import type { AchSection } from '../../core/achievements'
import type { LogLine } from '../../core/logLine'
import { zoneEntered } from '../../core/logLine'
import { achievementRaces, slayerLine, type SlayerCounter, type SlayerRaces } from '../../core/slayer'
import type { RaceTable } from '../../core/raceNames'
import { baseZone } from '../factions/attribution'
import { zoneKey } from '../factions/names'
import { SLAYER_CAMPS, type SlayerCamp } from '../../shared/game/slayerCamps'
import { HUNT } from '../../shared/game/hunt'

// The Slayer plan: where to kill what each open Slayer achievement still wants, quickest first. A
// camp is a zone and what dies there an hour; it is worth every open achievement its races feed, so
// a zone of giants counts for Might They Be Giants? and A Giant Problem at once. Where the kills come
// from, best first: the player's own logs (every kill over the archives and the live log, and the
// time spent killing in each zone), what play has settled (slayerCamps.ts: the raid lockouts, the
// camps the Discord agrees on) and eqlwiki's count of a race's NPCs in a zone (hunt.ts), a guess.
// The plan takes the camp that does the most still-open work an hour, until its first achievement
// is done, and again; raid lockouts go beside it, a few kills a day.

/** A run of kills: within this of the one before, the time between counts as time spent killing there. */
const KILL_RUN_MS = 10 * 60_000

/** Each zone's kills and the time spent killing there, over one stretch of log. */
export interface SlayerKillTallies {
  /** The zone the stretch was last in, carried across reads of the live log. */
  zone: string
  /** The last kill, and its zone: the next kill within KILL_RUN_MS there adds the gap to the zone's time. */
  lastAt: number
  lastZone: string
  /** By zone (instances folded in), then by mob lower-cased: the name as the log gave it, and kills. */
  zones: Record<string, { sec: number; kills: number; last: number; mobs: Record<string, { name: string; n: number }> }>
}

export const emptyKillTallies = (): SlayerKillTallies => ({ zone: '', lastAt: 0, lastZone: '', zones: {} })

/** The zone an instance is of: "The Permafrost Caverns - Solo" and "Befallen 1 (Awakened)" are their zones' camps. */
export const campZone = (zone: string) => baseZone(zone).replace(/ - (?:Solo|Group)$/, '')

/** A kill's killer that is no mob: the player, or a player or pet named in one word ("Vonartik"). */
const ourSide = (by: string) => by === 'You' || /^[A-Z][a-z']+$/.test(by)

/**
 * Reads one stretch of log: zones entered, and kills the player's side made ("You have slain a gnoll!",
 * "A gnoll has been slain by Vonartik!"), each put to the zone it was in. A kill's credit cannot be
 * told as the live counts tell it (the damage meter's roster is not kept with the history), so any
 * named killer is taken for the player's side: near enough for where kills come from.
 */
export function readKillLine(line: LogLine, into: SlayerKillTallies): void {
  const z = zoneEntered(line.text)
  if (z) {
    into.zone = campZone(z)
    return
  }
  if (!into.zone || !(line.text.startsWith('You have slain ') || line.text.includes(' has been slain by '))) return
  const x = slayerLine(line.text)
  if (!x || !('kill' in x) || !ourSide(x.kill.by)) return
  const zone = (into.zones[into.zone] ??= { sec: 0, kills: 0, last: 0, mobs: {} })
  const gap = line.time - into.lastAt
  if (into.lastZone === into.zone && gap > 0 && gap <= KILL_RUN_MS) zone.sec += gap / 1000
  into.lastAt = line.time
  into.lastZone = into.zone
  zone.kills++
  zone.last = Math.max(zone.last, line.time)
  const k = x.kill.mob.replace(/^\*+/, '').toLowerCase()
  const m = (zone.mobs[k] ??= { name: x.kill.mob.replace(/^\*+/, ''), n: 0 })
  m.n++
}

/** Stretches of log (archives and the live log, and other characters') as one. */
export function joinKillTallies(stretches: SlayerKillTallies[]): SlayerKillTallies['zones'] {
  const out: SlayerKillTallies['zones'] = {}
  for (const s of stretches)
    for (const [zone, z] of Object.entries(s.zones)) {
      const had = (out[zone] ??= { sec: 0, kills: 0, last: 0, mobs: {} })
      had.sec += z.sec
      had.kills += z.kills
      had.last = Math.max(had.last, z.last)
      for (const [k, m] of Object.entries(z.mobs)) {
        const hm = (had.mobs[k] ??= { name: m.name, n: 0 })
        hm.n += m.n
      }
    }
  return out
}

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
        if (m) (o.o || m[1] ? optional : required).add(m[2].toLowerCase())
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
export function slayerGoals(counters: SlayerCounter[], since: ReadonlyMap<string, number>, optional: ReadonlySet<string>): SlayerGoal[] {
  return counters.map((c) => ({
    name: c.name,
    section: c.section,
    races: c.races,
    count: Math.min(c.max, c.count + (since.get(c.name.toLowerCase()) ?? 0)),
    max: c.max,
    optional: optional.has(c.name.toLowerCase())
  }))
}

/** Where a camp's pace comes from. */
export type CampSource = 'log' | 'play' | 'wiki'

/** A place to kill, and what dies there an hour toward each achievement. */
export interface SlayerPlanCamp {
  /** Stable across plans: "log:<zone>", "play:<zone>|<mob>", "wiki:<zone>". */
  id: string
  zone: string
  /** The mobs that count toward something, most killed first (the log's), or play's. */
  mobs: string[]
  source: CampSource
  /**
   * Per goal index, kills an hour toward it (or a day, for a raid lockout); for a camp play names
   * without a number (`assumed`), the share of the assumed pace its races make up.
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
}

/** What the plan is built from, all of it from main. */
export interface SlayerPlanData {
  character: string
  /** The achievements export it read, and when the game wrote it; null without one. */
  export: { file: string; modified: number } | null
  goals: SlayerGoal[]
  camps: SlayerPlanCamp[]
  /** Kills in the logs that no race was found for, most first: what the plan cannot place. */
  unplaced: { name: string; n: number }[]
  /** Mobs still being looked up on eqlwiki for their race. */
  pending: number
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
  place: (mob: string) => number[],
  factionPerKill: (zone: string, mob: string) => Record<string, number> | null,
  /** Every Slayer achievement's races, done ones too (slayerRaceLists): what eqlwiki's census is keyed by. */
  raceLists: ReadonlyMap<string, ReadonlySet<string>>,
  known: SlayerCamp[] = SLAYER_CAMPS
): SlayerPlanCamp[] {
  const camps: SlayerPlanCamp[] = []
  const fed = new Set<string>()
  // A raid boss's kills are a lockout's, a few a day, however quick the log made them look.
  const lockoutMobs = new Set(known.filter((k) => k.perDay !== undefined).flatMap((k) => k.mobs.map((m) => m.toLowerCase())))
  const feeds = (zone: string, g: number) => `${zoneKey(zone)}|${g}`
  for (const [zone, z] of Object.entries(zones)) {
    if (z.sec < MIN_LOG_SEC || z.kills < MIN_LOG_KILLS) continue
    const hours = z.sec / 3600
    const pace: Record<number, number> = {}
    const counted: { name: string; n: number }[] = []
    const moved: Record<string, number> = {}
    for (const m of Object.values(z.mobs)) {
      const at = place(m.name)
      const hits = factionPerKill(zone, m.name)
      if (hits) for (const [f, v] of Object.entries(hits)) moved[f] = (moved[f] ?? 0) + (v * m.n) / hours
      if (!at.length || lockoutMobs.has(m.name.toLowerCase())) continue
      counted.push(m)
      for (const g of at) pace[g] = (pace[g] ?? 0) + m.n / hours
    }
    if (!counted.length) continue
    for (const g of Object.keys(pace)) fed.add(feeds(zone, +g))
    camps.push({
      id: `log:${zone}`,
      zone,
      mobs: counted.sort((a, b) => b.n - a.n).map((m) => m.name),
      source: 'log',
      pace,
      hours,
      kills: z.kills,
      factions: Object.entries(moved)
        .filter(([, v]) => Math.abs(v) >= 0.5)
        .map(([faction, perHour]) => ({ faction, perHour }))
        .sort((a, b) => a.perHour - b.perHour)
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
    // The camp's kills are shared among its races alike: a goal gets the part its races make up.
    const part = (g: number) => k.races.filter((r) => races.keys[g].has(r)).length / k.races.length
    if (!daily) for (const g of open) fed.add(feeds(k.zone, g))
    camps.push({
      id: `play:${k.zone}|${k.mobs.join('|')}`,
      zone: k.zone,
      mobs: k.mobs,
      source: 'play',
      pace: Object.fromEntries(open.map((g) => [g, (per ?? 1) * part(g)])),
      ...(per === undefined ? { assumed: true } : {}),
      ...(daily ? { daily: true } : {}),
      note: k.note,
      said: k.said
    })
  }
  // eqlwiki's census, for goals nothing else feeds: keyed by the Skill achievements' names.
  // A goal counts as fed only where something feeds it at a fair pace: eqlwiki's zones are offered beside a crawl.
  const best = (g: number) => Math.max(0, ...camps.filter((c) => !c.daily && !c.assumed).map((c) => c.pace[g] ?? 0))
  const fedGoal = new Set([...fed].map((f) => +f.split('|')[1]).filter((g) => best(g) >= SLOW || camps.some((c) => c.assumed && c.pace[g])))
  // A race only raid bosses are (the kedge, Phinigel): no census guess stands in for the lockout.
  const lockoutRaces = new Set(known.filter((k) => k.perDay !== undefined).flatMap((k) => k.races))
  goals.forEach((_, i) => {
    if (fedGoal.has(i) || [...races.keys[i]].every((k) => lockoutRaces.has(k))) return
    for (const [name, rows] of Object.entries(HUNT)) {
      const keys = raceLists.get(name)
      if (!keys || ![...keys].some((k) => races.keys[i].has(k))) continue
      for (const [zone, npcs] of rows) {
        const id = `wiki:${zoneKey(zone)}`
        let c = camps.find((x) => x.id === id)
        if (!c) camps.push((c = { id, zone, mobs: [], source: 'wiki', pace: {}, note: `${npcs} NPCs of the race on eqlwiki`, said: 'eqlwiki, 2026-09-24' }))
        c.pace[i] = Math.max(c.pace[i] ?? 0, npcs * WIKI_PER_NPC)
      }
    }
  })
  return camps
}

/** What the player has chosen on the page. */
export interface SlayerPlanChoices {
  /** Achievements (lower-cased) left out of the plan, and optional ones taken in. */
  excluded: string[]
  included: string[]
  /** Camps (ids) ruled out. */
  outCamps: string[]
  /** Minutes to get from one camp to another. */
  travelMin: number
  /** Kills an hour where play names a camp without a number. */
  pace: number
}

export const DEFAULT_CHOICES: SlayerPlanChoices = { excluded: [], included: [], outCamps: [], travelMin: 10, pace: 60 }

/** A step of the plan: a stretch at one camp. */
export interface SlayerStep {
  camp: SlayerPlanCamp
  /** Hours there, and the travel to it. */
  seconds: number
  travel: number
  /** Kills toward each goal it moves (index → kills). */
  kills: Record<number, number>
  /** Goals it finishes. */
  finishes: number[]
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
 * The plan: at each step the camp that does the most still-open kills a second, travel counted, kept
 * until the first achievement it feeds is done; a step that stays at the same camp joins the one
 * before. Raid lockouts are not steps: each gives its kills a day beside the plan.
 */
export function planSlayer(data: Pick<SlayerPlanData, 'goals' | 'camps'>, choices: SlayerPlanChoices): SlayerPlan {
  const goals = goalsInPlay(data.goals, choices)
  const need = new Map(goals.map((g) => [g, data.goals[g].max - data.goals[g].count]))
  const ruled = new Set(choices.outCamps)
  const paceOf = (c: SlayerPlanCamp, g: number) => (c.pace[g] ?? 0) * (c.assumed ? choices.pace : 1)
  const camps = data.camps.filter((c) => !ruled.has(c.id))
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
  const steps: SlayerStep[] = []
  let at = ''
  for (let guard = 0; guard < 500; guard++) {
    let best: { c: SlayerPlanCamp; secs: number; score: number; fed: number[] } | null = null
    for (const c of hourly) {
      const fed = goals.filter((g) => !onlyDaily.has(g) && (need.get(g) ?? 0) > 0 && paceOf(c, g) > 0)
      if (!fed.length) continue
      // Until the first achievement it feeds is done.
      const secs = Math.min(...fed.map((g) => ((need.get(g) ?? 0) / paceOf(c, g)) * 3600))
      const work = fed.reduce((s, g) => s + Math.min(need.get(g) ?? 0, (paceOf(c, g) * secs) / 3600), 0)
      const score = work / (secs + (c.id === at ? 0 : travelSec))
      if (!best || score > best.score) best = { c, secs, score, fed }
    }
    if (!best) break
    const { c, secs, fed } = best
    const kills: Record<number, number> = {}
    const finishes: number[] = []
    for (const g of fed) {
      const k = Math.min(need.get(g) ?? 0, (paceOf(c, g) * secs) / 3600)
      kills[g] = k
      const left = (need.get(g) ?? 0) - k
      need.set(g, left)
      if (left <= 1e-6) finishes.push(g)
    }
    const prev = steps.at(-1)
    if (prev && prev.camp.id === c.id) {
      prev.seconds += secs
      for (const [g, k] of Object.entries(kills)) prev.kills[+g] = (prev.kills[+g] ?? 0) + k
      prev.finishes.push(...finishes)
    } else steps.push({ camp: c, seconds: secs, travel: at ? travelSec : 0, kills, finishes })
    at = c.id
  }
  const unplanned = goals.filter((g) => (need.get(g) ?? 0) > 1e-6 && !onlyDaily.has(g))
  const merged = oneVisitEach(steps, data.goals, goals, travelSec)
  return { steps: merged, daily, seconds: merged.reduce((s, st) => s + st.seconds + st.travel, 0), unplanned, goals }
}

/**
 * The steps with every camp visited once, at its first place in the plan: a camp's kills toward each
 * goal are the same however its time is split, so joining its visits keeps every count and saves the
 * travel back. What each step finishes is worked out again in the new order.
 */
function oneVisitEach(steps: SlayerStep[], all: SlayerGoal[], goals: number[], travelSec: number): SlayerStep[] {
  const by = new Map<string, SlayerStep>()
  for (const st of steps) {
    const had = by.get(st.camp.id)
    if (!had) {
      by.set(st.camp.id, { ...st, kills: { ...st.kills }, finishes: [] })
      continue
    }
    had.seconds += st.seconds
    for (const [g, k] of Object.entries(st.kills)) had.kills[+g] = (had.kills[+g] ?? 0) + k
  }
  const need = new Map(goals.map((g) => [g, all[g].max - all[g].count]))
  return [...by.values()].map((st, i) => {
    for (const [g, k] of Object.entries(st.kills)) {
      const left = (need.get(+g) ?? 0) - k
      need.set(+g, left)
      if (left <= 1e-6) st.finishes.push(+g)
    }
    return { ...st, travel: i ? travelSec : 0 }
  })
}
