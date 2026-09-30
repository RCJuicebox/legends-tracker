import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { statsFor } from '../../../core/wornGear'
import type { InvItem } from '../../../core/inventory'
import { findUpgrades, type HandWeights, type Wearer, type Weights } from '../../../core/upgrades'
import type { FocusWorth } from '../../../core/itemFocus'
import { optimizeGear, type Exaltation, type Piece } from '../../../core/gearOptimizer'
import { itemEffects } from '../../../core/itemEffects'
import { bestInTheRound, bestOwned, judgeInTheRound, type RoundCandidate, type RoundSlot } from '../../../core/finderRound'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'
import type { GearEffects } from './useEffectsModel'

export type GearMode = 'finder' | 'focus' | 'effects' | 'procs' | 'optimize' | 'merge' | 'pet'

/** How long one slice of judging in the round may hold the page. */
const SLICE_MS = 10

/** Lets the page handle input and draw before the next slice of work. */
function nextSlice(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (s?.yield) return s.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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
    const opts = {
      pieces: d.pieces,
      wearer: d.wearer,
      weights: d.weights,
      twoHanders: d.twoHanders,
      focusValue: d.valueOf,
      exaltations: d.exaltations,
      effects: d.effects.value ?? undefined,
      hands: d.hands
    }
    return { slots, round: round ? opts : null }
  }, [deferred, classes.length, mode])

  // Judging in the round runs the optimiser once a candidate (some 150 ms in all), so it is done a
  // slice at a time with the page free in between; the last results stay up, marked stale, meanwhile.
  const [judged, setJudged] = useState<{ of: NonNullable<typeof found>; slots: RoundSlot[] } | null>(null)
  useEffect(() => {
    const opts = found?.round
    if (!found || !opts) return
    let stopped = false
    void (async () => {
      await nextSlice()
      const baseline = optimizeGear(opts)
      const out: RoundSlot[] = []
      let sliceEnd = performance.now() + SLICE_MS
      for (const s of found.slots) {
        const candidates: RoundCandidate[] = []
        for (const c of s.candidates) {
          if (performance.now() > sliceEnd) {
            await nextSlice()
            if (stopped) return
            sliceEnd = performance.now() + SLICE_MS
          }
          candidates.push(judgeInTheRound(c, s.slot, opts, baseline))
        }
        out.push({ ...s, candidates: bestInTheRound(candidates) })
      }
      if (!stopped) setJudged({ of: found, slots: out })
    })()
    return () => {
      stopped = true
    }
  }, [found])
  const results = !found ? null : !found.round ? found.slots : (judged?.slots ?? null)
  const judging = !!found?.round && judged?.of !== found

  return { results, stale: deferred !== input || judging }
}
