import { useMemo } from 'react'
import { useInvoke } from '../hooks'
import type { StatsInputs } from '../../../core/statsInputs'
import type { Weights } from '../../../core/gearFinder'
import type { EffectValue, Piece } from '../../../core/gearOptimizer'
import type { EffectSpell, EffectWorth } from '../../../core/itemEffects'
import type { MeleeProfile } from '../../../core/meleeTally'
import { effectScorers, type EffectInputs } from '../../../core/effectScorers'
import { HANDS } from '../../../core/gearCatalog'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'

export interface GearEffects {
  /** The character's melee over the days looked at; null while it is read or when there is no log. */
  profile: MeleeProfile | null
  spells: Record<string, EffectSpell>
  /** Worth in the weights' terms, for the finder and the optimiser; null until the spell file is read. */
  value: EffectValue | null
  /** What `value` is worked out from, for the gear worker to work it out alike; null with `value`. */
  inputs: EffectInputs | null
  /** What each does and the damage a minute it adds (0 with no melee to weigh against), by spell name. */
  wornWorth: (name: string) => EffectWorth | null
  procWorth: (name: string) => EffectWorth | null
  /** Worth in the weights' terms, all told and (for a worn effect) the part that is stats. */
  wornScore: (name: string) => number
  wornStatScore: (name: string) => number
  procScore: (name: string) => number
  /** Weapons in hand now that carry a proc, by name. */
  carriers: Map<string, number>
  dex: number
  loading: boolean
}

export function useEffectsModel({
  view,
  items,
  effectsOfItem,
  days,
  sheetStats,
  pieces,
  level,
  weights
}: {
  view: InventoryView
  items: CatalogItem[] | undefined
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  days: number
  sheetStats: StatsInputs
  pieces: Piece[]
  level: number
  weights: Weights
}): GearEffects {
  // Worn effects and procs: every one the catalog names, what its spell does, and the character's own
  // melee over the same days as the focus effects, to weigh them against.
  const effectNames = useMemo(() => {
    const out = new Set<string>()
    for (const it of items ?? []) {
      const fx = effectsOfItem(it.title)
      if (fx?.worn) out.add(fx.worn)
      if (fx?.proc) out.add(fx.proc)
    }
    return [...out].sort()
  }, [items, effectsOfItem])
  const effectsQ = useInvoke(effectNames.length && view.character ? 'gear:effects' : null, [effectNames, view.character, days])
  const dex = sheetStats.window?.values.Dexterity?.[0] ?? (sheetStats.dexterity || 150)
  const effects = useMemo<GearEffects>(() => {
    const data = effectsQ.data
    const profile = data?.profile ?? null
    const spells = data?.spells ?? {}
    const carriers = new Map<string, number>()
    for (const p of pieces) if (p.from === 'worn' && HANDS.includes(p.item.location)) for (const n of p.procs ?? []) carriers.set(n, (carriers.get(n) ?? 0) + 1)
    const inputs: EffectInputs = { spells, profile, level, dex, carriers: [...carriers] }
    const s = effectScorers(inputs, weights)
    return {
      profile,
      spells,
      value: data ? s.value : null,
      inputs: data ? inputs : null,
      wornWorth: s.wornWorth,
      procWorth: s.procWorth,
      wornScore: s.wornScore,
      wornStatScore: s.wornStatScore,
      procScore: s.procScore,
      carriers,
      dex,
      loading: !data
    }
  }, [effectsQ.data, pieces, level, dex, weights])
  return effects
}
