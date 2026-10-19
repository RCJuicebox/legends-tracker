import { addZoneLine, joinZoneVisits, type ZoneVisits } from '../core/zoneVisits'
import { everyStretch, type HistoryConsumer, type HistoryWhere, type LogHistory } from './sources/logHistory'

// The zones a character's log has entered, over its log and archives, read with everything else
// LogHistory counts: for the Exploration achievements the log can tick before the next export (LT-732).

export const zoneConsumer: HistoryConsumer<ZoneVisits> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => addZoneLine(into, line.text, line.time)
}

export class ZoneHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every place entered, over the live log and every archive of it, with when first and last. */
  async view(where: HistoryWhere): Promise<ZoneVisits> {
    const slice = await this.history.get<ZoneVisits>(this.key, where)
    return joinZoneVisits(everyStretch(slice))
  }
}
