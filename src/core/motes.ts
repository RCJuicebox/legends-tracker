import type { LogLine } from './logLine'

/** Mote ranks in upgrade order, with the item XP each is worth (from the EQL mote guide). */
export const MOTE_RANKS = [
  { key: 'infinitesimal', name: 'Infinitesimal', xp: 1 },
  { key: 'minor', name: 'Minor', xp: 1 },
  { key: 'lesser', name: 'Lesser', xp: 2 },
  { key: 'potential', name: '', xp: 4 },
  { key: 'major', name: 'Major', xp: 5 },
  { key: 'greater', name: 'Greater', xp: 6 },
  { key: 'superior', name: 'Superior', xp: 7 },
  { key: 'grand', name: 'Grand', xp: 8 },
  { key: 'ascendant', name: 'Ascendant', xp: 9 },
  { key: 'infinite', name: 'Infinite', xp: 10 }
] as const

export type MoteKey = (typeof MOTE_RANKS)[number]['key']
export type MoteCounts = Partial<Record<MoteKey, number>>

export type SessionOutcome = 'active' | 'completed' | 'abandoned' | 'stopped' | 'game closed'

export interface MoteSession {
  id: string
  /**
   * An instance run is a crawl only once the game says so: nothing in the log tells a Dungeon Crawl
   * instance from a normal one until "You have completed the Dungeon Crawl" and its reward chest.
   * One that ends without them stays 'instance': a normal instance.
   */
  kind: 'instance' | 'crawl' | 'manual'
  /** The instance zone: "The Plane of Fear 4 (Refined)". */
  name: string
  startedAt: number
  endedAt: number | null
  outcome: SessionOutcome
  motes: MoteCounts
  /** While a crawl is open but you are outside its instance (banking), when you left. */
  outsideSince: number | null
  /** Time spent outside the instance, so in-dungeon time can be shown too. */
  outsideMs: number
  /** While paused (stepped away), since when. Paused time does not count towards per-hour rates. */
  pausedSince?: number | null
  /** Paused time already over. */
  pausedMs?: number
}

export interface MoteLoot {
  rank: MoteKey
  count: number
  source: string
}

// "You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency"
// "You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency"
// "You looted a Mote of Potential from …" — the unnamed rank.
const RE_LOOT = /^(?:--)?You (?:have )?looted (a|an|\d+) Motes? of (?:(\w+) )?Potential from (.+?)(?: and stored it in your currency|\.--|\.)?$/
// "You have entered The Plane of Fear 4 (Refined)." / "… Nagafen's Lair - Solo 4 (Refined)."
const RE_INSTANCE = /^(.+?)(?: - (?:Solo|Group))? (\d+) \((\w+)\)$/
const RE_ZONE = /^You have entered (.+)\.$/
const RE_NOT_ZONE = /^(?:an? (?:area|Arena)|the Drunken)/i
const RE_CREATING = /^Player .+ creating instance .+ \d+\.$/
const RE_COMPLETED = /^You have completed the Dungeon Crawl/

/** A crawl you have been out of this long is taken as abandoned, ending when you left. */
export const ABANDON_AFTER_MS = 30 * 60_000
/** The reward chest's motes are logged just after the completion line. */
const CHEST_GRACE_MS = 15_000

export function parseMoteLoot(text: string): MoteLoot | null {
  const m = RE_LOOT.exec(text)
  if (!m) return null
  const rank = (m[2] ? m[2].toLowerCase() : 'potential') as MoteKey
  if (!MOTE_RANKS.some((r) => r.key === rank)) return null
  const count = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
  return { rank, count, source: m[3].replace(/'s corpse$/, '') }
}

export function isCrawlInstance(zone: string): boolean {
  return RE_INSTANCE.test(zone)
}

export function totalMotes(c: MoteCounts): number {
  return Object.values(c).reduce((n, v) => n + (v ?? 0), 0)
}

export function moteXp(c: MoteCounts): number {
  return MOTE_RANKS.reduce((n, r) => n + (c[r.key] ?? 0) * r.xp, 0)
}

export function moteName(rank: MoteKey): string {
  const r = MOTE_RANKS.find((x) => x.key === rank)!
  return r.name ? `Mote of ${r.name} Potential` : 'Mote of Potential'
}

export interface MoteHooks {
  onChange: () => void
  onLoot?: (loot: MoteLoot, session: MoteSession | null) => void
  onSession?: (session: MoteSession) => void
}

export interface MoteState {
  active: MoteSession | null
  sessions: MoteSession[]
  /** Motes looted per local day, "2026-09-24". */
  daily: Record<string, MoteCounts>
  /** The time of the last log line read, so a restart can catch up on what it missed. */
  seenUntil?: number
}

/**
 * Counts every mote you loot, per day, and times instance runs so motes per hour can be worked out.
 *
 * A run starts when you enter a tiered instance zone ("… 4 (Refined)"). The Instance window's
 * Normal / Dungeon Crawl choice never reaches the log, so a run becomes a crawl only when the game
 * says "You have completed the Dungeon Crawl" (the reward chest's motes, logged in the same second,
 * count towards it). A run also ends when you enter a different instance, when the game closes, or
 * after 30 minutes away; stepping out to bank and back into the same instance keeps it going. Runs
 * that end without completing are kept only if they produced motes. A manual session counts
 * everything between Start and Stop, and while one runs, instances do not start runs of their own.
 */
export class MoteTracker {
  state: MoteState
  private newInstancePending = false
  private lastEnded: { session: MoteSession; at: number } | null = null
  private seq = 0

  constructor(
    initial: MoteState,
    private readonly hooks: MoteHooks
  ) {
    this.state = initial
  }

  private lastTime = 0

  handle(line: LogLine): void {
    this.dispatch(line)
    this.lastTime = line.time
    this.state.seenUntil = line.time
  }

  private dispatch(line: LogLine): void {
    const { text, time } = line
    const loot = parseMoteLoot(text)
    if (loot) return this.onLoot(loot, time)

    // A fresh login: whatever crawl was open ended when the last session did.
    if (text === 'Welcome to EverQuest Legends!') {
      const a = this.state.active
      if (a && a.kind !== 'manual' && this.lastTime) this.end('game closed', a.outsideSince ?? this.lastTime)
      return
    }

    if (RE_CREATING.test(text)) {
      this.newInstancePending = true
      return
    }
    if (RE_COMPLETED.test(text)) {
      const a = this.state.active
      if (a && a.kind !== 'manual') {
        a.kind = 'crawl'
        this.end('completed', time)
      }
      return
    }
    const z = RE_ZONE.exec(text)
    if (z && !RE_NOT_ZONE.test(z[1])) this.onZone(z[1], time)
  }

  private onZone(zone: string, time: number): void {
    const a = this.state.active
    if (a?.kind === 'manual') return
    if (isCrawlInstance(zone)) {
      if (a && a.name === zone && !this.newInstancePending) {
        // Back in the same instance after stepping out.
        if (a.outsideSince !== null) {
          a.outsideMs += time - a.outsideSince
          a.outsideSince = null
          this.hooks.onChange()
        }
      } else {
        if (a) this.end('abandoned', a.outsideSince ?? time)
        this.begin('instance', zone, time)
      }
      this.newInstancePending = false
    } else if (a && a.outsideSince === null) {
      a.outsideSince = time
      this.hooks.onChange()
    }
  }

  private onLoot(loot: MoteLoot, time: number): void {
    const day = localDay(time)
    const counts = (this.state.daily[day] ??= {})
    counts[loot.rank] = (counts[loot.rank] ?? 0) + loot.count
    // The reward chest is logged after the completion line; it belongs to the crawl just finished.
    const recent = this.lastEnded && time - this.lastEnded.at <= CHEST_GRACE_MS ? this.lastEnded.session : null
    const target = this.state.active ?? recent
    if (target) target.motes[loot.rank] = (target.motes[loot.rank] ?? 0) + loot.count
    this.hooks.onLoot?.(loot, target)
    this.hooks.onChange()
  }

  private begin(kind: MoteSession['kind'], name: string, time: number): MoteSession {
    const s: MoteSession = {
      id: `${kind}-${time}-${++this.seq}`,
      kind,
      name,
      startedAt: time,
      endedAt: null,
      outcome: 'active',
      motes: {},
      outsideSince: null,
      outsideMs: 0,
      pausedSince: null,
      pausedMs: 0
    }
    this.state.active = s
    this.hooks.onChange()
    return s
  }

  private end(outcome: SessionOutcome, time: number): void {
    const s = this.state.active
    if (!s) return
    if (s.outsideSince !== null) {
      s.outsideMs += Math.max(0, Math.min(time, Date.now()) - s.outsideSince)
      s.outsideSince = null
    }
    if (s.pausedSince) {
      s.pausedMs = (s.pausedMs ?? 0) + Math.max(0, time - s.pausedSince)
      s.pausedSince = null
    }
    s.endedAt = time
    s.outcome = outcome
    this.state.active = null
    this.lastEnded = { session: s, at: time }
    // An instance visit that never completed and found no motes is not worth a row.
    if (s.kind === 'instance' && totalMotes(s.motes) === 0) {
      this.hooks.onChange()
      return
    }
    this.state.sessions = [s, ...this.state.sessions].slice(0, 500)
    this.hooks.onSession?.(s)
    this.hooks.onChange()
  }

  startManual(now: number, name = 'Manual session'): void {
    if (this.state.active) this.end(this.state.active.kind === 'manual' ? 'stopped' : 'abandoned', now)
    this.begin('manual', name, now)
  }

  stop(now: number): void {
    if (this.state.active) this.end('stopped', now)
  }

  gameClosed(now: number): void {
    const a = this.state.active
    if (a && a.kind !== 'manual') this.end('game closed', a.outsideSince ?? now)
  }

  /**
   * Pauses the running session: you have stepped away. `at` may be earlier than now, for when you
   * forgot to press Pause before leaving; it cannot be before the session started.
   */
  pause(at: number, now: number): void {
    const a = this.state.active
    if (!a) return
    a.pausedSince = Math.min(now, Math.max(a.startedAt, at))
    this.hooks.onChange()
  }

  resume(now: number): void {
    const a = this.state.active
    if (!a?.pausedSince) return
    a.pausedMs = (a.pausedMs ?? 0) + Math.max(0, now - a.pausedSince)
    a.pausedSince = null
    this.hooks.onChange()
  }

  /** Ends a run you left more than 30 minutes ago, as of when you left, unless it is paused. */
  tick(now: number): void {
    const a = this.state.active
    if (a && a.kind !== 'manual' && !a.pausedSince && a.outsideSince !== null && now - a.outsideSince > ABANDON_AFTER_MS) {
      this.end('abandoned', a.outsideSince)
    }
  }
}

/** Active hours: from start to end (or now), less any time paused. */
export function sessionHours(s: MoteSession, now: number): number {
  const end = s.endedAt ?? now
  const paused = (s.pausedMs ?? 0) + (s.pausedSince ? Math.max(0, end - s.pausedSince) : 0)
  return Math.max(0, end - s.startedAt - paused) / 3_600_000
}

export function pausedHours(s: MoteSession, now: number): number {
  const end = s.endedAt ?? now
  return ((s.pausedMs ?? 0) + (s.pausedSince ? Math.max(0, end - s.pausedSince) : 0)) / 3_600_000
}

export function localDay(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
