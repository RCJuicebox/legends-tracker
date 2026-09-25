import { zoneEntered, type LogLine } from './logLine'
import { SELF, type CombatEvent } from './combatLines'
import { displayName, isFriend } from './combatMeter'
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

/** Lines naming the mob this soon after it died are its death, not its return. */
const SETTLE_MS = 3_000
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
}

export type RespawnRecords = Record<string, RespawnRecord>

export const respawnKey = (zone: string, name: string): string => `${zone.toLowerCase()}|${name.toLowerCase()}`

/** The shortest gap that could be a respawn, in seconds; null before any. */
export function respawnEstimate(r: Pick<RespawnRecord, 'gaps'>): number | null {
  const real = r.gaps.filter((g) => g >= SHARED_SEC)
  return real.length ? Math.min(...real) : null
}

export interface RespawnHooks {
  onChange: () => void
  /** Who a name is, as the damage meter has worked it out. */
  kindOf: (name: string) => EntityKind
}

export class RespawnLog {
  constructor(
    readonly records: RespawnRecords,
    private readonly hooks: RespawnHooks
  ) {}

  /** One log line, with the zone it was written in and what the combat parser made of it. */
  handle(line: LogLine, zone: string, ev: CombatEvent | null): void {
    const entered = zoneEntered(line.text)
    if (entered) return this.left(line.time)
    if (!zone) return
    if (ev) {
      if (ev.kind === 'kill') {
        this.seen(zone, ev.target, line.time)
        this.died(zone, ev.target, ev.killer, line.time)
      } else if (ev.kind === 'damage' || ev.kind === 'miss' || ev.kind === 'heal' || ev.kind === 'resist') {
        this.seen(zone, ev.source, line.time)
        this.seen(zone, ev.target, line.time)
      } else if (ev.kind === 'cast') this.seen(zone, ev.source, line.time)
      return
    }
    // Speech, emotes and /consider all begin with the mob's name. "<name>'s corpse" does not count.
    const lower = line.text.toLowerCase()
    for (const r of Object.values(this.records)) {
      if (r.pendingSince && r.zone.toLowerCase() === zone.toLowerCase() && lower.startsWith(r.name.toLowerCase() + ' ')) this.seen(zone, r.name, line.time)
    }
  }

  /** Forgets a record. */
  forget(key: string): boolean {
    if (!this.records[key]) return false
    delete this.records[key]
    this.hooks.onChange()
    return true
  }

  private died(zone: string, name: string, killer: string | null, at: number): void {
    if (name === SELF) return
    const kind = this.hooks.kindOf(name)
    // A single capitalised word nobody has placed yet is a mob only if one of ours killed it.
    const mob = kind === 'npc' || (kind === 'unknown' && killer !== null && (killer === SELF || isFriend(this.hooks.kindOf(killer))))
    if (!mob) return
    const key = respawnKey(zone, name)
    let r = this.records[key]
    if (r && at <= r.lastDeath + SETTLE_MS) return
    if (!r) r = this.records[key] = { zone, name: displayName(name), kills: 0, lastDeath: 0, pendingSince: 0, gaps: [], shared: false }
    r.kills++
    r.lastDeath = at
    r.pendingSince = at
    this.prune()
    this.hooks.onChange()
  }

  private seen(zone: string, name: string, at: number): void {
    const r = this.records[respawnKey(zone, name)]
    if (!r || !r.pendingSince || at < r.pendingSince + SETTLE_MS) return
    const gap = Math.round((at - r.pendingSince) / 1000)
    r.pendingSince = 0
    r.gaps.push(gap)
    if (r.gaps.length > KEEP_GAPS) r.gaps.splice(0, r.gaps.length - KEEP_GAPS)
    if (gap < SHARED_SEC) r.shared = true
    this.hooks.onChange()
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
    if (changed) this.hooks.onChange()
  }

  private prune(): void {
    const keys = Object.keys(this.records)
    if (keys.length <= KEEP_RECORDS) return
    keys.sort((a, b) => this.records[a].lastDeath - this.records[b].lastDeath)
    for (const k of keys.slice(0, keys.length - KEEP_RECORDS)) delete this.records[k]
  }
}

// ---- the trigger a respawn timer is ----

export interface RespawnTimerSpec {
  name: string
  seconds: number
  overlay: string
  /** Seconds before it is up to say so; 0 = no warning. */
  warnSec: number
  /** Say "<name> is up" when the timer ends. */
  announce: boolean
}

/** One trigger per mob name; the id is made from the name so it can be found again. */
export function respawnTriggerId(name: string): string {
  return 'respawn-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The three ways the log reports a death, for exactly this name. Case-insensitive, as all phrases are. */
export function respawnPhrase(name: string): string {
  const n = escapeRegex(name)
  return `^(?:You have slain ${n}!|${n} has been slain by .+!|${n} died\\.)$`
}

/** The name as speech should say it: "Coercer T`vala" is read "Coercer Tvala". */
const spoken = (name: string) => name.replace(/[`]/g, '')

export const RESPAWN_FOLDER = 'Respawns'
export const RESPAWN_COLOR = '#6cc3ff'

export function respawnTrigger(spec: RespawnTimerSpec, existing?: Trigger): Trigger {
  const say = spoken(spec.name)
  const timer = existing?.actions.find((a) => a.type === 'timer')
  return {
    id: respawnTriggerId(spec.name),
    name: `${spec.name} respawn`,
    folder: existing?.folder ?? RESPAWN_FOLDER,
    enabled: true,
    comment: existing?.comment ?? `Made on the Respawns page. Starts when ${spec.name} dies.`,
    phrases: [{ text: respawnPhrase(spec.name), regex: true }],
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
export interface RespawnTimerInfo {
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
}

/** What the Respawns page shows: every record, most recent death first, and the zone you are in. */
export interface RespawnView {
  zone: string
  rows: RespawnRow[]
}

export function respawnView(records: RespawnRecords, triggers: Trigger[], zone: string): RespawnView {
  const mine = triggers.filter((t) => t.id.startsWith('respawn-'))
  const timers = new Map(mine.map((t) => [t.id, respawnTimerOf(t)]))
  const rows = Object.entries(records)
    .map(([key, r]): RespawnRow => ({ ...r, gaps: [...r.gaps], key, estimate: respawnEstimate(r), timer: timers.get(respawnTriggerId(r.name)) ?? null }))
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

export function respawnTimerOf(t: Trigger): RespawnTimerInfo | null {
  const a = t.actions.find((x) => x.type === 'timer')
  if (!a || a.type !== 'timer') return null
  return { triggerId: t.id, enabled: t.enabled, seconds: a.durationSec, overlay: a.overlay, warnSec: a.warnSec, announce: !!a.endSpeech }
}
