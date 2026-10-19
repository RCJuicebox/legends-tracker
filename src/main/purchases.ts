import { parseOffer, parsePurchase, type Offer, type Purchase } from '../core/tradeskills'
import { zoneEntered } from '../core/logLine'
import { everyStretch, type HistoryConsumer, type HistoryWhere, type LogHistory } from './sources/logHistory'
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

export type Offers = Record<string, Offer>

/** The newest merchant offer for each item, as a LogHistory consumer (LT-725). */
export const offerConsumer: HistoryConsumer<Offers> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => {
    const o = parseOffer(line.text, line.time)
    if (!o) return
    const k = o.item.toLowerCase()
    if (!into[k] || o.at >= into[k].at) into[k] = o
  }
}

/** What merchants last offered this character, by item, over the live log and its archives. */
export class OfferHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  async latest(o: HistoryWhere): Promise<Offers> {
    const slice = await this.history.get<Offers>(this.key, o)
    const all: Offers = {}
    for (const stretch of everyStretch(slice)) for (const [k, v] of Object.entries(stretch)) if (!all[k] || v.at >= all[k].at) all[k] = v
    return all
  }
}

export class PurchaseHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** The last price paid for each item, over the live log and every archive of it. */
  async latest(o: HistoryWhere): Promise<Purchases> {
    const slice = await this.history.get<PurchaseLog>(this.key, o)
    const all: Purchases = {}
    // The newest purchase wins, whichever log or archive it is in.
    for (const stretch of everyStretch(slice)) for (const p of Object.values(stretch.bought)) keep(all, p)
    return all
  }
}
