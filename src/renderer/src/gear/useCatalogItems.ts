import { useEffect, useMemo } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { itemFoci, itemKey, type InvItem } from '../../../core/inventory'
import { ERA_ORDER, eraOf, zoneEras } from '../../../core/upgrades'
import { procOf, wornEffectOf } from '../../../core/itemEffects'
import { withRaceFix, type CatalogItem } from '../../../core/wikiItem'
import type { CatalogState } from '../../../shared/ipc'

// The catalog's items as the gear tools read them: eras (crafted ones from their ingredients), the
// wiki's race fixes, and lookups by name for an item's foci, worn effect and proc.

export function useCatalogItems(state: CatalogState | null, shownEras: string[]) {
  // Crafted items without an era of their own take their ingredients' eras (from the recipe book, which
  // the main process fetches again in the background when it is old; asked again once it has been).
  const craftQ = useInvoke('trade:craftEras')
  const reloadCraft = craftQ.reload
  useEffect(() => api.on('state:recipes', (p: { busy: boolean }) => !p.busy && reloadCraft()), [reloadCraft])
  const rawItems = state?.file?.items
  // And race lines the wiki has wrong are put right (RACE_FIXES).
  const items = useMemo(() => {
    const made = craftQ.data ?? {}
    return rawItems?.map((it) => {
      const fixed = withRaceFix(it)
      return !fixed.era && made[fixed.title] ? { ...fixed, craftEras: made[fixed.title] } : fixed
    })
  }, [rawItems, craftQ.data])
  const eraStatus = state?.file?.eraStatus
  const zones = useMemo(() => zoneEras(items ?? [], eraStatus), [items, eraStatus])
  // Every era in the catalog with how many pieces it holds, tagged or worked out from drop zones.
  const eraCounts = useMemo(() => {
    const counts = new Map<string, number>(ERA_ORDER.map((e) => [e, 0]))
    for (const it of items ?? []) {
      const { era } = eraOf(it, zones, eraStatus)
      counts.set(era, (counts.get(era) ?? 0) + 1)
    }
    return [...counts]
  }, [items, zones, eraStatus])

  const byKey = useMemo(() => new Map((items ?? []).map((it) => [itemKey(it.title), it])), [items])
  // Every catalog item's own worn effect and proc, read from its stats block once.
  const effectsOfItem = useMemo(() => {
    const byItem = new Map([...byKey].map(([key, c]) => [key, { worn: wornEffectOf(c.statsblock), proc: procOf(c.statsblock) }]))
    return (name: string) => byItem.get(itemKey(name))
  }, [byKey])
  const fociOf = useMemo(() => (item: InvItem) => itemFoci(item, (name) => byKey.get(itemKey(name))?.focus), [byKey])
  // An item's era group, as the era buttons name them, and whether those buttons hide it.
  const eraHidden = useMemo(() => {
    const hidden = new Set(shownEras)
    return (c: CatalogItem) => hidden.has(eraOf(c, zones, eraStatus).era)
  }, [shownEras, zones, eraStatus])

  return { items, eraStatus, zones, eraCounts, byKey, effectsOfItem, fociOf, eraHidden }
}
