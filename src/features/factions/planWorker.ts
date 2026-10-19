import type { PlanChoices, PlanSettings } from '../../shared/settings'
import type { FactionPlan, PlanInput, PlanShape } from './planTypes'
import { planFactions } from './planner'

// The faction planner, off the page's thread: a search can take a good part of a second, and the
// Plan tab would freeze while it ran. planRunner.ts on the page sends it the plan's inputs and
// gets the plan back.

export type PlanRequest =
  | {
      id: number
      input: PlanInput
      settings: PlanSettings
      choices: PlanChoices
      keep?: PlanShape
    }
  /** Is the worker up? (The smoke test asks, LT-630.) */
  | { id: number; ping: true }

export type PlanReply = { id: number; plan: FactionPlan; ms: number } | { id: number; error: string } | { id: number; pong: true }

/** The worker's own global: a page's type lists would take `self` for a window. */
const scope = self as unknown as { onmessage: ((e: MessageEvent<PlanRequest>) => void) | null; postMessage(reply: PlanReply): void }

scope.onmessage = (e) => {
  if ('ping' in e.data) return scope.postMessage({ id: e.data.id, pong: true })
  const { id, input, settings, choices, keep } = e.data
  const started = performance.now()
  try {
    scope.postMessage({ id, plan: planFactions(input, settings, choices, keep), ms: performance.now() - started })
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) })
  }
}
