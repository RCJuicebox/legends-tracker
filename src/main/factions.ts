import { addFactionLine, factionView, joinFactions, type FactionTallies, type FactionView } from '../core/factions'
import type { HistoryConsumer, HistoryWhere, LogHistory } from './sources/logHistory'

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
