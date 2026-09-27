import { addFactionLine, factionView, joinFactions, type FactionTallies, type FactionView } from './core'
import { handle } from '../../main/ipc/handle'
import { isCharacterKey } from '../../core/validate'
import type { HistoryConsumer, HistoryWhere, LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'

// A character's faction changes, from "Your faction standing with X has been adjusted by N." and
// the cap lines, over the log and its archives, for the Factions page. The reading is LogHistory's.

/** Each stretch of log's faction tallies, as a LogHistory consumer. */
export const factionConsumer: HistoryConsumer<FactionTallies> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => addFactionLine(into, line)
}

export class FactionHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every faction the log saw change, over the live log and every archive of it. */
  async view(where: HistoryWhere): Promise<FactionView> {
    const slice = await this.history.get<FactionTallies>(this.key, where)
    // Archives oldest first, then the live log.
    return factionView(joinFactions([...slice.archives.map((a) => a.value), slice.live]))
  }
}

export function registerFactionIpc(ctx: AppContext): void {
  // Faction changes, over the character's log and its archives.
  handle('factions:get', async (character) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (!ctx.installDir()) return { factions: [] }
    return ctx.factions.view(ctx.historyOf(character))
  })
}
