import { addProgressLine, emptyProgress, joinProgress, progressionView, type ProgressionView, type ProgressTally } from '../core/progression'
import type { HistoryConsumer, HistoryWhere, LogHistory } from './sources/logHistory'

// A character's progression (levels, skill-ups, AA points and purchases, and each session's
// experience lines), over the log and its archives, for the Progression page. The reading is LogHistory's.

/** Each stretch of log's progression, as a LogHistory consumer. */
export const progressionConsumer: HistoryConsumer<ProgressTally> = {
  version: 1,
  empty: emptyProgress,
  reader: () => (line, into) => addProgressLine(into, line)
}

export class ProgressionHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Everything the log recorded, over the live log and every archive of it. */
  async view(where: HistoryWhere, now = Date.now()): Promise<ProgressionView> {
    const slice = await this.history.get<ProgressTally>(this.key, where)
    // Archives oldest first, then the live log.
    return progressionView(joinProgress([...slice.archives.map((a) => a.value), slice.live]), now)
  }
}
