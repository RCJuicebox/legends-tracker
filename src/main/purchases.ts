import { parsePurchase, type Purchase } from '../core/tradeskills'
import type { HistoryConsumer, LogHistory } from './sources/logHistory'
import type { Purchases } from '../shared/ipc'

// What a character paid for things, from "You purchased N X from M for coin." lines in the log and
// its archives, for the Tradeskills page's prices. The reading is LogHistory's.

export type { Purchases }

function keep(into: Purchases, p: Purchase): void {
  const k = p.item.toLowerCase()
  if (!into[k] || p.at >= into[k].at) into[k] = p
}

/** The newest purchase of each item, as a LogHistory consumer. */
export const purchaseConsumer: HistoryConsumer<Purchases> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => {
    if (!line.text.startsWith('You purchased ')) return
    const p = parsePurchase(line.text, line.time)
    if (p) keep(into, p)
  }
}

export class PurchaseHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** The last price paid for each item, over the live log and every archive of it. */
  async latest(o: { logPath: string; archiveDir: string; stem: string }): Promise<Purchases> {
    const slice = await this.history.get<Purchases>(this.key, o)
    const all: Purchases = {}
    // Archives oldest first, then the live log: the newest purchase wins.
    for (const a of slice.archives) for (const p of Object.values(a.value)) keep(all, p)
    for (const p of Object.values(slice.live)) keep(all, p)
    return all
  }
}
