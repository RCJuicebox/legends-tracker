// The best way to wear what a character already owns: every piece they carry, bank or wear, tried in
// every slot it fits (Legends' two Any slots take anything), scored with the finder's weights plus
// what the focus effects worn are worth. A local search from what is worn now: move one piece into a
// slot (swapping, or refilling the slot it left), keep the move that adds most, repeat until no move
// adds anything.

import { itemKey, type InvItem, type ItemStats } from './inventory'
import { canWear, isTwoHanded, score, WEAPON_SLOTS, type Restrictions, type Wearer, type Weights } from './upgrades'

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
  // A weapon's damage and delay only count in the hands. Haste is counted once for the whole set:
  // only the best worn works.
  const slotWeights = slots.map((s) => ({ ...(WEAPON_SLOTS.includes(s) ? o.weights : { ...o.weights, ratio: 0 }), haste: 0 }))
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
    const lore = new Set<string>()
    for (const p of a) {
      if (!p?.lore) continue
      if (lore.has(p.key)) return false
      lore.add(p.key)
    }
    const main = a[primary]
    return !(main?.r && isTwoHanded(main.r) && a[secondary])
  }
  // Most moves leave the foci worn unchanged, and their worth does not depend on the order they are
  // worn in, so it is worked out once per set.
  const focusCache = new Map<string, number>()
  const focusOf = (a: (Piece | null)[]) => {
    const names = a.flatMap((p) => p?.foci ?? [])
    const key = names.slice().sort().join('\u0001')
    let v = focusCache.get(key)
    if (v === undefined) focusCache.set(key, (v = o.focusValue(names)))
    return v
  }
  const total = (a: (Piece | null)[]): number => {
    if (!valid(a)) return -Infinity
    let t = focusOf(a) + hasteOf(a)
    for (let i = 0; i < a.length; i++) t += slotScore(a[i], i)
    return t
  }

  let a = start.slice()
  let best = total(a)
  for (let pass = 0; pass < 12; pass++) {
    let moved = false
    for (let i = 0; i < slots.length; i++) {
      let bestMove: (Piece | null)[] | null = null
      for (const p of pieces) {
        if (a[i] === p || !fits(p, i)) continue
        const b = a.slice()
        b[i] = p
        const j = a.indexOf(p)
        if (j >= 0) {
          // Moved from another slot: the piece it replaced goes there if it fits, else the best of the rest.
          const out = a[i]
          if (out && fits(out, j)) b[j] = out
          else {
            b[j] = null
            let fill: Piece | null = null
            let fillScore = total(b)
            for (const q of pieces) {
              if (b.includes(q) || !fits(q, j)) continue
              b[j] = q
              const t = total(b)
              if (t > fillScore) [fill, fillScore] = [q, t]
            }
            b[j] = fill
          }
        }
        const t = total(b)
        if (t > best + 1e-6) [best, bestMove] = [t, b]
      }
      if (bestMove) {
        a = bestMove
        moved = true
      }
    }
    if (!moved) break
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
