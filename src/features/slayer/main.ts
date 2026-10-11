import { join } from 'node:path'
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
  buildCamps,
  DEFAULT_CHOICES,
  emptyKillTallies,
  joinKillTallies,
  optionalSlayer,
  readKillLine,
  slayerGoals,
  slayerRaceLists,
  type SlayerKillTallies,
  type SlayerPlanChoices,
  type SlayerPlanData
} from './core'

// The Slayer page's side of the app: every kill over each character's log and archives, by zone
// (a LogHistory consumer), and the plan's data built from them, the achievements export, the live
// counts, eqlwiki's races and what play has settled (core.ts). What the player chooses on the page
// is kept per character in slayer-plan.json.

/** Each stretch of log's kills by zone, as a LogHistory consumer. */
const killConsumer: HistoryConsumer<SlayerKillTallies> = {
  version: 1,
  empty: emptyKillTallies,
  reader: () => readKillLine
}

const KILLS_KEY = 'slayerKills'
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
    travelMin: num(c.travelMin, 0, 120, DEFAULT_CHOICES.travelMin),
    pace: num(c.pace, 1, 2000, DEFAULT_CHOICES.pace)
  }
}

export class SlayerPlanner implements AppFeature {
  readonly id = 'slayer'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [KILLS_KEY]: killConsumer }
  private readonly choices: JsonFile<Record<string, SlayerPlanChoices>>
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
  }

  flush(): Promise<void> {
    return this.choices.flush()
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
  }

  /** Every kill in this character's logs and the player's other characters', by zone. */
  private async kills(ctx: AppContext, character: string): Promise<SlayerKillTallies['zones']> {
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
    return joinKillTallies(stretches)
  }

  private async data(ctx: AppContext, character: string): Promise<SlayerPlanData> {
    const exp = await ctx.achievementFiles.exported(character)
    if (!exp) return { character, export: null, goals: [], camps: [], unplaced: [], pending: 0 }
    const counters = slayerCounters(exp.sections)
    // The live counts, while the export they count on is the one read here.
    const track = ctx.liveAchievements.view
    const since = new Map<string, number>()
    if (track?.character === character && track.slayer?.exportAt === exp.modified) for (const r of track.slayer.rows) since.set(r.name.toLowerCase(), r.since)
    const goals = slayerGoals(counters, since, optionalSlayer(exp.sections))
    const game = await ctx.gameTables.get(RACE_TABLE)
    const races = new SlayerRaces(counters, game)
    const zones = await this.kills(ctx, character)
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
    const camps = buildCamps(goals, races, zones, place, factionPerKill, slayerRaceLists(exp.sections, game))
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
      pending: unknown.size
    }
  }
}
