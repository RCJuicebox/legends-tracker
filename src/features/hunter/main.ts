import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'
import type { AchievementTrack } from '../../shared/tracking'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import { joinKillTallies, type SlayerKillTallies } from '../slayer/core'
import { seenFromRecords } from '../../core/respawnSeen'
import { KILLS_KEY, lastKills, namedSpawns, namedSpots, spawnTimings } from '../slayer/main'
import { hunterLive, hunterZones, wantedTimers, type HunterPlanData } from './core'
import { bareName } from '../slayer/core'
import { respawnEstimate, respawnKey, respawnTriggerId } from '../../core/respawns'
import { DIED, SLAIN_BY, SLAIN_BY_YOU } from '../../core/phrases'
import { clock } from '../../core/format'
import type { RoutePart } from '../../core/route'

/** A named's respawn bar, as the Respawns page's timers are coloured. */
const HUNTER_COLOR = '#6cc3ff'
import { locPoint, nearest, nearText } from '../../core/where'
import { parseSpot } from '../../core/where'
import { setFoundSpawns } from '../slayer/spawns'
import { newerBuildWrote } from '../../main/schema'
import type { FoundSpot, LegendsSpawn } from '../../shared/game/legendsSpawns'

// Plan › Hunter's side of the app: the character's achievements export, the kills its own log has
// shown (the Slayer plan's history of kills, each mob's last), and the spawn tables in Legends' terms.
// Hunter achievements the player has found do not work in Legends (Hunter of Crushbone, 2026-10-12)
// are kept in hunter-broken.json, for every character: no plan, step or overlay offers them until
// the player says they work again.

export class HunterPlanner implements AppFeature {
  readonly id = 'hunter'
  private readonly brokenFile: JsonFile<{ broken: string[]; autoTimers?: boolean }>
  /** The named a kill starts a timer for, in the zone the overlay track was last made for (FEAT-038). */
  private wanted: { character: string; zone: string; names: Map<string, { name: string; seconds: number }> } | null = null
  /** The spots the player found named at in play (FEAT-020), drawn and marked as Legends' own are. */
  private readonly foundFile: JsonFile<{ spots: FoundSpot[] }>
  private ctx: AppContext | null = null

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): HunterPlanner {
    return new HunterPlanner(d.logHistory, d.dir)
  }

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'hunter-broken.json')
    const read = readJsonFile(path)
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { broken?: unknown; autoTimers?: unknown }
    const broken = Array.isArray(v.broken) ? v.broken.filter((s): s is string => typeof s === 'string' && s.length < 200).slice(0, 500) : []
    this.brokenFile = new JsonFile(path, { broken, ...(v.autoTimers === true ? { autoTimers: true } : {}) }, { delayMs: 1000 })
    if (read.state === 'unreadable') this.brokenFile.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.brokenFile.freeze('written by a newer version')
    const foundPath = join(dir, 'hunter-spots.json')
    const foundRead = readJsonFile(foundPath)
    this.foundFile = new JsonFile(foundPath, { spots: sanitizeFound(foundRead.state === 'ok' ? foundRead.value : null) }, { delayMs: 1000, backup: true })
    if (foundRead.state === 'unreadable') this.foundFile.freeze('could not be read at start')
    if (newerBuildWrote(foundPath)) this.foundFile.freeze('written by a newer version')
    setFoundSpawns(asSpawns(this.foundFile.get().spots))
  }

  /** Whether the player has said this Hunter achievement does not work in Legends. */
  isBroken(achievement: string): boolean {
    const k = achievement.toLowerCase()
    return this.brokenFile.get().broken.some((b) => b.toLowerCase() === k)
  }

  flush(): Promise<void> {
    return Promise.all([this.brokenFile.flush(), this.foundFile.flush()]).then(() => undefined)
  }

  /** Keeps the spots, and hands them to the spawn tables at once. */
  private setFound(spots: FoundSpot[]): FoundSpot[] {
    this.foundFile.set({ spots })
    setFoundSpawns(asSpawns(spots))
    return spots
  }

  /** Its part of the achievements overlay's track: the named left in the zone the player is in (LT-623). */
  track(at: TrackContext): Partial<Pick<AchievementTrack, 'hunter'>> {
    const ctx = this.ctx
    if (!ctx || !at.exported) return { hunter: null }
    const seenOf = seenFromRecords(ctx.store.respawns?.get() ?? {}, Date.now())
    // From the player's last /loc here: how far each named's nearest spot is, and which way (FEAT-023).
    const loc = at.loc
    const near = (name: string) => {
      const spots = loc ? namedSpots(at.zone, [name]).get(name.toLowerCase()) : undefined
      const n = loc && spots ? nearest(locPoint(loc), spots) : null
      return loc && n ? nearText(n, loc.at, Date.now()) : undefined
    }
    const hunter = hunterLive(at.exported.sections, at.exported.modified, at.zone, ctx.slayer?.live?.kills(at.character), seenOf, (a) => this.isBroken(a), near)
    this.wanted = hunter ? { character: at.character, zone: at.zone, names: wantedTimers(hunter.rows, this.lengthIn(ctx, at.zone)) } : null
    return { hunter }
  }

  /** How long a named in a zone takes to come back: what your Respawns record timed, else the tables'. */
  private lengthIn(ctx: AppContext, zone: string): (name: string) => number | null {
    const records = ctx.store.respawns?.get() ?? {}
    const tables = namedSpawns(spawnTimings(Object.values(records)))(zone)
    return (name) => {
      const r = records[respawnKey(zone, name)]
      return (r ? respawnEstimate(r) : null) ?? tables?.get(bareName(name))?.timer ?? null
    }
  }

  /**
   * A kill in the zone the player is in: a named still wanted starts its respawn timer, on the overlay
   * respawn timers go on, unless the player has made a respawn timer of their own for it (FEAT-038).
   */
  private killed(ctx: AppContext, text: string, at: number): boolean {
    const m = SLAIN_BY_YOU.exec(text) ?? SLAIN_BY.exec(text) ?? DIED.exec(text)
    const w = this.wanted
    if (!m || !w || !this.brokenFile.get().autoTimers || w.zone !== ctx.engine.status.zone) return false
    const named = w.names.get(bareName(m[1]))
    if (!named) return false
    if (ctx.store.triggers.get().some((t) => t.id === respawnTriggerId(named.name) && t.enabled)) return true
    const overlays = ctx.store.settings.get().overlays
    const overlay = overlays.some((o) => o.id === 'respawns') ? 'respawns' : 'targets'
    const say = named.name.replace(/`/g, '')
    ctx.engine.startTimer({
      key: `hunter:${bareName(named.name)}`,
      label: named.name,
      seconds: named.seconds,
      overlay,
      color: HUNTER_COLOR,
      warnSec: 0,
      warnSpeech: '',
      endSpeech: `${say} is up`,
      at
    })
    ctx.engine.pushFeed('timer', `${named.name}: respawn timer started, ${clock(named.seconds)} (Plan › Hunter)`)
    return true
  }

  register(ctx: AppContext): void {
    this.ctx = ctx
    ctx.engine?.use({ id: 'hunter', line: (line) => this.killed(ctx, line.text, line.time) })
    handle('hunter:autoTimers', (on) => {
      if (typeof on !== 'boolean') throw new Error('On or off.')
      const { autoTimers: _was, ...rest } = this.brokenFile.get()
      this.brokenFile.set(on ? { ...rest, autoTimers: true } : rest)
      return on
    })
    handle('hunter:plan', async (character) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return this.data(ctx, character)
    })
    // A spot the player found a named at, as /loc or /waypoint gives it, with a few words of their own (FEAT-020).
    handle('hunter:found', (zone, name, spot, words) => {
      if (typeof zone !== 'string' || !zone || zone.length > 120 || typeof name !== 'string' || !name || name.length > 120) throw new Error('No such named.')
      const at = typeof spot === 'string' ? parseSpot(spot) : null
      if (!at) throw new Error('Not a spot: give it as the game prints /loc ("Your Location is 661.88, -301.44, -40.42") or as y, x.')
      const where = typeof words === 'string' ? words.trim().slice(0, 120) : ''
      const spots = this.foundFile.get().spots
      if (spots.length >= FOUND_MAX) throw new Error(`No more than ${FOUND_MAX} spots are kept.`)
      return this.setFound([...spots, { zone, name, at, ...(where ? { where } : {}), on: Date.now() }])
    })
    handle('hunter:unfound', (zone, name, on) => this.setFound(this.foundFile.get().spots.filter((s) => !(s.zone === zone && s.name === name && s.on === on))))
    handle('hunter:foundSpots', () => this.foundFile.get().spots)
    handle('hunter:broken', (achievement, broken) => {
      if (typeof achievement !== 'string' || !achievement || achievement.length >= 200) throw new Error('No such achievement.')
      const k = achievement.toLowerCase()
      const others = this.brokenFile.get().broken.filter((b) => b.toLowerCase() !== k)
      this.brokenFile.set({ ...this.brokenFile.get(), broken: broken ? [...others, achievement] : others })
      return this.brokenFile.get().broken
    })
  }

  /** The Hunter achievements still open, as one zone view puts them (FEAT-031): the named left and the longest wait. */
  async routeParts(ctx: AppContext, character: string): Promise<RoutePart[]> {
    const { zones } = await this.data(ctx, character)
    return zones.map((z) => ({
      planner: 'hunter' as const,
      zone: z.zone,
      title: `${z.achievement}: ${z.left.length} named`,
      seconds: z.wait ?? 0
    }))
  }

  private async data(ctx: AppContext, character: string): Promise<HunterPlanData> {
    const broken = this.brokenFile.get().broken
    const exp = await ctx.achievementFiles.exported(character)
    const autoTimers = !!this.brokenFile.get().autoTimers
    if (!exp) return { character, export: null, zones: [], broken, autoTimers }
    // A named counts for the character that killed it: its own log alone.
    const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(character))
    const zones = joinKillTallies(everyStretch(slice))
    const records = ctx.store.respawns.get()
    const spawns = namedSpawns(spawnTimings(Object.values(records)))
    const all = hunterZones(exp.sections, lastKills(zones), exp.modified, spawns, seenFromRecords(records, Date.now()))
    return { character, export: { file: exp.file, modified: exp.modified }, zones: all.filter((z) => !this.isBroken(z.achievement)), broken, autoTimers }
  }
}

const FOUND_MAX = 500

/** hunter-spots.json as read back: spots with a zone, a name and two or three numbers. */
export function sanitizeFound(v: unknown): FoundSpot[] {
  const list = v && typeof v === 'object' && Array.isArray((v as { spots?: unknown }).spots) ? (v as { spots: unknown[] }).spots : []
  return list.slice(0, FOUND_MAX).flatMap((x) => {
    const s = x as Partial<FoundSpot> | null
    const at = s && Array.isArray(s.at) ? s.at : []
    if (
      !s ||
      typeof s.zone !== 'string' ||
      !s.zone ||
      typeof s.name !== 'string' ||
      !s.name ||
      at.length < 2 ||
      at.length > 3 ||
      !at.every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      return []
    return [
      {
        zone: s.zone.slice(0, 120),
        name: s.name.slice(0, 120),
        at: at as FoundSpot['at'],
        ...(typeof s.where === 'string' && s.where ? { where: s.where.slice(0, 120) } : {}),
        on: typeof s.on === 'number' ? s.on : 0
      }
    ]
  })
}

/** The found spots as Legends' own spawns, one entry a spot: legendsSpawnsOf puts a named's together. */
const asSpawns = (spots: FoundSpot[]): LegendsSpawn[] =>
  spots.map((s) => ({ zone: s.zone, name: s.name, spots: [{ at: s.at, ...(s.where ? { where: s.where } : {}) }], said: `you, ${dateOf(s.on)}` }))

/** "2026-10-19", the day as the built-in list writes it. */
const dateOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
