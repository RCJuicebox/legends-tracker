import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { statsFor } from '../../../core/wornGear'
import type { InvItem } from '../../../core/inventory'
import { findUpgrades, type HandWeights, type Wearer, type Weights } from '../../../core/gearFinder'
import type { FocusWorth } from '../../../core/itemFocus'
import type { Exaltation, Piece } from '../../../core/gearOptimizer'
import { itemEffects } from '../../../core/itemEffects'
import { bestOwned, type RoundSlot } from '../../../core/finderRound'
import type { GearInput } from '../../../core/gearWork'
import { Dropped, runRound } from './gearRunner'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'
import type { GearEffects } from './useEffectsModel'

export type GearMode = 'finder' | 'focus' | 'effects' | 'procs' | 'optimize' | 'merge' | 'pet'

export function useFinderResults({
  mode,
  classes,
  items,
  wearer,
  weights,
  compare,
  hiddenEras,
  inv,
  view,
  owned,
  twoHanders,
  worth,
  fociOf,
  valueOf,
  eraStatus,
  pieces,
  exaltations,
  judge,
  effects,
  effectsOfItem,
  weaponHands
}: {
  mode: GearMode
  classes: string[]
  items: CatalogItem[] | undefined
  wearer: Wearer
  weights: Weights
  compare: 'drop' | 'level'
  hiddenEras: string[]
  inv: NonNullable<InventoryView['inventory']>
  view: InventoryView
  owned: Set<string>
  twoHanders: boolean
  worth: FocusWorth | null
  fociOf: (item: InvItem) => { name: string; via: string }[]
  valueOf: (names: string[]) => number
  eraStatus: Record<string, 'in' | 'out'> | undefined
  pieces: Piece[]
  exaltations: Exaltation[]
  judge: 'slot' | 'round'
  effects: GearEffects
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  weaponHands: HandWeights | null
}) {
  // The finder scores the whole catalog (about 11,000 pieces) against every slot. Its inputs go
  // through a deferred value, so a weight being typed or a button being pressed answers at once and
  // the results catch up in the background.
  const input = useMemo(
    () => ({
      items,
      wearer,
      weights,
      compare,
      hiddenEras,
      inv,
      viewItems: view.items,
      owned,
      twoHanders,
      worth,
      fociOf,
      valueOf,
      eraStatus,
      pieces,
      exaltations,
      judge,
      effects,
      effectsOfItem,
      hands: weaponHands
    }),
    [
      items,
      wearer,
      weights,
      compare,
      hiddenEras,
      inv,
      view.items,
      owned,
      twoHanders,
      worth,
      fociOf,
      valueOf,
      eraStatus,
      pieces,
      exaltations,
      judge,
      effects,
      effectsOfItem,
      weaponHands
    ]
  )
  const deferred = useDeferredValue(input)
  const found = useMemo(() => {
    const d = deferred
    if (!d.items || !classes.length || mode !== 'finder') return null
    const round = d.judge === 'round'
    const slots = findUpgrades({
      worn: d.inv.worn,
      statsOf: (it) => statsFor(d.viewItems, it.name),
      catalog: d.items,
      wearer: d.wearer,
      weights: d.weights,
      compare: d.compare,
      hiddenEras: d.hiddenEras,
      eraStatus: d.eraStatus,
      twoHanders: d.twoHanders,
      owned: d.owned,
      ownedStats: (key) => bestOwned(d.pieces, key)?.stats ?? null,
      hands: d.hands,
      focus: d.worth ? { worn: (it) => d.fociOf(it).map((f) => f.name), value: d.valueOf } : undefined,
      effects: d.effects.value
        ? {
            of: (it) => {
              const fx = itemEffects(it, d.effectsOfItem)
              return { worn: fx.worn.map((f) => f.name), procs: fx.procs.map((f) => f.name) }
            },
            value: d.effects.value
          }
        : undefined,
      // In the round, the stat winners a focus loss would hide get their chance: the optimiser may keep the focus elsewhere.
      perSlot: round ? 8 : 6,
      keepStatWinners: round
    })
    // Each candidate among everything owned, worn as well as it can be; its worth is what the set gains.
    const input: GearInput = {
      pieces: d.pieces,
      wearer: d.wearer,
      weights: d.weights,
      twoHanders: d.twoHanders,
      worth: d.worth,
      exaltations: d.exaltations,
      effects: d.effects.inputs,
      hands: d.hands
    }
    return { slots, round: round ? input : null }
  }, [deferred, classes.length, mode])

  // Judging in the round runs the optimiser once a candidate (0.4 to 3 s in all), so it is done in
  // the gear worker, a newer ask overtaking an older (LT-391); the last results stay up, marked
  // stale, meanwhile.
  const [judged, setJudged] = useState<{ of: NonNullable<typeof found>; slots: RoundSlot[] } | null>(null)
  useEffect(() => {
    const input = found?.round
    if (!found || !input) return
    let stopped = false
    runRound(
      input,
      found.slots.map((s) => ({ slot: s.slot, candidates: s.candidates }))
    ).then(
      (answers) => {
        if (stopped) return
        setJudged({ of: found, slots: found.slots.map((s, k) => ({ ...s, candidates: (answers[k] ?? []).map((a) => ({ ...s.candidates[a.k], round: a.round })) })) })
      },
      (err: unknown) => {
        if (stopped || err instanceof Dropped) return
        // Shown as no upgrades rather than worked on for ever; what went wrong is in the console.
        console.warn('Judging in the round failed:', err)
        setJudged({ of: found, slots: found.slots.map((s) => ({ ...s, candidates: [] })) })
      }
    )
    return () => {
      stopped = true
    }
  }, [found])
  const results = !found ? null : !found.round ? found.slots : (judged?.slots ?? null)
  const judging = !!found?.round && judged?.of !== found

  return { results, stale: deferred !== input || judging }
}
