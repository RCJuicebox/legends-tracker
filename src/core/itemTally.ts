import { MERGED_ITEM } from './phrases'
import { itemKey } from './inventory'
import { parseLootLine } from './loot'
import { SELF } from './combatLines'
import type { LogLine } from './logLine'

// What the log says a character holds of chosen items: what a quest tracker (Plane of Sky, Epics)
// counts over the logs as a LogHistory consumer. Copies come in as loot and go out in trades and merges:
//   --You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--          +1
//   You looted a Wind Rune Neza from a blade storm's corpse and stored it in your currency   +1 (and the depot, the Dragon Hoard)
//   You looted a Nebulous Sapphire from Sister of the Spire's corpse and sold it for free.  never held
//   You offered 1 Nebulous Sapphire to Holwin.   then   You complete the trade with Holwin.  −1
//   You have cancelled the trade.                                                       what was offered comes back
//   You have successfully merged two items together to create a new item: Wu's Fist of Mastery +7    −1 (two become one)
// Copies held before the log began are not in it: the player puts the count right by hand, and that
// correction is kept as a difference, so the log goes on counting from it.

/** One stretch of log's count of the chosen items. */
export interface ItemTally {
  /** By item key: copies that came in, and copies that went (handed over, merged away); when the last came in. */
  items: Record<string, { got: number; gave: number; last?: number }>
  /** The trade open at the end of what was read: its NPC and what was offered, by item as printed. */
  trade?: { npc: string; items: Record<string, number> }
}

/** A trade that completed: the NPC, and what it took, by item as printed. */
export interface CompletedTrade {
  npc: string
  items: Record<string, number>
}

export const emptyItemTally = (): ItemTally => ({ items: {} })

const OFFERED = /^You offered (\d+) (.+) to (.+)\.$/
const TRADED = /^You complete the trade with (.+)\.$/
const CANCELLED = 'You have cancelled the trade.'

function count(into: ItemTally, counted: (key: string) => boolean, item: string, got: number, gave: number, at: number): void {
  const k = itemKey(item)
  if (!counted(k)) return
  const c = (into.items[k] ??= { got: 0, gave: 0 })
  c.got += got
  c.gave += gave
  if (got) c.last = at
}

/**
 * Reads one line into a stretch's tally, counting the items `counted` says yes to (by item key). A
 * completed trade is answered, whatever it held, for the caller to make of what it will.
 */
export function readItemLine(line: LogLine, into: ItemTally, counted: (key: string) => boolean): CompletedTrade | null {
  const text = line.text
  if (text.startsWith('You offered ')) {
    const m = OFFERED.exec(text)
    if (!m) return null
    // Another NPC: the trade before is over, whatever became of it.
    if (into.trade?.npc !== m[3]) into.trade = { npc: m[3], items: {} }
    into.trade.items[m[2]] = (into.trade.items[m[2]] ?? 0) + Number(m[1])
  } else if (text.startsWith('You complete the trade with ')) {
    const m = TRADED.exec(text)
    const t = into.trade
    if (!m || !t || t.npc !== m[1]) return null
    delete into.trade
    for (const [item, n] of Object.entries(t.items)) count(into, counted, item, 0, n, line.time)
    return t
  } else if (text === CANCELLED) {
    delete into.trade
  } else if (text.startsWith('You have successfully merged ')) {
    const m = MERGED_ITEM.exec(text)
    if (m) count(into, counted, m[1], 0, 1, line.time)
  } else {
    const e = parseLootLine(text)
    // Kept, or put in the depot, the currency tab or the Dragon Hoard: held. Sold as it dropped: never
    // held. Looted into a merge: one in, one out.
    if (e?.kind === 'loot' && e.looter === SELF && e.outcome !== 'sold' && e.outcome !== 'merged') count(into, counted, e.item, e.count, 0, line.time)
  }
  return null
}

/** Adds a stretch's counts into a whole (the stretches oldest first; the open trade is the last one's). */
export function addItemTally(into: ItemTally, stretch: ItemTally): void {
  for (const [k, c] of Object.entries(stretch.items)) {
    const o = (into.items[k] ??= { got: 0, gave: 0 })
    o.got += c.got
    o.gave += c.gave
    if (c.last) o.last = Math.max(o.last ?? 0, c.last)
  }
}

/** What the log says is held, by item key: what came in less what went, never under none. */
export function loggedCounts(t: ItemTally): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, c] of Object.entries(t.items)) out[k] = Math.max(0, c.got - c.gave)
  return out
}

/** When the log last saw each item come in, by item key. */
export function lastLooted(t: ItemTally): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, c] of Object.entries(t.items)) if (c.last) out[k] = c.last
  return out
}

/** Where the counts come from: the log, the inventory export, or the higher of the two for each item. */
export type CountFrom = 'both' | 'log' | 'export'

/** Held, by item key: the log's count with the player's correction, never under none. */
export function heldOf(s: { logged: Readonly<Record<string, number>>; adjust: Readonly<Record<string, number>> }, name: string): number {
  const k = itemKey(name)
  return Math.max(0, (s.logged[k] ?? 0) + (s.adjust[k] ?? 0))
}

/** How many of an item are held, counted from where the player chose; without an export, the log. */
export function heldFrom(log: number, exported: number | null, from: CountFrom): number {
  return from === 'log' || exported === null ? log : from === 'export' ? exported : Math.max(log, exported)
}
