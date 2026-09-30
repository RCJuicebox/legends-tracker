import type { FactionPlan, PlanChoices, PlanInput, PlanSettings, PlanShape } from './planner'
import type { PlanReply, PlanRequest } from './planWorker'

// The page's side of the planner worker (planWorker.ts): one worker, made when first needed and kept,
// each plan asked for by number so replies find their callers.

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { resolve: (p: FactionPlan) => void; reject: (e: Error) => void }>()

function start(): Worker {
  const w = new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<PlanReply>) => {
    const r = e.data
    const call = waiting.get(r.id)
    if (!call) return
    waiting.delete(r.id)
    if ('error' in r) call.reject(new Error(r.error))
    else {
      // What a plan costs, where it now runs (README, Measuring); a source run's console only.
      if (import.meta.env.DEV) console.info(`Faction plan: ${Math.round(r.ms)} ms in the worker, ${r.plan.steps.length} steps, ${r.plan.kept ? 'order kept' : 'searched'}`)
      call.resolve(r.plan)
    }
  }
  // A worker that fails to load or dies fails every plan waiting on it; the next ask makes another.
  w.onerror = (e) => {
    e.preventDefault()
    const err = new Error(`The faction planner stopped: ${e.message || 'it could not be loaded'}`)
    for (const call of waiting.values()) call.reject(err)
    waiting.clear()
    w.terminate()
    if (worker === w) worker = null
  }
  return w
}

/** A plan, worked out in the worker. */
export function runPlan(input: PlanInput, settings: PlanSettings, choices: PlanChoices, keep?: PlanShape): Promise<FactionPlan> {
  worker ??= start()
  const id = ++next
  const request: PlanRequest = { id, input, settings, choices, ...(keep ? { keep } : {}) }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage(request)
  })
}
