import { focusValue, type FocusWorth } from './itemFocus'
import { effectScorers, type EffectInputs } from './effectScorers'
import { exaltedCopy, optimizeGear, optimizerCache, type ExaltSlot, type Exaltation, type OptimizeOptions, type Piece, type Plan } from './gearOptimizer'
import { bestInTheRound, judgeInTheRound, type RoundCandidate } from './finderRound'
import type { SlotResult } from './gearFinder'
import type { HandWeights, Wearer, Weights } from './gearFinder'

// The gear optimiser's work as plain data, for the gear worker (LT-390, LT-391): the page sends what a
// search weighs, and the worker builds the focus and effect worth from it (functions cannot be sent),
// runs the search and sends the plan back as places in the page's own lists, so the pieces in it are
// the page's own.

/** Everything a search weighs, as data. */
export interface GearInput {
  pieces: Piece[]
  exaltations: Exaltation[]
  wearer: Wearer
  weights: Weights
  twoHanders: boolean
  hands: HandWeights | null
  /** What foci are worth; null leaves them out. */
  worth: FocusWorth | null
  /** What worn effects and procs are worth; null leaves them out. */
  effects: EffectInputs | null
  /** Pieces locked into a slot, by their place in `pieces`. */
  locks?: { slot: number; piece: number }[]
}

/** A piece in a plan: its place in `pieces`, or an exalted copy of one. */
type PieceRef = number | { host: number; exalt: number; slot: ExaltSlot } | null

export type PlanWire = Omit<Plan, 'before' | 'after'> & { before: PieceRef[]; after: PieceRef[] }

/** The optimiser's options from a search's data. */
export function optionsOf(i: GearInput): OptimizeOptions {
  const worth = i.worth
  return {
    pieces: i.pieces,
    exaltations: i.exaltations,
    wearer: i.wearer,
    weights: i.weights,
    twoHanders: i.twoHanders,
    hands: i.hands,
    focusValue: (names) => (worth ? focusValue(worth, names) : 0),
    effects: i.effects ? effectScorers(i.effects, i.weights).value : undefined,
    locks: (i.locks ?? []).flatMap((l) => (i.pieces[l.piece] ? [{ slot: l.slot, piece: i.pieces[l.piece] }] : []))
  }
}

export function encodePlan(plan: Plan, pieces: Piece[], exaltations: Exaltation[]): PlanWire {
  const at = new Map(pieces.map((p, k) => [p, k] as const))
  const ref = (p: Piece | null): PieceRef => {
    if (!p) return null
    if (p.host && p.exalt && p.exaltSlot) return { host: at.get(p.host) ?? -1, exalt: exaltations.indexOf(p.exalt), slot: p.exaltSlot }
    return at.get(p) ?? -1
  }
  return { ...plan, before: plan.before.map(ref), after: plan.after.map(ref) }
}

/** A plan from the worker, with the page's own pieces in it. */
export function decodePlan(w: PlanWire, pieces: Piece[], exaltations: Exaltation[]): Plan {
  const piece = (r: PieceRef): Piece | null => {
    if (r === null) return null
    if (typeof r === 'number') return pieces[r] ?? null
    const h = pieces[r.host]
    const e = exaltations[r.exalt]
    return h && e ? exaltedCopy(h, e, r.slot) : null
  }
  return { ...w, before: w.before.map(piece), after: w.after.map(piece) }
}

type FinderCandidate = SlotResult['candidates'][number]

/** A slot's candidates to judge in the round. */
export interface RoundAsk {
  slot: string
  candidates: FinderCandidate[]
}

/** A slot's candidates judged: the best, by their place in the slot's list, with what each does in the round. */
export type RoundAnswer = { k: number; round: RoundCandidate['round'] }[]

/**
 * Every candidate judged in the round, a slot at a time. `between` runs before each candidate and
 * stops the work by answering false (a newer ask came in).
 */
export async function judgeRound(input: GearInput, asks: RoundAsk[], between: () => Promise<boolean> | boolean): Promise<RoundAnswer[] | null> {
  // Every search here weighs alike, so what one works out (a piece's score in a slot, a set of foci)
  // serves the rest.
  const opts = { ...optionsOf(input), locks: undefined, cache: optimizerCache() }
  const baseline = optimizeGear(opts)
  const out: RoundAnswer[] = []
  for (const s of asks) {
    const judged: (RoundCandidate & { k: number })[] = []
    for (let k = 0; k < s.candidates.length; k++) {
      if (!(await between())) return null
      judged.push({ ...judgeInTheRound(s.candidates[k], s.slot, opts, baseline), k })
    }
    out.push((bestInTheRound(judged) as (RoundCandidate & { k: number })[]).map((c) => ({ k: c.k, round: c.round })))
  }
  return out
}
