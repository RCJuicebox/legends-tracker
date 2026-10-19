import { ZONE_ALIASES } from '../shared/game/factions'

// One zone as one place, whatever the log, the wiki or an achievement calls it. Used by the faction
// plan, Slayer, Hunter and the tracked achievements alike.

const INSTANCE = /^(.+?)(?: - (?:Solo|Group))?(?: \d+)? \((?:Refined|Awakened|Adaptive|Fused)\)$/

/** A zone's name without the instance it is one of. */
export function baseZone(zone: string): string {
  return INSTANCE.exec(zone)?.[1] ?? zone
}

/** A zone reduced for "same place": the instance, "The", spacing and punctuation dropped. */
export function zoneKey(zone: string): string {
  const k = baseZone(zone)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
  return ZONE_ALIASES[k] ?? k
}
