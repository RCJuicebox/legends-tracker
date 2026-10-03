import { decodePlan, judgeRound, optionsOf, type GearInput, type RoundAnswer, type RoundAsk } from '../../../core/gearWork'
import { optimizeGear, type Plan } from '../../../core/gearOptimizer'
import type { GearReply, GearRequest } from './gearWorker'

// The page's side of the gear worker (gearWorker.ts), as planRunner.ts is the faction planner's: one
// worker, made when first needed and kept, each ask by number. Should the worker fail to load, the
// work is done on the page as before, slower but right.

/** A round given up for a newer one: nothing to show for it. */
export class Dropped extends Error {}

let worker: Worker | null = null
let broken = false
let next = 0
const waiting = new Map<number, { resolve: (r: GearReply) => void; reject: (e: Error) => void }>()

function start(): Worker {
  const w = new Worker(new URL('./gearWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<GearReply>) => {
    const call = waiting.get(e.data.id)
    if (!call) return
    waiting.delete(e.data.id)
    call.resolve(e.data)
  }
  w.onerror = (e) => {
    e.preventDefault()
    const err = new Error(`The gear optimiser stopped: ${e.message || 'it could not be loaded'}`)
    console.warn(err.message)
    for (const call of waiting.values()) call.reject(err)
    waiting.clear()
    w.terminate()
    if (worker === w) worker = null
    broken = true
  }
  return w
}

/** A request before it has a number: each kind keeps its own fields. */
type Ask = GearRequest extends infer R ? (R extends GearRequest ? Omit<R, 'id'> : never) : never

function ask(request: Ask): Promise<GearReply> {
  worker ??= start()
  const id = ++next
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ ...request, id } as GearRequest)
  })
}

const failed = (r: GearReply): r is { id: number; error: string } => 'error' in r

/** The best set, worked out in the worker; the plan's pieces are those in `input`. */
export async function runGearPlan(input: GearInput): Promise<Plan> {
  if (!broken) {
    try {
      const r = await ask({ kind: 'plan', input })
      if (failed(r)) throw new Error(r.error)
      if ('plan' in r) {
        // What a plan costs, where it now runs (README, Measuring); a source run's console only.
        if (import.meta.env.DEV) console.info(`Gear plan: ${Math.round(r.ms)} ms in the worker, ${input.pieces.length} pieces`)
        return decodePlan(r.plan, input.pieces, input.exaltations)
      }
    } catch (err) {
      if (!broken) throw err
    }
  }
  return optimizeGear(optionsOf(input))
}

/** The finder's candidates judged in the round, in the worker; rejects with Dropped when a newer round overtook it. */
export async function runRound(input: GearInput, asks: RoundAsk[]): Promise<RoundAnswer[]> {
  if (!broken) {
    try {
      const r = await ask({ kind: 'round', input, asks })
      if (failed(r)) throw new Error(r.error)
      if ('dropped' in r) throw new Dropped()
      if ('round' in r) {
        if (import.meta.env.DEV) console.info(`Gear round: ${Math.round(r.ms)} ms in the worker, ${asks.reduce((n, s) => n + s.candidates.length, 0)} candidates`)
        return r.round
      }
    } catch (err) {
      if (!broken) throw err
    }
  }
  const round = await judgeRound(input, asks, () => true)
  return round ?? []
}
