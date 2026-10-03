import { encodePlan, judgeRound, optionsOf, type GearInput, type PlanWire, type RoundAnswer, type RoundAsk } from '../../../core/gearWork'
import { optimizeGear } from '../../../core/gearOptimizer'

// The gear optimiser, off the page's thread (LT-390, LT-391): a search with All gear or exaltations
// takes a few hundred milliseconds, and judging the finder's candidates in the round runs one per
// candidate. gearRunner.ts on the page sends the work and gets the answers back.

export type GearRequest = { id: number; kind: 'plan'; input: GearInput } | { id: number; kind: 'round'; input: GearInput; asks: RoundAsk[] }

export type GearReply =
  | { id: number; plan: PlanWire; ms: number }
  | { id: number; round: RoundAnswer[]; ms: number }
  /** A newer round was asked for before this one finished. */
  | { id: number; dropped: true }
  | { id: number; error: string }

/** The worker's own global: a page's type lists would take `self` for a window. */
const scope = self as unknown as { onmessage: ((e: MessageEvent<GearRequest>) => void) | null; postMessage(reply: GearReply): void }

/** How long the round runs before it looks for newer work. */
const SLICE_MS = 40

let latestRound = 0

scope.onmessage = (e) => {
  const r = e.data
  const started = performance.now()
  const fail = (err: unknown) => scope.postMessage({ id: r.id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) })
  if (r.kind === 'plan') {
    try {
      const plan = optimizeGear(optionsOf(r.input))
      scope.postMessage({ id: r.id, plan: encodePlan(plan, r.input.pieces, r.input.exaltations), ms: performance.now() - started })
    } catch (err) {
      fail(err)
    }
    return
  }
  // A round gives way to the next: a weight being dragged asks again and again, and only the last counts.
  latestRound = r.id
  let sliceEnd = started + SLICE_MS
  const between = async () => {
    if (performance.now() > sliceEnd) {
      // Lets a waiting message in: a plan to work out, or a newer round.
      await new Promise((resolve) => setTimeout(resolve, 0))
      sliceEnd = performance.now() + SLICE_MS
    }
    return latestRound === r.id
  }
  judgeRound(r.input, r.asks, between).then((round) => scope.postMessage(round ? { id: r.id, round, ms: performance.now() - started } : { id: r.id, dropped: true }), fail)
}
