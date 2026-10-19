import { useEffect, useRef, useState } from 'react'
import { api } from '../../../renderer/src/api'
import { showError } from '../../../renderer/src/toast'
import { useLatest } from '../../../renderer/src/hooks'
import type { PlanChoices, PlanSettings } from '../../../shared/settings'
import { STANDING_MAX } from '../core'
import type { FactionPlanData, PlanFor } from '../planner'
import { runPlan, Superseded } from '../planRunner'
import type { FactionPlan, PlanInput, PlanShape, PlanTarget } from '../planTypes'
import { followedPlan } from '../tracker'

// The Plan tab's three effects on the planner (LT-638): the plan itself, worked out again when what it
// is for changes; the plan handed to the main process when its steps change; and, once asked, what the
// race swaps save against the same plan without them.

/** What a plan is worked out from: the catalog, what it is for, and the choices and assumptions. */
export interface PlanAsk {
  data: FactionPlanData | null
  todo: PlanFor | null
  targets: PlanTarget[]
  extras: Pick<PlanInput, 'races' | 'unlocks'>
  settings: PlanSettings
  choices: PlanChoices
  /** What decides whether the order is kept: a change searches for the order again. */
  structure: string
}

const inputOf = (a: PlanAsk): PlanInput => ({
  targets: a.targets,
  maxed: a.todo!.maxed,
  standings: a.todo!.standings,
  activities: a.data!.catalog.activities,
  ...a.extras
})

/**
 * The plan, worked out in a worker (planRunner.ts) so a search does not freeze the page. The order is
 * kept while `structure` is the same; the plan shown stays until the next one arrives, and a plan
 * overtaken by newer inputs is dropped.
 */
export function usePlanSearch(a: PlanAsk): FactionPlan | null {
  const { data, todo, targets, extras, settings, choices, structure } = a
  const keptShape = useRef<{ key: string; shape: PlanShape } | null>(null)
  const [plan, setPlan] = useState<FactionPlan | null>(null)
  useEffect(() => {
    if (!data || !todo) return
    let current = true
    const keep = keptShape.current?.key === structure ? keptShape.current.shape : undefined
    runPlan(inputOf({ data, todo, targets, extras, settings, choices, structure }), settings, choices, keep, 'plan').then(
      (p) => {
        if (!current) return
        keptShape.current = { key: structure, shape: p.shape }
        // The order kept and the counts the same: the plan shown stays, and its hundred rows are not drawn again.
        setPlan((old) => (old && JSON.stringify(old) === JSON.stringify(p) ? old : p))
      },
      (e: unknown) => current && !(e instanceof Superseded) && showError('Could not work out the faction plan', e)
    )
    return () => {
      current = false
    }
  }, [data, todo, targets, extras, settings, choices, structure])
  return plan
}

/**
 * The plan shown is the one followed while the character is played: it goes to the main process
 * whenever its steps change, for the achievements overlay and its cues. A city's guards are followed
 * to their own standing; one a race unlock wants maxed as well, to 2000, as the plan has it.
 */
export function useFollowPlan(character: string, plan: FactionPlan | null, todo: PlanFor | null, cities: boolean): void {
  const followKey = plan ? JSON.stringify(plan.steps.map((st) => [st.activity.id, st.finishes, st.lifts, st.reaches])) : ''
  const following = useLatest({ plan, todo, cities })
  useEffect(() => {
    const { plan: p, todo: t, cities: c } = following.current
    if (!followKey || !p || !t) return
    const targets = c ? p.targets.filter((tg) => (tg.to ?? STANDING_MAX) < STANDING_MAX) : t.targets
    const timer = setTimeout(
      () => void api.invoke('factions:follow', character, followedPlan(p, targets)).catch((e: unknown) => showError('Could not hand the plan to the achievements overlay', e)),
      400
    )
    return () => clearTimeout(timer)
  }, [followKey, character, following])
}

/**
 * What the race swaps save against the same plan without them, worked out only once asked for (`on`):
 * a second run of the planner at every change of the plan is a third of a second each (LT-425).
 */
export function usePlanWithoutSwaps(a: PlanAsk, plan: FactionPlan | null, on: boolean): { seconds: number; unplanned: number } | null {
  const { data, todo, targets, extras, settings, choices, structure } = a
  const swapSteps = plan ? plan.steps.filter((st) => st.race).length : 0
  const swapKey = swapSteps && on ? structure : ''
  const [noSwap, setNoSwap] = useState<{ key: string; seconds: number; unplanned: number } | null>(null)
  useEffect(() => {
    if (!swapKey || !data || !todo || noSwap?.key === swapKey) return
    let current = true
    // Without swaps: every quest as the character's own race, when its standing gets there. A lock on one only another race opens now is dropped.
    const needSwap = new Set(data.catalog.activities.flatMap((x) => (x.blocked && x.swap?.length ? [x.id] : [])))
    runPlan(
      inputOf({ data, todo, targets, extras, settings, choices, structure }),
      { ...settings, raceSwaps: false },
      {
        ...choices,
        locks: Object.fromEntries(Object.entries(choices.locks).filter(([, id]) => !needSwap.has(id))),
        excluded: extras.races ? choices.excluded : [...choices.excluded, ...needSwap]
      },
      undefined,
      'noSwap'
    ).then(
      (p) => current && setNoSwap({ key: swapKey, seconds: p.seconds, unplanned: p.unplanned.length }),
      () => undefined
    )
    return () => {
      current = false
    }
  }, [swapKey, data, todo, targets, extras, settings, choices, structure, noSwap?.key])
  return noSwap && noSwap.key === swapKey ? noSwap : null
}
