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
//
// Gear on the pet counts as owned. Exaltations kept in Storage may go into a piece's focus, worn or
// proc slot: each is tried as an exalted copy of every piece of its own slot kind that one of the
// character's classes may wear with it (the piece and the exaltation share the class), bringing its focus,
// worn effect or proc in place of the piece's own, and a set wears a piece once (as it is or exalted)
// and uses each exaltation once. Worn effects count once however many carry them, wherever worn; a
// proc counts on a weapon in Primary or Secondary.

import { itemKey, storedEquipment, type Inventory, type InvItem, type ItemStats } from './inventory'
import { ANY_SLOT, canWear, isTwoHanded, score, weightsForSlot, type HandWeights, type Restrictions, type Wearer, type Weights } from './upgrades'

/** Every slot gear is worn in, one entry per slot: two ears, two wrists, two rings, two Any slots. */
export const SLOT_LAYOUT = [
  'Head',
  'Face',
  'Ear',
  'Ear',
  'Neck',
  'Shoulders',
  'Back',
  'Arms',
  'Chest',
  'Wrist',
  'Wrist',
  'Hands',
  'Fingers',
  'Fingers',
  'Waist',
  'Legs',
  'Feet',
  'Primary',
  'Secondary',
  'Range',
  'Any Slot',
  'Any Slot'
]

/** Where a piece is now; 'catalog' is one the character does not own, from the wiki (the optimizer's all-gear mode). */
export type PieceSource = 'worn' | 'bags' | 'bank' | 'sharedBank' | 'storage' | 'pet' | 'catalog'

export interface Piece {
  item: InvItem
  from: PieceSource
  key: string
  /** What the wiki says may wear it; null when it has no page, and then it stays where it is. */
  r: Restrictions | null
  stats: ItemStats | null
  /** Its focus effect and its exaltations'. */
  foci: string[]
  /** Its worn effect and combat proc (its exaltations' in their place); absent for none. */
  worn?: string[]
  procs?: string[]
  lore: boolean
  /** For an exalted copy: the exaltation put in it, the slot it goes in, and the piece it is a copy of. */
  exalt?: Exaltation
  exaltSlot?: ExaltSlot
  host?: Piece
}

/** An exaltation slot: 7 focus, 9 worn, 10 proc. */
export type ExaltSlot = 'focus' | 'worn' | 'proc'

/** An exaltation the character keeps, free to put in a piece's focus, worn or proc slot. */
export interface Exaltation {
  item: InvItem
  from: PieceSource
  /** What the item it was made from carries: a slot of each kind takes that one of it. '' for none. */
  focus: string
  worn?: string
  proc?: string
  /**
   * What the item it was made from may be worn by: its slot words ("FINGER", "CHEST") say which
   * pieces it goes in (one of the same kind), its classes, race and level who may use it.
   */
  r: Restrictions
}

/** What worn effects and procs are worth, in the weights' terms. */
export interface EffectValue {
  /** Worn effects worn together; one worn twice counts once. */
  worn: (names: string[]) => number
  /** One proc on one weapon in hand. */
  proc: (name: string) => number
}

export interface OptimizeOptions {
  pieces: Piece[]
  wearer: Wearer
  weights: Weights
  twoHanders: boolean
  focusValue: (names: string[]) => number
  /** Worn effects and procs; left out, they count for nothing. */
  effects?: EffectValue
  /** Where the search starts, one entry per slot; what is worn when absent. */
  from?: (Piece | null)[]
  /** Exaltations kept, to try in pieces' focus, worn and proc slots. */
  exaltations?: Exaltation[]
  /** How much each hand's weapon counts, from how often it swings; alike when absent. */
  hands?: HandWeights | null
}

// One exalted copy per piece, exaltation and slot, kept across searches so a set from one search (a
// baseline, say) means the same pieces in the next.
const exaltedCopies = new WeakMap<Piece, WeakMap<Exaltation, Partial<Record<ExaltSlot, Piece>>>>()
function exaltedCopy(h: Piece, e: Exaltation, slot: ExaltSlot): Piece {
  let byExalt = exaltedCopies.get(h)
  if (!byExalt) exaltedCopies.set(h, (byExalt = new WeakMap()))
  let bySlot = byExalt.get(e)
  if (!bySlot) byExalt.set(e, (bySlot = {}))
  const put: Partial<Piece> = slot === 'focus' ? { foci: [e.focus] } : slot === 'worn' ? { worn: [e.worn!] } : { procs: [e.proc!] }
  return (bySlot[slot] ??= { ...h, ...put, exalt: e, exaltSlot: slot, host: h })
}

/** A piece by name, with the exaltation to put in it when it is an exalted copy. */
export const pieceName = (p: Piece): string =>
  p.exalt ? `${p.item.name} with ${p.exalt.item.name}${p.exaltSlot && p.exaltSlot !== 'focus' ? ` (${p.exaltSlot} slot)` : ''}` : p.item.name

/**
 * Whether a piece and an exaltation are both for one of the character's classes: an exalted piece
 * may be worn only by a class both allow, so an SK exaltation in a monk weapon is no use to anyone.
 */
function sharedClass(host: Restrictions, exalt: Restrictions, wearer: Wearer): boolean {
  return wearer.classes.some((c) => {
    const one = { ...wearer, classes: [c] }
    return canWear(host, one, ANY_SLOT) && canWear(exalt, one, ANY_SLOT)
  })
}

/**
 * Every piece, and an exalted copy of each for every exaltation of its slot kind and every slot that
 * exaltation brings something worth having to, other than what the piece has there now. Exaltations
 * bringing the same thing to the same kind are one: a second copy of it is worth nothing more.
 */
function withExalted(pieces: Piece[], exaltations: Exaltation[], o: Pick<OptimizeOptions, 'focusValue' | 'effects' | 'wearer'>): Piece[] {
  const kinds = new Map<string, { e: Exaltation; slot: ExaltSlot; what: string }>()
  for (const e of exaltations) {
    // One the character's classes, race or level may not use does nothing for them.
    if (!canWear(e.r, o.wearer, ANY_SLOT)) continue
    const offers: [ExaltSlot, string | undefined, number][] = [
      ['focus', e.focus, e.focus ? o.focusValue([e.focus]) : 0],
      ['worn', e.worn, e.worn && o.effects ? o.effects.worn([e.worn]) : 0],
      ['proc', e.proc, e.proc && o.effects ? o.effects.proc(e.proc) : 0]
    ]
    for (const [slot, what, worth] of offers) {
      if (!what || worth <= 0) continue
      const k = `${slot}|${what}|${[...e.r.slots].sort().join(' ')}|${[...e.r.classes].sort().join(' ')}`
      if (!kinds.has(k)) kinds.set(k, { e, slot, what })
    }
  }
  if (!kinds.size) return pieces
  const out = [...pieces]
  for (const h of pieces) {
    if (!h.r || !h.stats) continue
    for (const { e, slot, what } of kinds.values()) {
      if (!e.r.slots.some((s) => h.r!.slots.includes(s)) || !sharedClass(h.r, e.r, o.wearer)) continue
      const now = slot === 'focus' ? h.foci : slot === 'worn' ? (h.worn ?? []) : (h.procs ?? [])
      if (now.length === 1 && now[0] === what) continue
      out.push(exaltedCopy(h, e, slot))
    }
  }
  return out
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
  /** What the worn effects and the procs in hand are worth, before and after. */
  effectsBefore: number
  effectsAfter: number
}

export function optimizeGear(o: OptimizeOptions): Plan {
  const slots = SLOT_LAYOUT
  const pieces = withExalted(o.pieces, o.exaltations ?? [], o)
  const exalted = pieces.length > o.pieces.length
  const hostOf = (p: Piece) => p.host ?? p
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
  const slotWeights = slots.map((s) => ({ ...weightsForSlot(o.weights, s, o.hands), haste: 0 }))
  // An offhand proc fires on offhand swings, so it counts as often as the offhand swings against the main hand.
  const offProc = o.hands && o.hands.main > 0 ? o.hands.off / o.hands.main : 1
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
    // A piece is worn once, as it is or exalted, and an exaltation goes in one piece.
    if (exalted) {
      const used = new Set<unknown>()
      for (const p of a) {
        if (!p) continue
        const h = hostOf(p)
        if (used.has(h) || (p.exalt && used.has(p.exalt))) return false
        used.add(h)
        if (p.exalt) used.add(p.exalt)
      }
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
  // Worn effects count once each wherever worn; a proc counts on a weapon in either hand.
  const wornCache = new Map<string, number>()
  const procCache = new Map<string, number>()
  const effectsOf = (a: (Piece | null)[]): number => {
    const fx = o.effects
    if (!fx) return 0
    let names: string[] | null = null
    let t = 0
    for (let i = 0; i < a.length; i++) {
      const p = a[i]
      if (!p) continue
      if (p.worn?.length) (names ??= []).push(...p.worn)
      if ((i === primary || i === secondary) && p.procs?.length)
        for (const n of p.procs) {
          let v = procCache.get(n)
          if (v === undefined) procCache.set(n, (v = fx.proc(n)))
          t += i === secondary ? v * offProc : v
        }
    }
    if (names) {
      const unique = [...new Set(names)].sort()
      const key = unique.join('\u0001')
      let v = wornCache.get(key)
      if (v === undefined) wornCache.set(key, (v = fx.worn(unique)))
      t += v
    }
    return t
  }
  const statsOf = (a: (Piece | null)[]): number => {
    let t = focusOf(a) + effectsOf(a)
    for (let i = 0; i < a.length; i++) t += slotScore(a[i], i)
    return t
  }
  const total = (a: (Piece | null)[]): number => (valid(a) ? statsOf(a) + hasteOf(a) : -Infinity)
  // With `h` the one haste item: it must be worn, its haste counts whatever else is, and every other
  // piece is judged on its stats alone. Without, the set's best haste counts.
  const value = (a: (Piece | null)[], h: Piece | null): number => (!h ? total(a) : valid(a) && a.includes(h) ? statsOf(a) + (h.stats?.haste ?? 0) * o.weights.haste : -Infinity)

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
    const effectsBase = o.effects ? effectsOf(b) : 0
    const hasteBase = h ? 0 : hasteOf(b)
    const lore = new Set(b.filter((p) => p?.lore).map((p) => p!.key))
    const used = exalted ? new Set(b.flatMap((p) => (p ? [hostOf(p), p.exalt] : []))) : null
    for (const q of fitting[j]) {
      if (b.includes(q) || (q.lore && lore.has(q.key))) continue
      if (used && (used.has(hostOf(q)) || (q.exalt && used.has(q.exalt)))) continue
      if (j === primary && q.r && isTwoHanded(q.r) && b[secondary]) continue
      let t = base + slotScore(q, j)
      if (q.foci.length || (o.effects && (q.worn?.length || ((j === primary || j === secondary) && q.procs?.length)))) {
        b[j] = q
        t += focusOf(b) - focusBase + (o.effects ? effectsOf(b) - effectsBase : 0)
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
        let bestChanges = Infinity
        for (const p of fitting[i]) {
          if (a[i] === p) continue
          const b = a.slice()
          b[i] = p
          // Moved from another slot: that slot takes the piece it replaced, if it fits, or the best of the rest.
          const j = a.indexOf(p)
          if (j >= 0) refill(b, j, h)
          const t = value(b, h)
          // Of moves worth the same, the one that changes fewest slots: no swapping two pieces for nothing.
          const changes = j >= 0 && b[j] !== a[j] ? 2 : 1
          if (t > best + 1e-6 || (bestMove && t > best - 1e-6 && changes < bestChanges)) [best, bestMove, bestChanges] = [Math.max(t, best), b, changes]
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
  // Slots that come in pairs (ears, wrists, rings, Any slots) are one slot twice: of the two ways to
  // wear a pair, keep the one that leaves more where the search started, so nothing shows as moving
  // from one ear to the other.
  const origin = o.from ?? start
  for (let i = 0; i < slots.length; i++) {
    const k = slots.indexOf(slots[i], i + 1)
    if (k < 0) continue
    const kept = Number(a[i] === origin[i]) + Number(a[k] === origin[k])
    const swapped = Number(a[k] === origin[i]) + Number(a[i] === origin[k])
    if (swapped > kept) [a[i], a[k]] = [a[k], a[i]]
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
    focusAfter: focusOf(a),
    effectsBefore: effectsOf(start),
    effectsAfter: effectsOf(a)
  }
}

/** A piece for every item the character has: worn, in bags, in the bank, the shared bank, Storage › Equipment and on the pet. */
export function ownedPieces(
  inv: { worn: InvItem[]; bags: InvItem[]; bank: InvItem[]; sharedBank: InvItem[]; keyRing?: Inventory['keyRing'] },
  describe: (item: InvItem) => { r: Restrictions | null; stats: ItemStats | null; foci: string[]; worn?: string[]; procs?: string[]; lore: boolean } | null,
  /** What the pet wears, from the log's list of its gear. */
  pet: InvItem[] = []
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
  if (inv.keyRing) add(storedEquipment({ keyRing: inv.keyRing }), 'storage')
  add(pet, 'pet')
  return out
}
