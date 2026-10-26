import { useDeferredValue, useMemo } from 'react'
import { useRemembered } from '../remember'
import type { InvItem } from '../../../core/inventory'
import { DEFAULT_HIDDEN_ERAS, restrictions, type HandWeights, type Wearer, type Weights } from '../../../core/gearFinder'
import { itemKey } from '../../../core/inventory'
import { withLootSince } from '../../../core/loot'
import type { FocusLine, FocusWorth } from '../../../core/itemFocus'
import type { Exaltation, Piece } from '../../../core/gearOptimizer'
import { usePet } from './usePet'
import type { CatalogItem } from '../../../core/wikiItem'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import type { FocusData } from '../../../shared/ipc'
import { useCatalog } from './useCatalog'
import { useCharacterWeights, type HandInfo } from './useCharacterWeights'
import { useCatalogItems } from './useCatalogItems'
import { useOwnedGear } from './useOwnedGear'
import { useFocusModel, type FocusCandidate, type OwnedFocus } from './useFocusModel'
import { useEffectsModel, type GearEffects } from './useEffectsModel'
import { useCatalogPieces } from './useCatalogPieces'
import { useFinderResults, type GearMode } from './useFinderResults'
import type { OwnEffects } from '../../../core/itemEffects'

// Everything the upgrade finder, the focus effects tab and the optimiser work out, apart from how
// they show it. Each concern is its own hook (the catalog, the character's weights, the catalog's
// items, what is owned, focus effects, worn effects and procs, the optimizer's catalog pieces, the
// finder's results); this puts them together.

export type { FocusCandidate, GearMode, OwnedFocus }

/** Everything the finder, the focus tab and the optimiser share. */
export interface GearModel {
  view: InventoryView
  classes: string[]
  level: number
  wearer: Wearer
  weights: Weights
  twoHanders: boolean
  catalog: CatalogItem[]
  /** Focus names an item carries: its own and its exaltations'. */
  fociOf: (item: InvItem) => { name: string; via: string }[]
  report: FocusData | null
  /** Days of casting the foci are judged on; 0 for all of it. */
  days: number
  setDays: (n: number) => void
  /** Lines that improve at least one of the character's spells. */
  lines: FocusLine[]
  /** Lines that improve none of them. */
  idleLines: FocusLine[]
  wanted: Set<string>
  setWanted: (keys: string[], on: boolean) => void
  resetWanted: () => void
  /** Per line, the focus the player calls enough (a stronger rank counts for no more); absent = the best. */
  enough: Record<string, string>
  setEnough: (line: string, focus: string | null) => void
  /** The strength that counts as the most wanted on a line: the enough focus's, or Infinity. */
  capOf: (line: string) => number
  points: number
  setPoints: (n: number) => void
  /** Per line, the catalog items with a focus of it that the character could wear, best first. */
  available: Map<string, FocusCandidate[]>
  /** Per line, what the character owns with a focus of it, best first. */
  ownedFoci: Map<string, OwnedFocus[]>
  pieces: Piece[]
  /** How much each hand's weapon counts, from how often it swings; null when the log gives no Dual Wield skill. */
  hands: HandInfo | null
  /** What the finder and the optimiser weigh the hands' weapon ratio by: `hands`, raised when weapons go by ratio first. */
  weaponHands: HandWeights | null
  /** For the optimizer's all-gear mode: the best of what is not owned, slot by slot (empty on other tabs). */
  catalogPieces: Piece[]
  /** The finder's comparison: pieces to get as they drop, or at the merge level of what they replace. */
  compare: 'drop' | 'level'
  /** Worn effects and procs: the character's melee they are weighed against, their spells, their worth. */
  effects: GearEffects
  /** An item's own worn effect and proc, by name; undefined when the wiki does not know it. */
  effectsOfItem: (name: string) => OwnEffects | undefined
  /** Every exaltation kept in Storage with a focus, worn effect or proc, whoever may use it. */
  storedExaltations: Exaltation[]
  /** Whether the era buttons hide a catalog item. */
  eraHidden: (c: CatalogItem) => boolean
  /** Exaltations kept in Storage, free to put in a piece's focus slot. */
  exaltations: Exaltation[]
  /** The pet as the log shows it: what it wears, which one it is. */
  pet: ReturnType<typeof usePet>
  worth: FocusWorth | null
  focusValue: (names: string[]) => number
  /** Gear kept on looting since the inventory export, one item a copy, counted as owned. */
  looted: InvItem[]
  /** Merges on looting since the export that raised an item owned. */
  raisedByLoot: number
}

export function useGearModel(view: InventoryView, sheet: CharacterSheet | null, mode: GearMode) {
  const catalog = useCatalog()
  const state = catalog.state
  const character = useCharacterWeights(view, sheet)
  const { stats, classes, level, role, conv, weights, hands, weaponHands, acState, acFactor, overCap, secondaryInUse, twoHanders, wearer } = character
  const [compare, setCompare] = useRemembered<'drop' | 'level'>('finder.compare', 'drop')
  const [hiddenEras, setHiddenEras] = useRemembered<string[]>('finder.hiddenEras.v3', DEFAULT_HIDDEN_ERAS)
  const [slot, setSlot] = useRemembered<string>('finder.slot', 'all')
  // 'round': every candidate judged with everything owned rearranged around it; 'slot': one slot, one item out.
  const [judge, setJudge] = useRemembered<'slot' | 'round'>('finder.judge', 'round')
  const pet = usePet(view.character, classes, level)

  // Hiding an era re-sorts the whole catalog; the buttons answer first, the lists follow.
  const shownEras = useDeferredValue(hiddenEras)
  const { items, eraStatus, zones, eraCounts, byKey, effectsOfItem, fociOf, eraHidden } = useCatalogItems(state, shownEras)
  // The export with what the log saw looted since: gear kept goes in as yours, and a merge on looting
  // raises the copy it went into. The log does not say what was sold or destroyed after; the next export does.
  const lootSince = useMemo(() => {
    const exported = view.inventory!
    if (!view.looted) return { inventory: exported, added: [], raised: 0 }
    const isGear = (name: string) => {
      const c = byKey.get(itemKey(name))
      return !!c && restrictions(c.statsblock).slots.length > 0
    }
    return withLootSince(exported, view.looted, isGear)
  }, [view.inventory, view.looted, byKey])
  const inv = lootSince.inventory
  const { owned, pieces, storedExaltations, exaltations } = useOwnedGear({ view, inv, looted: lootSince.added, pet, byKey, fociOf, effectsOfItem, wearer })
  const { report, days, setDays, lines, idleLines, wanted, setWanted, resetWanted, enough, setEnough, capOf, points, setPoints, available, ownedFoci, worth, valueOf } =
    useFocusModel({ view, items, classes, level, zones, eraStatus, wearer, owned, pieces, fociOf, shownEras })
  const effects = useEffectsModel({ view, items, effectsOfItem, days, sheetStats: stats, pieces, level, weights })
  const catalogPieces = useCatalogPieces({
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
  })
  const finder = useFinderResults({
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
  })

  const model: GearModel | null = state?.file
    ? {
        view,
        classes,
        level,
        wearer,
        weights,
        twoHanders,
        catalog: items ?? state.file.items,
        fociOf,
        report,
        days,
        setDays,
        lines,
        idleLines,
        wanted,
        setWanted,
        resetWanted,
        enough,
        setEnough,
        capOf,
        points,
        setPoints,
        available,
        ownedFoci,
        pieces,
        catalogPieces,
        compare,
        hands,
        weaponHands,
        effects,
        effectsOfItem,
        storedExaltations,
        eraHidden,
        exaltations,
        pet,
        worth,
        focusValue: valueOf,
        looted: lootSince.added,
        raisedByLoot: lootSince.raised
      }
    : null

  return {
    catalog,
    model,
    results: finder.results,
    /** The results shown are from before the latest change and are being worked out again. */
    resultsStale: finder.stale,
    stats,
    classes,
    level,
    role,
    conv,
    /** What a point of each item stat is worth to this character, AC by the AC model's slope over the soft cap. */
    weights,
    hands,
    acState,
    acFactor,
    overCap,
    secondaryInUse,
    twoHanders,
    eraCounts,
    fociOf,
    lines,
    wanted,
    points,
    setPoints,
    controls: { ...character.controls, compare, setCompare, hiddenEras, setHiddenEras, slot, setSlot, judge, setJudge }
  }
}
