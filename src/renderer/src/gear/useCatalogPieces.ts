import { useMemo } from 'react'
import type { HandWeights, Wearer, Weights } from '../../../core/upgrades'
import type { Piece } from '../../../core/gearOptimizer'
import { catalogPieces as catalogPiecesOf } from '../../../core/gearCatalog'
import type { InventoryView } from '../../../shared/types'
import type { CatalogItem } from '../../../core/wikiItem'
import type { GearEffects } from './useEffectsModel'
import type { GearMode } from './useFinderResults'

export function useCatalogPieces({
  mode,
  items,
  shownEras,
  owned,
  zones,
  eraStatus,
  wearer,
  twoHanders,
  effectsOfItem,
  valueOf,
  effects,
  weights,
  compare,
  inv,
  weaponHands
}: {
  mode: GearMode
  items: CatalogItem[] | undefined
  shownEras: string[]
  owned: Set<string>
  zones: Map<string, string>
  eraStatus: Record<string, 'in' | 'out'> | undefined
  wearer: Wearer
  twoHanders: boolean
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  valueOf: (names: string[]) => number
  effects: GearEffects
  weights: Weights
  compare: 'drop' | 'level'
  inv: NonNullable<InventoryView['inventory']>
  weaponHands: HandWeights | null
}): Piece[] {
  // The optimizer's all-gear mode: the best of what the character does not own, slot by slot (core/gearCatalog).
  const catalogPieces = useMemo<Piece[]>(() => {
    if (mode !== 'optimize' || !items) return []
    return catalogPiecesOf({
      items, hiddenEras: shownEras, owned, zones, eraStatus, wearer, twoHanders, effectsOfItem, focusValue: valueOf, effects: effects.value, weights, compare,
      worn: inv.worn, hands: weaponHands
    })
  }, [mode, items, shownEras, owned, zones, eraStatus, wearer, twoHanders, effectsOfItem, valueOf, effects.value, weights, compare, inv, weaponHands])
  return catalogPieces
}
