import { join } from 'node:path'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { RACE_TABLE } from '../../core/raceNames'
import { zoneKey } from '../../core/zones'
import { mixCredits, sayKey, setSaidRaces, SlayerRaces, slayerCounters } from '../../core/slayer'
import { characterKey, isCharacterKey, isRecordKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import { log } from '../../main/log'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type HistoryConsumer, type LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import type { AchievementTrack } from '../../shared/tracking'
import { SlayerLive } from './liveSource'
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
  type Placing,
  type SlayerKillTallies,
  type SlayerMove,
  type SlayerPlanChoices,
  type SlayerPlanData
} from './core'
import { mapMarks, mobSpawns, parseMap, petCamps, raceMixer, spotsIn, zoneIndex, zoneTimings, type MobSpawn, type SlayerMap, type SlayerMark, type SpawnTables } from './spawns'
import type { RespawnFallback, RespawnRecord, RespawnRecords } from '../../core/respawns'
import TAKP from '../../shared/game/takpSpawns.json'
import { lockoutDayStart } from '../../shared/game/slayerCamps'
import { hunterZones } from '../hunter/core'
import { newerBuildWrote } from '../../main/schema'
import type { MapPoint } from '../../core/where'

// The Slayer page's side of the app: every kill over each character's log and archives, by zone
// (a LogHistory consumer), and the plan's data built from them, the achievements export, the live
// counts, eqlwiki's races and what play has settled (core.ts). What the player chooses on the page
// is kept per character in slayer-plan.json.

/** TAKP's classic spawn tables, as scripts/takp-spawns.mjs wrote them. */
const TABLES = TAKP.zones as unknown as SpawnTables
const tableOf = zoneIndex(TABLES)

/** The map set the plan's spawns are marked in: a copy of the game's own maps, so its files stay as they are. */
const MAP_SET = 'LegendsTracker'

/** Each stretch of log's kills by zone, as a LogHistory consumer. Version 2: trips between zones, each mob's last kill; 3: each stretch of killing. */
const killConsumer: HistoryConsumer<SlayerKillTallies> = {
  // 4: mobs' pets left out (isNpcPet). 5: raid lockout bosses' kill times.
  version: 5,
  empty: emptyKillTallies,
  reader: () => readKillLine
}

export const KILLS_KEY = 'slayerKills'
/** One plan's data is shared for this long: the page asks every minute, and reading every log takes a while. */
const SHARED_MS = 30_000
/** The overlay's plan stands on data this old at most: what the camps' paces come from moves slowly. */
const OVERLAY_MS = 10 * 60_000
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
    pace: num(c.pace, 1, 2000, DEFAULT_CHOICES.pace),
    overlay: c.overlay === true,
    avoidPlanFactions: c.avoidPlanFactions === true
  }
}

export class SlayerPlanner implements AppFeature {
  readonly id = 'slayer'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [KILLS_KEY]: killConsumer }
  private readonly choices: JsonFile<Record<string, SlayerPlanChoices>>
  /** What Plan › Hunter last marked on the game's map: the named left. The Slayer plan's mobs are never marked there. */
  private readonly marks: JsonFile<{ hunter: SlayerMark[] }>
  /** Slayer marks a version before 2.14.3 put on the game's maps: taken off once, at start. */
  private readonly staleSlayer: boolean
  /** The game folder, once registered: a named killed takes its marks off the map then and there. */
  private installDir: () => string = () => ''
  /** The Slayer counts since the export, as the game is played (liveSource.ts): made when the feature is registered. */
  live!: SlayerLive
  /** The maps being written again, one write after another. */
  private redraw: Promise<unknown> = Promise.resolve()
  private readonly shared = new Map<string, { at: number; data: Promise<SlayerPlanData> }>()
  /** The races the player said unplaced mobs are, for every character (FEAT-021). */
  private readonly said: JsonFile<{ version: 1; races: Record<string, string> }>
  /** The data the overlay's plan was last made from, by character: made again when it is old or another export came. */
  private readonly overlayData = new Map<string, { at: number; exportAt: number; data: Promise<SlayerPlanData>; done?: SlayerPlanData }>()

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): SlayerPlanner {
    return new SlayerPlanner(d.logHistory, d.dir)
  }

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'slayer-plan.json')
    const read = readJsonFile(path)
    const value = read.state === 'ok' && read.value && typeof read.value === 'object' ? (read.value as Record<string, unknown>) : {}
    this.choices = new JsonFile(path, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeChoices(v)])), { delayMs: 1000, backup: true })
    if (read.state === 'unreadable') this.choices.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.choices.freeze('written by a newer version')
    const saidPath = join(dir, 'slayer-races.json')
    const saidRead = readJsonFile(saidPath)
    this.said = new JsonFile(saidPath, { version: 1, races: sanitizeSaid(saidRead.state === 'ok' ? saidRead.value : null) }, { delayMs: 1000, backup: true })
    if (saidRead.state === 'unreadable') this.said.freeze('could not be read at start')
    if (newerBuildWrote(saidPath)) this.said.freeze('written by a newer version')
    setSaidRaces(this.said.get().races)
    const marksPath = join(dir, 'map-marks.json')
    const kept = readJsonFile(marksPath)
    const sets = (kept.state === 'ok' && kept.value && typeof kept.value === 'object' ? kept.value : {}) as Record<string, unknown>
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter(isMark).slice(0, 200) : [])
    this.staleSlayer = list(sets.slayer).length > 0
    this.marks = new JsonFile(marksPath, { hunter: list(sets.hunter) }, { delayMs: 1000 })
    if (newerBuildWrote(marksPath)) this.marks.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return Promise.all([this.choices.flush(), this.marks.flush(), this.said.flush(), this.live?.flush()]).then(() => undefined)
  }

  /** Its part of the achievements overlay's track: the Slayer counts since the export (LT-623). */
  track(at: TrackContext): Partial<Pick<AchievementTrack, 'slayer'>> {
    return { slayer: this.live?.character === at.character ? this.live.view : null }
  }

  /** The character's own kills an hour in each zone it has hunted a quarter hour, by zoneKey: the faction plan's pace where a camp has none (LT-734). */
  async zonePaces(ctx: AppContext, character: string): Promise<Record<string, number>> {
    const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(character))
    return zonePaces(joinKillTallies(everyStretch(slice)))
  }

  register(ctx: AppContext): void {
    this.live = new SlayerLive(ctx, takpRaceMix)
    // The Respawns page's rows the log has not timed take the tables' timer, or the zone's (LT-736).
    const combat = ctx.engine?.combat
    if (combat) combat.respawnFallback = respawnFallback(() => ctx.store.respawns.get())
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
    // The races the player said mobs are, and every race there is to say (FEAT-021).
    handle('slayer:said', async () => ({ races: this.said.get().races, names: new SlayerRaces([], await ctx.gameTables.get(RACE_TABLE)).names() }))
    handle('slayer:sayRace', async (mob, race) => {
      if (typeof mob !== 'string' || !mob.trim() || mob.length > 120) throw new Error('No such mob.')
      const k = sayKey(mob)
      const races = { ...this.said.get().races }
      if (race === null) delete races[k]
      else {
        const names = new SlayerRaces([], await ctx.gameTables.get(RACE_TABLE)).names()
        if (typeof race !== 'string' || !names.includes(race)) throw new Error('Not a race the game has.')
        races[k] = race
      }
      this.said.set({ version: 1, races })
      setSaidRaces(races)
      // Counted again at once: the page's plan, the counts since the export, the overlay.
      this.shared.clear()
      this.live?.recount()
      return races
    })
    handle('slayer:choices', (character, choices) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      this.choices.set({ ...this.choices.get(), [character]: sanitizeChoices(choices) })
      // The overlay's plan follows what was chosen at once.
      ctx.liveAchievements.slayerChoicesChanged(character)
    })
    handle('slayer:map', async (zone, mobs) => {
      if (typeof zone !== 'string' || !Array.isArray(mobs)) throw new Error('No such zone.')
      return spawnMap(ctx.installDir(), zone, mobs.filter((m): m is string => typeof m === 'string').slice(0, 50))
    })
    this.installDir = () => ctx.installDir()
    handle('slayer:mark', async (marks, set = 'hunter') => {
      if (!Array.isArray(marks) || set !== 'hunter') throw new Error('Nothing to mark.')
      // The Hunter named alone: a Slayer camp's mobs are everywhere in its zone, no help on the game's map.
      const hunter = (marks as unknown[])
        .filter(isMark)
        .slice(0, 200)
        .map((m) => ({ zone: m.zone, mobs: [], named: m.named ?? [] }))
      this.marks.set({ hunter })
      return markMaps(ctx.installDir(), hunter)
    })
    // The maps written again at start, as this version labels them: the Slayer marks an older version
    // put there come off, and the Hunter named read as their names alone ("Hunter_" was dropped 2026-10-18).
    if ((this.staleSlayer || this.marks.get().hunter.length) && ctx.installDir())
      this.redraw = markMaps(ctx.installDir(), this.marks.get().hunter)
        .then(() => this.marks.set({ hunter: this.marks.get().hunter }))
        .catch((e: unknown) => log.warn('Could not write the marks on the game’s maps again:', e))
  }

  /**
   * Named the player killed (the live counts' kills, lower-cased or not): off the game's map at
   * once. Plan › Hunter's marks lose them, and the map files are written again with the rest.
   */
  namedKilled(mobs: string[]): void {
    const gone = new Set(mobs.map(bareName))
    const was = this.marks.get().hunter
    const hunter = was.map((m) => ({ ...m, named: (m.named ?? []).filter((n) => !gone.has(bareName(n))) })).filter((m) => m.named.length)
    if (hunter.length === was.length && hunter.every((m, i) => m.named.length === (was[i].named ?? []).length)) return
    this.marks.set({ hunter })
    const dir = this.installDir()
    if (dir) this.redraw = this.redraw.then(() => markMaps(dir, this.marks.get().hunter)).catch((e: unknown) => log.warn('Could not take a killed named off the game’s map:', e))
  }

  /**
   * What the achievements overlay makes the plan from, for a character that shows it there (null for
   * one that does not): the camps as last read, read again every OVERLAY_MS or for an export written
   * since (`exportAt`), and the player's choices. The counts the caller puts in as they are now.
   */
  async forOverlay(ctx: AppContext, character: string, exportAt: number): Promise<{ data: SlayerPlanData; choices: SlayerPlanChoices } | null> {
    const choices = this.choices.get()[character]
    if (!choices?.overlay) {
      this.overlayData.delete(character)
      return null
    }
    let had = this.overlayData.get(character)
    if (!had || had.exportAt !== exportAt || Date.now() - had.at >= OVERLAY_MS) {
      const data = this.data(ctx, character)
      // Data only old, for the same export, still stands while the new is read: reading every log takes a while.
      const stale = had?.exportAt === exportAt ? had.done : undefined
      const entry: { at: number; exportAt: number; data: Promise<SlayerPlanData>; done?: SlayerPlanData } = { at: Date.now(), exportAt, data, done: stale }
      this.overlayData.set(character, (had = entry))
      data.then(
        (d) => (entry.done = d),
        () => this.overlayData.get(character) === entry && this.overlayData.delete(character)
      )
    }
    return { data: had.done ?? (await had.data), choices }
  }

  /**
   * Every kill in this character's logs and the player's other characters', by zone, and their trips
   * between zones; and this character's own kills apart (`own`), for what counts for it alone (LT-715).
   */
  private async kills(ctx: AppContext, character: string): Promise<{ zones: SlayerKillTallies['zones']; own: SlayerKillTallies['zones']; moves: SlayerMove[] }> {
    const who = [character, ...(await ctx.logCharacters()).filter((c) => c.toLowerCase() !== character.toLowerCase())]
    const stretches: SlayerKillTallies[] = []
    let own: SlayerKillTallies[] = []
    // One at a time: LogHistory reads one log at a time anyway, and a log that fails is left out.
    for (const c of who) {
      try {
        const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(c))
        const read = everyStretch(slice)
        if (c === character) own = read
        stretches.push(...read)
      } catch (e) {
        log.warn(`${c}'s log could not be read for the Slayer plan:`, e)
      }
    }
    return { zones: joinKillTallies(stretches), own: joinKillTallies(own), moves: joinMoves(stretches) }
  }

  private async data(ctx: AppContext, character: string): Promise<SlayerPlanData> {
    const exp = await ctx.achievementFiles.exported(character)
    if (!exp) return { character, export: null, goals: [], camps: [], unplaced: [], pending: 0, moves: [], killSpeed: null, timings: [], hunter: [] }
    const counters = slayerCounters(exp.sections)
    // The live counts, while the export they count on is the one read here.
    const live = this.live.character === character ? this.live.view : null
    const since = new Map<string, number>()
    const done = new Set<string>()
    if (live?.exportAt === exp.modified)
      for (const r of live.rows) {
        since.set(r.name.toLowerCase(), r.since)
        if (r.done) done.add(r.name.toLowerCase())
      }
    const goals = slayerGoals(counters, since, optionalSlayer(exp.sections), banestrikeTiers(exp.sections), done)
    const game = await ctx.gameTables.get(RACE_TABLE)
    const races = new SlayerRaces(counters, game)
    const { zones, own, moves } = await this.kills(ctx, character)
    const npc = ctx.npcPages
    await npc.ready()
    const unknown = new Set<string>()
    const unplaced = new Map<string, { name: string; n: number }>()
    const placed = new Map<string, Placing>()
    const place = (mob: string, zone = ''): Placing => {
      const k = mob.toLowerCase()
      // A mob play placed zone by zone (New Sebilis Expedition's undead), or one of several races placed
      // by its zone's mix (a dervish cutthroat), is placed for the zone it is in.
      const key = races.zoned(mob) || races.mixed(mob) ? `${k}|${zone}` : k
      let at = placed.get(key)
      if (at) return at
      const wiki = npc.race(mob)
      if (wiki === undefined) unknown.add(mob)
      const p = races.place(mob, wiki, zone)
      const fact = (g: string) => (p.by === 'zone' ? undefined : this.live.fact(k, g))
      // Several races under one name: each goal gets the part of a kill the spawn tables' mix for the
      // zone gives it (as the live counts count them), unless an export has settled the mob whole.
      const mix = p.key === null && races.mixed(mob) ? mixCredits(mob, [zone], races, takpRaceMix) : null
      if (mix) {
        const shares = new Map<number, number>()
        goals.forEach((g, i) => {
          const f = fact(g.name.toLowerCase())
          const w = f === undefined ? mix[i] : f ? 1 : 0
          if (w > 0) shares.set(i, w)
        })
        at = shares
      } else at = goals.flatMap((g, i) => ((fact(g.name.toLowerCase()) ?? (p.key !== null && races.keys[i].has(p.key))) ? [i] : []))
      placed.set(key, at)
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
      return goals.flatMap((g, i) => ((this.live.fact(k, g.name.toLowerCase()) ?? (p.key !== null && races.keys[i].has(p.key))) ? [i] : []))
    }
    const timings = spawnTimings(Object.values(ctx.store.respawns.get()))
    const killSpeed = usualPace(zones)
    const camps = buildCamps(goals, races, zones, place, factionPerKill, slayerRaceLists(exp.sections, game), undefined, {
      tables: TABLES,
      timings,
      place: placeSpawn,
      killSpeed: killSpeed ?? DEFAULT_CHOICES.pace
    })
    // A raid lockout's kills so far today, since the game's noon reset: "2 of 5 today" (LT-657). From this
    // character's logs, not the live counts: those keep only what came after the export.
    const reset = lockoutDayStart()
    for (const c of camps) if (c.daily) c.today = lockoutKillsSince(own, c.mobs ?? [], reset)
    // A named counts for the character that killed it: its own log alone, as on Plan › Hunter (LT-715).
    // Less the Hunter achievements the player has said do not work.
    const hunter = hunterZones(exp.sections, lastKills(own), exp.modified, namedSpawns(timings)).filter((z) => !ctx.hunter?.isBroken(z.achievement))
    // Kills no race was found for: the wiki answered, and neither it, the name nor a zone's race mix places them.
    for (const [zone, z] of Object.entries(zones))
      for (const m of Object.values(z.mobs)) {
        const wiki = npc.race(m.name)
        if (wiki === undefined || races.place(m.name, wiki).key !== null || (races.mixed(m.name) && takpRaceMix(m.name, zone))) continue
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
      // The kills since count for the character whose log is followed; a moment after a start they are on their way (LT-539).
      sinceKills: characterKey(ctx.store.settings.get().logFile) === character,
      goals,
      camps,
      unplaced: [...unplaced.values()].sort((a, b) => b.n - a.n).slice(0, 20),
      pending: unknown.size,
      moves,
      killSpeed,
      timings: [...timings.values()]
        .filter((t) => t.timed.length)
        .map((t) => ({ zone: t.timed[0].zone, timer: t.timer, timed: t.timed.map(({ name, legends, classic }) => ({ name, legends, classic })) })),
      hunter,
      raising: ctx.factions.follow.raisedByPlan(character)
    }
  }
}

/** How many times the logs saw these raid lockout bosses die since a time, in any zone. */
export function lockoutKillsSince(zones: SlayerKillTallies['zones'], mobs: readonly string[], since: number): number {
  const keys = new Set(mobs.map((m) => m.toLowerCase()))
  let n = 0
  for (const z of Object.values(zones)) for (const [k, m] of Object.entries(z.mobs)) if (keys.has(k)) n += m.times?.filter((t) => t >= since).length ?? 0
  return n
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

/** The races a mob's name is in TAKP's tables, by share, in a zone (else everywhere it is): for a kill nothing else places. */
const takpRaceMix = raceMixer(TABLES)

/**
 * What the spawn tables say of a mob's respawn, for a Respawns row the log has not timed: its timer in
 * Legends' terms and its zone's median. The timings are worked out again at most each half minute.
 */
export function respawnFallback(records: () => RespawnRecords): (zone: string, name: string) => RespawnFallback | null {
  let made = 0
  let timings = spawnTimings([])
  let spawnsOf = namedSpawns(timings)
  return (zone, name) => {
    const now = Date.now()
    if (now - made > 30_000) {
      made = now
      timings = spawnTimings(Object.values(records()))
      spawnsOf = namedSpawns(timings)
    }
    const short = tableOf(zone)
    if (!short) return null
    const spawn = spawnsOf(zone)?.get(bareName(name))
    return { mob: spawn ? { seconds: spawn.timer, from: spawn.timerFrom } : null, zone: timings.get(short)?.timer ?? null }
  }
}

/** The spawn tables' timings: each zone's timers against classic, from the Respawns page's records. */
export const spawnTimings = (records: RespawnRecord[]) => zoneTimings(TABLES, records)

/** A zone hunted at least this long has a pace of its own for the faction plan (LT-734). */
const ZONE_PACE_SEC = 15 * 60

/** Kills an hour while killing, in every zone hunted a quarter hour or more, by zoneKey: kills that moved no faction counted too. */
export function zonePaces(zones: SlayerKillTallies['zones']): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [zone, z] of Object.entries(zones)) if (z.sec >= ZONE_PACE_SEC && z.kills > 0) out[zoneKey(zone)] = z.kills / (z.sec / 3600)
  return out
}

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
  if (!short) return { zone, short: '', lines: [], labels: [], spots: [], camps: [] }
  const maps = join(installDir, 'maps')
  const files = await Promise.all([`${short}.txt`, `${short}_1.txt`].map((f) => (installDir ? readText(join(maps, f)) : Promise.resolve(null))))
  const map = parseMap(files.filter((t): t is string => t !== null).join('\n'))
  const spots = spotsIn(TABLES[short], mobs)
  return { zone: TABLES[short].name, short, ...map, spots, camps: petCamps(spots) }
}

/**
 * Marks the plan's spawns on the game's own map, in a map set of its own: the game's maps copied into
 * maps\LegendsTracker (once), then each zone's label layer written as the game's copy plus the marks.
 * A zone no longer marked goes back to the game's copy. The game's own files are only read.
 */
export async function markMaps(installDir: string, marks: SlayerMark[]): Promise<{ folder: string; zones: number; spots: number }> {
  if (!installDir) throw new Error('Choose the game folder on Settings › General first.')
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
    const lines = mapMarks(spotsIn(TABLES[short], [...z.mobs]), spotsIn(TABLES[short], [...z.named]))
    if (!lines.length) continue
    const base = (await readText(join(maps, `${short}_1.txt`))) ?? ''
    await writeFile(join(set, `${short}_1.txt`), (base && !base.endsWith('\n') ? base + '\r\n' : base) + lines.join('\r\n') + '\r\n', 'latin1')
    marked.add(short)
    spots += lines.length
  }
  // Zones marked before and not now: the game's own label layer again, or none where the game has none.
  // The copy is the game's own where nothing is marked: one that differs holds marks.
  for (const short of Object.keys(TABLES)) {
    if (marked.has(short)) continue
    const mine = await readText(join(set, `${short}_1.txt`))
    if (mine === null) continue
    const base = await readText(join(maps, `${short}_1.txt`))
    if (base === null) await rm(join(set, `${short}_1.txt`), { force: true })
    else if (mine !== base) await writeFile(join(set, `${short}_1.txt`), base, 'latin1')
  }
  return { folder: set, zones: marked.size, spots }
}

/** The map points each of these named can pop at in a zone: TAKP's spots and Legends' own (FEAT-023). */
export function namedSpots(zone: string, names: string[]): Map<string, MapPoint[]> {
  const out = new Map<string, MapPoint[]>()
  const short = zoneOf(zone)
  const z = short ? TABLES[short] : undefined
  if (!z) return out
  for (const s of spotsIn(z, names)) for (const m of s.mobs) out.set(m.name.toLowerCase(), [...(out.get(m.name.toLowerCase()) ?? []), { x: s.x, y: s.y }])
  return out
}

const zoneOf = zoneIndex(TABLES)

/** slayer-races.json as read back: a race key for each mob's name words, short strings both. */
export function sanitizeSaid(v: unknown): Record<string, string> {
  const races = v && typeof v === 'object' ? (v as { races?: unknown }).races : null
  if (!races || typeof races !== 'object' || Array.isArray(races)) return {}
  return Object.fromEntries(
    Object.entries(races as Record<string, unknown>)
      .filter(([k, r]) => isRecordKey(k) && typeof r === 'string' && r.length > 0 && r.length <= 60)
      .slice(0, 2000) as [string, string][]
  )
}
