import { parsePurchase, type Purchase } from '../core/tradeskills'
import { zoneEntered } from '../core/logLine'
import type { HistoryConsumer, LogHistory } from './sources/logHistory'
import type { Purchases } from '../shared/ipc'

// What a character paid for things, and where, from "You purchased N X from M for coin." lines in the
// log and its archives, for the Tradeskills page's prices and the faction plan's "you bought it from M
// in Z". The reading is LogHistory's.

export type { Purchases }

/**
 * A stretch of log's purchases, and the zone it was last in: the live log is read a little at a time, and
 * the zone a purchase was made in was said once, maybe many reads before.
 */
export interface PurchaseLog {
  bought: Purchases
  zone: string
}

function keep(into: Purchases, p: Purchase): void {
  const k = p.item.toLowerCase()
  if (!into[k] || p.at >= into[k].at) into[k] = p
}

/** The newest purchase of each item, as a LogHistory consumer. */
export const purchaseConsumer: HistoryConsumer<PurchaseLog> = {
  version: 2,
  empty: () => ({ bought: {}, zone: '' }),
  reader: () => (line, into) => {
    const zone = zoneEntered(line.text)
    if (zone) into.zone = zone
    else if (line.text.startsWith('You purchased ')) {
      const p = parsePurchase(line.text, line.time)
      if (p) keep(into.bought, into.zone ? { ...p, zone: into.zone } : p)
    }
  }
}

export class PurchaseHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** The last price paid for each item, over the live log and every archive of it. */
  async latest(o: { logPath: string; archiveDir: string; stem: string }): Promise<Purchases> {
    const slice = await this.history.get<PurchaseLog>(this.key, o)
    const all: Purchases = {}
    // Archives oldest first, then the live log: the newest purchase wins.
    for (const a of slice.archives) for (const p of Object.values(a.value.bought)) keep(all, p)
    for (const p of Object.values(slice.live.bought)) keep(all, p)
    return all
  }
}
