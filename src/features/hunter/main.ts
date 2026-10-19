import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'
import type { AchievementTrack } from '../../shared/tracking'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import { joinKillTallies, type SlayerKillTallies } from '../slayer/core'
import { seenFromRecords } from './core'
import { KILLS_KEY, lastKills, namedSpawns, namedSpots, spawnTimings } from '../slayer/main'
import { hunterLive, hunterZones, type HunterPlanData } from './core'
import { locPoint, nearest, nearText } from '../../core/where'

// Plan › Hunter's side of the app: the character's achievements export, the kills its own log has
// shown (the Slayer plan's history of kills, each mob's last), and the spawn tables in Legends' terms.
// Hunter achievements the player has found do not work in Legends (Hunter of Crushbone, 2026-10-12)
// are kept in hunter-broken.json, for every character: no plan, step or overlay offers them until
// the player says they work again.

export class HunterPlanner implements AppFeature {
  readonly id = 'hunter'
  private readonly brokenFile: JsonFile<{ broken: string[] }>
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
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { broken?: unknown }
    const broken = Array.isArray(v.broken) ? v.broken.filter((s): s is string => typeof s === 'string' && s.length < 200).slice(0, 500) : []
    this.brokenFile = new JsonFile(path, { broken }, { delayMs: 1000 })
    if (read.state === 'unreadable') this.brokenFile.freeze('could not be read at start')
  }

  /** Whether the player has said this Hunter achievement does not work in Legends. */
  isBroken(achievement: string): boolean {
    const k = achievement.toLowerCase()
    return this.brokenFile.get().broken.some((b) => b.toLowerCase() === k)
  }

  flush(): Promise<void> {
    return this.brokenFile.flush()
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
    return { hunter: hunterLive(at.exported.sections, at.exported.modified, at.zone, ctx.slayer?.live?.kills(at.character), seenOf, (a) => this.isBroken(a), near) }
  }

  register(ctx: AppContext): void {
    this.ctx = ctx
    handle('hunter:plan', async (character) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return this.data(ctx, character)
    })
    handle('hunter:broken', (achievement, broken) => {
      if (typeof achievement !== 'string' || !achievement || achievement.length >= 200) throw new Error('No such achievement.')
      const k = achievement.toLowerCase()
      const others = this.brokenFile.get().broken.filter((b) => b.toLowerCase() !== k)
      this.brokenFile.set({ broken: broken ? [...others, achievement] : others })
      return this.brokenFile.get().broken
    })
  }

  private async data(ctx: AppContext, character: string): Promise<HunterPlanData> {
    const broken = this.brokenFile.get().broken
    const exp = await ctx.achievementFiles.exported(character)
    if (!exp) return { character, export: null, zones: [], broken }
    // A named counts for the character that killed it: its own log alone.
    const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(character))
    const zones = joinKillTallies(everyStretch(slice))
    const records = ctx.store.respawns.get()
    const spawns = namedSpawns(spawnTimings(Object.values(records)))
    const all = hunterZones(exp.sections, lastKills(zones), exp.modified, spawns, seenFromRecords(records, Date.now()))
    return { character, export: { file: exp.file, modified: exp.modified }, zones: all.filter((z) => !this.isBroken(z.achievement)), broken }
  }
}
