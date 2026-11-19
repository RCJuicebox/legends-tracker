import { join } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { zoneEntered } from '../../core/logLine'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { newerBuildWrote } from '../../main/schema'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import type { AchievementTrack } from '../../shared/tracking'
import ROUTES from '../../shared/game/crawlRoutes.json'
import { mapSet } from '../../main/mapSet'
import { crawlView, isInstance, newRun, parseMapLines, readRunLine, routeMarks, routeOf, type CrawlData, type CrawlRoutes, type CrawlRun } from './core'

// Motes › Crawl route's side of the app: the routes (crawlRoutes.json, as scripts/crawl-routes.mjs
// wrote them), the game's own map of a route's zone with its heights kept, the route drawn on the game's
// map (a layer of its own in the LegendsTracker map set, beside Hunter's marks), and the run in hand:
// the rares the log has shown dying since the instance was entered, kept in crawl.json so a restart
// mid-run loses nothing. The achievements overlay shows the next stops while the player is in the instance.

const routes = ROUTES.zones as unknown as CrawlRoutes

/** The map layer the route is drawn on: the game's maps use the first for labels (and Hunter's marks go there). */
const LAYER = 2
/** A run this old is not the one being entered again. */
const RUN_STALE_MS = 6 * 3600_000
/** "Player Juicebox creating instance Kedge Keep 453.", "Juicebox has been added to Kedge Keep - Group.": the next instance entered is a new one. */
const NEW_INSTANCE = /^(?:Player .+ creating instance .+ \d+\.|.+ has been (?:added to|removed from) .+\.)$/

const readText = (path: string) => readFile(path, 'latin1').catch(() => null)

export class CrawlGuide implements AppFeature {
  readonly id = 'crawl'
  private readonly file: JsonFile<{ run: CrawlRun | null }>
  /** The next instance entered is a new one, whatever its name. */
  private fresh = false
  /** The zone the log last entered. */
  private zone = ''
  /** Told when the run has moved (LiveAchievements publishes the track again). */
  onChange: (() => void) | null = null

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): CrawlGuide {
    return new CrawlGuide(d.dir)
  }

  constructor(dir: string) {
    const path = join(dir, 'crawl.json')
    const read = readJsonFile(path)
    this.file = new JsonFile(path, { run: sanitizeRun(read.state === 'ok' ? (read.value as { run?: unknown } | null)?.run : null) }, { delayMs: 1000 })
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
    this.file.set({ run })
    this.onChange?.()
  }

  /** Whether the line was one it reads: an instance of a route's zone entered, a rare of the run dying or called rare. */
  private line(text: string, at: number): boolean {
    if (NEW_INSTANCE.test(text)) {
      this.fresh = true
      return false
    }
    const entered = zoneEntered(text)
    if (entered) {
      this.zone = entered
      if (!isInstance(entered) || !routeOf(routes, entered)) return false
      const run = this.file.get().run
      // Stepping out and back into the same instance keeps the run; a new instance, or one long over, starts one.
      if (this.fresh || !run || run.instance !== entered || run.doneAt || at - run.startedAt > RUN_STALE_MS) this.setRun(newRun(entered, at))
      this.fresh = false
      return false
    }
    const run = this.file.get().run
    const found = run && run.instance === this.zone ? routeOf(routes, run.instance) : undefined
    if (!run || !found) return false
    const next = readRunLine(found.route, run, text, at)
    if (next === run) return false
    this.setRun(next)
    return true
  }

  /** Its part of the achievements overlay's track: how the run stands, while the player is in its instance. */
  track(at: TrackContext): Partial<Pick<AchievementTrack, 'crawl'>> {
    const run = this.file.get().run
    const found = run && run.instance === at.zone ? routeOf(routes, at.zone) : undefined
    return { crawl: run && found ? crawlView(found.route, run, at.zone) : null }
  }

  register(ctx: AppContext): void {
    this.zone = ctx.engine?.status.zone ?? ''
    ctx.engine?.use({
      id: 'crawl',
      line: (line) => this.line(line.text, line.time),
      reset: () => {
        this.fresh = false
        this.zone = ''
        if (this.file.get().run) this.setRun(null)
      }
    })
    handle('crawl:route', async (zone) => this.data(ctx, typeof zone === 'string' ? zone : ''))
    handle('crawl:mark', async (zone, on) => {
      const found = typeof zone === 'string' ? routeOf(routes, zone) : undefined
      if (!found || typeof on !== 'boolean') throw new Error('No route for that zone.')
      return markRoute(ctx.installDir(), found.short, on ? routeMarks(found.route) : [])
    })
  }

  /** What the page shows: the zone asked for (else the one being played in, else the first with a route), its route, its map and the run in hand. */
  private async data(ctx: AppContext, zone: string): Promise<CrawlData> {
    const zones = Object.values(routes).map((r) => r.name)
    const found = routeOf(routes, zone) ?? routeOf(routes, ctx.engine?.status.zone ?? '') ?? routeOf(routes, zones[0] ?? '')
    if (!found) return { zones, route: null, lines: [], marked: false, run: null, here: false }
    const dir = ctx.installDir()
    const maps = dir ? join(dir, 'maps') : ''
    const files = maps ? await Promise.all([`${found.short}.txt`, `${found.short}_1.txt`].map((f) => readText(join(maps, f)))) : []
    const mine = maps ? await readText(join(maps, 'LegendsTracker', `${found.short}_${LAYER}.txt`)) : null
    const run = this.runIn(found.route.name)
    return {
      zones,
      route: found.route,
      lines: parseMapLines(files.filter((t): t is string => t !== null).join('\n')),
      marked: !!mine && mine.includes(MARK),
      run,
      here: !!run && run.instance === (ctx.engine?.status.zone ?? '')
    }
  }
}

/** The line the route's layer starts its own part with: what tells a layer holding a route from the game's own. */
const MARK = 'LegendsTracker_crawl_route'

/**
 * Draws a route on the game's map, in the app's own map set (maps\LegendsTracker): the zone's second
 * layer written as the game's own (where it has one) and then the route's lines; no lines takes the
 * route off again. The layer can be switched off in the game's map window on its own.
 */
export async function markRoute(installDir: string, short: string, lines: string[]): Promise<{ folder: string; lines: number }> {
  const { maps, set } = await mapSet(installDir)
  const file = `${short}_${LAYER}.txt`
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
