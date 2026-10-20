import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { itemKey } from '../../core/inventory'
import { lastLooted, loggedCounts } from '../../core/itemTally'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type HistoryConsumer, type LogHistory } from '../../main/sources/logHistory'
import { newerBuildWrote } from '../../main/schema'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps } from '../../main/appFeature'
import {
  emptyEpicCharacter,
  emptyEpicTally,
  exportCounts,
  isEpicItem,
  isTick,
  joinEpicTallies,
  readEpicLine,
  sanitizeEpicCharacter,
  type EpicCharacter,
  type EpicState,
  type EpicTally
} from './core'

// Goals › Epics' side of the app (an optional module): the epic pieces counted over each character's
// logs (a LogHistory consumer), the inventory export as the game last wrote it, and what the player
// keeps per character in epics.json: the steps ticked off and their corrections to the counts. The
// consumer counts whether the module is on or not, so turning it on finds the counts ready.

/** Each stretch of log's epic pieces, as a LogHistory consumer. */
const epicConsumer: HistoryConsumer<EpicTally> = {
  version: 1,
  empty: emptyEpicTally,
  reader: () => readEpicLine
}

const EPIC_KEY = 'epicItems'

export class EpicTracker implements AppFeature {
  readonly id = 'epics'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [EPIC_KEY]: epicConsumer }
  /** By character key. */
  private readonly file: JsonFile<{ characters: Record<string, EpicCharacter> }>

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): EpicTracker {
    return new EpicTracker(d.logHistory, d.dir)
  }

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'epics.json')
    const read = readJsonFile(path)
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { characters?: unknown }
    const characters: Record<string, EpicCharacter> = {}
    if (v.characters && typeof v.characters === 'object') for (const [k, c] of Object.entries(v.characters)) if (isCharacterKey(k)) characters[k] = sanitizeEpicCharacter(c)
    this.file = new JsonFile(path, { characters }, { delayMs: 1000, backup: true })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  private kept(character: string): EpicCharacter {
    return this.file.get().characters[character] ?? emptyEpicCharacter()
  }

  private keep(character: string, next: EpicCharacter): void {
    this.file.set({ characters: { ...this.file.get().characters, [character]: next } })
  }

  register(ctx: AppContext): void {
    const check = (character: unknown): string => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return character
    }
    handle('epics:state', async (character) => this.state(ctx, check(character)))
    // A step ticked off by hand (handed in, made, or had before the log began), or not.
    handle('epics:tick', async (character, key, on) => {
      const c = check(character)
      if (!isTick(key)) throw new Error('No such step.')
      const kept = this.kept(c)
      this.keep(c, { ...kept, ticks: kept.ticks.filter((k) => k !== key).concat(on ? [key] : []) })
      return this.state(ctx, c)
    })
    // What the player says they hold of an item: kept as the difference from the log's count.
    handle('epics:have', async (character, item, have) => {
      const c = check(character)
      if (!isEpicItem(item)) throw new Error('Not an item an epic takes.')
      if (!Number.isInteger(have) || have < 0 || have > 9999) throw new Error('Hold 0 to 9999.')
      const k = itemKey(item)
      const logged = loggedCounts(await this.tally(ctx, c))[k] ?? 0
      const kept = this.kept(c)
      const { [k]: _, ...adjust } = kept.adjust
      this.keep(c, { ...kept, adjust: have === logged ? adjust : { ...adjust, [k]: have - logged } })
      return this.state(ctx, c)
    })
  }

  private async tally(ctx: AppContext, character: string): Promise<EpicTally> {
    return joinEpicTallies(everyStretch(await this.history.get<EpicTally>(EPIC_KEY, ctx.historyOf(character))))
  }

  private async state(ctx: AppContext, character: string): Promise<EpicState> {
    const [t, inv] = await Promise.all([this.tally(ctx, character), ctx.inventoryFiles.exported(character)])
    const record = ctx.store.settings.get().characters[character]
    return {
      character,
      ...this.kept(character),
      logged: loggedCounts(t),
      last: lastLooted(t),
      classes: Object.keys(record?.classLevels ?? {}),
      exported: inv ? { file: inv.file, modified: inv.modified, counts: exportCounts(inv.inventory) } : null
    }
  }
}
