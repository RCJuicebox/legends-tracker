import { mobKey } from '../../core/respawnSeen'
import { respawnEstimate, type RespawnRecord } from '../../core/respawns'
import { zoneKey } from '../../core/zones'
import { LEGENDS_SPAWNS, type LegendsSpawn } from '../../shared/game/legendsSpawns'

// What a zone's spawns allow: TAKP's classic spawn tables (scripts/takp-spawns.mjs) with each timer
// put in Legends' terms. Legends is not classic: a zone's spawns come back on one timer of its own,
// whatever classic gave each (Blackburrow's gnoll brewer, eighteen minutes classic, and its Splitpaw
// sharpshooter, not classic at all, both 3:40; Ak'Anon's clockworks 4:50 against twenty minutes), and
// never slower than classic in any zone timed so far. So a zone's timer is the one the player's log
// has timed there (the Respawns page: a spawn of one spot, a few gaps seen), no longer than each
// spot's classic timer; a zone nothing was timed in keeps classic's. A mob timed on its own is one
// spot on its own timer, whatever classic rolled there: the lesser blade fiend is a 3% roll in TAKP
// and a spawn of its own in Legends.

/** A TAKP zone: its mobs [name, race, lowest level, highest level], and its spawn groups. */
export interface TakpZone {
  id: number
  /** As the game's ZoneNames.txt names it. */
  name: string
  npcs: [string, string, number, number][]
  /** [classic respawn seconds, rolls [mob index, chance %], spots flattened as the map files draw them: x, y, z, x, y, z…]. */
  groups: [number, [number, number][], number[]][]
}

export type SpawnTables = Record<string, TakpZone>

/** A group on a timer this short is a roamer's, with a cap TAKP does not show: at most this many of its spots count. */
const ROAMER_SEC = 120
const ROAMER_SPOTS = 4
/** Gaps a spawn needs before its shortest one is taken as its timer. */
const MIN_GAPS = 3

/** The zone the game's log names, as the tables have it: "The Permafrost Caverns - Solo 2 (Adaptive)" → permafrost. */
export function zoneIndex(tables: SpawnTables): (zone: string) => string | null {
  const byKey = new Map(Object.entries(tables).map(([short, z]) => [zoneKey(z.name), short]))
  return (zone) => byKey.get(zoneKey(zone)) ?? null
}

/** A mob's name as the tables and the log both have it: no article, no marks, lower-cased ("an orc pawn" and TAKP's "orc pawn"). */
export const spawnKey = mobKey
const lower = spawnKey

/**
 * One mob's classic timer, where the tables give it a single spot: a mob of several spots, timed by
 * the log, was any of them, and its gaps say nothing of one spot's timer.
 */
function classicTimer(z: TakpZone, name: string): number | null {
  const n = lower(name)
  const at = z.groups.filter(([sec, rolls]) => sec > 0 && rolls.some(([i]) => lower(z.npcs[i][0]) === n))
  return at.length === 1 && at[0][2].length === 3 ? at[0][0] : null
}

/** A spawn the log timed, against its classic timer. */
interface TimedSpawn {
  zone: string
  name: string
  /** Seconds: Legends' (the shortest gap the log saw), classic's (TAKP). */
  legends: number
  classic: number | null
}

/** A zone's timer in Legends, from the spawns timed there. */
export interface ZoneTiming {
  /** Seconds: the middle of the spawns timed there that the tables give one spot; null when none is. */
  timer: number | null
  timed: TimedSpawn[]
}

/**
 * Each zone's timing, by the tables' zone: the Respawns page's records that make a fair timer (one
 * spawn, a few gaps seen), each with the classic timer of the mob it is where the tables give it one
 * spot. A spawn point of several names is any of them.
 */
export function zoneTimings(tables: SpawnTables, records: RespawnRecord[]): Map<string, ZoneTiming> {
  const index = zoneIndex(tables)
  const out = new Map<string, ZoneTiming>()
  for (const r of records) {
    if (r.shared || r.gaps.filter((g) => g >= 30).length < MIN_GAPS) continue
    const short = index(r.zone)
    const legends = respawnEstimate(r)
    if (!short || legends === null) continue
    const names = r.names?.length ? r.names : [r.name]
    const classic = names.map((n) => classicTimer(tables[short], n)).find((t) => t !== null) ?? null
    const t = out.get(short) ?? { timer: null, timed: [] }
    for (const name of names) t.timed.push({ zone: tables[short].name, name, legends, classic })
    out.set(short, t)
  }
  for (const t of out.values()) {
    // Each record once, though a spawn point lists several names.
    const timers = [...new Set(t.timed.filter((x) => x.classic).map((x) => `${x.legends}|${x.name}`))].map((k) => Number(k.split('|')[0])).sort((a, b) => a - b)
    if (!timers.length) continue
    const mid = timers.length / 2
    t.timer = timers.length % 2 ? timers[Math.floor(mid)] : (timers[mid - 1] + timers[mid]) / 2
  }
  return out
}

/** What a mob's spawns in a zone allow. */
export interface MobSpawn {
  name: string
  race: string
  lo: number
  hi: number
  /** Spots it can pop at, and how many of it are up at once, on average. */
  spots: number
  up: number
  /** Its timer in Legends, seconds (the most of its spots' timer), and where that comes from. */
  timer: number
  timerFrom: 'timed' | 'zone' | 'classic'
  /** Kills an hour at most, killing each the moment it pops. */
  ceiling: number
}

/** Every mob in a zone with what its spawns allow, by spawnKey. */
export function mobSpawns(z: TakpZone, timing?: ZoneTiming): Map<string, MobSpawn> {
  const zone = timing?.timer ?? null
  const timedOwn = new Map((timing?.timed ?? []).map((t) => [lower(t.name), t.legends]))
  const out = new Map<string, MobSpawn>()
  const timers = new Map<string, Map<number, number>>()
  for (const [sec, rolls, flat] of z.groups) {
    if (sec <= 0) continue
    const total = Math.max(
      100,
      rolls.reduce((s, [, c]) => s + c, 0)
    )
    const spots = sec < ROAMER_SEC ? Math.min(flat.length / 3, ROAMER_SPOTS) : flat.length / 3
    const timer = zone === null ? sec : Math.min(sec, zone)
    for (const [i, chance] of rolls) {
      const [name, race, lo, hi] = z.npcs[i]
      const k = lower(name)
      const m = out.get(k) ?? { name, race, lo, hi, spots: 0, up: 0, timer: 0, timerFrom: zone === null ? 'classic' : 'zone', ceiling: 0 }
      m.spots += flat.length / 3
      m.up += (spots * chance) / total
      m.ceiling += (spots * chance * 3600) / total / timer
      out.set(k, m)
      const t = timers.get(k) ?? new Map<number, number>()
      t.set(timer, (t.get(timer) ?? 0) + spots)
      timers.set(k, t)
    }
  }
  for (const [k, m] of out) {
    m.timer = [...(timers.get(k) ?? [])].sort((a, b) => b[1] - a[1])[0][0]
    const own = timedOwn.get(k)
    // Timed on its own: one spot, popping on that timer.
    if (own) Object.assign(m, { spots: 1, up: 1, timer: own, timerFrom: 'timed', ceiling: 3600 / own })
  }
  return out
}

/** A race a mob's name is, and its share of the mob's spawns: "a bandit" in the Western Plains of Karana is Human 62%, Barbarian 23%, Half Elf 16%. */
export interface RaceShare {
  race: string
  share: number
}

/**
 * The races a mob's name is in TAKP's tables, each by its share of the mob's spawns there (spots ×
 * odds): in the zone the kill was in, else over every zone that has it. Null where the tables lack
 * the name. Classic gives one name several races ("a bandit" Human, Half Elf or Barbarian); the log
 * names them alike, and only the share says how many counted toward what.
 */
export function raceMixer(tables: SpawnTables): (mob: string, zone: string) => RaceShare[] | null {
  const index = zoneIndex(tables)
  const cache = new Map<string, RaceShare[] | null>()
  const add = (into: Map<string, number>, z: TakpZone, k: string) => {
    for (const [, rolls, flat] of z.groups) {
      const total = Math.max(
        100,
        rolls.reduce((s, [, c]) => s + c, 0)
      )
      for (const [i, c] of rolls) if (lower(z.npcs[i][0]) === k) into.set(z.npcs[i][1], (into.get(z.npcs[i][1]) ?? 0) + (flat.length / 3) * (c / total))
    }
  }
  const shares = (m: Map<string, number>) => {
    const sum = [...m.values()].reduce((s, v) => s + v, 0)
    return sum > 0 ? [...m].map(([race, v]) => ({ race, share: v / sum })).sort((a, b) => b.share - a.share) : null
  }
  return (mob, zone) => {
    const k = lower(mob)
    const short = zone ? index(zone) : null
    const key = `${short ?? ''}|${k}`
    if (cache.has(key)) return cache.get(key)!
    const here = new Map<string, number>()
    if (short) add(here, tables[short], k)
    let got = shares(here)
    if (!got) {
      const everywhere = new Map<string, number>()
      for (const z of Object.values(tables)) add(everywhere, z, k)
      got = shares(everywhere)
    }
    cache.set(key, got)
    return got
  }
}

/** A spot on the map and what pops there. */
export interface MapSpot {
  x: number
  y: number
  z: number
  mobs: { name: string; chance: number }[]
  /** Classic timer, seconds; 0 for a spot of Legends' own. */
  timer: number
  /** Where it is, in words, as the player put it (a Legends spot). */
  where?: string
}

/** The spots in a zone where any of these mobs (any case) can pop. */
export function spotsOf(z: TakpZone, mobs: string[]): MapSpot[] {
  const want = new Set(mobs.map(lower))
  const out: MapSpot[] = []
  for (const [timer, rolls, flat] of z.groups) {
    const total = Math.max(
      100,
      rolls.reduce((s, [, c]) => s + c, 0)
    )
    const here = rolls.filter(([i]) => want.has(lower(z.npcs[i][0]))).map(([i, c]) => ({ name: z.npcs[i][0], chance: Math.round((c * 100) / total) }))
    if (!here.length) continue
    for (let p = 0; p + 2 < flat.length; p += 3) out.push({ x: flat[p], y: flat[p + 1], z: flat[p + 2], mobs: here, timer })
  }
  return out
}

/** The spots the player found in play (hunter-spots.json, FEAT-020), beside the built-in ones; main sets them as it reads and saves them. */
let found: LegendsSpawn[] = []

export function setFoundSpawns(list: LegendsSpawn[]): void {
  found = list
}

/**
 * Legends' own spawns of these mobs in a zone (legendsSpawns.ts, and the player's): what TAKP's tables
 * lack. One a named both lists have is one, with every spot and both sayings.
 */
export function legendsSpawnsOf(zone: string, mobs: string[]): LegendsSpawn[] {
  const want = new Set(mobs.map(lower))
  const k = zoneKey(zone)
  const by = new Map<string, LegendsSpawn>()
  for (const s of [...LEGENDS_SPAWNS, ...found]) {
    if (zoneKey(s.zone) !== k || !want.has(lower(s.name))) continue
    const had = by.get(lower(s.name))
    by.set(lower(s.name), had ? { ...had, spots: [...had.spots, ...s.spots], said: `${had.said}; ${s.said}`, ...(had.ph || s.ph ? { ph: had.ph ?? s.ph } : {}) } : s)
  }
  return [...by.values()]
}

/**
 * The spots in a zone where any of these mobs can pop: TAKP's, and Legends' own (a /waypoint's y, x
 * is the map's -y, -x). A Legends spot's odds are not known: it is drawn as a sure one.
 */
export function spotsIn(z: TakpZone, mobs: string[]): MapSpot[] {
  return [...spotsOf(z, mobs), ...legendsSpots(z.name, mobs)]
}

/** Legends' own spots of these mobs in a zone, as the map draws them. */
const legendsSpots = (zone: string, mobs: string[]): MapSpot[] =>
  legendsSpawnsOf(zone, mobs).flatMap((s) =>
    s.spots.map(({ at: [y, x, h], where }) => ({ x: -x, y: -y, z: h ?? 0, mobs: [{ name: s.name, chance: 100 }], timer: 0, ...(where ? { where } : {}) }))
  )

/** A spot as the game's /waypoint takes it, in the /loc order: "/waypoint -649, -13825". */
export const waypoint = (s: Pick<MapSpot, 'x' | 'y'>) => `/waypoint ${Math.round(-s.y)}, ${Math.round(-s.x)}`

/**
 * Where to stand still and let a pet kill what pops around you (most Slayer kills are farmed so, AFK):
 * the spot with the most of the step's spawns within reach, at about its own height (a castle's
 * floors, a cave's levels).
 */
export interface PetCamp {
  x: number
  y: number
  z: number
  /** How far it reaches, map units. */
  radius: number
  /** The spawn spots within reach. */
  spots: number
  /** What they give an hour on their classic timers, each spot's odds counted. */
  perHour: number
}

/** A pet's reach from where you stand: a spawn farther off is a walk the pet does not make on its own. */
export const PET_REACH = 150
/** A spawn more above or below you than this is another floor. */
const PET_HEIGHT = 25
/** A spot of Legends' own has no known timer: taken as a common mob's. */
const LEGENDS_TIMER = 600

/**
 * The best places to stand still with a pet, best first: each spawn spot tried as where you stand,
 * scored by the kills an hour the spots within reach give. The next is never within reach of one before.
 */
export function petCamps(spots: MapSpot[], reach = PET_REACH, most = 2): PetCamp[] {
  const worth = spots.map((s) => (s.mobs.reduce((n, m) => n + m.chance, 0) / 100) * (3600 / (s.timer || LEGENDS_TIMER)))
  const tried = spots.map((c) => {
    let n = 0
    let perHour = 0
    spots.forEach((s, i) => {
      if (Math.hypot(s.x - c.x, s.y - c.y) > reach || Math.abs(s.z - c.z) > PET_HEIGHT) return
      n++
      perHour += worth[i]
    })
    return { x: c.x, y: c.y, z: c.z, radius: reach, spots: n, perHour }
  })
  tried.sort((a, b) => b.perHour - a.perHour || b.spots - a.spots)
  const out: PetCamp[] = []
  for (const t of tried) {
    if (out.length >= most) break
    if (out.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < reach)) continue
    out.push(t)
  }
  return out
}

/** Where to stand with a pet for some of a zone's mobs, and each one's kills an hour from there (by spawnKey). */
export interface PetReach {
  x: number
  y: number
  z: number
  perHour: Map<string, number>
}

/**
 * The best place to stand with a pet for these mobs of a zone, as the spawn tables put them: the spot
 * whose reach (PET_REACH, at about its height) takes in the most of their kills an hour, on the timers
 * `mobs` give them. A zone's spawns spread over the map are not a camp: what pops out of reach is not
 * killed while you stand (a whole zone's treants once paced Plants Concrete and Stone at 55 an hour,
 * where a pet reaches 19). A mob never gives more than its spawns allow in the whole zone. With `at`,
 * what they give from there. Null when none of them has a spot.
 */
export function petReach(z: TakpZone, mobs: ReadonlyMap<string, MobSpawn>, zoneTimer: number | null = null, at?: Pick<PetReach, 'x' | 'y' | 'z'>): PetReach | null {
  const spots: { x: number; y: number; z: number; rates: [string, number][] }[] = []
  for (const [sec, rolls, flat] of z.groups) {
    if (sec <= 0) continue
    const total = Math.max(
      100,
      rolls.reduce((s, [, c]) => s + c, 0)
    )
    const n = flat.length / 3
    // A roamer's group counts no more spots than mobSpawns gives it, spread over where it starts.
    const part = sec < ROAMER_SEC ? Math.min(n, ROAMER_SPOTS) / n : 1
    const rates: [string, number][] = []
    for (const [i, chance] of rolls) {
      const k = lower(z.npcs[i][0])
      const m = mobs.get(k)
      if (!m) continue
      const timer = m.timerFrom === 'timed' ? m.timer : zoneTimer === null ? sec : Math.min(sec, zoneTimer)
      rates.push([k, (part * chance * 3600) / total / timer])
    }
    if (rates.length) for (let p = 0; p + 2 < flat.length; p += 3) spots.push({ x: flat[p], y: flat[p + 1], z: flat[p + 2], rates })
  }
  let best: PetReach | null = null
  let most = -1
  for (const c of at ? [at] : spots) {
    const perHour = new Map<string, number>()
    for (const s of spots) {
      if (Math.hypot(s.x - c.x, s.y - c.y) > PET_REACH || Math.abs(s.z - c.z) > PET_HEIGHT) continue
      for (const [k, r] of s.rates) perHour.set(k, (perHour.get(k) ?? 0) + r)
    }
    for (const [k, r] of perHour) perHour.set(k, Math.min(r, mobs.get(k)!.ceiling))
    const sum = [...perHour.values()].reduce((a, b) => a + b, 0)
    if (sum > most) {
      most = sum
      best = { x: c.x, y: c.y, z: c.z, perHour }
    }
  }
  return best
}

/** A zone's map as the game draws it, with the spots a step's mobs pop at. */
export interface SlayerMap {
  zone: string
  /** The zone's short name: its map files' name. */
  short: string
  /** Line segments flattened: x1, y1, x2, y2… */
  lines: number[]
  labels: { x: number; y: number; text: string }[]
  spots: MapSpot[]
  /** Where to stand with a pet, best first (petCamps). */
  camps: PetCamp[]
}

/** The game's map files (lines "L x1, y1, z1, x2, y2, z2, r, g, b", labels "P x, y, z, r, g, b, size, text"), heights dropped. */
export function parseMap(text: string): Pick<SlayerMap, 'lines' | 'labels'> {
  const lines: number[] = []
  const labels: SlayerMap['labels'] = []
  for (const row of text.split(/\r?\n/)) {
    const p = row
      .slice(2)
      .split(',')
      .map((v) => v.trim())
    if (row.startsWith('L ') && p.length >= 6) {
      const [x1, y1, , x2, y2] = p.map(Number)
      if ([x1, y1, x2, y2].every(Number.isFinite) && (x1 !== x2 || y1 !== y2)) lines.push(Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2))
    } else if (row.startsWith('P ') && p.length >= 8) {
      const x = Number(p[0])
      const y = Number(p[1])
      if (Number.isFinite(x) && Number.isFinite(y)) labels.push({ x, y, text: p.slice(7).join(',').replace(/_/g, ' ') })
    }
  }
  return { lines, labels }
}

/** What to mark on the game's map for one step: its zone, its mobs, and the Hunter named left there. */
export interface SlayerMark {
  zone: string
  mobs: string[]
  named?: string[]
}

/**
 * The marks for a zone's label layer: a point at each spot, red for the plan's mobs and deep blue for
 * Hunter named, labelled with what pops there ("a_hill_giant_60%", "Boog_Mudtoe").
 */
export function mapMarks(spots: MapSpot[], named: MapSpot[]): string[] {
  // What pops there, and its odds where it is a roll: "Boog_Mudtoe", "Andrew_Pine_25%". The colour says whose mark it is.
  const label = (s: MapSpot) =>
    s.mobs
      .map((m) => `${m.name}${m.chance < 100 ? ` ${m.chance}%` : ''}`)
      .join(' or ')
      .replace(/[\s,]+/g, '_')
      .replace(/[^\x20-\x7e]/g, '')
  const line = (s: MapSpot, rgb: string, size: number, text: string) => `P ${s.x}.0000, ${s.y}.0000, ${s.z}.0000, ${rgb}, ${size}, ${text}`
  return [...spots.map((s) => line(s, '240, 40, 40', 2, label(s))), ...named.map((s) => line(s, '0, 60, 220', 3, label(s)))]
}
