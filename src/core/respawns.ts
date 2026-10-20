import { zoneEntered, type LogLine } from './logLine'
import { SELF, type CombatEvent } from './combatLines'
import { displayName, isFriend } from './combatMeter'
import { parseLoc, type Loc } from './where'
import type { EntityKind, Trigger } from '../shared/types'

// How long mobs take to respawn, measured from the log. A kill opens a watch on that name in that
// zone; the first line that names the mob again closes it: it hits or is hit, casts, speaks, is
// considered, or is killed again. Death to that line is an observed gap. A mob can only be seen
// after it is up, so every gap is at least the respawn time, and the shortest gap is the best
// estimate. Leaving the zone ends every watch: what happened while you were away is unknown.
//
// Records survive restarts, and the same log is read again at every start (the last hour, for the
// meter), so each step is idempotent: a kill at or before the record's last death is one already
// counted, and a watch only closes on a line after its death.
//
// A spawn point that pops one of several mobs (a placeholder, or the named it gives way to) is one
// record that lists their names: a death of any of them opens its watch, and any of them seen again
// closes it. The log never says where a mob is, so the player says which names are one spawn.
//
// A spawn pinned to a spot (`spot`) is one of many mobs sharing a name: the log can only tell it from
// the rest by the player's /loc. A kill of one of its names waits for the next /loc; one within
// SPOT_CONFIRM_MS and within `spot.within` of it makes the kill the spot's, and starts its timer from
// the death. Its names keep their own records, counting every kill in the zone. A sighting cannot be
// told apart either, so a gap at the spot runs from its death to the start of the fight that ends in
// its next kill.

/** Lines naming the mob this soon after it died are its death, not its return. */
const SETTLE_MS = 3_000
/** How long a kill of a pinned spawn's mob waits for the player's /loc to say where it was. */
export const SPOT_CONFIRM_MS = 30_000
/** How near the spot a /loc must be when the player does not say. */
export const SPOT_WITHIN = 50
/** Lines naming a mob closer together than this are one fight with it. */
const FIGHT_GAP_MS = 15_000
/** A gap shorter than this is another mob with the same name, not a respawn. */
export const SHARED_SEC = 30
const KEEP_GAPS = 20
const KEEP_RECORDS = 400

export interface RespawnRecord {
  zone: string
  /** As the log prints it first in a sentence: "A shiverback", "Coercer T`vala". */
  name: string
  kills: number
  lastDeath: number
  /** The death still waiting for the mob to be seen again; 0 when none is. */
  pendingSince: number
  /** Death to next sighting, in seconds, oldest first. */
  gaps: number[]
  /** Two of this name were up at once, so its gaps say little about any one spawn. */
  shared: boolean
  /** A spawn point several mobs pop at: their names, as the log prints them. `name` is then the spawn's own name. */
  names?: string[]
  /** Where a spawn point is, for one of many mobs sharing a name: only kills a /loc puts here count. */
  spot?: SpawnSpot
}

/** A spawn point's place: y, x and z in the /loc order, and how near a /loc must be. */
export interface SpawnSpot {
  at: [number, number, number?]
  within: number
}

export type RespawnRecords = Record<string, RespawnRecord>

export const respawnKey = (zone: string, name: string): string => `${zone.toLowerCase()}|${name.toLowerCase()}`

/** A spawn point's names, as the Respawns page sends them: which zone, what to call it, the mobs it pops, and where it is when pinned. */
export interface SpawnLink {
  zone: string
  name: string
  names: string[]
  spot?: SpawnSpot
}

/** How far a /loc is from a spot, z counted when the spot has one. */
export function spotDistance(spot: SpawnSpot, loc: Loc): number {
  const [y, x, z] = spot.at
  return Math.hypot(loc.y - y, loc.x - x, z === undefined ? 0 : loc.z - z)
}

/** "289, -375": a spot as /loc gives it, rounded. */
export const spotText = (spot: SpawnSpot): string => `${Math.round(spot.at[0])}, ${Math.round(spot.at[1])}`

/** A kill of a pinned spawn's mob, waiting for a /loc to say which spot it was. */
interface HeldKill {
  keys: string[]
  line: LogLine
  /** When the fight that ended in it began: where a gap at the spot ends. */
  fightStart: number
}

/** Gaps a record's estimate can go by: past SHARED_SEC, and with three or more, none under half their median (LT-736). */
function trustedGaps(gaps: readonly number[]): { kept: number[]; dropped: number } {
  const real = gaps.filter((g) => g >= SHARED_SEC)
  if (real.length < 3) return { kept: real, dropped: 0 }
  const sorted = [...real].sort((a, b) => a - b)
  const mid = sorted.length / 2
  const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2
  // One of the name wandering past 45 s after a kill is not a 45-second respawn.
  const kept = real.filter((g) => g >= median / 2)
  return { kept, dropped: real.length - kept.length }
}

/** The shortest gap that could be a respawn, in seconds; null before any. A gap far under the rest is left out (LT-736). */
export function respawnEstimate(r: Pick<RespawnRecord, 'gaps'>): number | null {
  const { kept } = trustedGaps(r.gaps)
  return kept.length ? Math.min(...kept) : null
}

/** How many of a record's gaps its estimate leaves out as too short to be a respawn. */
export function respawnDropped(r: Pick<RespawnRecord, 'gaps'>): number {
  return trustedGaps(r.gaps).dropped
}

/**
 * What else says how long a mob takes, where its record does not: the spawn tables' timer for it in
 * Legends' terms (its own, timed, or classic's), and the zone's median of the timers the records make
 * (LT-736). Main hands it in from the Slayer tables.
 */
export interface RespawnFallback {
  mob: { seconds: number; from: 'timed' | 'zone' | 'classic' } | null
  zone: number | null
}

export interface RespawnHooks {
  onChange: () => void
  /** Who a name is, as the damage meter has worked it out. */
  kindOf: (name: string) => EntityKind
  /** A /loc made a kill a pinned spawn's: its timer starts from `death`, the kill's line. */
  onSpot?: (r: RespawnRecord, death: LogLine) => void
}

export class RespawnLog {
  constructor(
    readonly records: RespawnRecords,
    private readonly hooks: RespawnHooks
  ) {}

  /** One log line, with the zone it was written in and what the combat parser made of it. */
  handle(line: LogLine, zone: string, ev: CombatEvent | null): void {
    const entered = zoneEntered(line.text)
    if (entered) {
      this.held = []
      this.fights.clear()
      return this.left(line.time)
    }
    if (!zone) return
    if (ev) {
      if (ev.kind === 'kill') {
        this.fought(zone, ev.target, line.time)
        this.seen(zone, ev.target, line.time)
        this.died(zone, ev.target, ev.killer, line)
      } else if (ev.kind === 'damage' || ev.kind === 'miss' || ev.kind === 'heal' || ev.kind === 'resist') {
        this.fought(zone, ev.source, line.time)
        this.fought(zone, ev.target, line.time)
        this.seen(zone, ev.source, line.time)
        this.seen(zone, ev.target, line.time)
      } else if (ev.kind === 'cast') {
        this.fought(zone, ev.source, line.time)
        this.seen(zone, ev.source, line.time)
      }
      return
    }
    if (this.held.length && line.text.startsWith('Your Location is ')) {
      const loc = parseLoc(line.text)
      if (loc) this.located(loc, line.time)
      return
    }
    // Speech, emotes and /consider all begin with the mob's name. "<name>'s corpse" does not count.
    const open = this.watching()
    if (!open.size) return
    const sp = line.text.indexOf(' ')
    if (sp <= 0) return
    const watches = open.get(`${zone.toLowerCase()}|${line.text.slice(0, sp).toLowerCase()}`)
    if (!watches) return
    for (const w of watches) {
      if (w.record.pendingSince && line.text.slice(0, w.prefix.length).toLowerCase() === w.prefix) this.sighted(w.record, line.time)
    }
  }

  // Which spawn each name belongs to, by zone and name, lowercased. Worked out again after a link changes.
  private spawns: Map<string, string> | null = null

  /** The record a mob's lines go to: its spawn's, when it is one of a spawn's names, else its own. A pinned spawn takes none. */
  private keyFor(zone: string, name: string): string {
    if (!this.spawns) {
      this.spawns = new Map()
      for (const [key, r] of Object.entries(this.records)) if (!r.spot) for (const n of r.names ?? []) this.spawns.set(respawnKey(r.zone, n), key)
    }
    const own = respawnKey(zone, name)
    return this.spawns.get(own) ?? own
  }

  // The pinned spawns each name may be, by zone and name, lowercased. Worked out again after a link changes.
  private pins: Map<string, string[]> | null = null

  private pinned(): Map<string, string[]> {
    if (!this.pins) {
      this.pins = new Map()
      for (const [key, r] of Object.entries(this.records)) {
        if (!r.spot) continue
        for (const n of r.names ?? []) {
          const k = respawnKey(r.zone, n)
          this.pins.set(k, [...(this.pins.get(k) ?? []), key])
        }
      }
    }
    return this.pins
  }

  /** The fights going on with pinned spawns' mobs, by zone and name: when each began, and its latest line. */
  private readonly fights = new Map<string, { start: number; last: number }>()
  /** Kills of pinned spawns' mobs waiting for a /loc, oldest first. */
  private held: HeldKill[] = []

  /** A line naming a pinned spawn's mob: the fight with it goes on, or a new one begins. */
  private fought(zone: string, name: string, at: number): void {
    if (!this.pinned().size) return
    const k = respawnKey(zone, name)
    if (!this.pins!.has(k)) return
    const f = this.fights.get(k)
    if (f && at - f.last <= FIGHT_GAP_MS) f.last = at
    else this.fights.set(k, { start: at, last: at })
  }

  /** A /loc: the kills waiting go to the spots it is near, the latest kill to the nearest spot it could be; the rest were elsewhere. */
  private located(loc: Loc, at: number): void {
    const held = this.held.filter((h) => at >= h.line.time && at - h.line.time <= SPOT_CONFIRM_MS)
    this.held = []
    const near = [...new Set(held.flatMap((h) => h.keys))]
      .map((key) => ({ key, r: this.records[key] }))
      .filter((s) => s.r?.spot && spotDistance(s.r.spot, loc) <= s.r.spot.within)
      .sort((a, b) => spotDistance(a.r.spot!, loc) - spotDistance(b.r.spot!, loc))
    const used = new Set<HeldKill>()
    for (const s of near) {
      const h = held.findLast((x) => !used.has(x) && x.keys.includes(s.key))
      if (!h) continue
      used.add(h)
      this.spotKill(s.r, h)
    }
  }

  private spotKill(r: RespawnRecord, h: HeldKill): void {
    const at = h.line.time
    // Counted already, on an earlier read of the same log.
    if (at <= r.lastDeath + SETTLE_MS) return
    if (r.pendingSince && h.fightStart >= r.pendingSince + SETTLE_MS) this.addGap(r, Math.round((h.fightStart - r.pendingSince) / 1000))
    r.kills++
    r.lastDeath = at
    r.pendingSince = at
    this.hooks.onSpot?.(r, h.line)
    this.hooks.onChange()
  }

  // The watches open, by zone and the first word of the name, lowercased once: most lines are not
  // combat, and each is looked up here by its own first word. Worked out again after any change.
  private open: Map<string, { record: RespawnRecord; prefix: string }[]> | null = null

  private watching() {
    if (!this.open) {
      this.open = new Map()
      for (const record of Object.values(this.records)) {
        if (!record.pendingSince || record.spot) continue
        for (const name of record.names ?? [record.name]) {
          const prefix = name.toLowerCase() + ' '
          const key = `${record.zone.toLowerCase()}|${prefix.slice(0, prefix.indexOf(' '))}`
          const list = this.open.get(key)
          if (list) list.push({ record, prefix })
          else this.open.set(key, [{ record, prefix }])
        }
      }
    }
    return this.open
  }

  /** Forgets a record's kills and gaps; a spawn point keeps its mobs and starts afresh. */
  forget(key: string): boolean {
    const r = this.records[key]
    if (!r) return false
    if (r.names)
      this.records[key] = { zone: r.zone, name: r.name, kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false, names: r.names, ...(r.spot ? { spot: r.spot } : {}) }
    else delete this.records[key]
    this.open = null
    this.hooks.onChange()
    return true
  }

  /**
   * Makes `link.names` one spawn point in `link.zone`, called `link.name`, or changes the names of the
   * one already called that. What the names had on record of their own goes into it: the kills, and
   * the last death with its watch. Their gaps do not, as each measured one name rather than the spot,
   * and a name taken from another spawn leaves that one. Returns the spawn's key.
   *
   * A spawn pinned to a spot (`link.spot`) takes nothing: its names are shared with mobs elsewhere, so
   * they keep their own records, and it counts from its first kill a /loc puts there.
   */
  link(link: SpawnLink): string {
    const key = respawnKey(link.zone, link.name)
    const names = [...new Map(link.names.map((n) => [n.toLowerCase(), displayName(n)])).values()]
    const was = this.records[key]
    if (was && !was.names && (link.spot || !names.some((n) => n.toLowerCase() === was.name.toLowerCase()))) {
      throw new Error(`${was.name} is a mob of its own in ${was.zone}: call the spawn something else${link.spot ? '' : `, or make ${was.name} one of its mobs`}.`)
    }
    if (link.spot) {
      this.records[key] = was?.names
        ? { ...was, names, spot: link.spot }
        : { zone: link.zone, name: link.name, kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false, names, spot: link.spot }
      this.open = this.spawns = this.pins = null
      this.hooks.onChange()
      return key
    }
    const spawn: RespawnRecord = was?.names
      ? { ...was, names }
      : { zone: was?.zone ?? link.zone, name: link.name, kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false, names }
    // A pinned spawn unpinned: its names are the spot's alone from now on.
    delete spawn.spot
    const take = (r: RespawnRecord) => {
      spawn.kills += r.kills
      if (r.lastDeath > spawn.lastDeath) {
        spawn.lastDeath = r.lastDeath
        spawn.pendingSince = r.pendingSince
      }
    }
    // A mob on record under the spawn's own name, one of its names.
    if (was && !was.names) take(was)
    for (const n of names) {
      const from = this.keyFor(spawn.zone, n)
      const r = this.records[from]
      if (!r || from === key) continue
      if (r.names) {
        // Another spawn had this name: it keeps its record and the rest of its names.
        r.names = r.names.filter((x) => x.toLowerCase() !== n.toLowerCase())
        if (!r.names.length) delete this.records[from]
        continue
      }
      take(r)
      delete this.records[from]
    }
    this.records[key] = spawn
    this.open = this.spawns = this.pins = null
    this.prune()
    this.hooks.onChange()
    return key
  }

  /** The spawn point called `name`, in any zone: its names, and its spot when pinned; null when no spawn is called that. */
  spawnOf(name: string): { names: string[]; spot?: SpawnSpot } | null {
    const r = Object.values(this.records).find((x) => x.names && x.name.toLowerCase() === name.toLowerCase())
    return r?.names ? { names: [...r.names], ...(r.spot ? { spot: r.spot } : {}) } : null
  }

  /** Undoes a spawn point: its names are mobs of their own again, starting afresh. */
  unlink(key: string): boolean {
    if (!this.records[key]?.names) return false
    delete this.records[key]
    this.open = this.spawns = this.pins = null
    this.hooks.onChange()
    return true
  }

  private died(zone: string, name: string, killer: string | null, line: LogLine): void {
    if (name === SELF) return
    const at = line.time
    const kind = this.hooks.kindOf(name)
    // A single capitalised word nobody has placed yet is a mob only if one of ours killed it.
    const mob = kind === 'npc' || (kind === 'unknown' && killer !== null && (killer === SELF || isFriend(this.hooks.kindOf(killer))))
    if (!mob) return
    this.hold(zone, name, line)
    const key = this.keyFor(zone, name)
    let r = this.records[key]
    if (r && at <= r.lastDeath + SETTLE_MS) return
    if (!r) r = this.records[key] = { zone, name: displayName(name), kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false }
    r.kills++
    r.lastDeath = at
    r.pendingSince = at
    this.open = null
    this.prune()
    this.hooks.onChange()
  }

  private seen(zone: string, name: string, at: number): void {
    const r = this.records[this.keyFor(zone, name)]
    if (r) this.sighted(r, at)
  }

  private sighted(r: RespawnRecord, at: number): void {
    if (!r.pendingSince || at < r.pendingSince + SETTLE_MS) return
    const gap = Math.round((at - r.pendingSince) / 1000)
    r.pendingSince = 0
    this.open = null
    this.addGap(r, gap)
    this.hooks.onChange()
  }

  private addGap(r: RespawnRecord, gap: number): void {
    r.gaps.push(gap)
    if (r.gaps.length > KEEP_GAPS) r.gaps.splice(0, r.gaps.length - KEEP_GAPS)
    if (gap < SHARED_SEC) r.shared = true
  }

  /** A mob died: if a pinned spawn has its name, the kill waits for a /loc, with when the fight with it began. */
  private hold(zone: string, name: string, line: LogLine): void {
    const k = respawnKey(zone, name)
    const keys = this.pinned().get(k)
    const fight = this.fights.get(k)
    this.fights.delete(k)
    if (!keys) return
    this.held = [...this.held.filter((h) => line.time - h.line.time <= SPOT_CONFIRM_MS), { keys, line, fightStart: fight?.start ?? line.time }]
  }

  /** A zone line: every watch opened before it is off. */
  private left(at: number): void {
    let changed = false
    for (const r of Object.values(this.records)) {
      if (r.pendingSince && r.pendingSince < at) {
        r.pendingSince = 0
        changed = true
      }
    }
    if (changed) {
      this.open = null
      this.hooks.onChange()
    }
  }

  /** The oldest kills go past KEEP_RECORDS; a spawn point stays, as the player made it. */
  private prune(): void {
    const keys = Object.keys(this.records).filter((k) => !this.records[k].names)
    if (keys.length <= KEEP_RECORDS) return
    keys.sort((a, b) => this.records[a].lastDeath - this.records[b].lastDeath)
    for (const k of keys.slice(0, keys.length - KEEP_RECORDS)) delete this.records[k]
  }
}

// ---- the trigger a respawn timer is ----

export interface RespawnTimerSpec {
  /** The mob's, or a spawn point's own name. */
  name: string
  /** A spawn point's: the mobs whose deaths start it. */
  names?: string[]
  /** A pinned spawn's: the respawn log starts it when a /loc puts a kill here, so it has no phrase of its own. */
  spot?: SpawnSpot
  seconds: number
  overlay: string
  /** Seconds before it is up to say so; 0 = no warning. */
  warnSec: number
  /** Say "<name> is up" when the timer ends. */
  announce: boolean
}

/** "18:47", "1:02:03" or plain seconds; null for anything else. */
export function parseClock(text: string): number | null {
  const t = text.trim()
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(t)) return null
  const n = t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
  return n > 0 ? n : null
}

/** One trigger per mob name; the id is made from the name so it can be found again. */
export function respawnTriggerId(name: string): string {
  return (
    'respawn-' +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The three ways the log reports a death, for exactly this name, or any of these. Case-insensitive, as all phrases are. */
export function respawnPhrase(name: string | string[]): string {
  const names = typeof name === 'string' ? [name] : name
  const n = names.length === 1 ? escapeRegex(names[0]) : `(?:${names.map(escapeRegex).join('|')})`
  return `^(?:You have slain ${n}!|${n} has been slain by .+!|${n} died\\.)$`
}

/** The name as speech should say it: "Coercer T`vala" is read "Coercer Tvala". */
const spoken = (name: string) => name.replace(/[`]/g, '')

const RESPAWN_FOLDER = 'Respawns'
const RESPAWN_COLOR = '#6cc3ff'

export function respawnTrigger(spec: RespawnTimerSpec, existing?: Trigger): Trigger {
  const say = spoken(spec.name)
  const timer = existing?.actions.find((a) => a.type === 'timer')
  return {
    id: respawnTriggerId(spec.name),
    name: `${spec.name} respawn`,
    folder: existing?.folder ?? RESPAWN_FOLDER,
    enabled: true,
    comment: spec.spot
      ? `Made on the Respawns page. Started by a kill of ${(spec.names ?? [spec.name]).join(' or ')} when your /loc within ${SPOT_CONFIRM_MS / 1000} s of it is within ${spec.spot.within} of ${spotText(spec.spot)}: no phrase of its own.`
      : spec.names?.length
        ? `Made on the Respawns page. Starts when any of ${spec.names.join(', ')} dies.`
        : (existing?.comment ?? `Made on the Respawns page. Starts when ${spec.name} dies.`),
    phrases: spec.spot ? [] : [{ text: respawnPhrase(spec.names?.length ? spec.names : spec.name), regex: true }],
    cooldownSec: 0,
    actions: [
      {
        type: 'timer',
        name: spec.name,
        durationSec: spec.seconds,
        color: timer?.type === 'timer' ? timer.color : RESPAWN_COLOR,
        overlay: spec.overlay,
        warnSec: spec.warnSec,
        warnSpeech: spec.warnSec > 0 ? `${say} in ${spec.warnSec} seconds` : '',
        endSpeech: spec.announce ? `${say} is up` : '',
        restart: 'restart',
        endEarly: []
      },
      // Anything else added to it on the Triggers page is kept.
      ...(existing?.actions.filter((a) => a.type !== 'timer') ?? [])
    ]
  }
}

/** A respawn trigger's timer, as the Respawns page shows it. */
interface RespawnTimerInfo {
  triggerId: string
  enabled: boolean
  seconds: number
  overlay: string
  warnSec: number
  announce: boolean
}

export interface RespawnRow extends RespawnRecord {
  key: string
  estimate: number | null
  /** The timer made for this name, wherever it was killed; null when there is none. */
  timer: RespawnTimerInfo | null
  /** Gaps the estimate leaves out as far too short: another of the name wandering past (LT-736). */
  dropped?: number
  /** The spawn tables' timer for it, in Legends' terms, where they have it. */
  tables?: RespawnFallback['mob'] & {}
  /** The middle of the zone's timers the records make. */
  zoneTimer?: number
}

/** How long a row's mob takes, best first: your timer, what the log timed, the tables', the zone's; null when nothing says. */
export function respawnLength(r: Pick<RespawnRow, 'timer' | 'estimate' | 'tables' | 'zoneTimer'>): number | null {
  return r.timer?.seconds ?? r.estimate ?? r.tables?.seconds ?? r.zoneTimer ?? null
}

/** What the Respawns page shows: every record, most recent death first, and the zone you are in. */
export interface RespawnView {
  zone: string
  rows: RespawnRow[]
  /** A push of the rows that changed alone, with the keys of those gone: merged into the page's (LT-555). */
  removed?: string[]
}

/**
 * The rows of `next` that differ from what was sent (`sent`, each row's JSON by key, updated here), and
 * the keys gone; null when nothing changed. A kill changes a row or two of four hundred.
 */
export function respawnChanges(next: RespawnView, sent: Map<string, string>): RespawnView | null {
  const rows: RespawnRow[] = []
  const seen = new Set<string>()
  for (const r of next.rows) {
    seen.add(r.key)
    const json = JSON.stringify(r)
    if (sent.get(r.key) !== json) {
      sent.set(r.key, json)
      rows.push(r)
    }
  }
  const removed = [...sent.keys()].filter((k) => !seen.has(k))
  for (const k of removed) sent.delete(k)
  return rows.length || removed.length ? { zone: next.zone, rows, removed } : null
}

/** A page's view with a push applied: whole, or its changed rows put in and the gone ones taken out, newest death first. */
export function mergeRespawns(had: RespawnView | null, next: RespawnView): RespawnView {
  if (!next.removed || !had) return next
  const gone = new Set([...next.removed, ...next.rows.map((r) => r.key)])
  const rows = [...had.rows.filter((r) => !gone.has(r.key)), ...next.rows].sort((a, b) => b.lastDeath - a.lastDeath)
  return { zone: next.zone, rows }
}

export function respawnView(
  records: RespawnRecords,
  triggers: Trigger[],
  zone: string,
  fallback: (zone: string, name: string) => RespawnFallback | null = () => null
): RespawnView {
  const mine = triggers.filter((t) => t.id.startsWith('respawn-'))
  const timers = new Map(mine.map((t) => [t.id, respawnTimerOf(t)]))
  const rows = Object.entries(records)
    .map(([key, r]): RespawnRow => ({
      ...r,
      gaps: [...r.gaps],
      ...(r.names ? { names: [...r.names] } : {}),
      ...(r.spot ? { spot: { ...r.spot, at: [...r.spot.at] as SpawnSpot['at'] } } : {}),
      key,
      estimate: respawnEstimate(r),
      timer: timers.get(respawnTriggerId(r.name)) ?? null,
      ...withFallback(r, fallback)
    }))
    .sort((a, b) => b.lastDeath - a.lastDeath)
  // A timer added by name, for a mob not killed since: listed so it can be changed here too.
  const named = new Set(rows.map((r) => respawnTriggerId(r.name)))
  for (const t of mine) {
    const a = t.actions.find((x) => x.type === 'timer')
    if (named.has(t.id) || a?.type !== 'timer') continue
    rows.push({ zone: '', name: a.name, kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false, key: `timer|${t.id}`, estimate: null, timer: respawnTimerOf(t) })
  }
  return { zone, rows }
}

/** A row's dropped gaps and what else times it, left off when there is nothing to say. */
function withFallback(r: RespawnRecord, fallback: (zone: string, name: string) => RespawnFallback | null): Pick<RespawnRow, 'dropped' | 'tables' | 'zoneTimer'> {
  const dropped = respawnDropped(r)
  const f = fallback(r.zone, r.name)
  return { ...(dropped ? { dropped } : {}), ...(f?.mob ? { tables: f.mob } : {}), ...(f?.zone ? { zoneTimer: f.zone } : {}) }
}

function respawnTimerOf(t: Trigger): RespawnTimerInfo | null {
  const a = t.actions.find((x) => x.type === 'timer')
  if (!a || a.type !== 'timer') return null
  return { triggerId: t.id, enabled: t.enabled, seconds: a.durationSec, overlay: a.overlay, warnSec: a.warnSec, announce: !!a.endSpeech }
}

/** A respawn trigger's timer as a spec to make it again with; null when it has no timer. */
export function respawnTimerSpec(t: Trigger): RespawnTimerSpec | null {
  const a = t.actions.find((x) => x.type === 'timer')
  if (!a || a.type !== 'timer') return null
  return { name: a.name, seconds: a.durationSec, overlay: a.overlay, warnSec: a.warnSec, announce: !!a.endSpeech }
}
