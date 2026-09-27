import { itemKey, mergeLevel, parseStatsBlock, scaledStats, wornTotals, SHIELD_NAME, type ItemStats } from './inventory'
import type { CharacterSheet, InventoryView, ItemInfo } from '../shared/types'

// What the worn gear adds up to, for the Gear and Stats pages and the Gear tools.

/** An item's stats at its merge level, if the wiki has it. */
export function statsFor(items: Record<string, ItemInfo>, name: string): ItemStats | null {
  const info = items[itemKey(name)]
  return info?.found ? scaledStats(parseStatsBlock(info.statsblock), mergeLevel(name)) : null
}

export type WornSummary = ReturnType<typeof wornSummary>

/** What the worn gear adds up to, with the player's typed-in AC where they gave one. */
export function wornSummary(view: InventoryView, sheet: CharacterSheet | null) {
  const worn = view.inventory?.worn ?? []
  const totals = wornTotals(
    worn,
    (it) => statsFor(view.items, it.name),
    (it) => sheet?.acOverrides[itemKey(it.name)]
  )
  const secondary = worn.find((it) => it.location === 'Secondary')
  const shieldByName = !!secondary && SHIELD_NAME.test(secondary.name)
  const shield = sheet?.shield ?? shieldByName
  const shieldAC = shield && secondary ? (sheet?.acOverrides[itemKey(secondary.name)] ?? statsFor(view.items, secondary.name)?.ac ?? 0) : 0
  return { totals, secondary, shield, shieldByName, shieldAC }
}
