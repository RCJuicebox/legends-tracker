import { useMemo } from 'react'
import { useInvoke } from '../hooks'
import type { StatsSheet } from '../../../core/statsSheet'
import { score, type Weights } from '../../../core/upgrades'
import type { EffectValue, Piece } from '../../../core/gearOptimizer'
import { effectScore, procWorth, wornStats, wornWorth, type EffectSpell, type EffectWorth } from '../../../core/itemEffects'
import { meleeProfile, type MeleeProfile } from '../../../core/meleeTally'
import { HANDS } from '../../../core/gearCatalog'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'

export interface GearEffects {
  /** The character's melee over the days looked at; null while it is read or when there is no log. */
  profile: MeleeProfile | null
  spells: Record<string, EffectSpell>
  /** Worth in the weights' terms, for the finder and the optimizer; null until the spell file is read. */
  value: EffectValue | null
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

const NO_MELEE = meleeProfile({}, { from: '', to: '' })

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
  sheetStats: StatsSheet
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
    // With no melee in the log, what an effect does is still shown and its stats still count.
    const melee = profile ?? NO_MELEE
    const wornWorthOf = (name: string) => (spells[name] ? wornWorth(spells[name], melee, level) : null)
    const procWorthOf = (name: string) => (spells[name] ? procWorth(spells[name], melee, { level, dex, carriers: carriers.get(name) ?? 1 }) : null)
    // Stats a worn effect gives are priced as on an item: set-wide, so no weapon ratio or haste.
    const statWeights = { ...weights, ratio: 0, rangedRatio: 0, haste: 0 }
    const wornStatScore = (name: string) => (spells[name] ? score(wornStats(spells[name], level), statWeights) : 0)
    const wornScore = (name: string) => effectScore(wornWorthOf(name)?.dpm ?? 0, melee, weights.ratio) + wornStatScore(name)
    const procScore = (name: string) => effectScore(procWorthOf(name)?.dpm ?? 0, melee, weights.ratio)
    const value: EffectValue | null = data ? { worn: (names) => names.reduce((s, n) => s + wornScore(n), 0), proc: procScore } : null
    return { profile, spells, value, wornWorth: wornWorthOf, procWorth: procWorthOf, wornScore, wornStatScore, procScore, carriers, dex, loading: !data }
  }, [effectsQ.data, pieces, level, dex, weights])
  return effects
}
