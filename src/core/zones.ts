import { ZONE_ALIASES } from '../shared/game/factions'

// One zone as one place, whatever the log, the wiki or an achievement calls it. Used by the faction
// plan, Slayer, Hunter and the tracked achievements alike.

// "Befallen 1 (Awakened)", "The Plane of Fear 4 (Refined)", and the instances with no tier: "The
// Permafrost Caverns - Solo", "Nagafen's Lair - Group 2" (LT-543).
const INSTANCE = /^(.+?)(?: - (?:Solo|Group))?(?: \d+)? \((?:Refined|Awakened|Adaptive|Fused)\)$|^(.+?) - (?:Solo|Group)(?: \d+)?$/

/** A zone's name without the instance it is one of. */
export function baseZone(zone: string): string {
  const m = INSTANCE.exec(zone)
  return m ? (m[1] ?? m[2]) : zone
}

/** A zone reduced for "same place": the instance, "The", spacing and punctuation dropped. */
export function zoneKey(zone: string): string {
  const k = baseZone(zone)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
  return ZONE_ALIASES[k] ?? k
}
