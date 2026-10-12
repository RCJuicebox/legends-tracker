import { isCharacterKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import type { LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'
import type { AppFeature } from '../../main/appFeature'
import { joinKillTallies, type SlayerKillTallies } from '../slayer/core'
import { KILLS_KEY, lastKills, namedSpawns, spawnTimings } from '../slayer/main'
import { hunterZones, type HunterPlanData } from './core'

// Plan › Hunter's side of the app: the character's achievements export, the kills its own log has
// shown (the Slayer plan's history of kills, each mob's last), and the spawn tables in Legends' terms.

export class HunterPlanner implements AppFeature {
  readonly id = 'hunter'

  constructor(private readonly history: LogHistory) {}

  register(ctx: AppContext): void {
    handle('hunter:plan', async (character) => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return this.data(ctx, character)
    })
  }

  private async data(ctx: AppContext, character: string): Promise<HunterPlanData> {
    const exp = await ctx.achievementFiles.exported(character)
    if (!exp) return { character, export: null, zones: [] }
    // A named counts for the character that killed it: its own log alone.
    const slice = await this.history.get<SlayerKillTallies>(KILLS_KEY, ctx.historyOf(character))
    const zones = joinKillTallies([...slice.archives.map((a) => a.value), slice.live])
    const spawns = namedSpawns(spawnTimings(Object.values(ctx.store.respawns.get())))
    return { character, export: { file: exp.file, modified: exp.modified }, zones: hunterZones(exp.sections, lastKills(zones), exp.modified, spawns) }
  }
}
