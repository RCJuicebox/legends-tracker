import type { PlanChoices, PlanSettings } from '../../shared/settings'
import type { FactionPlan, PlanInput, PlanShape } from './planTypes'
import type { PlanReply, PlanRequest } from './planWorker'

// The page's side of the planner worker (planWorker.ts): one worker, made when first needed and kept,
// each plan asked for by number so replies find their callers.

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { resolve: (p: FactionPlan) => void; reject: (e: Error) => void }>()
const pings = new Map<number, (up: boolean) => void>()

function start(): Worker {
  const w = new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<PlanReply>) => {
    const r = e.data
    if ('pong' in r) {
      pings.get(r.id)?.(true)
      pings.delete(r.id)
      return
    }
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

/** What a plan asked for in a lane gets when a newer ask in the lane overtakes it before it is begun. */
export class Superseded extends Error {
  constructor() {
    super('A newer plan was asked for')
  }
}

/** Each lane's ask in the worker, and the newest one waiting behind it. */
const lanes = new Map<string, { busy: boolean; next?: { go: () => void; reject: (e: Error) => void } }>()

/**
 * A plan, worked out in the worker. In a `lane`, one ask runs at a time and only the newest waits
 * behind it, the ones it overtakes failing with Superseded: toggling a choice twice while a second's
 * search runs waits for that one and the last, not every one between (LT-547).
 */
export function runPlan(input: PlanInput, settings: PlanSettings, choices: PlanChoices, keep?: PlanShape, lane?: string): Promise<FactionPlan> {
  const send = () => {
    worker ??= start()
    const id = ++next
    const request: PlanRequest = { id, input, settings, choices, ...(keep ? { keep } : {}) }
    return new Promise<FactionPlan>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      worker!.postMessage(request)
    })
  }
  if (!lane) return send()
  let l = lanes.get(lane)
  if (!l) lanes.set(lane, (l = { busy: false }))
  const at = l
  return new Promise((resolve, reject) => {
    const go = () => {
      at.busy = true
      send()
        .then(resolve, reject)
        .finally(() => {
          at.busy = false
          const n = at.next
          at.next = undefined
          n?.go()
        })
    }
    if (!at.busy) return go()
    at.next?.reject(new Superseded())
    at.next = { go, reject }
  })
}

/** Whether the worker is up and answering: the smoke test asks (LT-630). */
export function pingPlanWorker(): Promise<boolean> {
  worker ??= start()
  const id = ++next
  return new Promise((resolve) => {
    pings.set(id, resolve)
    worker!.postMessage({ id, ping: true } satisfies PlanRequest)
  })
}
