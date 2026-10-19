import { decodePlan, judgeRound, optionsOf, type GearInput, type RoundAnswer, type RoundAsk } from '../../../core/gearWork'
import { optimizeGear, type Plan } from '../../../core/gearOptimizer'
import type { GearReply, GearRequest } from './gearWorker'
import { workerClient } from '../workerClient'

// The page's side of the gear worker (gearWorker.ts), through workerClient.ts as the faction planner's
// is. Should the worker fail to load, the work is done on the page as before, slower but right.

/** A round given up for a newer one: nothing to show for it. */
export class Dropped extends Error {}

const gear = workerClient<GearRequest, GearReply>('The gear optimiser', () => new Worker(new URL('./gearWorker.ts', import.meta.url), { type: 'module' }))

const failed = (r: GearReply): r is { id: number; error: string } => 'error' in r

/** The best set, worked out in the worker; the plan's pieces are those in `input`. */
export async function runGearPlan(input: GearInput): Promise<Plan> {
  if (!gear.broken) {
    try {
      const r = await gear.ask({ kind: 'plan', input })
      if (failed(r)) throw new Error(r.error)
      if ('plan' in r) {
        // What a plan costs, where it now runs (README, Measuring); a source run's console only.
        if (import.meta.env.DEV) console.info(`Gear plan: ${Math.round(r.ms)} ms in the worker, ${input.pieces.length} pieces`)
        return decodePlan(r.plan, input.pieces, input.exaltations)
      }
    } catch (err) {
      if (!gear.broken) throw err
    }
  }
  return optimizeGear(optionsOf(input))
}

/** The finder's candidates judged in the round, in the worker; rejects with Dropped when a newer round overtook it. */
export async function runRound(input: GearInput, asks: RoundAsk[]): Promise<RoundAnswer[]> {
  if (!gear.broken) {
    try {
      const r = await gear.ask({ kind: 'round', input, asks })
      if (failed(r)) throw new Error(r.error)
      if ('dropped' in r) throw new Dropped()
      if ('round' in r) {
        if (import.meta.env.DEV) console.info(`Gear round: ${Math.round(r.ms)} ms in the worker, ${asks.reduce((n, s) => n + s.candidates.length, 0)} candidates`)
        return r.round
      }
    } catch (err) {
      if (!gear.broken) throw err
    }
  }
  const round = await judgeRound(input, asks, () => true)
  return round ?? []
}

/** Whether the worker is up and answering: the smoke test asks (LT-630). */
export async function pingGearWorker(): Promise<boolean> {
  const r = await gear.ask({ kind: 'ping' })
  return 'pong' in r
}
