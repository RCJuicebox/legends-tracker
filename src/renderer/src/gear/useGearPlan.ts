import { useEffect, useState } from 'react'
import type { GearInput } from '../../../core/gearWork'
import type { Plan } from '../../../core/gearOptimizer'
import { runGearPlan } from './gearRunner'

/**
 * The best set for `input`, worked out in the gear worker (LT-390): the window stays free while it
 * runs, and the last plan stays up, marked stale, until the new one comes. Null until the first.
 */
export function useGearPlan(input: GearInput): { plan: Plan | null; stale: boolean; error: string | null } {
  const [done, setDone] = useState<{ of: GearInput; plan: Plan | null; error: string | null } | null>(null)
  useEffect(() => {
    let current = true
    runGearPlan(input).then(
      (plan) => current && setDone({ of: input, plan, error: null }),
      (err: unknown) => current && setDone((d) => ({ of: input, plan: d?.plan ?? null, error: err instanceof Error ? err.message : String(err) }))
    )
    return () => {
      current = false
    }
  }, [input])
  return { plan: done?.plan ?? null, stale: done?.of !== input, error: done?.error ?? null }
}
