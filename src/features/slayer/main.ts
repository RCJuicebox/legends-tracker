import { join } from 'node:path'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { RACE_TABLE } from '../../core/raceNames'
import { SlayerRaces, slayerCounters } from '../../core/slayer'
import { isCharacterKey } from '../../core/validate'
import { listLogs } from '../../main/game'
import { handle } from '../../main/ipc/handle'
import { log } from '../../main/log'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import type { HistoryConsumer, LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'
import type { AppFeature } from '../../main/appFeature'
import {
  banestrikeTiers,
  bareName,
  buildCamps,
  DEFAULT_CHOICES,
  emptyKillTallies,
  joinKillTallies,
  joinMoves,
  optionalSlayer,
  readKillLine,
  slayerGoals,
  slayerRaceLists,
  type SlayerKillTallies,
  type SlayerMove,
  type SlayerPlanChoices,
  type SlayerPlanData
} from './core'
import { isMarked, mapMarks, mobSpawns, parseMap, spotsOf, zoneIndex, zoneTimings, type MobSpawn, type SlayerMap, type SlayerMark, type SpawnTables } from './spawns'
import type { RespawnRecord } from '../../core/respawns'
import TAKP from '../../shared/game/takpSpawns.json'
import { hunterZones } from '../hunter/core'

// The Slayer page's side of the app: every kill over each character's log and archives, by zone
// (a LogHistory consumer), and the plan's data built from them, the achievements export, the live
// counts, eqlwiki's races and what play has settled (core.ts). What the player chooses on the page
// is kept per character in slayer-plan.json.

/** The pages that mark the game's map. */
export type MarkSet = 'slayer' | 'hunter'

/** TAKP's classic spawn tables, as scripts/takp-spawns.mjs wrote them. */
const TABLES = TAKP.zones as unknown as SpawnTables
const tableOf = zoneIndex(TABLES)

/** The map set the plan's spawns are marked in: a copy of the game's own maps, so its files stay as they are. */
const MAP_SET = 'LegendsTracker'

/** Each stretch of log's kills by zone, as a LogHistory consumer. Version 2: trips between zones, each mob's last kill. */
const killConsumer: HistoryConsumer<SlayerKillTallies> = {
  version: 2,
  empty: emptyKillTallies,
  reader: () => readKillLine
}

export const KILLS_KEY = 'slayerKills'
/** One plan's data is shared for this long: the page asks every minute, and reading every log takes a while. */
const SHARED_MS = 30_000
/** Mobs asked of eqlwiki for one plan at most: fifty a request, in the background. */
const LOOKUPS = 400

/** A choice read from the page or the file, kept only as far as it is the right shape. */
export function sanitizeChoices(v: unknown): SlayerPlanChoices {
  const c = (v ?? {}) as Partial<SlayerPlanChoices>
  const names = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length < 200).slice(0, 500) : [])
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)
  return {
    excluded: names(c.excluded),
    included: names(c.included),
    outCamps: names(c.outCamps),
    outMobs: names(c.outMobs).map((m) => m.toLowerCase()),
    travelMin: num(c.travelMin, 0, 120, DEFAULT_CHOICES.travelMin),
    pace: num(c.pace, 1, 2000, DEFAULT_CHOICES.pace)
  }
}

export class SlayerPlanner implements AppFeature {
  readonly id = 'slayer'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [KILLS_KEY]: killConsumer }
  private readonly choices: JsonFile<Record<string, SlayerPlanChoices>>
  /** What each page last marked on the game's map: the Slayer plan's steps, and Plan › Hunter's named. */
  private readonly marks: JsonFile<Record<MarkSet, SlayerMark[]>>
  private readonly shared = new Map<string, { at: number; data: Promise<SlayerPlanData> }>()

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'slayer-plan.json')
    const read = readJsonFile(path)
    const value = read.state === 'ok' && read.value && typeof read.value === 'object' ? (read.value as Record<string, unknown>) : {}
    this.choices = new JsonFile(path, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeChoices(v)])), { delayMs: 1000 })
    if (read.state === 'unreadable') this.choices.freeze('could not be read at start')
    const marksPath = join(dir, 'map-marks.json')
    const kept = readJsonFile(marksPath)
    const sets = (kept.state === 'ok' && kept.value && typeof kept.value === 'object' ? kept.value : {}) as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter(isMark).slice(0, 200) : [])
    this.marks = new JsonFile(marksPath, { slayer: list(sets.slayer), hunter: list(sets.hunter) }, { delayMs: 1000 })
  }

  flush(): Promise<void> {
    return Promise.all([this.choices.flush(), this.marks.flush()]).then(() => undefined)
  }

  register(ctx: AppContext): void {
    handle('slayer:plan', async (character, refresh) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      const had = this.shared.get(character)
      const data = !refresh && had && Date.now() - had.at < SHARED_MS ? had.data : this.data(ctx, character)
      if (data !== had?.data) {
        this.shared.set(character, { at: Date.now(), data })
        data.catch(() => this.shared.get(character)?.data === data && this.shared.delete(character))
      }
      return { data: await data, choices: this.choices.get()[character] ?? DEFAULT_CHOICES }
    })
    handle('slayer:choices', (character, choices) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      this.choices.set({ ...this.choices.get(), [character]: sanitizeChoices(choices) })
    })
    handle('slayer:map', async (zone, mobs) => {
      if (typeof zone !== 'string' || !Array.isArray(mobs)) throw new Error('No such zone.')
      return spawnMap(ctx.installDir(), zone, mobs.filter((m): m is string => typeof m === 'string').slice(0, 50))
    })
    handle('slayer:mark', async (marks, set = 'slayer') => {
      if (!Array.isArray(marks) || (set !== 'slayer' && set !== 'hunter')) throw new Error('Nothing to mark.')
      // Each page's marks kept, and the map written with both: marking one never takes the other's off.
      const next = { ...this.marks.get(), [set]: (marks as unknown[]).filter(isMark).slice(0, 200) }
      this.marks.set(next)
      return markMaps(ctx.installDir(), [...next.slayer, ...next.hunter])
    })
  }

  /** Every kill in this character's logs and the player's other characters', by zone, and their trips between zones. */
  private async kills(ctx: AppContext, character: string): Promise<{ zones: SlayerKillTallies['zones']; moves: SlayerMove[] }> {
    const logs = await listLogs(ctx.installDir())
    const who = [character, ...new Set(logs.map((l) => l.character).filter((c) => c.toLowerCase() !== character.toLowerCase()))]
    const stretches: SlayerKillTallies[] = []
    // One at a time: LogHistory reads one log at a time anyway, and a log that fails is left out.
    for (const c of who) {
      try {
        const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(c))
        stretches.push(...slice.archives.map((a) => a.value), slice.live)
      } catch (e) {
        log.warn(`${c}'s log could not be read for the Slayer plan:`, e)
      }
    }
    return { zones: joinKillTallies(stretches), moves: joinMoves(stretches) }
  }

  private async data(ctx: AppContext, character: string): Promise<SlayerPlanData> {
    const exp = await ctx.achievementFiles.exported(character)
    if (!exp) return { character, export: null, goals: [], camps: [], unplaced: [], pending: 0, moves: [], killSpeed: null, timings: [], hunter: [] }
    const counters = slayerCounters(exp.sections)
    // The live counts, while the export they count on is the one read here.
    const track = ctx.liveAchievements.view
    const since = new Map<string, number>()
    if (track?.character === character && track.slayer?.exportAt === exp.modified) for (const r of track.slayer.rows) since.set(r.name.toLowerCase(), r.since)
    const goals = slayerGoals(counters, since, optionalSlayer(exp.sections), banestrikeTiers(exp.sections))
    const game = await ctx.gameTables.get(RACE_TABLE)
    const races = new SlayerRaces(counters, game)
    const { zones, moves } = await this.kills(ctx, character)
    const npc = ctx.liveAchievements.races
    await npc.ready()
    const unknown = new Set<string>()
    const unplaced = new Map<string, { name: string; n: number }>()
    const placed = new Map<string, number[]>()
    const place = (mob: string) => {
      const k = mob.toLowerCase()
      let at = placed.get(k)
      if (at) return at
      const wiki = npc.race(mob)
      if (wiki === undefined) unknown.add(mob)
      const p = races.place(mob, wiki)
      at = goals.flatMap((g, i) => ((ctx.liveAchievements.fact(k, g.name.toLowerCase()) ?? (p.key !== null && races.keys[i].has(p.key))) ? [i] : []))
      placed.set(k, at)
      return at
    }
    // What a kill did to the factions, from the faction lines after kills (this character's log).
    const causes = await ctx.factions.causes.view(ctx.historyOf(character)).catch(() => null)
    const factionPerKill = (zone: string, mob: string) => {
      const t = causes?.acts[`kill|${zone.toLowerCase()}|${mob.toLowerCase()}`]
      if (!t || !t.n) return null
      const out: Record<string, number> = {}
      for (const [f, amounts] of Object.entries(t.hits)) out[f] = Object.entries(amounts).reduce((s, [v, n]) => s + Number(v) * n, 0) / t.n
      return out
    }
    // The spawn tables' mobs count as eqlwiki or the tables place them; none is asked of eqlwiki for it.
    const placeSpawn = (mob: string, race: string) => {
      const k = mob.toLowerCase()
      const p = races.place(mob, npc.race(mob) || race)
      return goals.flatMap((g, i) => ((ctx.liveAchievements.fact(k, g.name.toLowerCase()) ?? (p.key !== null && races.keys[i].has(p.key))) ? [i] : []))
    }
    const timings = spawnTimings(Object.values(ctx.store.respawns.get()))
    const killSpeed = usualPace(zones)
    const camps = buildCamps(goals, races, zones, place, factionPerKill, slayerRaceLists(exp.sections, game), undefined, {
      tables: TABLES,
      timings,
      place: placeSpawn,
      killSpeed: killSpeed ?? DEFAULT_CHOICES.pace
    })
    const hunter = hunterZones(exp.sections, lastKills(zones), exp.modified, namedSpawns(timings))
    // Kills no race was found for: the wiki answered, and neither it nor the name places them.
    for (const z of Object.values(zones))
      for (const m of Object.values(z.mobs)) {
        const wiki = npc.race(m.name)
        if (wiki === undefined || races.place(m.name, wiki).key !== null) continue
        const had = unplaced.get(m.name.toLowerCase()) ?? { name: m.name, n: 0 }
        had.n += m.n
        unplaced.set(m.name.toLowerCase(), had)
      }
    // Mobs not looked up yet are asked of eqlwiki in the background, a few hundred a plan; the next plan places them.
    if (unknown.size)
      void npc.lookUp([...unknown].slice(0, LOOKUPS)).then((learned) => {
        if (learned) this.shared.delete(character)
      })
    return {
      character,
      export: { file: exp.file, modified: exp.modified },
      goals,
      camps,
      unplaced: [...unplaced.values()].sort((a, b) => b.n - a.n).slice(0, 20),
      pending: unknown.size,
      moves,
      killSpeed,
      timings: [...timings.values()]
        .filter((t) => t.timed.length)
        .map((t) => ({ zone: t.timed[0].zone, timer: t.timer, timed: t.timed.map(({ name, legends, classic }) => ({ name, legends, classic })) })),
      hunter
    }
  }
}

/** When the logs last saw each mob killed, by bareName: 0 for never. */
export function lastKills(zones: SlayerKillTallies['zones']): (bare: string) => number {
  const at = new Map<string, number>()
  for (const z of Object.values(zones)) for (const m of Object.values(z.mobs)) at.set(bareName(m.name), Math.max(at.get(bareName(m.name)) ?? 0, m.at ?? 0))
  return (bare) => at.get(bare) ?? 0
}

/** A place's mobs as the spawn tables have them, by bareName, timers in Legends' terms; null for a place they lack. */
export function namedSpawns(timings: ReturnType<typeof zoneTimings>): (zone: string) => Map<string, MobSpawn> | null {
  return (zone) => {
    const short = tableOf(zone)
    return short ? mobSpawns(TABLES[short], timings.get(short)) : null
  }
}

/** The spawn tables' timings: each zone's timers against classic, from the Respawns page's records. */
export const spawnTimings = (records: RespawnRecord[]) => zoneTimings(TABLES, records)

/** A zone hunted at least this long counts toward the player's usual pace. */
const USUAL_SEC = 3600

/** The player's usual kills an hour while killing: the middle of the zones hunted an hour or more. Null before any. */
export function usualPace(zones: SlayerKillTallies['zones']): number | null {
  const paces = Object.values(zones)
    .filter((z) => z.sec >= USUAL_SEC)
    .map((z) => z.kills / (z.sec / 3600))
    .sort((a, b) => a - b)
  if (!paces.length) return null
  const mid = paces.length / 2
  return paces.length % 2 ? paces[Math.floor(mid)] : (paces[mid - 1] + paces[mid]) / 2
}

const isMark = (m: unknown): m is SlayerMark => {
  const x = m as SlayerMark
  return (
    !!x &&
    typeof x.zone === 'string' &&
    Array.isArray(x.mobs) &&
    x.mobs.every((s) => typeof s === 'string') &&
    (x.named === undefined || (Array.isArray(x.named) && x.named.every((s) => typeof s === 'string')))
  )
}

const readText = (path: string) => readFile(path, 'latin1').catch(() => null)

/** A zone's map as the game draws it (its own files, and its labels), with the spots these mobs pop at. A zone the tables lack has no short name. */
async function spawnMap(installDir: string, zone: string, mobs: string[]): Promise<SlayerMap> {
  const short = tableOf(zone)
  if (!short) return { zone, short: '', lines: [], labels: [], spots: [] }
  const maps = join(installDir, 'maps')
  const files = await Promise.all([`${short}.txt`, `${short}_1.txt`].map((f) => (installDir ? readText(join(maps, f)) : Promise.resolve(null))))
  const map = parseMap(files.filter((t): t is string => t !== null).join('\n'))
  return { zone: TABLES[short].name, short, ...map, spots: spotsOf(TABLES[short], mobs) }
}

/**
 * Marks the plan's spawns on the game's own map, in a map set of its own: the game's maps copied into
 * maps\LegendsTracker (once), then each zone's label layer written as the game's copy plus the marks.
 * A zone no longer marked goes back to the game's copy. The game's own files are only read.
 */
export async function markMaps(installDir: string, marks: SlayerMark[]): Promise<{ folder: string; zones: number; spots: number }> {
  if (!installDir) throw new Error('Choose the game folder on the Settings page first.')
  const maps = join(installDir, 'maps')
  const set = join(maps, MAP_SET)
  await mkdir(set, { recursive: true })
  const have = new Set(await readdir(set))
  for (const f of await readdir(maps, { withFileTypes: true })) if (f.isFile() && /\.txt$/i.test(f.name) && !have.has(f.name)) await copyFile(join(maps, f.name), join(set, f.name))
  // One zone's marks together, whichever steps and pages asked for them.
  const byZone = new Map<string, { mobs: Set<string>; named: Set<string> }>()
  for (const m of marks) {
    const short = tableOf(m.zone)
    if (!short) continue
    const z = byZone.get(short) ?? { mobs: new Set<string>(), named: new Set<string>() }
    for (const x of m.mobs) z.mobs.add(x)
    for (const x of m.named ?? []) z.named.add(x)
    byZone.set(short, z)
  }
  let spots = 0
  const marked = new Set<string>()
  for (const [short, z] of byZone) {
    const lines = mapMarks(spotsOf(TABLES[short], [...z.mobs]), spotsOf(TABLES[short], [...z.named]))
    if (!lines.length) continue
    const base = (await readText(join(maps, `${short}_1.txt`))) ?? ''
    await writeFile(join(set, `${short}_1.txt`), (base && !base.endsWith('\n') ? base + '\r\n' : base) + lines.join('\r\n') + '\r\n', 'latin1')
    marked.add(short)
    spots += lines.length
  }
  // Zones marked before and not now: the game's own label layer again, or none where the game has none.
  for (const short of Object.keys(TABLES)) {
    if (marked.has(short)) continue
    const mine = await readText(join(set, `${short}_1.txt`))
    if (mine === null || !isMarked(mine)) continue
    const base = await readText(join(maps, `${short}_1.txt`))
    if (base === null) await rm(join(set, `${short}_1.txt`), { force: true })
    else await writeFile(join(set, `${short}_1.txt`), base, 'latin1')
  }
  return { folder: set, zones: marked.size, spots }
}
