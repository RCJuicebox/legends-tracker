import { useMemo } from 'react'
import { statsFor } from '../../../core/wornGear'
import { itemKey, mergeLevel, parseStatsBlock, scaledStats, storedEquipment, type InvItem } from '../../../core/inventory'
import { ANY_SLOT, canWear, isLore, restrictions, type Wearer } from '../../../core/gearFinder'
import { ownedPieces, type Exaltation } from '../../../core/gearOptimizer'
import { itemEffects } from '../../../core/itemEffects'
import type { CatalogItem } from '../../../core/wikiItem'
import type { InventoryView } from '../../../shared/types'
import type { usePet } from './usePet'

// What the character owns, the pet's gear included: item names for the finder's "owned" marks, the
// pieces the optimiser arranges, and the exaltations kept in Storage.

export function useOwnedGear({
  view,
  pet,
  byKey,
  fociOf,
  effectsOfItem,
  wearer
}: {
  view: InventoryView
  pet: ReturnType<typeof usePet>
  byKey: Map<string, CatalogItem>
  fociOf: (item: InvItem) => { name: string; via: string }[]
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  wearer: Wearer
}) {
  const inv = view.inventory!
  // What the pet wears is the character's too: the log's list names each piece (not its exaltations).
  const petGear = pet.data?.gear
  const petItems = useMemo<InvItem[]>(() => (petGear?.items ?? []).map((g) => ({ location: 'Pet', name: g.name, id: 0, count: 1, augs: [] })), [petGear])
  const owned = useMemo(
    () =>
      new Set(
        [...inv.worn, ...inv.bags, ...inv.bank, ...inv.sharedBank, ...storedEquipment(inv), ...petItems].flatMap((i) => [itemKey(i.name), ...i.augs.map((a) => itemKey(a.name))])
      ),
    [inv, petItems]
  )

  const pieces = useMemo(
    () =>
      ownedPieces(
        inv,
        (item) => {
          const c = byKey.get(itemKey(item.name))
          const stats = statsFor(view.items, item.name) ?? (c ? scaledStats(parseStatsBlock(c.statsblock), mergeLevel(item.name)) : null)
          if (!c && !stats) return null
          const fx = itemEffects(item, effectsOfItem)
          return {
            r: c ? restrictions(c.statsblock) : null,
            stats,
            foci: fociOf(item).map((f) => f.name),
            worn: fx.worn.map((f) => f.name),
            procs: fx.procs.map((f) => f.name),
            lore: c ? isLore(c.statsblock) : true
          }
        },
        petItems
      ),
    [inv, byKey, view.items, fociOf, petItems, effectsOfItem]
  )
  // Exaltations kept in Storage › Exaltations that bring a focus and the character may use, with what
  // the item each was made from allows: the slot kind it goes in, and its classes, race and level.
  const storedExaltations = useMemo<Exaltation[]>(
    () =>
      inv.keyRing.flatMap((k): Exaltation[] => {
        if (k.kind !== 'Augmentation') return []
        const c = byKey.get(itemKey(k.name))
        const fx = effectsOfItem(k.name)
        if (!c || !(c.focus || fx?.worn || fx?.proc)) return []
        const item = { location: 'Storage', name: k.name, id: k.id, count: 1, augs: [] }
        return [{ item, from: 'storage', focus: c.focus, worn: fx?.worn ?? '', proc: fx?.proc ?? '', r: restrictions(c.statsblock) }]
      }),
    [inv, byKey, effectsOfItem]
  )
  const exaltations = useMemo(() => storedExaltations.filter((e) => canWear(e.r, wearer, ANY_SLOT)), [storedExaltations, wearer])

  return { owned, pieces, storedExaltations, exaltations }
}
