// The best way to wear what a character already owns: every piece they carry, bank or wear, tried in
// every slot it fits (Legends' two Any slots take anything), scored with the finder's weights plus
// what the focus effects worn are worth. A local search from what is worn now: move one piece into a
// slot (swapping, or refilling the slot it left), keep the move that adds most, repeat until no move
// adds anything.
//
// Only one haste item is needed: the best worn is all that counts. One move at a time cannot trade the
// haste gloves for a haste belt so that better gloves can go on (the belt alone costs the old belt,
// the gloves alone cost the haste), so the search is run again with each haste item owned as the one,
// the rest of the set free to drop its haste, and the best set of the lot is kept.

import { itemKey, type InvItem, type ItemStats } from './inventory'
import { canWear, isTwoHanded, score, weightsForSlot, type Restrictions, type Wearer, type Weights } from './upgrades'

/** Every slot gear is worn in, one entry per slot: two ears, two wrists, two rings, two Any slots. */
export const SLOT_LAYOUT = [
  'Head', 'Face', 'Ear', 'Ear', 'Neck', 'Shoulders', 'Back', 'Arms', 'Chest', 'Wrist', 'Wrist', 'Hands',
  'Fingers', 'Fingers', 'Waist', 'Legs', 'Feet', 'Primary', 'Secondary', 'Range', 'Any Slot', 'Any Slot'
]

export type PieceSource = 'worn' | 'bags' | 'bank' | 'sharedBank'

export interface Piece {
  item: InvItem
  from: PieceSource
  key: string
  /** What the wiki says may wear it; null when it has no page, and then it stays where it is. */
  r: Restrictions | null
  stats: ItemStats | null
  /** Its focus effect and its exaltations'. */
  foci: string[]
  lore: boolean
}

export interface OptimizeOptions {
  pieces: Piece[]
  wearer: Wearer
  weights: Weights
  twoHanders: boolean
  focusValue: (names: string[]) => number
  /** Where the search starts, one entry per slot; what is worn when absent. */
  from?: (Piece | null)[]
}

export interface Plan {
  slots: string[]
  before: (Piece | null)[]
  after: (Piece | null)[]
  /** Stat score of each slot's piece, before and after, haste aside. */
  slotScoreBefore: number[]
  slotScoreAfter: number[]
  /** What the best haste worn is worth, before and after. */
  hasteBefore: number
  hasteAfter: number
  focusBefore: number
  focusAfter: number
}

export function optimizeGear(o: OptimizeOptions): Plan {
  const slots = SLOT_LAYOUT
  const pieces = o.pieces
  // Where each worn piece starts: the first free entry for its slot.
  const start: (Piece | null)[] = slots.map(() => null)
  for (const p of pieces) {
    if (p.from !== 'worn') continue
    const i = slots.findIndex((s, k) => s === p.item.location && !start[k])
    if (i >= 0) start[i] = p
  }
  const home = new Map(start.map((p, i) => [p, i] as const))
  const fits = (p: Piece, i: number): boolean => {
    if (!p.r) return home.get(p) === i
    if (!canWear(p.r, o.wearer, slots[i])) return false
    return !(slots[i] === 'Primary' && isTwoHanded(p.r) && !o.twoHanders)
  }
  // What may go in each slot, worked out once: the search asks it for every move.
  const fitting = slots.map((_, i) => pieces.filter((p) => fits(p, i)))
  // Weapon ratio counts in the hands, ranged ratio in the Range slot. Haste is counted once for the
  // whole set: only the best worn works.
  const slotWeights = slots.map((s) => ({ ...weightsForSlot(o.weights, s), haste: 0 }))
  const hasteOf = (a: (Piece | null)[]) => Math.max(0, ...a.map((p) => p?.stats?.haste ?? 0)) * o.weights.haste
  const scoreCache = new Map<Piece, number[]>()
  const slotScore = (p: Piece | null, i: number): number => {
    if (!p?.stats) return 0
    let row = scoreCache.get(p)
    if (!row) scoreCache.set(p, (row = []))
    return (row[i] ??= score(p.stats, slotWeights[i]))
  }
  const primary = slots.indexOf('Primary')
  const secondary = slots.indexOf('Secondary')
  const valid = (a: (Piece | null)[]): boolean => {
    let lore: Set<string> | null = null
    for (const p of a) {
      if (!p?.lore) continue
      if (lore?.has(p.key)) return false
      ;(lore ??= new Set()).add(p.key)
    }
    const main = a[primary]
    return !(main?.r && isTwoHanded(main.r) && a[secondary])
  }
  // Most moves leave the foci worn unchanged, and their worth does not depend on the order they are
  // worn in, so it is worked out once per set.
  const focusCache = new Map<string, number>()
  const focusOf = (a: (Piece | null)[]) => {
    const names: string[] = []
    for (const p of a) if (p?.foci.length) names.push(...p.foci)
    const key = names.length > 1 ? names.slice().sort().join('\u0001') : (names[0] ?? '')
    let v = focusCache.get(key)
    if (v === undefined) focusCache.set(key, (v = o.focusValue(names)))
    return v
  }
  const statsOf = (a: (Piece | null)[]): number => {
    let t = focusOf(a)
    for (let i = 0; i < a.length; i++) t += slotScore(a[i], i)
    return t
  }
  const total = (a: (Piece | null)[]): number => (valid(a) ? statsOf(a) + hasteOf(a) : -Infinity)
  // With `h` the one haste item: it must be worn, its haste counts whatever else is, and every other
  // piece is judged on its stats alone. Without, the set's best haste counts.
  const value = (a: (Piece | null)[], h: Piece | null): number =>
    !h ? total(a) : valid(a) && a.includes(h) ? statsOf(a) + (h.stats?.haste ?? 0) * o.weights.haste : -Infinity

  // Slot j of b takes the piece that adds most, or stays empty. Only that slot changes, so b is
  // weighed once with it empty, and each piece by what it brings: its own score, the foci if it
  // carries any, the haste if it is quicker.
  const refill = (b: (Piece | null)[], j: number, h: Piece | null): void => {
    b[j] = null
    const base = value(b, h)
    let fill: Piece | null = null
    let fillScore = base
    if (base === -Infinity) {
      // Only a piece put back can make it whole (the haste item itself): weigh each in full.
      for (const q of fitting[j]) {
        if (b.includes(q)) continue
        b[j] = q
        const t = value(b, h)
        if (t > fillScore) [fill, fillScore] = [q, t]
      }
      b[j] = fill
      return
    }
    const main = b[primary]
    if (j === secondary && main?.r && isTwoHanded(main.r)) return
    const focusBase = focusOf(b)
    const hasteBase = h ? 0 : hasteOf(b)
    const lore = new Set(b.filter((p) => p?.lore).map((p) => p!.key))
    for (const q of fitting[j]) {
      if (b.includes(q) || (q.lore && lore.has(q.key))) continue
      if (j === primary && q.r && isTwoHanded(q.r) && b[secondary]) continue
      let t = base + slotScore(q, j)
      if (q.foci.length) {
        b[j] = q
        t += focusOf(b) - focusBase
        b[j] = null
      }
      if (!h) t += Math.max(0, (q.stats?.haste ?? 0) * o.weights.haste - hasteBase)
      if (t > fillScore) [fill, fillScore] = [q, t]
    }
    b[j] = fill
  }

  // Move one piece at a time while a move adds to the set's value.
  const search = (from: (Piece | null)[], h: Piece | null): (Piece | null)[] => {
    let a = from.slice()
    let best = value(a, h)
    for (let pass = 0; pass < 12; pass++) {
      let moved = false
      for (let i = 0; i < slots.length; i++) {
        let bestMove: (Piece | null)[] | null = null
        for (const p of fitting[i]) {
          if (a[i] === p) continue
          const b = a.slice()
          b[i] = p
          // Moved from another slot: that slot takes the piece it replaced, if it fits, or the best of the rest.
          const j = a.indexOf(p)
          if (j >= 0) refill(b, j, h)
          const t = value(b, h)
          if (t > best + 1e-6) [best, bestMove] = [t, b]
        }
        if (bestMove) {
          a = bestMove
          moved = true
        }
      }
      if (!moved) break
    }
    return a
  }

  let a = search(o.from ?? start, null)
  let best = total(a)
  if (o.weights.haste > 0) {
    // Each haste item owned as the one worn (one of each, however many copies). The one already giving
    // the haste is skipped: with its haste counted either way, no move helps that did not already.
    const seen = new Set<string>()
    for (const h of pieces) {
      const haste = h.stats?.haste ?? 0
      if (haste <= 0 || seen.has(h.key)) continue
      seen.add(h.key)
      if (a.includes(h) && haste * o.weights.haste >= hasteOf(a)) continue
      // Start from the best set so far, with the haste item put on where it costs least.
      let from: (Piece | null)[] | null = a.includes(h) ? a : null
      let fromScore = -Infinity
      if (!from) {
        for (let i = 0; i < slots.length; i++) {
          if (!fitting[i].includes(h)) continue
          const b = a.slice()
          b[i] = h
          const t = value(b, h)
          if (t > fromScore) [from, fromScore] = [b, t]
        }
      }
      if (!from) continue
      const b = search(from, h)
      if (total(b) > best + 1e-6) {
        // Settled with every haste counted again, so the next haste item starts from a set no move improves.
        a = search(b, null)
        best = total(a)
      }
    }
  }
  return {
    slots,
    before: start,
    after: a,
    slotScoreBefore: start.map((p, i) => slotScore(p, i)),
    slotScoreAfter: a.map((p, i) => slotScore(p, i)),
    hasteBefore: hasteOf(start),
    hasteAfter: hasteOf(a),
    focusBefore: focusOf(start),
    focusAfter: focusOf(a)
  }
}

/** A piece for every item the character has: worn, in bags, in the bank and the shared bank. */
export function ownedPieces(
  inv: { worn: InvItem[]; bags: InvItem[]; bank: InvItem[]; sharedBank: InvItem[] },
  describe: (item: InvItem) => { r: Restrictions | null; stats: ItemStats | null; foci: string[]; lore: boolean } | null
): Piece[] {
  const out: Piece[] = []
  const add = (items: InvItem[], from: PieceSource) => {
    for (const item of items) {
      if (from === 'worn' && !SLOT_LAYOUT.includes(item.location)) continue
      const d = describe(item)
      if (!d || (!d.r && from !== 'worn')) continue
      out.push({ item, from, key: itemKey(item.name), ...d })
    }
  }
  add(inv.worn, 'worn')
  add(inv.bags, 'bags')
  add(inv.bank, 'bank')
  add(inv.sharedBank, 'sharedBank')
  return out
}
