import { CITY_GUARDS } from '../../shared/game/factions'
import { factionKey, STANDING_MAX, STANDING_MIN } from './core'
import type { PlanTarget } from './planTypes'

// The Plan tab's Cities plan: every starting city's guards conning the character Indifferent or better,
// so it can walk into any of them. A guard cons on the standing with the race's and the best class's
// modifiers added (as an Agnostic, as the plan counts everyone), so how far each faction has to go is the
// character's own: an Iksar has a long way to go with Felwithe's guards, a Wood Elf none. Each city's
// guards' faction is in shared/game/factions.ts (CITY_GUARDS).

/** Where a city's guards con the character Indifferent: the con the Cities plan wants. */
const CONTENT_CON = 0

/** One starting city and its guards, for one character. */
export interface CityGuards {
  /** "Qeynos", "Neriak, Foreign Quarter". */
  city: string
  /** The guards' faction, by the character's own name for it. */
  faction: string
  /** Its standing now; 0 where none is known. */
  standing: number
  /** What the character's race and best class add to it, as an Agnostic. */
  mod: number
  /** The standing its guards con the character Indifferent from; above 2000 when none will do. */
  to: number
}

/**
 * Every starting city's guards for a character: `factions` are its own names for factions (the game's
 * spelling: "DaBashers" for eqlwiki's "Da Bashers"), `standings` where each stands, and `mods` its
 * race's and classes' modifiers (null without a race on record: then the standing alone counts).
 */
export function cityGuards(factions: Iterable<string>, standings: Record<string, number>, mods: Record<string, number> | null): CityGuards[] {
  const byKey = new Map<string, string>()
  for (const f of factions) if (!byKey.has(factionKey(f))) byKey.set(factionKey(f), f)
  return CITY_GUARDS.map(({ city, faction: listed }) => {
    const faction = byKey.get(factionKey(listed)) ?? listed
    const mod = mods?.[faction] ?? 0
    const standing = Math.max(STANDING_MIN, Math.min(STANDING_MAX, standings[faction] ?? 0))
    return { city, faction, standing, mod, to: Math.max(STANDING_MIN, CONTENT_CON - mod) }
  })
}

/** "Kelethin", "Kelethin and Felwithe", "Kelethin, Felwithe and Qeynos". */
const joined = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * The Cities plan's targets: one for each guards' faction some standing contents (Kelethin's and
 * Felwithe's share Emerald Warriors), done at that standing and to end there, so the plan neither stops
 * short of it nor takes it back below. One already there is a target too, kept there.
 */
export function cityTargets(rows: CityGuards[]): PlanTarget[] {
  const out = new Map<string, { cities: string[]; row: CityGuards }>()
  for (const r of rows) {
    if (r.to > STANDING_MAX) continue
    const had = out.get(r.faction)
    if (had) had.cities.push(r.city)
    else out.set(r.faction, { cities: [r.city], row: r })
  }
  return [...out.values()].map(({ cities, row }) => ({
    faction: row.faction,
    achievement: `${joined(cities)} guards`,
    standing: row.standing,
    to: row.to,
    floor: row.to
  }))
}
