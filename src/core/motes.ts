import { zoneEntered, type LogLine } from './logLine'
import { localDay } from './dates'

export { localDay }

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

/**
 * Fragments of <Rank> Potential (2026-11-12 patch): reward-chest and raid-boss drops beside motes,
 * nine ranks with no Infinite. `xp` is what one gives an item, read off the game's upgrade previews;
 * `checked` is false where that is a guess from the pattern (Greater, Grand, Ascendant, not yet seen).
 * On a spell a fragment gives 2^rank xp (fragmentSpellXp), twice the mote of its rank. A fragment of
 * rank R works on an item below +R, and they do not combine.
 */
export const FRAGMENT_RANKS = [
  { key: 'infinitesimal', name: 'Infinitesimal', xp: 2, checked: true },
  { key: 'minor', name: 'Minor', xp: 3, checked: true },
  { key: 'lesser', name: 'Lesser', xp: 4, checked: true },
  { key: 'potential', name: '', xp: 6, checked: true },
  { key: 'major', name: 'Major', xp: 8, checked: true },
  { key: 'greater', name: 'Greater', xp: 12, checked: false },
  { key: 'superior', name: 'Superior', xp: 16, checked: true },
  { key: 'grand', name: 'Grand', xp: 24, checked: false },
  { key: 'ascendant', name: 'Ascendant', xp: 32, checked: false }
] as const

/** A fragment's xp on a spell, by rank index: Infinitesimal 2, Potential 16, Superior 128. */
export function fragmentSpellXp(index: number): number {
  return 2 ** (index + 1)
}

/** What a fragment is worth in Infinitesimal motes: its xp on a spell, as a mote's worth is. */
export function fragmentWorth(index: number): number {
  return fragmentSpellXp(index)
}

export function fragmentName(rank: MoteKey, count = 1): string {
  const r = FRAGMENT_RANKS.find((x) => x.key === rank)
  const of = r?.name ? `${r.name} Potential` : 'Potential'
  return `${count === 1 ? 'Fragment' : 'Fragments'} of ${of}`
}

/** Whether a fragment's item xp has been seen in game, not guessed. */
export function fragmentChecked(rank: MoteKey): boolean {
  return FRAGMENT_RANKS.some((r) => r.key === rank && r.checked)
}

export type SessionOutcome = 'active' | 'completed' | 'abandoned' | 'stopped' | 'game closed'

export interface MoteSession {
  id: string
  /**
   * An instance run is a crawl only once the game says so: nothing in the log tells a Dungeon Crawl
   * instance from a normal one until "You have completed the Dungeon Crawl" and its reward chest.
   * One that ends without them stays 'instance': a normal instance.
   */
  kind: 'instance' | 'crawl' | 'manual'
  /** The kind was set by the player (see MoteState.marks). */
  byHand?: boolean
  /** The instance zone: "The Plane of Fear 4 (Refined)". */
  name: string
  startedAt: number
  endedAt: number | null
  outcome: SessionOutcome
  motes: MoteCounts
  /** Fragments of Potential looted in the run, by rank, kept apart from the motes. */
  fragments?: MoteCounts
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
  /** A Fragment of Potential, not a mote. */
  fragment?: true
}

// "You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency"
// "You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency"
// "You looted a Mote of Potential from …" — the unnamed rank.
// "You looted 4 Fragment of Major Potential from Reward Chest and stored it in your currency"
// "--You have looted a Fragment of Superior Potential from Lady Vox's corpse.--"
const RE_LOOT = /^(?:--)?You (?:have )?looted (a|an|\d+) (Mote|Fragment)s? of (?:(\w+) )?Potential from (.+?)(?: and stored it in your currency|\.--|\.)?$/
// "You have entered The Plane of Fear 4 (Refined)." / "… Nagafen's Lair - Solo 4 (Refined)."
const RE_INSTANCE = /^(.+?)(?: - (?:Solo|Group))? (\d+) \((\w+)\)$/
const RE_CREATING = /^Player .+ creating instance .+ \d+\.$/
const RE_COMPLETED = /^You have completed the Dungeon Crawl/

/** A crawl you have been out of this long is taken as abandoned, ending when you left. */
const ABANDON_AFTER_MS = 30 * 60_000
/** The reward chest's motes are logged just after the completion line. */
const CHEST_GRACE_MS = 15_000

export function parseMoteLoot(text: string): MoteLoot | null {
  const m = RE_LOOT.exec(text)
  if (!m) return null
  const fragment = m[2] === 'Fragment'
  const rank = (m[3] ? m[3].toLowerCase() : 'potential') as MoteKey
  if (!(fragment ? FRAGMENT_RANKS : MOTE_RANKS).some((r) => r.key === rank)) return null
  const count = /^\d+$/.test(m[1]) ? Number(m[1]) : 1
  return { rank, count, source: m[4].replace(/'s corpse$/, ''), ...(fragment ? { fragment: true as const } : {}) }
}

function isCrawlInstance(zone: string): boolean {
  return RE_INSTANCE.test(zone)
}

/** A run's key for MoteState.marks: the same run gets the same key on every rescan, unlike its id. */
export function markKey(s: Pick<MoteSession, 'name' | 'startedAt'>): string {
  return `${s.name}@${s.startedAt}`
}

/** Puts the player's hand-set kinds back on rebuilt runs. */
export function applyMarks(state: MoteState): MoteState {
  const marks = state.marks ?? {}
  const mark = (s: MoteSession): MoteSession => {
    const kind = s.kind === 'manual' ? undefined : marks[markKey(s)]
    if (!kind) return s
    return { ...s, kind, byHand: true, ...(kind === 'crawl' && s.outcome !== 'active' ? { outcome: 'completed' as const } : {}) }
  }
  return { ...state, active: state.active ? mark(state.active) : null, sessions: state.sessions.map(mark) }
}

export function totalMotes(c: MoteCounts): number {
  return Object.values(c).reduce((n, v) => n + (v ?? 0), 0)
}

/**
 * What a rank is worth counted in Infinitesimal motes. Two motes of a rank combine into one of the
 * next, so each rank is worth double the one below: Minor 2, Potential 8, Major 16, Superior 64.
 */
export function moteWorth(index: number): number {
  return 2 ** index
}

/** The combine value of a haul, in Infinitesimal motes. Higher ranks count for what they took to make. */
export function moteValue(c: MoteCounts): number {
  return MOTE_RANKS.reduce((n, r, i) => n + (c[r.key] ?? 0) * moteWorth(i), 0)
}

export function moteName(rank: MoteKey): string {
  const r = MOTE_RANKS.find((x) => x.key === rank)!
  return r.name ? `Mote of ${r.name} Potential` : 'Mote of Potential'
}

export interface MoteHooks {
  onChange: () => void
  onLoot?: (loot: MoteLoot, session: MoteSession | null, time: number) => void
  onSession?: (session: MoteSession) => void
}

export interface MoteState {
  active: MoteSession | null
  sessions: MoteSession[]
  /** Motes looted per local day, "2026-09-24". */
  daily: Record<string, MoteCounts>
  /** The time of the last log line read, so a restart can catch up on what it missed. */
  seenUntil?: number
  /**
   * Kinds the player set by hand, by run (see markKey), so a rescan of the logs puts them back. A
   * crawl in someone else's instance prints no completion line for you, so it needs marking.
   */
  marks?: Record<string, 'crawl' | 'instance'>
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

  /** Whether the line was a mote's, a login, or an instance's making or end (FEAT-025). */
  handle(line: LogLine): boolean {
    const took = this.dispatch(line)
    this.lastTime = line.time
    this.state.seenUntil = line.time
    return took
  }

  private dispatch(line: LogLine): boolean {
    const { text, time } = line
    const loot = parseMoteLoot(text)
    if (loot) {
      this.onLoot(loot, time)
      return true
    }

    // A fresh login: whatever crawl was open ended when the last session did.
    if (text === 'Welcome to EverQuest Legends!') {
      const a = this.state.active
      if (a && a.kind !== 'manual' && this.lastTime) this.end('game closed', a.outsideSince ?? this.lastTime)
      return true
    }

    if (RE_CREATING.test(text)) {
      this.newInstancePending = true
      return true
    }
    if (RE_COMPLETED.test(text)) {
      const a = this.state.active
      if (a && a.kind !== 'manual') {
        a.kind = 'crawl'
        this.end('completed', time)
      }
      return true
    }
    const zone = zoneEntered(text)
    if (zone) this.onZone(zone, time)
    return !!zone
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
    if (!loot.fragment) {
      const counts = (this.state.daily[localDay(time)] ??= {})
      counts[loot.rank] = (counts[loot.rank] ?? 0) + loot.count
    }
    // The reward chest is logged after the completion line; it belongs to the crawl just finished.
    const recent = this.lastEnded && time - this.lastEnded.at <= CHEST_GRACE_MS ? this.lastEnded.session : null
    const target = this.state.active ?? recent
    if (target) {
      const into = loot.fragment ? (target.fragments ??= {}) : target.motes
      into[loot.rank] = (into[loot.rank] ?? 0) + loot.count
    }
    this.hooks.onLoot?.(loot, target, time)
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
      s.outsideMs += Math.max(0, time - s.outsideSince)
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
    if (s.kind === 'instance' && totalMotes(s.motes) + totalMotes(s.fragments ?? {}) === 0) {
      this.hooks.onChange()
      return
    }
    this.state.sessions = [s, ...this.state.sessions].slice(0, 500)
    this.hooks.onSession?.(s)
    this.hooks.onChange()
  }

  /**
   * The player says what a run was: a crawl the log never confirmed (someone else's instance, so the
   * completion line was theirs), or a normal instance after all. Remembered across rescans.
   */
  setKind(id: string, kind: 'crawl' | 'instance'): boolean {
    const s = this.state.active?.id === id ? this.state.active : this.state.sessions.find((x) => x.id === id)
    if (!s || s.kind === 'manual') return false
    s.kind = kind
    s.byHand = true
    if (kind === 'crawl' && s.outcome !== 'active') s.outcome = 'completed'
    ;(this.state.marks ??= {})[markKey(s)] = kind
    this.hooks.onChange()
    return true
  }

  /** Drops a finished run from the history; false when there is none by that id. */
  forget(id: string): boolean {
    const before = this.state.sessions.length
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id)
    if (this.state.sessions.length === before) return false
    this.hooks.onChange()
    return true
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

/** A place's runs together (FEAT-035): how many, the hours in them, and the motes they dropped by rank. */
export interface FarmPlace {
  name: string
  runs: number
  hours: number
  motes: MoteCounts
}

/** Every place the runs were in, by name ("The Plane of Hate 4 (Refined)"), runs still open left out. */
export function farmPlaces(sessions: readonly MoteSession[], now: number): FarmPlace[] {
  const by = new Map<string, FarmPlace>()
  for (const s of sessions) {
    if (s.endedAt === null || s.kind === 'manual') continue
    const p = by.get(s.name) ?? { name: s.name, runs: 0, hours: 0, motes: {} }
    p.runs++
    p.hours += sessionHours(s, now)
    for (const [k, n] of Object.entries(s.motes) as [MoteKey, number][]) p.motes[k] = (p.motes[k] ?? 0) + n
    by.set(s.name, p)
  }
  return [...by.values()]
}

/** The places that dropped a rank fastest, two runs or more each: "Plane of Hate 4 (Refined) 2.1 Superior an hour over 9 runs". */
export function bestFor(places: readonly FarmPlace[], rank: MoteKey): (FarmPlace & { perHour: number })[] {
  return places
    .filter((p) => p.runs >= 2 && p.hours > 0 && (p.motes[rank] ?? 0) > 0)
    .map((p) => ({ ...p, perHour: (p.motes[rank] ?? 0) / p.hours }))
    .sort((a, b) => b.perHour - a.perHour)
}

export function pausedHours(s: MoteSession, now: number): number {
  const end = s.endedAt ?? now
  return ((s.pausedMs ?? 0) + (s.pausedSince ? Math.max(0, end - s.pausedSince) : 0)) / 3_600_000
}

/** "13:05" on the session's day → a timestamp. */
export function timeOnDay(day: number, hhmm: string): number | null {
  // As timeOfDay writes it in either clock: "13:05", "1:05:00 PM" (a 12-hour clock's time read back, LT-695).
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?$/.exec(hhmm.trim())
  if (!m) return null
  let h = +m[1]
  if (m[4]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (/p/i.test(m[4]) ? 12 : 0)
  } else if (h > 23) return null
  if (+m[2] > 59 || +(m[3] ?? 0) > 59) return null
  const d = new Date(day)
  d.setHours(h, +m[2], +(m[3] ?? 0), 0)
  return d.getTime()
}
