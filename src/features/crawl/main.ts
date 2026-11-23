import { join } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { zoneEntered } from '../../core/logLine'
import { zoneKey } from '../../core/zones'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { newerBuildWrote } from '../../main/schema'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import type { AchievementTrack } from '../../shared/tracking'
import ROUTES from '../../shared/game/crawlRoutes.json'
import { mapSet } from '../../main/mapSet'
import { everyStretch, type HistoryConsumer, type LogHistory } from '../../main/sources/logHistory'
import { isCharacterKey } from '../../core/validate'
import { emptyXpTally, joinXp, readXpLine, type CrawlXpData, type XpTally } from './xp'
import {
  campMarks,
  crawlCue,
  crawlView,
  createdInstance,
  isInstance,
  newRun,
  parseMapLines,
  readRunLine,
  routeMarks,
  routeOf,
  type CrawlData,
  type CrawlRoutes,
  type CrawlRun
} from './core'

// Motes › Crawl route's side of the app: the routes (crawlRoutes.json, as scripts/crawl-routes.mjs
// wrote them), the game's own map of a route's zone with its heights kept, the route drawn on the game's
// map (a layer of its own in the LegendsTracker map set, beside Hunter's marks), and the run in hand:
// the rares the log has shown dying since the instance was entered, kept in crawl.json so a restart
// mid-run loses nothing. The achievements overlay shows the next stops while the player is in the instance.
// The zone's places to sit go on the game's map too, on a third layer, so neither crowds the other.
// While a run goes on, the stop to go to next is said aloud ("Move to fierce impaler."), all of it on one
// switch on the page, kept with the run in crawl.json.

const routes = ROUTES.zones as unknown as CrawlRoutes

/**
 * What goes on the game's map, each on a layer of its own: the game's maps use the first for labels (and
 * Hunter's marks go there). `mark` is the line its part of the layer starts with: what tells a layer
 * holding the app's lines from the game's own.
 */
const LAYERS = {
  route: { layer: 2, mark: 'LegendsTracker_crawl_route' },
  camps: { layer: 3, mark: 'LegendsTracker_places_to_sit' }
} as const
type CrawlMarks = keyof typeof LAYERS
/** A run this old is not the one being entered again. */
const RUN_STALE_MS = 6 * 3600_000
/** "Player Juicebox creating instance Kedge Keep 453.", "Juicebox has been added to Kedge Keep - Group.": the next instance entered is a new one. */
const NEW_INSTANCE = /^(?:Player .+ creating instance .+ \d+\.|.+ has been (?:added to|removed from) .+\.)$/

const readText = (path: string) => readFile(path, 'latin1').catch(() => null)

/** Each stretch of log's runs in instances and the experience each brought (Motes › Crawl XP), as a LogHistory consumer. */
const xpConsumer: HistoryConsumer<XpTally> = {
  version: 1,
  empty: emptyXpTally,
  reader: () => readXpLine
}

const XP_KEY = 'crawlXp'
/** Runs the page lists, newest first. */
const XP_RUNS_SHOWN = 200

export class CrawlGuide implements AppFeature {
  readonly id = 'crawl'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [XP_KEY]: xpConsumer }
  private readonly file: JsonFile<{ run: CrawlRun | null; cues: boolean }>
  private ctx: AppContext | null = null
  /** The next instance entered is a new one, whatever its name. */
  private fresh = false
  /** The zone the log last entered. */
  private zone = ''
  /** The zone an instance was just made of, until it is entered: a base instance carries the zone's own name. */
  private created = ''
  /** What was last said of the run in hand. */
  private lastCue = ''
  /** The player is in the instance of the run in hand: its name alone does not say so when it is the zone's own. */
  private inside = false
  /** The zone the player was in as the app started has been taken from the engine (it knows it a moment after the features are built). */
  private synced = false
  /** Told when the run has moved (LiveAchievements publishes the track again). */
  onChange: (() => void) | null = null

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): CrawlGuide {
    return new CrawlGuide(d.dir, d.logHistory)
  }

  constructor(
    dir: string,
    private readonly history: LogHistory | null = null
  ) {
    const path = join(dir, 'crawl.json')
    const read = readJsonFile(path)
    const kept = read.state === 'ok' ? (read.value as { run?: unknown; cues?: unknown } | null) : null
    // The cues are on until the player switches them off.
    this.file = new JsonFile(path, { run: sanitizeRun(kept?.run), cues: kept?.cues !== false }, { delayMs: 1000 })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  /** The run in hand, when it is of this zone's route. */
  private runIn(zone: string): CrawlRun | null {
    const run = this.file.get().run
    return run && routeOf(routes, run.instance)?.short === routeOf(routes, zone)?.short ? run : null
  }

  private setRun(run: CrawlRun | null): void {
    this.file.set({ ...this.file.get(), run })
    this.onChange?.()
  }

  /** Says where a run goes next, as a trigger's speech would go (muting and the voice settings apply), while the cues are on. */
  private say(cue: string | null): void {
    // A rare seen and killed at a stop after its "Move to" was said sends the player to the same stop again: said once.
    if (!cue || cue === this.lastCue) return
    this.lastCue = cue
    if (this.file.get().cues) this.ctx?.engine?.notify([{ kind: 'speak', text: cue, interrupt: false }])
  }

  /** A run that is neither completed nor long over: one a step outside and back goes on with. */
  private going(run: CrawlRun | null, at: number): run is CrawlRun {
    return !!run && !run.doneAt && at - run.startedAt <= RUN_STALE_MS
  }

  /**
   * Once, as the app starts mid-game: the zone the engine found the player in, and whether that is the
   * instance of the run in hand (a restart in the middle of a crawl goes on with it).
   */
  private sync(): void {
    const zone = this.ctx?.engine?.status.zone
    if (this.synced || !zone) return
    this.synced = true
    this.zone = zone
    const run = this.file.get().run
    this.inside = !!run && run.instance === zone && (isInstance(zone) || this.going(run, Date.now()))
  }

  /** Whether the line was one it reads: an instance of a route's zone entered, a rare of the run dying or called rare. */
  private line(text: string, at: number): boolean {
    this.sync()
    if (NEW_INSTANCE.test(text)) {
      this.fresh = true
      this.created = createdInstance(text) ?? ''
      return false
    }
    const entered = zoneEntered(text)
    if (entered) {
      this.synced = true
      this.zone = entered
      const of = routeOf(routes, entered)
      const run = this.file.get().run
      // The zone's own name is an instance right after the line creating one of it, and again on stepping
      // back into the run in hand while it goes on; without either it is the open zone.
      const base = zoneKey(this.created) === zoneKey(entered) || (!this.fresh && run?.instance === entered && this.going(run, at))
      this.created = ''
      this.inside = !!of && (isInstance(entered) || base)
      if (!of || !this.inside) return false
      // Stepping out and back into the same instance keeps the run; a new instance, or one long over, starts one.
      if (this.fresh || !run || run.instance !== entered || run.doneAt || at - run.startedAt > RUN_STALE_MS) {
        const started = newRun(entered, at)
        this.setRun(started)
        this.lastCue = ''
        this.say(crawlCue(of.route, null, started))
      }
      this.fresh = false
      return false
    }
    const run = this.file.get().run
    const found = run && this.inside && run.instance === this.zone ? routeOf(routes, run.instance) : undefined
    if (!run || !found) return false
    const next = readRunLine(found.route, run, text, at)
    if (next === run) return false
    this.setRun(next)
    this.say(crawlCue(found.route, run, next))
    return true
  }

  /** Its part of the achievements overlay's track: how the run stands, while the player is in its instance. */
  track(at: TrackContext): Partial<Pick<AchievementTrack, 'crawl'>> {
    this.sync()
    const run = this.file.get().run
    const found = run && this.inside && run.instance === at.zone ? routeOf(routes, at.zone) : undefined
    return { crawl: run && found ? crawlView(found.route, run, at.zone) : null }
  }

  register(ctx: AppContext): void {
    this.ctx = ctx
    this.sync()
    ctx.engine?.use({
      id: 'crawl',
      line: (line) => this.line(line.text, line.time),
      reset: () => {
        this.fresh = false
        this.zone = ''
        this.created = ''
        this.inside = false
        if (this.file.get().run) this.setRun(null)
      }
    })
    handle('crawl:route', async (zone) => this.data(ctx, typeof zone === 'string' ? zone : ''))
    handle('crawl:xp', async (character) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return this.xp(ctx, character)
    })
    handle('crawl:cues', async (on) => {
      if (typeof on !== 'boolean') throw new Error('On or off.')
      this.file.set({ ...this.file.get(), cues: on })
      return on
    })
    handle('crawl:mark', async (zone, on, what) => {
      const found = typeof zone === 'string' ? routeOf(routes, zone) : undefined
      if (!found || typeof on !== 'boolean') throw new Error('No route for that zone.')
      const camps = what === 'camps'
      return markRoute(ctx.installDir(), found.short, !on ? [] : camps ? campMarks(found.route) : routeMarks(found.route), camps ? 'camps' : 'route')
    })
  }

  /** Motes › Crawl XP: every run in an instance over the character's logs, and what each level of mob is worth. */
  private async xp(ctx: AppContext, character: string): Promise<CrawlXpData> {
    if (!this.history) return { runs: [], current: null, level: null, values: {} }
    const slice = await this.history.get<XpTally>(XP_KEY, ctx.historyOf(character))
    const { runs, values, level } = joinXp(everyStretch(slice))
    const live = slice.live
    const current = live.inside && live.open ? (runs.find((r) => r.zone === live.open?.zone && r.startedAt === live.open.startedAt) ?? live.open) : null
    return { runs: runs.slice(0, XP_RUNS_SHOWN), current, level, values }
  }

  /** What the page shows: the zone asked for (else the one being played in, else the first with a route), its route, its map and the run in hand. */
  private async data(ctx: AppContext, zone: string): Promise<CrawlData> {
    const zones = Object.values(routes).map((r) => r.name)
    const found = routeOf(routes, zone) ?? routeOf(routes, ctx.engine?.status.zone ?? '') ?? routeOf(routes, zones[0] ?? '')
    const cues = this.file.get().cues
    if (!found) return { zones, route: null, lines: [], marked: false, campsMarked: false, run: null, here: false, cues }
    const dir = ctx.installDir()
    const maps = dir ? join(dir, 'maps') : ''
    const files = maps ? await Promise.all([`${found.short}.txt`, `${found.short}_1.txt`].map((f) => readText(join(maps, f)))) : []
    const marked = async (what: CrawlMarks) => !!maps && !!(await readText(join(maps, 'LegendsTracker', `${found.short}_${LAYERS[what].layer}.txt`)))?.includes(LAYERS[what].mark)
    const run = this.runIn(found.route.name)
    return {
      zones,
      route: found.route,
      lines: parseMapLines(files.filter((t): t is string => t !== null).join('\n')),
      marked: await marked('route'),
      campsMarked: await marked('camps'),
      run,
      here: !!run && this.inside && run.instance === (ctx.engine?.status.zone ?? ''),
      cues
    }
  }
}

/**
 * Draws a route (or the places to sit) on the game's map, in the app's own map set (maps\LegendsTracker):
 * its layer written as the game's own (where it has one) and then the lines; no lines takes them off
 * again. The layer can be switched off in the game's map window on its own.
 */
export async function markRoute(installDir: string, short: string, lines: string[], what: CrawlMarks = 'route'): Promise<{ folder: string; lines: number }> {
  const { maps, set } = await mapSet(installDir)
  const { layer, mark: MARK } = LAYERS[what]
  const file = `${short}_${layer}.txt`
  const base = await readText(join(maps, file))
  if (!lines.length) {
    if (base === null) await rm(join(set, file), { force: true })
    else await writeFile(join(set, file), base, 'latin1')
    return { folder: set, lines: 0 }
  }
  // A label far below the zone, in black: it marks the layer as the app's without showing on the map.
  const mark = `P 0.0000, 0.0000, -9000.0000, 0, 0, 0, 1, ${MARK}`
  await writeFile(join(set, file), (base && !base.endsWith('\n') ? base + '\r\n' : (base ?? '')) + [mark, ...lines].join('\r\n') + '\r\n', 'latin1')
  return { folder: set, lines: lines.length }
}

/** crawl.json's run as read back: an instance, its start, and times by name. */
export function sanitizeRun(v: unknown): CrawlRun | null {
  const r = v as Partial<CrawlRun> | null
  if (!r || typeof r !== 'object' || typeof r.instance !== 'string' || !r.instance || r.instance.length > 120 || typeof r.startedAt !== 'number') return null
  const times = (x: unknown): Record<string, number> =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>)
            .filter((e): e is [string, number] => e[0].length <= 80 && typeof e[1] === 'number' && Number.isFinite(e[1]))
            .slice(0, 200)
        )
      : {}
  return { instance: r.instance, startedAt: r.startedAt, killed: times(r.killed), up: times(r.up), ...(typeof r.doneAt === 'number' ? { doneAt: r.doneAt } : {}) }
}
