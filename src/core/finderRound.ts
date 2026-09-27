// A finder candidate judged in the round: not "this slot, this item out", but the best way to wear
// everything owned once the candidate is among it. The item it pushes out may fit an Any slot, a
// focus it displaces may be carried by something else, and a lore twin may block it: the optimizer
// settles all of that, and the candidate is worth what the whole set gains.

import { itemKey, mergeLevel, type InvItem, type ItemStats } from './inventory'
import { optimizeGear, pieceName, type OptimizeOptions, type Piece, type Plan } from './gearOptimizer'
import { isLore, restrictions, type SlotResult } from './upgrades'
import type { CatalogItem } from './wikiItem'
import { procOf, wornEffectOf } from './itemEffects'

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
  const worn = wornEffectOf(item.statsblock)
  const proc = procOf(item.statsblock)
  return {
    item: inv,
    from: 'bags',
    key: itemKey(item.title),
    r: restrictions(item.statsblock),
    stats,
    foci: item.focus ? [item.focus] : [],
    worn: worn ? [worn] : [],
    procs: proc ? [proc] : [],
    lore: isLore(item.statsblock)
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/** A plan's worth once carried out: every slot's stats, the best haste, the foci worn, and worn effects and procs. */
export function planTotal(p: Plan): number {
  return sum(p.slotScoreAfter) + p.hasteAfter + p.focusAfter + p.effectsAfter
}

/**
 * The candidate among everything owned, worn as well as it can be. `baseline` is the optimizer's
 * plan without it (worked out once and shared across candidates); the candidate's worth is what it
 * adds over that.
 */
export function inTheRound(o: Omit<OptimizeOptions, 'pieces'> & { pieces: Piece[]; candidate: Piece; baseline: Plan }): RoundResult {
  // Started from the baseline's set, so the search is short and the candidate never ends up behind it.
  const plan = optimizeGear({ ...o, pieces: [...o.pieces, o.candidate], from: o.baseline.after })
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

/**
 * An item the character owns, judged in the round. Its copies are already among what the baseline
 * weighs, so a fresh copy would count it twice; it is worth what the baseline loses without them.
 * That is nothing when the optimizer leaves it off, so the finder and the optimizer agree.
 */
export function ownedInTheRound(o: Omit<OptimizeOptions, 'pieces' | 'from'> & { pieces: Piece[]; key: string; baseline: Plan }): RoundResult {
  const mine = (p: Piece | null) => !!p && p.key === o.key
  const without = optimizeGear({ ...o, pieces: o.pieces.filter((p) => !mine(p)), from: o.baseline.after.map((p) => (mine(p) ? null : p)) })
  const delta = planTotal(o.baseline) - planTotal(without)
  const moves: RoundMove[] = []
  for (let i = 0; i < without.slots.length; i++) {
    const out = without.after[i]
    const now = o.baseline.after[i]
    if (out !== now) moves.push({ slot: without.slots[i], out, in: now })
  }
  const at = o.baseline.after.findIndex(mine)
  return { delta: Math.round(delta * 100) / 100, moves, placed: at >= 0 ? o.baseline.slots[at] : null }
}

/** The copy of an item the character owns at the highest merge level, among the pieces the optimizer weighs. */
export function bestOwned(pieces: Piece[], key: string): Piece | null {
  let best: Piece | null = null
  for (const p of pieces) if (p.key === key && p.stats && (!best || mergeLevel(p.item.name) > mergeLevel(best.item.name))) best = p
  return best
}

type FinderCandidate = SlotResult['candidates'][number]
export type RoundCandidate = FinderCandidate & {
  round: { delta: number; placed: string | null; owned: boolean; moves: { slot: string; out: string | null; in: string | null }[] }
}
export type RoundSlot = Omit<SlotResult, 'candidates'> & { candidates: RoundCandidate[] }

/** One candidate among everything owned, worn as well as it can be: its worth is what the set gains. */
export function judgeInTheRound(c: FinderCandidate, slot: string, opts: OptimizeOptions, baseline: Plan): RoundCandidate {
  // One the character owns is already among the pieces: judged as their own copy, as the optimizer does.
  const key = itemKey(c.item.title)
  const mine = !!bestOwned(opts.pieces, key)
  const r = mine ? ownedInTheRound({ ...opts, key, baseline }) : inTheRound({ ...opts, candidate: candidatePiece(c.item, c.stats), baseline })
  // One the best set wears just where it is worn now is no upgrade, and one it wears in another
  // slot is that slot's.
  const stays = mine && (r.placed !== slot || baseline.after.some((p, i) => p?.key === key && p.from === 'worn' && !p.exalt && baseline.slots[i] === p.item.location))
  return {
    ...c,
    round: {
      delta: stays ? 0 : r.delta,
      placed: r.placed,
      owned: mine,
      moves: r.moves.map((m) => ({ slot: m.slot, out: m.out ? pieceName(m.out) : null, in: m.in ? pieceName(m.in) : null }))
    }
  }
}

/** A slot's candidates judged in the round: those that gain, the best first, six at most. */
export function bestInTheRound(candidates: RoundCandidate[]): RoundCandidate[] {
  // The best thing to have first, as the optimizer's all-gear mode would choose it: a piece to get
  // gains over the best set of what is owned, which already has the owned candidates in it, so
  // those rank after any piece to get that beats that set (their own gain still shows).
  const rank = (c: RoundCandidate) => (c.round.owned ? 0 : c.round.delta)
  return candidates
    .filter((c) => c.round.delta > 0)
    .sort((a, b) => rank(b) - rank(a) || b.round.delta - a.round.delta)
    .slice(0, 6)
}
