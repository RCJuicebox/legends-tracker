import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { itemKey } from '../../core/inventory'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type HistoryConsumer, type LogHistory } from '../../main/sources/logHistory'
import { newerBuildWrote } from '../../main/schema'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps } from '../../main/appFeature'
import { emptySkyTally, isSkyItem, joinSkyTallies, loggedCounts, readSkyLine, sanitizeSkyCharacter, SKY_QUESTS, type SkyCharacter, type SkyState, type SkyTally } from './core'

// Plan › Plane of Sky's side of the app (an optional module): the Sky's items counted over each
// character's logs (a LogHistory consumer), and what the player keeps per character in sky.json: the
// wish list, and their corrections to the counts. The consumer counts whether the module is on or not,
// so turning it on finds the counts ready.

/** Each stretch of log's Sky items and hand-ins, as a LogHistory consumer. */
const skyConsumer: HistoryConsumer<SkyTally> = {
  version: 1,
  empty: emptySkyTally,
  reader: () => readSkyLine
}

const SKY_KEY = 'skyItems'

export class SkyTracker implements AppFeature {
  readonly id = 'sky'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [SKY_KEY]: skyConsumer }
  /** By character key. */
  private readonly file: JsonFile<{ characters: Record<string, SkyCharacter> }>

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): SkyTracker {
    return new SkyTracker(d.logHistory, d.dir)
  }

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'sky.json')
    const read = readJsonFile(path)
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { characters?: unknown }
    const characters: Record<string, SkyCharacter> = {}
    if (v.characters && typeof v.characters === 'object') for (const [k, c] of Object.entries(v.characters)) if (isCharacterKey(k)) characters[k] = sanitizeSkyCharacter(c)
    this.file = new JsonFile(path, { characters }, { delayMs: 1000, backup: true })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  private kept(character: string): SkyCharacter {
    return this.file.get().characters[character] ?? { wishes: [], adjust: {} }
  }

  private keep(character: string, next: SkyCharacter): void {
    this.file.set({ characters: { ...this.file.get().characters, [character]: next } })
  }

  register(ctx: AppContext): void {
    const check = (character: unknown): string => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return character
    }
    const quest = (name: unknown): string => {
      if (typeof name !== 'string' || !SKY_QUESTS.some((q) => q.name === name)) throw new Error('No such Test.')
      return name
    }
    handle('sky:state', async (character) => this.state(ctx, check(character)))
    // A wish set: how many times the Test is wanted, and hand-ins the log did not see; a want of 0 drops it.
    handle('sky:wish', async (character, name, want, extra) => {
      const c = check(character)
      const q = quest(name)
      if (!Number.isInteger(want) || want < 0 || want > 99) throw new Error('Want it 0 to 99 times.')
      if (extra !== undefined && (!Number.isInteger(extra) || extra < 0 || extra > 99)) throw new Error('No more than 99 hand-ins.')
      const kept = this.kept(c)
      const had = kept.wishes.find((w) => w.quest === q)
      const wish = { quest: q, want, since: had?.since ?? Date.now(), ...((extra ?? had?.extra) ? { extra: extra ?? had?.extra } : {}) }
      const wishes = want === 0 ? kept.wishes.filter((w) => w.quest !== q) : had ? kept.wishes.map((w) => (w.quest === q ? wish : w)) : [...kept.wishes, wish]
      this.keep(c, { ...kept, wishes })
      return this.state(ctx, c)
    })
    // What the player says they hold of an item: kept as the difference from the log's count.
    handle('sky:have', async (character, item, have) => {
      const c = check(character)
      if (typeof item !== 'string' || !isSkyItem(item)) throw new Error('Not an item a Test takes.')
      if (!Number.isInteger(have) || have < 0 || have > 9999) throw new Error('Hold 0 to 9999.')
      const k = itemKey(item)
      const logged = loggedCounts(await this.tally(ctx, c))[k] ?? 0
      const kept = this.kept(c)
      const { [k]: _, ...adjust } = kept.adjust
      this.keep(c, { ...kept, adjust: have === logged ? adjust : { ...adjust, [k]: have - logged } })
      return this.state(ctx, c)
    })
  }

  private async tally(ctx: AppContext, character: string): Promise<SkyTally> {
    return joinSkyTallies(everyStretch(await this.history.get<SkyTally>(SKY_KEY, ctx.historyOf(character))))
  }

  private async state(ctx: AppContext, character: string): Promise<SkyState> {
    const t = await this.tally(ctx, character)
    const record = ctx.store.settings.get().characters[character]
    return { character, ...this.kept(character), logged: loggedCounts(t), runs: t.runs, classes: Object.keys(record?.classLevels ?? {}) }
  }
}
