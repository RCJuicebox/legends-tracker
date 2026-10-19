import type { PlanChoices, PlanSettings } from '../../shared/settings'
import type { FactionPlan, PlanInput, PlanShape } from './planTypes'
import type { PlanReply, PlanRequest } from './planWorker'
import { workerClient } from '../../renderer/src/workerClient'
import { planFactions } from './planner'

// The page's side of the planner worker (planWorker.ts), through workerClient.ts: one worker, made when
// first needed and kept. Should it fail to load, plans are worked out on the page, slower but right,
// rather than every plan failing (LT-637).

const planner = workerClient<PlanRequest, PlanReply>('The faction planner', () => new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module' }))

/** One plan: in the worker, or on the page once the worker has failed (the page has planner.ts already, for planFor). */
async function plan(input: PlanInput, settings: PlanSettings, choices: PlanChoices, keep?: PlanShape): Promise<FactionPlan> {
  if (!planner.broken)
    try {
      const r = await planner.ask({ input, settings, choices, ...(keep ? { keep } : {}) })
      if ('error' in r) throw new Error(r.error)
      if ('plan' in r) {
        // What a plan costs, where it now runs (README, Measuring); a source run's console only.
        if (import.meta.env.DEV) console.info(`Faction plan: ${Math.round(r.ms)} ms in the worker, ${r.plan.steps.length} steps, ${r.plan.kept ? 'order kept' : 'searched'}`)
        return r.plan
      }
      throw new Error('The faction planner answered something else')
    } catch (err) {
      if (!planner.broken) throw err
    }
  return planFactions(input, settings, choices, keep)
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
  const send = () => plan(input, settings, choices, keep)
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
export async function pingPlanWorker(): Promise<boolean> {
  return 'pong' in (await planner.ask({ ping: true }))
}
