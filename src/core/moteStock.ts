import { MOTE_RANKS, type MoteLoot } from './motes'
import { itemKey, mergeLevel } from './inventory'
import { StockCursor, fixItem, levelFromName, plan } from './moteCalc'
import type { FeedItem, MoteStock } from '../shared/types'

export interface Cell<T> {
  get(): T
  set(value: T): void
}

/** The motes on hand and the item being planned, kept up to date from loot as it happens. */
export class MoteStockKeeper {
  private cursor: StockCursor | null = null

  constructor(
    private readonly cell: Cell<MoteStock>,
    private readonly onChange: (stock: MoteStock) => void,
    private readonly feed: (kind: FeedItem['kind'], text: string) => void
  ) {}

  view(): MoteStock {
    return this.cell.get()
  }

  private save(next: MoteStock): MoteStock {
    this.cell.set(next)
    this.onChange(next)
    return next
  }

  /** Counts looted motes in, once each: the cursor remembers how far through the log it has counted. */
  add(loot: MoteLoot, time: number): void {
    const s = this.cell.get()
    if (!s.autoAdd) return
    this.cursor ??= new StockCursor(s.seenUntil ?? 0, s.seenAtSecond ?? 0)
    if (!this.cursor.accept(time)) return
    this.save({
      ...s,
      counts: { ...s.counts, [loot.rank]: (s.counts[loot.rank] ?? 0) + loot.count },
      seenUntil: this.cursor.seenUntil,
      seenAtSecond: this.cursor.seenAtSecond
    })
  }

  /**
   * Carries on counting exactly where the saved stock left off, for a read that picks up right after
   * the last line counted: the loot already counted in that last second is gone over again first, so
   * more loot logged in the same second still counts.
   */
  resume(): void {
    const s = this.cell.get()
    const c = new StockCursor(s.seenUntil ?? 0, s.seenAtSecond ?? 0)
    for (let i = 0; i < (s.seenAtSecond ?? 0); i++) c.accept(s.seenUntil ?? 0)
    this.cursor = c
  }

  setCounts(counts: MoteStock['counts']): MoteStock {
    return this.save({ ...this.cell.get(), counts })
  }

  setItem(item: MoteStock['item']): MoteStock {
    return this.save({ ...this.cell.get(), item: fixItem(item) })
  }

  setAutoAdd(on: boolean): MoteStock {
    // Switching it back on counts from now, not from whenever it was switched off.
    const s = this.cell.get()
    if (on) this.cursor = new StockCursor(Date.now(), 0)
    return this.save({ ...s, autoAdd: on, ...(on ? { seenUntil: Date.now(), seenAtSecond: 0 } : {}) })
  }

  /**
   * The game says an item is at a level (LT-740): merged up in the log ("… to create a new item: Cloak of
   * Flames +7", kept as a recent merge), or as the inventory export lists it. The item being planned
   * follows what the game says, whatever Done or nothing said before.
   */
  observed(names: readonly string[], at: number, from: 'merge' | 'export'): MoteStock {
    let s = this.cell.get()
    if (from === 'merge') s = { ...s, merges: [...(s.merges ?? []), ...names.map((name) => ({ name, at }))].slice(-50) }
    const planned = s.item.name ? itemKey(s.item.name) : ''
    const levels = planned ? names.filter((n) => itemKey(n) === planned).map(mergeLevel) : []
    const level = levels.length ? Math.max(...levels) : null
    if (level === null || level === s.item.lvl) return from === 'merge' ? this.save(s) : s
    const name = levelFromName(s.item.name) !== null ? s.item.name.replace(/\+\d+\s*$/, `+${level}`) : s.item.name
    this.feed('loot', `Merge planner: ${name} is +${level} ${from === 'merge' ? 'by your log' : 'in your inventory export'}.`)
    return this.save({ ...s, item: fixItem({ name, lvl: level, xp: 0, to: Math.max(s.item.to, level + 1) }) })
  }

  /** "Done": takes the planned motes off the stock and moves the item up to the level reached. */
  applyPlan(): MoteStock {
    const s = this.cell.get()
    const p = plan(fixItem(s.item), s.counts)
    if (!p.covered || !p.after) return s
    const counts = { ...s.counts }
    MOTE_RANKS.forEach((r, i) => (counts[r.key] = p.after![i]))
    const name = levelFromName(s.item.name) !== null ? s.item.name.replace(/\+\d+\s*$/, `+${p.reached}`) : s.item.name
    this.feed('loot', `Upgraded ${name || 'the item'} to +${p.reached}.`)
    return this.save({ ...s, counts, item: fixItem({ name, lvl: p.reached, xp: 0, to: Math.max(s.item.to, p.reached + 1) }) })
  }
}
