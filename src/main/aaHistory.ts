import { addAaLine, aaHistoryView, emptyAaTally, joinAaTallies, type AaHistoryView, type AaTally } from '../core/aaHistory'
import type { HistoryConsumer, HistoryWhere, LogHistory } from './sources/logHistory'

// The AAs a character bought, raised and had refunded, and the ability points the game reported,
// over its log and archives: read with everything else LogHistory counts, for Stats › AAs.

export const aaConsumer: HistoryConsumer<AaTally> = {
  version: 1,
  empty: emptyAaTally,
  reader: () => (line, into) => addAaLine(into, line)
}

export class AaHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** What the live log and every archive of it recorded. */
  async view(where: HistoryWhere): Promise<AaHistoryView> {
    const slice = await this.history.get<AaTally>(this.key, where)
    return aaHistoryView(joinAaTallies([...slice.archives.map((a) => a.value), slice.live]))
  }
}
