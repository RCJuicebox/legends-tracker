// A finder candidate judged in the round: not "this slot, this item out", but the best way to wear
// everything owned once the candidate is among it. The item it pushes out may fit an Any slot, a
// focus it displaces may be carried by something else, and a lore twin may block it: the optimizer
// settles all of that, and the candidate is worth what the whole set gains.

import { itemKey, type InvItem, type ItemStats } from './inventory'
import { optimizeGear, type OptimizeOptions, type Piece, type Plan } from './gearOptimizer'
import { isLore, restrictions } from './upgrades'
import type { CatalogItem } from './wikiItem'

/** Where a piece of gear ends up, when a candidate moves things around. */
export interface RoundMove {
  slot: string
  /** What the slot held before; null for empty. */
  out: Piece | null
  /** What it holds after; null when the slot is left empty. */
  in: Piece | null
}

export interface RoundResult {
  /** What the whole set gains with the candidate, over the best use of what is owned without it. */
  delta: number
  /** The slots that change, the candidate's own included. */
  moves: RoundMove[]
  /** The slot the candidate lands in; null when the optimizer found no place worth putting it. */
  placed: string | null
}

/** A catalog item as a piece the optimizer can place: it is carried, as if just looted. */
export function candidatePiece(item: CatalogItem, stats: ItemStats): Piece {
  const inv: InvItem = { location: 'Candidate', name: item.title, id: 0, count: 1, augs: [] }
  return { item: inv, from: 'bags', key: itemKey(item.title), r: restrictions(item.statsblock), stats, foci: item.focus ? [item.focus] : [], lore: isLore(item.statsblock) }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** A plan's worth once carried out: every slot's stats, the best haste, and the foci worn. */
export function planTotal(p: Plan): number {
  return sum(p.slotScoreAfter) + p.hasteAfter + p.focusAfter
}

/**
 * The candidate among everything owned, worn as well as it can be. `baseline` is the optimizer's
 * plan without it (worked out once and shared across candidates); the candidate's worth is what it
 * adds over that.
 */
export function inTheRound(o: Omit<OptimizeOptions, 'pieces'> & { pieces: Piece[]; candidate: Piece; baseline: Plan }): RoundResult {
  const plan = optimizeGear({ ...o, pieces: [...o.pieces, o.candidate] })
  const delta = planTotal(plan) - planTotal(o.baseline)
  const moves: RoundMove[] = []
  for (let i = 0; i < plan.slots.length; i++) {
    const out = o.baseline.after[i]
    const now = plan.after[i]
    if (out !== now) moves.push({ slot: plan.slots[i], out, in: now })
  }
  const at = plan.after.indexOf(o.candidate)
  return { delta: Math.round(delta * 100) / 100, moves, placed: at >= 0 ? plan.slots[at] : null }
}
