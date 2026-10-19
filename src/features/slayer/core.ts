import type { AchSection } from '../../core/achievements'
import { mobSpawns, spawnKey, zoneIndex, type MobSpawn, type SpawnTables, type ZoneTiming } from './spawns'
import type { HunterZone } from '../hunter/core'
import type { LogLine } from '../../core/logLine'
import { zoneEntered } from '../../core/logLine'
import { achievementRaces, slayerLine, type SlayerCounter, type SlayerKills, type SlayerRaces } from '../../core/slayer'
import type { RaceTable } from '../../core/raceNames'
import { baseZone, isCity, zoneKey } from '../../core/zones'
import { KILL_RUN_MS } from '../../core/phrases'
import { SLAYER_CAMPS, SLAYER_SPOTS, type SlayerCamp } from '../../shared/game/slayerCamps'
import { SLAYER_GUIDE, SLAYER_GUIDE_SAID, SLAYER_GUIDE_SPOTS, type SlayerGuideTip } from '../../shared/game/slayerGuide'
import { HUNT } from '../../shared/game/hunt'
import { num } from '../../core/format'
import type { SlayerPlanStepView, SlayerPlanTrackView } from '../../shared/tracking'

// The Slayer plan: where to kill what each open Slayer achievement still wants, quickest first. A
// camp is a zone and what dies there an hour; it is worth every open achievement its races feed, so
// a zone of giants counts for Might They Be Giants? and A Giant Problem at once. Where the kills come
// from, best first: the player's own logs (every kill over the archives and the live log, and the
// time spent killing in each zone), what play has settled (slayerCamps.ts: the raid lockouts, the
// camps the Discord agrees on) and eqlwiki's count of a race's NPCs in a zone (hunt.ts), a guess.
// Where nobody has hunted, TAKP's classic spawn tables (spawns.ts) say what a zone's spots allow, at
// no more than the player's own usual pace. The plan takes the camp that finishes something soonest,
// travel counted (the log's own trips between zones), and again; raid lockouts go beside it.

/** A trip between zones takes no longer than this: a longer stay is not travel. */
const MOVE_SEC = 30 * 60
/** Trips kept for each way between two zones. */
const KEEP_MOVES = 15

/** Each zone's kills and the time spent killing there, over one stretch of log. */
export interface SlayerKillTallies {
  /** The zone the stretch was last in, carried across reads of the live log. */
  zone: string
  /** The last kill, and its zone: the next kill within KILL_RUN_MS there adds the gap to the zone's time. */
  lastAt: number
  lastZone: string
  /**
   * By zone (instances folded in), then by mob lower-cased: the name as the log gave it, kills, and the
   * last one's time. And each stretch of killing there (kills KILL_RUN_MS apart at most): its time and
   * what died, by mob lower-cased, so a race's pace is its own stretches' (runPace), not the zone's.
   */
  zones: Record<string, { sec: number; kills: number; last: number; mobs: Record<string, { name: string; n: number; at?: number }>; runs?: KillRun[] }>
  /** When the zone the stretch is in was entered, the kills there since, and whether the player has died since. */
  enteredAt: number
  killsHere: number
  died: boolean
  /** Trips from zone to zone ("from|to"), seconds: across a zone killing nothing there, and from a camp's last kill to the next zone. */
  moves: Record<string, { pass: number[]; leave: number[] }>
}

/** A stretch of killing in a zone: kills no more than KILL_RUN_MS apart, its seconds and what died (mob lower-cased → kills). */
export interface KillRun {
  sec: number
  mobs: Record<string, number>
}

export const emptyKillTallies = (): SlayerKillTallies => ({ zone: '', lastAt: 0, lastZone: '', zones: {}, enteredAt: 0, killsHere: 0, died: false, moves: {} })

/** The zone an instance is of: "The Permafrost Caverns - Solo" and "Befallen 1 (Awakened)" are their zones' camps. */
export const campZone = (zone: string) => baseZone(zone)

/** A kill's killer that is no mob: the player, or a player or pet named in one word ("Vonartik"). */
const ourSide = (by: string) => by === 'You' || /^[A-Z][a-z']+$/.test(by)

/**
 * Reads one stretch of log: zones entered, and kills the player's side made ("You have slain a gnoll!",
 * "A gnoll has been slain by Vonartik!"), each put to the zone it was in. A kill's credit cannot be
 * told as the live counts tell it (the damage meter's roster is not kept with the history), so any
 * named killer is taken for the player's side: near enough for where kills come from. Measured on
 * 2026-10-19 over the player's live log (LT-668): such killers, not the player or a pet of theirs,
 * were 3.2% of 25,371 kills, 0–1% at the main camps, 8% in the Estate of Unrest and 44% in the Plane
 * of Hate, a raid's kills that the group shares; so the rule stays.
 */
export function readKillLine(line: LogLine, into: SlayerKillTallies): void {
  const z = zoneEntered(line.text)
  if (z) {
    const to = campZone(z)
    const from = into.zone
    // A trip: from a zone crossed without a kill, or from a camp's last kill. Not a death's way home.
    if (from && from !== to && !into.died) {
      const crossed = (line.time - into.enteredAt) / 1000
      const left = (line.time - into.lastAt) / 1000
      const way = (into.moves[`${from}|${to}`] ??= { pass: [], leave: [] })
      const keep = (list: number[], sec: number) => {
        list.push(Math.round(sec))
        if (list.length > KEEP_MOVES) list.splice(0, list.length - KEEP_MOVES)
      }
      if (!into.killsHere && crossed > 0 && crossed <= MOVE_SEC) keep(way.pass, crossed)
      else if (into.killsHere && left > 0 && left <= MOVE_SEC) keep(way.leave, left)
    }
    into.zone = to
    into.enteredAt = line.time
    into.killsHere = 0
    into.died = false
    return
  }
  if (line.text === 'You died.' || line.text.startsWith('You have been slain by ')) {
    into.died = true
    return
  }
  if (!into.zone || !(line.text.startsWith('You have slain ') || line.text.includes(' has been slain by '))) return
  const x = slayerLine(line.text)
  if (!x || !('kill' in x) || !ourSide(x.kill.by)) return
  const zone = (into.zones[into.zone] ??= { sec: 0, kills: 0, last: 0, mobs: {} })
  const runs = (zone.runs ??= [])
  const gap = line.time - into.lastAt
  const goesOn = into.lastZone === into.zone && gap >= 0 && gap <= KILL_RUN_MS && runs.length > 0
  if (goesOn && gap > 0) {
    zone.sec += gap / 1000
    runs[runs.length - 1].sec += gap / 1000
  }
  if (!goesOn) runs.push({ sec: 0, mobs: {} })
  into.lastAt = line.time
  into.lastZone = into.zone
  into.killsHere++
  zone.kills++
  zone.last = Math.max(zone.last, line.time)
  const k = x.kill.mob.replace(/^\*+/, '').toLowerCase()
  const m = (zone.mobs[k] ??= { name: x.kill.mob.replace(/^\*+/, ''), n: 0 })
  m.n++
  const run = runs[runs.length - 1].mobs
  run[k] = (run[k] ?? 0) + 1
  m.at = Math.max(m.at ?? 0, line.time)
}

/** Stretches of log (archives and the live log, and other characters') as one. */
export function joinKillTallies(stretches: SlayerKillTallies[]): SlayerKillTallies['zones'] {
  const out: SlayerKillTallies['zones'] = {}
  for (const s of stretches)
    for (const [zone, z] of Object.entries(s.zones)) {
      const had = (out[zone] ??= { sec: 0, kills: 0, last: 0, mobs: {}, runs: [] })
      had.runs = [...(had.runs ?? []), ...(z.runs ?? [])]
      had.sec += z.sec
      had.kills += z.kills
      had.last = Math.max(had.last, z.last)
      for (const [k, m] of Object.entries(z.mobs)) {
        const hm = (had.mobs[k] ??= { name: m.name, n: 0 })
        hm.n += m.n
        if (m.at) hm.at = Math.max(hm.at ?? 0, m.at)
      }
    }
  return out
}

/** A way between two zones the log has seen taken: crossing `from` toward `to`, and leaving a camp there for it, seconds. */
export interface SlayerMove {
  from: string
  to: string
  pass: number[]
  leave: number[]
}

/** The stretches' trips as one list, each way's latest kept. */
export function joinMoves(stretches: SlayerKillTallies[]): SlayerMove[] {
  const out = new Map<string, SlayerMove>()
  for (const s of stretches)
    for (const [key, w] of Object.entries(s.moves ?? {})) {
      const [from, to] = key.split('|')
      const had = out.get(key) ?? { from, to, pass: [], leave: [] }
      had.pass = [...had.pass, ...w.pass].slice(-KEEP_MOVES)
      had.leave = [...had.leave, ...w.leave].slice(-KEEP_MOVES)
      out.set(key, had)
    }
  return [...out.values()]
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length / 2
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2
}

/** A way from one camp to another, as the log has taken it: seconds, and the zones crossed between. */
export interface SlayerRoute {
  seconds: number
  via: string[]
}

/**
 * The quickest way between two zones over the trips the log has seen: leaving the first (its camp's
 * last kill to the next zone), then crossing each zone between as long as crossing it took. A gate or
 * a port is a trip like any other. Null where the log knows no way.
 */
export function routeFinder(moves: SlayerMove[]): (from: string, to: string) => SlayerRoute | null {
  const edges = new Map<string, { to: string; leave: number; pass: number }[]>()
  const names = new Map<string, string>()
  for (const m of moves) {
    const leave = median(m.leave) ?? median(m.pass)
    const pass = median(m.pass) ?? median(m.leave)
    if (leave === null || pass === null) continue
    const a = zoneKey(m.from)
    const b = zoneKey(m.to)
    names.set(a, m.from)
    names.set(b, m.to)
    edges.set(a, [...(edges.get(a) ?? []), { to: b, leave, pass }])
  }
  const cache = new Map<string, Map<string, { sec: number; prev: string | null }>>()
  const from = (src: string) => {
    let done = cache.get(src)
    if (done) return done
    done = new Map()
    const open = new Map<string, { sec: number; prev: string | null }>([[src, { sec: 0, prev: null }]])
    while (open.size) {
      const [k, v] = [...open].reduce((a, b) => (b[1].sec < a[1].sec ? b : a))
      open.delete(k)
      done.set(k, v)
      for (const e of edges.get(k) ?? []) {
        if (done.has(e.to)) continue
        const sec = v.sec + (k === src ? e.leave : e.pass)
        if (!open.has(e.to) || sec < open.get(e.to)!.sec) open.set(e.to, { sec, prev: k })
      }
    }
    cache.set(src, done)
    return done
  }
  return (a, b) => {
    const src = zoneKey(a)
    const reached = from(src)
    const hit = reached.get(zoneKey(b))
    if (!hit) return null
    const via: string[] = []
    for (let k = hit.prev; k && k !== src; k = reached.get(k)?.prev ?? null) via.unshift(names.get(k) ?? k)
    return { seconds: hit.sec, via }
  }
}

/** A name as a Hunter objective, the log and the spawn tables all have it: no article, no marks, lower-cased. */
export const bareName = spawnKey

/** An open Slayer achievement the plan works toward. */
export interface SlayerGoal {
  name: string
  section: string
  /** What it counts, as the achievement says. */
  races: string
  /** The count now (the export's and the kills since), and the total. */
  count: number
  max: number
  /** Only an optional part of the meta achievements that hold it (out of era, most of them). */
  optional: boolean
  /** The Banestrike tier it is needed for (BANESTRIKE's index), or BANESTRIKE.length for none. */
  tier: number
}

/** An achievement's name as the metas name it: "Catnipped in the bud." is Catnipped In the Bud. */
const metaName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.+$/, '')

/** The Slayer metas, in the order the plan works through them: each raises Banestrike a rank, Megadeath crowns them. */
export const BANESTRIKE = ['Progressive', 'Highly Decorated', 'A Force of Nature', 'Megadeath'] as const

/**
 * Each achievement the Slayer metas name, lower-cased, with the first tier that needs it: Progressive's
 * are 0, Highly Decorated's 1, A Force of Nature's 2, what Megadeath names besides the three 3.
 */
export function banestrikeTiers(sections: AchSection[]): Map<string, number> {
  const out = new Map<string, number>()
  const LINK = /^(?:\(Optional\)\s*)?Complete the achievement "(.+)"\.?$/i
  BANESTRIKE.forEach((meta, tier) => {
    const a = sections
      .filter((s) => s.cat === 'Slayer')
      .flatMap((s) => s.ach)
      .find((x) => metaName(x.n) === metaName(meta))
    for (const o of a?.c ?? []) {
      const m = LINK.exec(o.t.trim())
      const name = m && metaName(m[1])
      if (name && !out.has(name)) out.set(name, tier)
    }
  })
  return out
}

/**
 * The achievements the Slayer metas (Progressive, Highly Decorated, A Force of Nature, Megadeath) hold
 * only as "(Optional) Complete the achievement …", lower-cased: out-of-era ones, most of them, that
 * Banestrike does not need. One any of them requires is not optional.
 */
export function optionalSlayer(sections: AchSection[]): Set<string> {
  const optional = new Set<string>()
  const required = new Set<string>()
  const LINK = /^(\(Optional\)\s*)?Complete the achievement "(.+)"\.?$/i
  for (const sec of sections) {
    if (sec.cat !== 'Slayer') continue
    for (const a of sec.ach)
      for (const o of a.c) {
        // The parser keeps "(Optional)" as a flag; the text may still carry it.
        const m = LINK.exec(o.t.trim())
        if (m) (o.o || m[1] ? optional : required).add(metaName(m[2]))
      }
  }
  for (const r of required) optional.delete(r)
  return optional
}

/** Every Slayer achievement's races, done or not, by lower-cased name: "Barbarous" → barbarian. */
export function slayerRaceLists(sections: AchSection[], game: RaceTable): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const sec of sections) {
    if (sec.cat !== 'Slayer') continue
    for (const a of sec.ach) {
      const o = a.c.find((x) => !/^(?:\(Optional\)\s*)?Complete the achievement /i.test(x.t))
      if (o) out.set(a.n.toLowerCase(), achievementRaces(o.t, game).keys)
    }
  }
  return out
}

/** The open Slayer achievements, with their counts now: the export's, plus `since` (lower-cased name → kills since). */
export function slayerGoals(
  counters: SlayerCounter[],
  since: ReadonlyMap<string, number>,
  optional: ReadonlySet<string>,
  tiers: ReadonlyMap<string, number> = new Map(),
  /** Achievements (lower-cased) the game said were completed since the export: done, whatever the counts since add up to (LT-529). */
  done: ReadonlySet<string> = new Set()
): SlayerGoal[] {
  return counters.map((c) => ({
    name: c.name,
    section: c.section,
    races: c.races,
    count: done.has(c.name.toLowerCase()) ? c.max : Math.min(c.max, c.count + (since.get(c.name.toLowerCase()) ?? 0)),
    max: c.max,
    optional: optional.has(metaName(c.name)),
    tier: tiers.get(metaName(c.name)) ?? BANESTRIKE.length
  }))
}

/** Where a camp's pace comes from. */
export type CampSource = 'log' | 'play' | 'spawns' | 'wiki'

/**
 * One kind of kill at a camp: a mob the log saw die there, a mob or race play names, or a race eqlwiki
 * counts there; what dies an hour (a day, for a raid lockout), and the goals each kill counts toward.
 */
interface CampKind {
  name: string
  perHour: number
  goals: number[]
  /** For a mob of several races (a dervish cutthroat): the part of a kill each goal gets, by goal index; a whole kill where unsaid. */
  share?: Record<number, number>
  /** What its spawns in the zone allow, where TAKP's tables know it; and whether the log's pace is up against that. */
  spawn?: MobSpawn
  bound?: boolean
}

/** A place to kill, and what dies there an hour toward each achievement. */
export interface SlayerPlanCamp {
  /** Stable across plans: "log:<zone>", "play:<zone>|<mob>", "wiki:<zone>". */
  id: string
  zone: string
  /** What dies there that counts toward something, most first. */
  kinds: CampKind[]
  source: CampSource
  /**
   * Per goal index, kills an hour toward it (or a day, for a raid lockout): its kinds' together. For a
   * camp play names without a number (`assumed`), the share of the assumed pace.
   */
  pace: Record<number, number>
  assumed?: boolean
  /** Kills a day at most, for a raid lockout: run beside the plan, not in it. */
  daily?: boolean
  /** The log's hours spent killing there, and kills: what the pace stands on. */
  hours?: number
  kills?: number
  note?: string
  said?: string
  /** Each faction an hour there moves, from what the faction lines after kills there did (negative first). */
  factions?: { faction: string; perHour: number }[]
  /**
   * For a camp the spawn tables paced: what holds it back (the spawns, or the player's usual pace,
   * where the spawns allow more), and the kills an hour its spawns allow.
   */
  limit?: 'spawns' | 'you'
  ceiling?: number
  /** For a raid lockout: kills of its mobs so far today (since local midnight), from the live counts. */
  today?: number
}

/** What the plan is built from, all of it from main. */
export interface SlayerPlanData {
  character: string
  /** The achievements export it read, and when the game wrote it; null without one. */
  export: { file: string; modified: number } | null
  /** Whether the counts have the kills since the export: only for the character being played (LT-539). */
  sinceKills?: boolean
  goals: SlayerGoal[]
  camps: SlayerPlanCamp[]
  /** Kills in the logs that no race was found for, most first: what the plan cannot place. */
  unplaced: { name: string; n: number }[]
  /** Mobs still being looked up on eqlwiki for their race. */
  pending: number
  /** The trips between zones the logs have seen: the plan's travel. */
  moves: SlayerMove[]
  /** The player's usual kills an hour where spawns allow (the logs' camps, the middle one), or null before any. */
  killSpeed: number | null
  /** Each zone's timers against classic, from the spawns the log has timed. */
  timings: { zone: string; timer: number | null; timed: { name: string; legends: number; classic: number | null }[] }[]
  /** The Hunter named still to kill, by place (Plan › Hunter's). */
  hunter: HunterZone[]
  /** The factions the faction plan the character follows (Factions › Plan) is raising: a camp that costs one is flagged, or ruled out by choice. */
  raising?: string[]
}

/** TAKP's spawn tables for buildCamps, with how a zone's timers compare and how the tables' mobs count. */
export interface SpawnSource {
  tables: SpawnTables
  timings: ReadonlyMap<string, ZoneTiming>
  /** The goals a mob the tables list counts toward, by its name and the tables' race. */
  place: (mob: string, race: string) => number[]
  /** Kills an hour the player keeps where the spawns allow more: what a camp of plenty gives at most. */
  killSpeed: number
}

/** A mob counts as up against its spawns when the log's pace reaches this much of what they allow. */
const BOUND = 0.7
/** Kinds the tables allow fewer kills an hour than this are left out: a rare roll is no camp. */
const MIN_KIND = 0.2
/**
 * A classic timer longer than this is a raid zone's or a named's, which Legends runs its own way (its
 * planes are instances): the tables say nothing of it unless the log timed it.
 */
const LONG_SEC = 3600
const usable = (m: MobSpawn) => m.timerFrom === 'timed' || m.timer <= LONG_SEC
/** A named NPC, one of its kind ("Guard Gruilka", "Quillmane"): the tables name the many in lower case ("orc pawn"). */
const named = (name: string) => /^[A-Z]/.test(name) && !/^(?:A|An|The) /.test(name)

/** Kinds at a spawn-paced camp, held to the player's pace: the spawns allow `ceiling`, the player kills at most `speed`. */
function capped(kinds: CampKind[], speed: number): { kinds: CampKind[]; limit: 'spawns' | 'you'; ceiling: number } {
  const ceiling = kinds.reduce((s, k) => s + k.perHour, 0)
  const scale = Math.min(1, speed / ceiling)
  return { kinds: kinds.map((k) => ({ ...k, perHour: k.perHour * scale })), limit: scale < 1 ? 'you' : 'spawns', ceiling }
}

/** A timer as the game's clocks show it: 7:47. */
export const clock = (sec: number) => {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const paceOfKinds = (kinds: CampKind[]) => {
  const pace: Record<number, number> = {}
  for (const k of kinds) for (const g of k.goals) pace[g] = (pace[g] ?? 0) + k.perHour * partOf(k, g)
  return pace
}

/** A stretch of killing is about an achievement when its races were at least this share of what died in it. */
const RUN_SHARE = 0.25
/** A mob killed fewer times than this in a stretch sets no pace: one named kill said Trooper Kraer came 0.38 an hour (LT-528). */
const MIN_KIND_KILLS = 3
/** The stretches about the same achievements must come to this long to be a camp of their own (as a zone must, MIN_LOG_SEC); else the zone's time stands. */
const MIN_RUN_SEC = 15 * 60

/**
 * What a kill of a mob counts toward: the goals, a whole kill each; or, for a mob of several races
 * under one name, the part of a kill each goal gets (a West Commonlands dervish cutthroat is an orc
 * about a third of the time, as the spawn tables roll them).
 */
export type Placing = number[] | ReadonlyMap<number, number>

/** A placing as goal and part-of-a-kill pairs. */
const sharesOf = (p: Placing): [number, number][] => (Array.isArray(p) ? p.map((g) => [g, 1]) : [...p])

/** The part of a kill of a kind that counts toward a goal: a whole one unless the kind says otherwise. */
const partOf = (k: CampKind, g: number) => k.share?.[g] ?? 1

/** Some of a zone's killing, as one camp: its time, kills, what died (mob lower-cased → kills), and the achievements it was about. */
export interface KillStretch {
  sec: number
  kills: number
  mobs: Record<string, number>
  about: number[]
  /** The zone's time as a whole, for what no stretch was about: it counts toward those alone. */
  whole?: boolean
}

/**
 * A zone's killing, split by what it was about. Each stretch of killing is about the achievements its
 * races were RUN_SHARE of what died for; the stretches about the same ones are a camp, their kills over
 * their own time: an hour of granitebacks in September says nothing of how quickly kejekan die now,
 * nor can the two be killed at once. Stretches about the same achievements coming to under
 * MIN_RUN_SEC say too little; what no camp of stretches is about (a tiger among the granitebacks),
 * and tallies kept before stretches were, are the zone's time as a whole.
 */
export function killStretches(z: SlayerKillTallies['zones'][string], placeOf: (mob: string) => Placing): KillStretch[] {
  const groups = new Map<string, KillStretch>()
  for (const r of z.runs ?? []) {
    // What a stretch was about is what died in it: a mob of several races was killed whole, whatever part of each kill a goal gets.
    const byGoal = new Map<number, number>()
    let all = 0
    for (const [mob, n] of Object.entries(r.mobs)) {
      all += n
      for (const [g] of sharesOf(placeOf(mob))) byGoal.set(g, (byGoal.get(g) ?? 0) + n)
    }
    const about = [...byGoal]
      .filter(([, n]) => all > 0 && n >= all * RUN_SHARE)
      .map(([g]) => g)
      .sort((a, b) => a - b)
    if (!about.length) continue
    const key = about.join(',')
    const group = groups.get(key) ?? { sec: 0, kills: 0, mobs: {}, about }
    group.sec += r.sec
    group.kills += all
    for (const [mob, n] of Object.entries(r.mobs)) group.mobs[mob] = (group.mobs[mob] ?? 0) + n
    groups.set(key, group)
  }
  const out = [...groups.values()].filter((g) => g.sec >= MIN_RUN_SEC).sort((a, b) => b.sec - a.sec)
  const covered = new Set(out.flatMap((x) => x.about))
  const rest = [...new Set(Object.keys(z.mobs).flatMap((m) => sharesOf(placeOf(m)).map(([g]) => g)))].filter((g) => !covered.has(g))
  if (rest.length) out.push({ sec: z.sec, kills: z.kills, mobs: Object.fromEntries(Object.entries(z.mobs).map(([k, m]) => [k, m.n])), about: rest, whole: true })
  return out
}

/** How long a zone must have been hunted, and how many kills it gave, before its pace is taken as the log's. */
const MIN_LOG_SEC = 15 * 60
const MIN_LOG_KILLS = 10
/** An NPC of a race in a zone, as eqlwiki counts them: kills an hour it might give, at a common mob's respawn (a guess). */
const WIKI_PER_NPC = 4
/** Kills an hour under which the logs' best pace for a goal is a crawl, and eqlwiki's zones are offered too. */
const SLOW = 10

/**
 * The camps the logs, play and eqlwiki give. `place` says which goals a mob's kill counts toward
 * (its race, or what the exports settled); `factionPerKill` what a kill of a mob in a zone did to
 * the factions. Play's camp gives way to the log's in the same zone for the same goals; eqlwiki's
 * only stands where neither has a camp for a goal.
 */
export function buildCamps(
  goals: SlayerGoal[],
  races: SlayerRaces,
  zones: SlayerKillTallies['zones'],
  place: (mob: string, zone?: string) => Placing,
  factionPerKill: (zone: string, mob: string) => Record<string, number> | null,
  /** Every Slayer achievement's races, done ones too (slayerRaceLists): what eqlwiki's census is keyed by. */
  raceLists: ReadonlyMap<string, ReadonlySet<string>>,
  known: SlayerCamp[] = SLAYER_CAMPS,
  spawns?: SpawnSource,
  guide: SlayerGuideTip[] = SLAYER_GUIDE
): SlayerPlanCamp[] {
  const camps: SlayerPlanCamp[] = []
  const fed = new Set<string>()
  // What the spawn tables say of a zone's mobs, worked out once a zone.
  const tableOf = spawns ? zoneIndex(spawns.tables) : () => null
  const spawnCache = new Map<string, Map<string, MobSpawn>>()
  const spawnsIn = (zone: string) => {
    const short = tableOf(zone)
    if (!short || !spawns) return null
    let m = spawnCache.get(short)
    if (!m) spawnCache.set(short, (m = mobSpawns(spawns.tables[short], spawns.timings.get(short))))
    return m
  }
  // A zone's mobs that feed these goals, as kinds: what their spawns allow an hour.
  const spawnKinds = (zone: string, open: (g: number) => boolean): CampKind[] =>
    [...(spawnsIn(zone)?.values() ?? [])]
      .filter((m) => usable(m) && (!named(m.name) || m.timerFrom === 'timed') && !lockoutMobs.has(spawnKey(m.name)) && m.ceiling >= MIN_KIND)
      .map((m) => ({ name: m.name, perHour: m.ceiling, goals: spawns!.place(m.name, m.race).filter(open), spawn: m }))
      .filter((k) => k.goals.length)
      .sort((a, b) => b.perHour - a.perHour)
  // A raid boss's kills are a lockout's, a few a day, however quick the log made them look.
  const lockoutMobs = new Set(known.filter((k) => k.perDay !== undefined).flatMap((k) => k.mobs.map(spawnKey)))
  const feeds = (zone: string, g: number) => `${zoneKey(zone)}|${g}`
  for (const [zone, z] of Object.entries(zones)) {
    if (z.sec < MIN_LOG_SEC || z.kills < MIN_LOG_KILLS) continue
    const nameOf = (key: string) => z.mobs[key]?.name ?? key
    const spawnsHere = spawnsIn(zone)
    // Each stretch of what the killing there was about, a camp of its own (the largest first, keeping the zone's id).
    killStretches(z, (key) => place(nameOf(key), zone)).forEach((st, i) => {
      if (st.sec <= 0) return
      const hours = st.sec / 3600
      const about = new Set(st.about)
      const pace: Record<number, number> = {}
      const moved: Record<string, number> = {}
      const kinds: CampKind[] = []
      for (const [key, n] of Object.entries(st.mobs).sort((a, b) => b[1] - a[1])) {
        const name = nameOf(key)
        const hits = factionPerKill(zone, name)
        if (hits) for (const [f, v] of Object.entries(hits)) moved[f] = (moved[f] ?? 0) + (v * n) / hours
        // A stretch's kills count toward all their races feed; the zone's time as a whole only toward what no stretch was about.
        const here = sharesOf(place(name, zone)).filter(([g]) => !st.whole || about.has(g))
        if (!here.length || lockoutMobs.has(spawnKey(name)) || n < MIN_KIND_KILLS) continue
        const goalsHere = here.map(([g]) => g)
        // A mob of several races gives each goal its part of a kill.
        const parts = here.filter(([, w]) => w < 1)
        const perHour = n / hours
        const found = spawnsHere?.get(spawnKey(name))
        const spawn = found && usable(found) ? found : undefined
        kinds.push({
          name,
          perHour,
          goals: goalsHere,
          ...(parts.length ? { share: Object.fromEntries(parts) } : {}),
          ...(spawn ? { spawn, bound: perHour >= spawn.ceiling * BOUND } : {})
        })
        for (const [g, w] of here) pace[g] = (pace[g] ?? 0) + perHour * w
      }
      if (!kinds.length) return
      for (const g of Object.keys(pace)) fed.add(feeds(zone, +g))
      camps.push({
        id: i === 0 ? `log:${zone}` : `log:${zone}#${i + 1}`,
        zone,
        kinds,
        source: 'log',
        pace,
        hours,
        kills: st.kills,
        factions: Object.entries(moved)
          .filter(([, v]) => Math.abs(v) >= 0.5)
          .map(([faction, perHour]) => ({ faction, perHour }))
          .sort((a, b) => a.perHour - b.perHour)
      })
    })
  }
  const goalsOf = (keys: string[]) => goals.flatMap((_, i) => (keys.some((k) => races.keys[i].has(k)) ? [i] : []))
  for (const k of known) {
    const at = goalsOf(k.races)
    const daily = k.perDay !== undefined
    // The log's pace for the same zone and goals stands; a raid lockout is a lockout whatever the log says.
    const open = daily ? at : at.filter((g) => !fed.has(feeds(k.zone, g)))
    if (!open.length) continue
    const per = k.perDay ?? k.perHour ?? (k.respawnMin ? (60 / k.respawnMin) * (k.spawns ?? 1) : undefined)
    // A camp of several kinds shares its kills among its races alike: a goal gets the part its races
    // make up. A raid lockout is one boss, its races only its names ("dragon", "true dragon"): each kill
    // counts whole toward every goal they feed.
    const part = (g: number) => (daily ? 1 : k.races.filter((r) => races.keys[g].has(r)).length / k.races.length)
    if (!daily) for (const g of open) fed.add(feeds(k.zone, g))
    // A camp named without a number: the zone's spawns of what it feeds, where the tables know them.
    const table = per === undefined && spawns ? spawnKinds(k.zone, (g) => open.includes(g)) : []
    let id = `play:${k.zone}|${k.mobs.join('|')}`
    let left = open
    if (table.length) {
      const c = capped(table, spawns!.killSpeed)
      camps.push({ id, zone: k.zone, kinds: c.kinds, source: 'play', pace: paceOfKinds(c.kinds), limit: c.limit, ceiling: c.ceiling, note: k.note, said: k.said })
      // What play names there and the tables lack (South Karana's treants): at the assumed pace, beside.
      const covered = new Set(table.flatMap((t) => t.goals))
      left = open.filter((g) => !covered.has(g))
      if (!left.length) continue
      id += '|rest'
    }
    // A boss, or one kind of mob: the mobs named. Several races: each its own kind, the camp's kills shared alike.
    const kinds: CampKind[] =
      daily || k.races.length === 1
        ? [{ name: k.mobs.join(', '), perHour: per ?? 1, goals: left }]
        : k.races.map((r) => ({ name: r, perHour: (per ?? 1) / k.races.length, goals: left.filter((g) => races.keys[g].has(r)) })).filter((x) => x.goals.length)
    camps.push({
      id,
      zone: k.zone,
      kinds,
      source: 'play',
      pace: Object.fromEntries(left.map((g) => [g, (per ?? 1) * part(g)])),
      ...(per === undefined ? { assumed: true } : {}),
      ...(daily ? { daily: true } : {}),
      note: k.note,
      said: k.said
    })
  }
  // eqlwiki's Slayer guide: each zone it names for an achievement, a camp for it, paced by the zone's
  // spawns of what feeds it. The log's camp, or play's, in the same zone for a goal stands; a zone the
  // tables lack (New Sebilis Expedition) is the guide's words only, on the page.
  if (spawns) {
    const at = new Map<string, { zone: string; goals: Set<number> }>()
    for (const tip of guide) {
      const g = goals.findIndex((x) => metaName(x.name) === metaName(tip.achievement))
      if (g < 0) continue
      for (const zone of tip.zones) {
        const k = zoneKey(zone)
        const e = at.get(k) ?? { zone, goals: new Set<number>() }
        e.goals.add(g)
        at.set(k, e)
      }
    }
    for (const [k, e] of at) {
      // A city's people bring its guards down (the guide says faction hit): no camp, the words stand.
      if (isCity(e.zone)) continue
      const open = [...e.goals].filter((g) => !fed.has(feeds(e.zone, g)))
      const kinds = open.length ? spawnKinds(e.zone, (g) => open.includes(g)) : []
      if (!kinds.length) continue
      const c = capped(kinds, spawns.killSpeed)
      for (const x of c.kinds) for (const g of x.goals) fed.add(feeds(e.zone, g))
      const spot = SLAYER_GUIDE_SPOTS.find((s) => zoneKey(s.zone) === k)
      camps.push({
        id: `guide:${k}`,
        zone: e.zone,
        kinds: c.kinds,
        source: 'play',
        pace: paceOfKinds(c.kinds),
        limit: c.limit,
        ceiling: c.ceiling,
        ...(spot ? { note: spot.tip } : {}),
        said: SLAYER_GUIDE_SAID
      })
    }
  }
  // eqlwiki's census, keyed by the Skill achievements' names: for every goal, the plan offering it only
  // where nothing measured feeds the goal at a fair pace (fallbackOnly), once the player's rule-outs are
  // taken off. A race only raid bosses are (the kedge, Phinigel): no census guess stands in for the lockout.
  const lockoutRaces = new Set(known.filter((k) => k.perDay !== undefined).flatMap((k) => k.races))
  const wanting = goals.flatMap((_, i) => ([...races.keys[i]].every((k) => lockoutRaces.has(k)) ? [] : [i]))
  // TAKP's tables: each zone of them, for what nothing measured or named feeds there, paced by its spawns
  // at no more than the player's usual pace. A city's people are its citizens and guards: no camp.
  if (spawns)
    for (const [short, z] of Object.entries(spawns.tables)) {
      if (isCity(z.name)) continue
      const kinds = spawnKinds(z.name, (g) => wanting.includes(g) && !fed.has(feeds(z.name, g)))
      if (!kinds.length) continue
      const c = capped(kinds, spawns.killSpeed)
      const timed = spawns.timings.get(short)
      camps.push({
        id: `spawns:${short}`,
        zone: z.name,
        kinds: c.kinds,
        source: 'spawns',
        pace: paceOfKinds(c.kinds),
        limit: c.limit,
        ceiling: c.ceiling,
        note: timed?.timer ? `respawns as you timed them here (${clock(timed.timer)})` : 'classic timers: Legends has been as quick or quicker',
        said: 'TAKP’s spawn table'
      })
    }
  for (const [name, rows] of Object.entries(HUNT)) {
    const keys = raceLists.get(name)
    const at = keys ? wanting.filter((i) => [...keys].some((k) => races.keys[i].has(k))) : []
    if (!keys || !at.length) continue
    // One kind a race eqlwiki counts in the zone, named for the race: it lists no mobs.
    const kind = [...keys].join(' / ')
    for (const [zone, npcs] of rows) {
      // A city's people are its citizens and guards: no camp to send anyone to on a count alone. A zone
      // the spawn tables have is theirs.
      if (isCity(zone) || tableOf(zone)) continue
      const id = `wiki:${zoneKey(zone)}`
      let c = camps.find((x) => x.id === id)
      if (!c) camps.push((c = { id, zone, kinds: [], source: 'wiki', pace: {}, said: 'eqlwiki, 2026-09-24' }))
      if (!c.kinds.some((x) => x.name === kind)) c.kinds.push({ name: kind, perHour: npcs * WIKI_PER_NPC, goals: at })
    }
  }
  for (const c of camps.filter((x) => x.source === 'wiki')) {
    c.kinds.sort((a, b) => b.perHour - a.perHour)
    c.pace = {}
    for (const k of c.kinds) for (const g of k.goals) c.pace[g] = (c.pace[g] ?? 0) + k.perHour
    c.note = c.kinds.map((k) => `${k.name}: ${num(k.perHour / WIKI_PER_NPC)} on eqlwiki`).join(', ')
  }
  return camps
}

/** What the player has chosen on the page. */
export interface SlayerPlanChoices {
  /** Achievements (lower-cased) left out of the plan, and optional ones taken in. */
  excluded: string[]
  included: string[]
  /** Camps (ids) ruled out, and mobs (lower-cased), wherever they are: one that takes a faction to spawn. */
  outCamps: string[]
  outMobs: string[]
  /** Minutes to get from one camp to another. */
  travelMin: number
  /** Kills an hour where play names a camp without a number. */
  pace: number
  /** The plan's step shown on the achievements overlay. */
  overlay: boolean
  /** Camps whose kills cost a faction the followed faction plan (Factions › Plan) is raising are ruled out. */
  avoidPlanFactions: boolean
}

export const DEFAULT_CHOICES: SlayerPlanChoices = { excluded: [], included: [], outCamps: [], outMobs: [], travelMin: 10, pace: 60, overlay: false, avoidPlanFactions: false }

/** The factions a camp costs (its kills' faction hits an hour, below zero) that the followed faction plan is raising. */
export function costsPlan(camp: Pick<SlayerPlanCamp, 'factions'>, raising: readonly string[]): string[] {
  if (!raising.length || !camp.factions) return []
  const up = new Set(raising.map((f) => f.toLowerCase()))
  return camp.factions.filter((f) => f.perHour < 0 && up.has(f.faction.toLowerCase())).map((f) => f.faction)
}

/** A step of the plan: a stretch at one camp. */
export interface SlayerStep {
  camp: SlayerPlanCamp
  /** Hours there, and the travel to it. */
  seconds: number
  travel: number
  /** The zones crossed on the way there, when the log knows the way. */
  via?: string[]
  /** Kills toward each goal it moves (index → kills). */
  kills: Record<number, number>
  /** Goals it finishes. */
  finishes: number[]
  /** The Banestrike tier it works toward, and the goals of that tier it is there for. */
  tier: number
  focus: number[]
}

/** What a step kills: each kind there that feeds the goals it is there for, and how many in its time. */
export function stepKills(st: SlayerStep, choices: Pick<SlayerPlanChoices, 'pace'>): { name: string; n: number; goals: number[]; spawn?: MobSpawn; bound?: boolean }[] {
  const focus = new Set(st.focus)
  const scale = st.camp.assumed ? choices.pace : 1
  return st.camp.kinds
    .filter((k) => k.goals.some((g) => focus.has(g)))
    .map((k) => ({ name: k.name, n: (k.perHour * scale * st.seconds) / 3600, goals: k.goals, ...(k.spawn ? { spawn: k.spawn } : {}), ...(k.bound ? { bound: true } : {}) }))
}

/** A raid lockout to run each day beside the plan. */
interface SlayerDaily {
  camp: SlayerPlanCamp
  /** Days until what it feeds is done, at its kills a day. */
  days: number
  goals: number[]
}

export interface SlayerPlan {
  steps: SlayerStep[]
  daily: SlayerDaily[]
  seconds: number
  /** Goals in the plan that nothing known feeds. */
  unplanned: number[]
  /** Goals the plan works toward (not left out, not done). */
  goals: number[]
}

/**
 * eqlwiki's census only where nothing measured or named feeds a goal at a fair pace: beside a crawl,
 * or in place of a mob or camp ruled out. Its guesses never outbid the log's pace or play's camps,
 * and never stand where the log has measured the goal's pace.
 */
function fallbackOnly(camps: SlayerPlanCamp[]): SlayerPlanCamp[] {
  const firm = camps.filter((c) => c.source !== 'wiki' && !c.daily)
  const wanted = (g: number) => !firm.some((c) => (c.assumed && c.pace[g]) || (c.pace[g] ?? 0) >= SLOW)
  // Nor in a zone your log has measured for the goal, however slow: 4/h a dracolich on a count beat
  // the 1.6/h 137 hours in the Plane of Fear had measured (LT-533).
  const measured = new Set(firm.flatMap((c) => (c.source === 'log' ? Object.keys(c.pace).flatMap((g) => ((c.pace[+g] ?? 0) > 0 ? [`${zoneKey(c.zone)}|${g}`] : [])) : [])))
  return camps.flatMap((c) => {
    if (c.source !== 'wiki') return [c]
    const zone = zoneKey(c.zone)
    const kinds = c.kinds.map((k) => ({ ...k, goals: k.goals.filter((g) => wanted(g) && !measured.has(`${zone}|${g}`)) })).filter((k) => k.goals.length)
    if (!kinds.length) return []
    return [{ ...c, kinds, pace: paceOfKinds(kinds) }]
  })
}

/** A camp without the mobs ruled out, its pace their kinds' together again; none when nothing is left. */
function withoutMobs(c: SlayerPlanCamp, out: string[]): SlayerPlanCamp[] {
  if (!out.length) return [c]
  // By the name without its article: the log's "an orc pawn" is the spawn tables' "orc pawn".
  const gone = new Set(out.map(spawnKey))
  const kinds = c.kinds.filter((k) => !gone.has(spawnKey(k.name)))
  if (kinds.length === c.kinds.length) return [c]
  if (!kinds.length) return []
  return [{ ...c, kinds, pace: paceOfKinds(kinds) }]
}

/** Kills still wanted below this are rounding, not kills: an achievement with no more than this left is done. */
const LEFT = 1e-6

/** The goals the plan works toward: open, not left out, and optional ones only when taken in. */
export function goalsInPlay(goals: SlayerGoal[], choices: SlayerPlanChoices): number[] {
  const out = new Set(choices.excluded)
  const inc = new Set(choices.included)
  return goals.flatMap((g, i) => {
    const n = g.name.toLowerCase()
    return g.count < g.max && !out.has(n) && (!g.optional || inc.has(n)) ? [i] : []
  })
}

/**
 * The plan: a step an achievement, at the camp and on the way that finish it soonest, travel counted;
 * then the tier's others whose best zone is the same, one after another while there. A step kills
 * only the mobs that achievement wants (a zone's races are seldom near each other), each kill still
 * counting toward whatever else its race feeds. Raid lockouts are not steps: each gives its kills a
 * day beside the plan. Travel is the way the log has seen taken between the two zones, or the
 * player's minutes between camps where it knows none.
 */
export function planSlayer(data: Pick<SlayerPlanData, 'goals' | 'camps'> & { moves?: SlayerMove[]; raising?: string[] }, choices: SlayerPlanChoices): SlayerPlan {
  const goals = goalsInPlay(data.goals, choices)
  const need = new Map(goals.map((g) => [g, data.goals[g].max - data.goals[g].count]))
  const ruled = new Set(choices.outCamps)
  // By choice, a camp that costs a faction the followed faction plan is raising is out too (LT-656).
  const raising = choices.avoidPlanFactions ? (data.raising ?? []) : []
  const paceOf = (c: SlayerPlanCamp, g: number) => (c.pace[g] ?? 0) * (c.assumed ? choices.pace : 1)
  const camps = fallbackOnly(data.camps.filter((c) => !ruled.has(c.id) && !costsPlan(c, raising).length).flatMap((c) => withoutMobs(c, choices.outMobs)))
  // The lockouts: what they alone feed is out of the hourly plan, done in the days the lockouts'
  // kills a day take together (Lady Vox and Lord Nagafen, ten true dragons a day). What an hourly
  // camp also feeds, they only help along.
  const hourly = camps.filter((c) => !c.daily)
  const lockouts = camps.filter((c) => c.daily)
  const onlyDaily = new Set(goals.filter((g) => lockouts.some((c) => paceOf(c, g) > 0) && !hourly.some((c) => paceOf(c, g) > 0)))
  const perDay = (g: number) => lockouts.reduce((s, c) => s + paceOf(c, g), 0)
  const daily: SlayerDaily[] = []
  for (const c of lockouts) {
    const fed = goals.filter((g) => onlyDaily.has(g) && paceOf(c, g) > 0)
    if (fed.length) daily.push({ camp: c, days: Math.ceil(Math.max(...fed.map((g) => (need.get(g) ?? 0) / perDay(g)))), goals: fed })
  }
  const travelSec = choices.travelMin * 60
  const route = routeFinder(data.moves ?? [])
  const trip = (a: SlayerPlanCamp | null, b: SlayerPlanCamp): SlayerRoute => {
    if (!a || a.id === b.id || zoneKey(a.zone) === zoneKey(b.zone)) return { seconds: 0, via: [] }
    return route(a.zone, b.zone) ?? { seconds: travelSec, via: [] }
  }
  const tierOf = (g: number) => data.goals[g].tier ?? BANESTRIKE.length
  const inPlan = new Set(goals)
  const scaleOf = (c: SlayerPlanCamp) => (c.assumed ? choices.pace : 1)
  // A goal's kills an hour at a camp: its own mobs'. A camp that names no mobs is one kind of kill.
  const rateOf = (c: SlayerPlanCamp, g: number) =>
    c.kinds.length ? c.kinds.reduce((s, k) => s + (k.goals.includes(g) ? k.perHour * partOf(k, g) * scaleOf(c) : 0), 0) : paceOf(c, g)
  /** What killing a goal's mobs at a camp for so long does toward every goal: each kill counts toward all its race feeds. */
  const killsFor = (c: SlayerPlanCamp, g: number, secs: number): Record<number, number> => {
    const out: Record<number, number> = {}
    const add = (h: number, n: number) => inPlan.has(h) && n > 0 && (out[h] = (out[h] ?? 0) + n)
    if (c.kinds.length) {
      for (const k of c.kinds) if (k.goals.includes(g)) for (const h of new Set(k.goals)) add(h, (k.perHour * partOf(k, h) * scaleOf(c) * secs) / 3600)
    } else for (const h of Object.keys(c.pace)) add(+h, (paceOf(c, +h) * secs) / 3600)
    return out
  }
  // Each goal's best zone: where it goes quickest, travel aside.
  const bestZone = new Map<number, string>()
  for (const g of goals) {
    let best: { zone: string; rate: number } | null = null
    for (const c of hourly) {
      const r = rateOf(c, g)
      if (r > 0 && (!best || r > best.rate)) best = { zone: zoneKey(c.zone), rate: r }
    }
    if (best) bestZone.set(g, best.zone)
  }
  const steps: SlayerStep[] = []
  let at: SlayerPlanCamp | null = null
  // Banestrike's tiers in turn, each done before the next is begun; within a tier, the achievement
  // that can be finished soonest, travel counted, first, and after it the others best done in the
  // same zone. Every kill still counts toward whatever else its race feeds, a later tier's too.
  for (const tier of [...new Set(goals.map(tierOf))].sort((a, b) => a - b)) {
    for (let guard = 0; guard < 500; guard++) {
      const open = goals.filter((g) => tierOf(g) === tier && !onlyDaily.has(g) && (need.get(g) ?? 0) > LEFT)
      if (!open.length) break
      const here: string | null = at ? zoneKey(at.zone) : null
      let best: { c: SlayerPlanCamp; g: number; secs: number; cost: number; work: number } | null = null
      // While in a zone, the tier's goals whose best zone it is come next, at its best camp for each.
      const stay: number[] = here ? open.filter((g) => bestZone.get(g) === here) : []
      for (const g of (stay.length ? stay : open) as number[])
        for (const c of hourly) {
          if (stay.length && zoneKey(c.zone) !== here) continue
          const r: number = rateOf(c, g)
          if (r <= 0) continue
          const secs: number = ((need.get(g) ?? 0) / r) * 3600
          const cost: number = secs + trip(at, c).seconds
          // As soon: the one doing more besides.
          const work = Object.values(killsFor(c, g, secs)).reduce((s, n) => s + n, 0)
          if (!best || cost < best.cost - 1e-6 || (Math.abs(cost - best.cost) <= 1e-6 && work > best.work)) best = { c, g, secs, cost, work }
        }
      if (!best) break
      const kills = killsFor(best.c, best.g, best.secs)
      for (const [h, k] of Object.entries(kills)) {
        const was = need.get(+h) ?? 0
        const k2 = Math.min(was, k)
        if (k2 <= 0) {
          delete kills[+h]
          continue
        }
        kills[+h] = k2
        // What is left of a kill by rounding is none: it would bring the plan back for it, step after step.
        const left = was - k2
        need.set(+h, left > LEFT ? left : 0)
      }
      need.set(best.g, 0)
      steps.push({ camp: best.c, seconds: best.secs, travel: 0, kills, finishes: [], tier, focus: [best.g] })
      at = best.c
    }
  }
  const unplanned = goals.filter((g) => (need.get(g) ?? 0) > LEFT && !onlyDaily.has(g))
  // What each step finishes, and the travel to it, in the order they are done.
  const left = new Map(goals.map((g) => [g, data.goals[g].max - data.goals[g].count]))
  steps.forEach((st, i) => {
    const way = trip(i ? steps[i - 1].camp : null, st.camp)
    st.travel = way.seconds
    if (way.via.length) st.via = way.via
    for (const [g, k] of Object.entries(st.kills)) {
      const l = (left.get(+g) ?? 0) - k
      left.set(+g, l)
      if (l <= 1e-6 && l + k > 1e-6) st.finishes.push(+g)
    }
  })
  return { steps, daily, seconds: steps.reduce((s, st) => s + st.seconds + st.travel, 0), unplanned, goals }
}

/**
 * The plan as the achievements overlay shows it: the step whose zone the player is in (the first, where
 * several are), else the first step, to head to; and the step after it. The plan is made again from
 * the counts as they are, so a step's kills and time are what is left of it.
 */
export function slayerPlanView(plan: SlayerPlan, goals: SlayerGoal[], choices: Pick<SlayerPlanChoices, 'pace'>, zone: string): SlayerPlanTrackView {
  const z = zone ? zoneKey(campZone(zone)) : ''
  const at = z ? plan.steps.findIndex((st) => zoneKey(st.camp.zone) === z) : -1
  const view = (i: number): SlayerPlanStepView => {
    const st = plan.steps[i]
    return {
      index: i,
      zone: st.camp.zone,
      here: !!z && zoneKey(st.camp.zone) === z,
      tier: BANESTRIKE[st.tier] ?? 'Not for Banestrike',
      seconds: st.seconds,
      travel: st.travel,
      ...(st.via?.length ? { via: st.via } : {}),
      goals: st.focus.map((g) => ({ name: goals[g].name, count: goals[g].count, max: goals[g].max })),
      mobs: stepKills(st, choices)
        .map((k) => ({ name: k.name, n: Math.ceil(k.n) }))
        .sort((a, b) => b.n - a.n)
    }
  }
  const current = plan.steps.length ? Math.max(0, at) : -1
  // After the step worked on: the plan's first, or the one after it.
  const next = plan.steps.findIndex((_, i) => i !== current)
  return {
    steps: plan.steps.length,
    goals: plan.goals.length,
    secondsLeft: plan.seconds,
    current: current < 0 ? null : view(current),
    next: next < 0 ? null : view(next)
  }
}

/** Where in a zone players say to be for an achievement (SLAYER_SPOTS), with who said it; undefined where nobody has. */
export function spotTip(zone: string, achievement: string): string | undefined {
  const s = spotFor(zone, achievement)
  return s && `${s.tip} (${s.said})`
}

/** The spot players name in a zone for an achievement (SLAYER_SPOTS), where to stand among it; undefined where nobody has. */
export const spotFor = (zone: string, achievement: string) =>
  SLAYER_SPOTS.find((x) => zoneKey(x.zone) === zoneKey(zone) && x.for.some((a) => metaName(a) === metaName(achievement)))

/** What eqlwiki's Slayer guide says of an achievement: where its kills are, in the guide's words; undefined where it says nothing. */
export function guideTip(achievement: string, guide: SlayerGuideTip[] = SLAYER_GUIDE): string | undefined {
  return guide.find((t) => metaName(t.achievement) === metaName(achievement))?.tip
}

/** How far back the pace now looks, and the fewest kills in that time that make one (FEAT-022). */
const PACE_WINDOW_MS = 20 * 60_000
const PACE_MIN_KILLS = 5
/** The shortest stretch a pace is taken over: five kills in a minute is not 300 an hour. */
const PACE_MIN_MS = 5 * 60_000

/**
 * The player's pace now at a step: its mobs killed in its zone over the last twenty minutes, an hour's
 * worth; with the step's time at that pace and the pace the plan assumed. Undefined with too few kills.
 */
export function paceNow(step: Pick<SlayerPlanStepView, 'zone' | 'seconds' | 'mobs'>, kills: SlayerKills | undefined, now: number): SlayerPlanStepView['now'] {
  if (!kills || !step.mobs.length) return undefined
  const want = new Set(step.mobs.map((m) => bareName(m.name)))
  const z = zoneKey(campZone(step.zone))
  const times: number[] = []
  for (const k of kills.values()) {
    if (!want.has(bareName(k.name))) continue
    k.times.forEach((t, i) => {
      const at = k.zones?.[i]
      if (t > now - PACE_WINDOW_MS && t <= now && (!at || zoneKey(campZone(at)) === z)) times.push(t)
    })
  }
  if (times.length < PACE_MIN_KILLS) return undefined
  const span = Math.max(PACE_MIN_MS, now - Math.min(...times))
  const perHour = Math.round((times.length / span) * 3_600_000)
  const left = step.mobs.reduce((n, m) => n + m.n, 0)
  return { perHour, seconds: Math.round((left / perHour) * 3600), planPerHour: step.seconds > 0 ? Math.round((left / step.seconds) * 3600) : 0 }
}
