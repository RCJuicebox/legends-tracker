import { DIED, SLAIN_BY, SLAIN_BY_YOU } from '../../core/phrases'
import { mobKey } from '../../core/respawnSeen'
import { zoneKey } from '../../core/zones'
import type { CrawlTrackView } from '../../shared/tracking'

// Dungeon Crawl routes: a crawl is finished by killing every rare creature in the instance (and
// enough of the rest), and in a zone of many floors drawn on one flat map the hard part is the way
// between them. A route (scripts/crawl-routes.mjs writes them, from the zone's own geometry) is the
// zone's rare spots as stops, in the order that makes the shortest swim from the zone-in, with the way
// from each stop to the next as it really runs, floor by floor. This file reads a route: which floor a
// height is on, the way cut into pieces a map can draw, the marks for the game's own map, and how a
// run stands from the kills the log shows.
//
// A route's zone also has its places to sit (camps): spots that have enough spawn spots in a straight
// open line, within a spell's reach, to kill what pops there without moving. Those are for the zone
// itself, where things respawn, not for a crawl.

/** A rare that pops at a stop. */
export interface CrawlRare {
  /** As the log names it. */
  name: string
  /** Why it is taken as rare: the game's Hunter list, a /con that said so, or a named taken as one. */
  why: 'hunter' | 'con' | 'guess'
  /** The most it rolls at a spot here, in a hundred, by classic's tables. */
  chance: number
  /** How many of the stop's spots it can pop at. */
  spots: number
  /** It pops near here at long odds only, out of the stop's reach: look for it on the game's map. */
  far?: boolean
}

/** A point as the game's maps have it: x, y, height. */
export type Point = [number, number, number]

export interface CrawlStop {
  at: Point
  rares: CrawlRare[]
  /** The spawn spots that are this stop. */
  spots: Point[]
  /** Spots of long odds that go with it, out of its reach. */
  far?: Point[]
  /** The way here from the stop before (the zone-in for the first), flattened: x, y, z, x, y, z… */
  leg: number[]
  /** How long that way is, in the game's units. */
  length: number
}

/** A depth of the zone, named top first; `from` is the height it starts at, null for the lowest. */
export interface CrawlFloor {
  name: string
  from: number | null
}

/** A mob a place to sit has in sight. */
export interface CampMob {
  /** As the log names it. */
  name: string
  /** Its levels, by classic's tables (Legends' /con levels match them). */
  lo: number
  hi: number
  /** How many of the spots in sight it can pop at, and the most it rolls at one, in a hundred. */
  spots: number
  chance: number
  /** A rare of the zone, or a named on a long timer. */
  named?: boolean
  /** Too low to be worth a spell (a level 1 fish): seen, not counted. */
  small?: boolean
}

/** A spawn spot seen from a place to sit: x, y, height, and how far it is. */
export type SeenSpot = [number, number, number, number]

/** A place to sit and kill what pops: the spawn spots in a straight open line from it, within a spell's reach. */
export interface CrawlCamp {
  at: Point
  /** The spots in sight that mostly hold something worth a spell, of the levels wanted (the route's sitUnder). */
  spots: SeenSpot[]
  /** The spots in sight that mostly hold something above those levels. */
  over?: SeenSpot[]
  /** The spots in sight that mostly hold small fry. */
  small?: SeenSpot[]
  /** How many of `spots` and `over` are within classic's aggro reach: those mobs come on their own. */
  close: number
  /** What pops at the spots in sight, the lowest first, small fry last. */
  mobs: CampMob[]
  /** The spots' respawn time by classic's tables, in seconds. */
  respawn: number
  /** The way here from the zone-in, flattened as a stop's leg is. */
  way: number[]
  length: number
}

export interface CrawlRoute {
  /** As the game's ZoneNames.txt names it. */
  name: string
  start: Point
  floors: CrawlFloor[]
  /** In the order to visit them. */
  stops: CrawlStop[]
  /** How far each stop is from each other by the open ways (row and column 0 are the start), in the stops' order. */
  dist: number[][]
  /** The zone's places to sit: those with enough spots under `sitUnder` first, then the rest, each by the most spots in sight. */
  camps?: CrawlCamp[]
  /** The level the mobs of a place to sit are wanted under. */
  sitUnder?: number
}

export type CrawlRoutes = Record<string, CrawlRoute>

/** A zone's route by the name the log gives the zone or an instance of it ("Kedge Keep 1 (Awakened)"); undefined for a zone with none. */
export function routeOf(routes: CrawlRoutes, zone: string): { short: string; route: CrawlRoute } | undefined {
  const k = zoneKey(zone)
  const short = k ? Object.keys(routes).find((s) => zoneKey(routes[s].name) === k) : undefined
  return short ? { short, route: routes[short] } : undefined
}

/** "Kedge Keep 1 (Awakened)", "Nagafen's Lair - Solo 4 (Refined)": an instance, where nothing respawns on a crawl. */
const INSTANCE = /^.+? \d+ \(\w+\)$/
export const isInstance = (zone: string) => INSTANCE.test(zone)

/** The floor a height is on: its place in the route's floors, top first. */
export function floorOf(route: Pick<CrawlRoute, 'floors'>, z: number): number {
  const i = route.floors.findIndex((f) => f.from === null || z >= f.from)
  return i < 0 ? route.floors.length - 1 : i
}

/** One straight piece of the way to a stop, on the floor its middle is on. */
export interface LegPiece {
  /** The stop it leads to, from 0. */
  stop: number
  floor: number
  /**
   * The floor the way is on here, for saying where it changes floors: `floor`, but a short dip across
   * a floor's edge in the middle of a leg (a tunnel running along the height two floors meet at) stays
   * on the floor it left.
   */
  level: number
  from: Point
  to: Point
}

/** A stretch of a leg on another floor shorter than this, between two longer ones, is no change of floor. */
const MIN_RUN = 60

/** One way (a stop's leg, the way to a place to sit) as straight pieces, each on a floor; `stop` is what it leads to. */
export function wayPieces(route: Pick<CrawlRoute, 'floors'>, way: number[], stop = 0): LegPiece[] {
  const leg: LegPiece[] = []
  for (let i = 0; i + 5 < way.length; i += 3) {
    const from: Point = [way[i], way[i + 1], way[i + 2]]
    const to: Point = [way[i + 3], way[i + 4], way[i + 5]]
    const floor = floorOf(route, (from[2] + to[2]) / 2)
    leg.push({ stop, floor, level: floor, from, to })
  }
  // Runs of pieces on one level, each with its length; a short run that is neither the way's first nor its last joins the one before.
  for (let changed = true; changed;) {
    changed = false
    const runs: { at: number; n: number; length: number }[] = []
    leg.forEach((p, i) => {
      const len = Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1], p.to[2] - p.from[2])
      const last = runs.at(-1)
      if (last && leg[last.at].level === p.level) {
        last.n++
        last.length += len
      } else runs.push({ at: i, n: 1, length: len })
    })
    const short = runs.findIndex((r, i) => i > 0 && i < runs.length - 1 && r.length < MIN_RUN)
    if (short > 0) {
      const r = runs[short]
      for (let i = r.at; i < r.at + r.n; i++) leg[i].level = leg[r.at - 1].level
      changed = true
    }
  }
  return leg
}

/** The whole route as straight pieces, each on a floor: what a map draws, and what says where a leg changes floors. */
export const legPieces = (route: CrawlRoute): LegPiece[] => route.stops.flatMap((s, stop) => wayPieces(route, s.leg, stop))

/** The floors a stop's leg passes through, in order, each once in a row: "Top → High → Upper". */
export const legFloors = (route: CrawlRoute, stop: number): number[] => wayFloors(route, route.stops[stop].leg)

/** The floors a way passes through, in order, each once in a row. */
export function wayFloors(route: Pick<CrawlRoute, 'floors'>, way: number[]): number[] {
  const out: number[] = []
  for (const p of wayPieces(route, way)) if (out.at(-1) !== p.level) out.push(p.level)
  return out
}

// ---- the game's own map ----

/** A floor's colour, top first, on the page and on the game's map alike: red at the top down to violet. */
export const FLOOR_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 90, 90],
  [255, 165, 30],
  [235, 215, 40],
  [60, 210, 110],
  [50, 170, 255],
  [190, 110, 255]
]

export const floorColor = (floor: number) => FLOOR_COLORS[Math.min(floor, FLOOR_COLORS.length - 1)]

/** A climb or a drop of the route this tall is called out on the game's map: under it, the route stays inside a tight height filter. */
const CLIMB = 24

/** Where the route leaves the height it is at, to go up or down. */
export interface Climb {
  /** Where it starts, at the height the player is still at: where the route's line ends under a height filter. */
  at: Point
  up: boolean
  /** The stop it starts at (from 0), when it starts where that stop's label is. */
  from?: number
}

/**
 * The route's climbs and drops: each run of a leg's pieces rising (or falling) at least half as fast as
 * they go along, when the run is CLIMB tall or more. With the game's map filtered by height the route's
 * line stops at each of them, and nothing else says which way it went.
 */
export function routeClimbs(route: CrawlRoute): Climb[] {
  const out: Climb[] = []
  route.stops.forEach((s, stop) => {
    let at: Point | null = null
    let rise = 0
    let first = false
    const close = () => {
      if (at && Math.abs(rise) >= CLIMB) out.push({ at, up: rise > 0, ...(first && stop > 0 ? { from: stop - 1 } : {}) })
      at = null
      rise = 0
    }
    for (let i = 0; i + 5 < s.leg.length; i += 3) {
      const dz = s.leg[i + 5] - s.leg[i + 2]
      const steep = dz !== 0 && Math.abs(dz) * 2 >= Math.hypot(s.leg[i + 3] - s.leg[i], s.leg[i + 4] - s.leg[i + 1])
      if (!steep || dz > 0 !== rise > 0) close()
      if (!steep) continue
      if (!at) {
        at = [s.leg[i], s.leg[i + 1], s.leg[i + 2]]
        first = i === 0
      }
      rise += dz
    }
    close()
  })
  return out
}

/**
 * The route as lines for one of the game's map layers: the way in each floor's colour, then a label at
 * each stop with its number and what pops there ("3_Cauldronbubble"), then "up" or "down" where the way
 * climbs or drops (on the stop's own label when it does so from a stop: "3_Cauldronbubble_then_up").
 * The game's map files take "L x1, y1, z1, x2, y2, z2, r, g, b" and "P x, y, z, r, g, b, size, text", a
 * label's spaces as underscores.
 */
export function routeMarks(route: CrawlRoute): string[] {
  const n = (v: number) => v.toFixed(4)
  const way = (c: Climb) => (c.up ? 'up' : 'down')
  const climbs = routeClimbs(route)
  const lines = legPieces(route).map((p) => `L ${[...p.from, ...p.to].map(n).join(', ')}, ${floorColor(p.floor).join(', ')}`)
  const labels = route.stops.map((s, i) => {
    const names = s.rares.filter((r) => !r.far).map((r) => r.name.replace(/^an? /, ''))
    const then = climbs.find((c) => c.from === i)
    const text = `${i + 1}_${names.slice(0, 2).join('/')}${names.length > 2 ? `_+${names.length - 2}` : ''}${then ? `_then_${way(then)}` : ''}`
      .replace(/[\s,]+/g, '_')
      .replace(/[^\x20-\x7e]/g, '')
    return `P ${s.at.map(n).join(', ')}, ${floorColor(floorOf(route, s.at[2])).join(', ')}, 3, ${text}`
  })
  const turns = climbs.filter((c) => c.from === undefined).map((c) => `P ${c.at.map(n).join(', ')}, ${floorColor(floorOf(route, c.at[2])).join(', ')}, 2, ${way(c)}`)
  return [...lines, ...labels, ...turns]
}

/** A place to sit's letter, as the page and the game's map both name it: A for the first. */
export const campLetter = (i: number) => String.fromCharCode(65 + (i % 26))

/** The levels of what a place to sit kills, small fry and the seldom seen named aside: [lowest, highest]. */
export function campLevels(camp: CrawlCamp): [number, number] {
  const real = camp.mobs.filter((m) => !m.small)
  const usual = real.filter((m) => !m.named || m.chance >= 50)
  const of = usual.length ? usual : real
  return [Math.min(...of.map((m) => m.lo)), Math.max(...of.map((m) => m.hi))]
}

/** How many spawn spots worth a spell a place to sit has in sight. */
export const campSpots = (camp: CrawlCamp) => camp.spots.length + (camp.over?.length ?? 0)

/** Whether a place to sit is of the levels wanted: enough spots under them, and few above (one in five at most). */
export const campIsLow = (camp: CrawlCamp) => camp.spots.length >= 4 && (camp.over?.length ?? 0) * 4 <= camp.spots.length

/**
 * The places to sit as lines for one of the game's map layers: the way to each from the zone-in in each
 * floor's colour, then a label at each with its letter, how many spots it sees and their levels ("Sit_B_7_spots_levels_28-42").
 */
export function campMarks(route: CrawlRoute): string[] {
  const n = (v: number) => v.toFixed(4)
  const camps = route.camps ?? []
  const lines = camps.flatMap((c) => wayPieces(route, c.way).map((p) => `L ${[...p.from, ...p.to].map(n).join(', ')}, ${floorColor(p.floor).join(', ')}`))
  const labels = camps.map(
    (c, i) => `P ${c.at.map(n).join(', ')}, ${floorColor(floorOf(route, c.at[2])).join(', ')}, 3, Sit_${campLetter(i)}_${campSpots(c)}_spots_levels_${campLevels(c).join('-')}`
  )
  return [...new Set(lines), ...labels]
}

// ---- a run ----

/** A run in an instance, as the log shows it: the rares killed and the rares seen up, by bare name, with when. */
export interface CrawlRun {
  /** The instance, as the log names it. */
  instance: string
  startedAt: number
  killed: Record<string, number>
  /** Rares a /con called rare this run: up, until killed. */
  up: Record<string, number>
  /** When the game said the crawl was completed. */
  doneAt?: number
}

export const newRun = (instance: string, at: number): CrawlRun => ({ instance, startedAt: at, killed: {}, up: {} })

/** A name as the route, the log's kills and a /con all have it. */
export const rareKey = mobKey

/** "Auraline - a rare creature - glares at you threateningly -- looks like quite a gamble. (Lvl: 50)": the rare a /con named. */
const RARE_CON = /^\*?(.+?) - a rare creature - /
export const rareCon = (text: string): string | null => RARE_CON.exec(text)?.[1] ?? null

/** The mob a line says died, whoever killed it; null for any other line. */
export function slainMob(text: string): string | null {
  if (!text.endsWith('!') && !text.endsWith('.')) return null
  return (SLAIN_BY_YOU.exec(text) ?? SLAIN_BY.exec(text) ?? DIED.exec(text))?.[1] ?? null
}

export const CRAWL_DONE = /^You have completed the Dungeon Crawl/

/**
 * A run after one more line of the log, or the same run when the line says nothing of it: a rare of
 * the route killed, a /con calling something rare (of the route or not: Legends has rares no list
 * names), the crawl completed.
 */
export function readRunLine(route: CrawlRoute, run: CrawlRun, text: string, at: number): CrawlRun {
  if (CRAWL_DONE.test(text)) return { ...run, doneAt: at }
  const rare = rareCon(text)
  if (rare) return run.killed[rareKey(rare)] ? run : { ...run, up: { ...run.up, [rareKey(rare)]: at } }
  const mob = slainMob(text)
  if (!mob) return run
  const k = rareKey(mob)
  if (!route.stops.some((s) => s.rares.some((r) => rareKey(r.name) === k)) && !run.up[k]) return run
  const { [k]: _was, ...up } = run.up
  return { ...run, killed: { ...run.killed, [k]: at }, up }
}

/**
 * Where a run has been: when each stop was visited (0 for not), the last one visited (-1 before any)
 * and the one to go to next (-1 when none is left after it). A stop is visited once a rare that pops
 * nowhere else died there: a rare of several stops says nothing of which it was at.
 */
export function stopStates(route: CrawlRoute, run: CrawlRun | null): { visitedAt: number[]; last: number; next: number } {
  const killed = run?.killed ?? {}
  const stopsOf = new Map<string, number>()
  for (const s of route.stops) for (const r of s.rares) stopsOf.set(rareKey(r.name), (stopsOf.get(rareKey(r.name)) ?? 0) + 1)
  const visitedAt = route.stops.map((s) => Math.max(0, ...s.rares.filter((r) => stopsOf.get(rareKey(r.name)) === 1).map((r) => killed[rareKey(r.name)] ?? 0)))
  // Two stops visited in the same second: the later on the route is the last.
  const last = visitedAt.reduce((best, at, i) => (at && at >= (visitedAt[best] ?? 0) ? i : best), -1)
  return { visitedAt, last, next: visitedAt.findIndex((at, i) => i > last && !at) }
}

/** Stops listed on the overlay after the next one. */
const AHEAD = 3

/**
 * How a run stands, for the overlay. The next stop is the first not visited after the last one
 * visited (stopStates), in the route's order: its numbers are the ones on the game's map,
 * so they never move. Stops passed over before it are kept as `passed`: the game's map shows whether a
 * rare was up there, and not every rare is up every run.
 */
export function crawlView(route: CrawlRoute, run: CrawlRun | null, zone: string): CrawlTrackView {
  const killed = run?.killed ?? {}
  const up = run?.up ?? {}
  const { visitedAt, last, next } = stopStates(route, run)
  const row = (i: number) => {
    const s = route.stops[i]
    return {
      n: i + 1,
      floor: route.floors[floorOf(route, s.at[2])].name,
      rares: s.rares.filter((r) => !killed[rareKey(r.name)] && (!r.far || up[rareKey(r.name)])).map((r) => ({ name: r.name, ...(up[rareKey(r.name)] ? { up: true } : {}) })),
      length: s.length
    }
  }
  const names = new Set(route.stops.flatMap((s) => s.rares.map((r) => rareKey(r.name))))
  // The way on from the last stop visited, where the route's own leg starts from a stop passed over.
  const away = next >= 0 ? (route.dist[last + 1]?.[next + 1] ?? route.stops[next].length) : 0
  return {
    zone,
    route: route.name,
    stops: route.stops.length,
    visited: visitedAt.filter(Boolean).length,
    rares: names.size,
    killed: Object.keys(killed).length,
    ...(next >= 0 ? { next: { ...row(next), length: away } } : {}),
    ahead: visitedAt.flatMap((at, i) => (next >= 0 && i > next && !at ? [row(i)] : [])).slice(0, AHEAD),
    passed: visitedAt.flatMap((at, i) => (i < last && !at ? [row(i)] : [])).filter((r) => r.rares.length),
    // A rare the route does not know, which a /con called rare this run and is not dead yet.
    also: Object.keys(up).filter((k) => !names.has(k)),
    ...(run?.doneAt ? { done: true } : {})
  }
}

// ---- the page ----

/** The game's map lines with their heights kept, flattened six numbers each: x1, y1, z1, x2, y2, z2. */
export function parseMapLines(text: string): number[] {
  const out: number[] = []
  for (const row of text.split(/\r?\n/)) {
    if (!row.startsWith('L ')) continue
    const p = row
      .slice(2)
      .split(',')
      .slice(0, 6)
      .map((v) => Math.round(Number(v)))
    if (p.length === 6 && p.every(Number.isFinite) && (p[0] !== p[3] || p[1] !== p[4] || p[2] !== p[5])) out.push(...p)
  }
  return out
}

/** What Motes › Crawl route shows. */
export interface CrawlData {
  /** The zones that have a route, as the game names them. */
  zones: string[]
  route: CrawlRoute | null
  /** The zone's map as the game draws it (parseMapLines). */
  lines: number[]
  /** The route is drawn on the game's map (the LegendsTracker map set). */
  marked: boolean
  /** The places to sit are drawn on the game's map, on a layer of their own. */
  campsMarked: boolean
  /** The run in hand in an instance of this zone, if any; `here` while the player is in it. */
  run: CrawlRun | null
  here: boolean
}
