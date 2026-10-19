import { type InvItem } from '../../../core/inventory'
import type { CharacterSheet } from '../../../shared/types'
import { MAX_LEVEL } from '../../../core/moteCalc'

// What the Gear page and its panels share (LT-638): the slots and their names, and the merge pips.

/** The highest merge an item takes: +10. */
export const MAX_MERGE = MAX_LEVEL

export type UpdateSheet = (fn: (s: CharacterSheet) => CharacterSheet) => void

// A character sheet: the body's slots down either side of a card for the character, weapons and
// charms under the card. Slots that appear twice (ears, wrists, fingers, charms) take the export's
// items in order.
export const LEFT = ['Head', 'Face', 'Ear', 'Ear', 'Neck', 'Shoulders', 'Back', 'Arms']
export const RIGHT = ['Chest', 'Wrist', 'Wrist', 'Hands', 'Fingers', 'Fingers', 'Waist', 'Legs', 'Feet']
export const HANDS = ['Primary', 'Secondary', 'Range', 'Ammo']
export const CHARMS = ['Any Slot', 'Any Slot']
export const SLOT_NAMES: Record<string, string> = { 'Any Slot': 'Any slot' }

/** Worn items by slot, each slot's items in the export's order. */
export function bySlot(worn: InvItem[]): Map<string, InvItem[]> {
  const m = new Map<string, InvItem[]>()
  for (const it of worn) m.set(it.location, [...(m.get(it.location) ?? []), it])
  return m
}

export const augName = (name: string) => name.replace(/\s*\(Exaltation\)$/i, '')
export const plainName = (name: string) => name.replace(/\s*\+\d+$/, '')

/** Ten pips for the ten merge levels, filled up to this item's. */
export function MergePips({ level }: { level: number }) {
  return (
    <span
      className="lt-pips"
      title={level ? `Merged to +${level} of ${MAX_MERGE}` : 'Not merged yet'}
      role="img"
      aria-label={level ? `Merged to +${level} of ${MAX_MERGE}` : 'Not merged yet'}
    >
      {Array.from({ length: MAX_MERGE }, (_, i) => (
        <i key={i} className={i < level ? 'on' : ''} />
      ))}
    </span>
  )
}
