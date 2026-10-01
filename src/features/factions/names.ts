import { factionKey } from './core'
import { baseZone } from './attribution'
import { CITY_ZONES, FACTION_ALIASES, ZONE_ALIASES } from '../../shared/game/factions'

// Names written more than one way, put one way: a faction as the game writes it, whatever the wiki
// calls it; a zone as one place, whatever the log or the wiki calls it; and a Loadouts swap that puts
// one more class in the trio, which the plan counts as a race of its own. The names themselves are in
// shared/game/factions.ts.

/** Puts any faction name the way the game writes it, when the game has it; else leaves it be. */
export function factionNamer(gameNames: string[]): (name: string) => string {
  const byKey = new Map(gameNames.map((n) => [factionKey(n), n]))
  return (name) => {
    const k = factionKey(name)
    return byKey.get(FACTION_ALIASES[k] ?? k) ?? name.replace(/\s*\(Faction\)\s*$/i, '').trim()
  }
}

/**
 * The names factionNamer cannot join: the wiki's faction pages that match none of the game's names,
 * and the game's factions no page matches. A page left over is mostly a faction the character has not
 * met; a faction and a page that are the same thing named two ways want a line in FACTION_ALIASES
 * (shared/game/factions.ts).
 */
export function unmatchedNames(pages: string[], gameNames: string[]): { pages: string[]; factions: string[] } {
  const name = factionNamer(gameNames)
  const game = new Set(gameNames)
  const joined = new Set<string>()
  const left: string[] = []
  for (const p of pages) {
    const n = name(p)
    if (game.has(n)) joined.add(n)
    else left.push(p)
  }
  const abc = (a: string, b: string) => a.localeCompare(b)
  return { pages: left.sort(abc), factions: gameNames.filter((f) => !joined.has(f)).sort(abc) }
}

/** A zone reduced for "same place": the instance, "The", spacing and punctuation dropped. */
export function zoneKey(zone: string): string {
  const k = baseZone(zone)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
  return ZONE_ALIASES[k] ?? k
}

/** The cities, where killing the people brings the guards down on you. */
const CITIES = new Set(CITY_ZONES.map(zoneKey))

/** Whether a zone is a city. */
export const isCity = (zone: string) => CITIES.has(zoneKey(zone))

/**
 * A Loadouts swap that puts one more class in the trio ("Wood Elf + Bard"), keeping the race or with
 * another ("Dwarf + Rogue"): a con takes the best of the trio's class modifiers, so one class an NPC
 * likes opens what the trio does not. The plan counts it as a race of its own, there whenever its race is.
 */
export const classSwapName = (race: string, cls: string) => `${race} + ${cls}`

/** The class a swap puts in the trio; null for a swap of race alone. */
export const classSwapOf = (name: string) => / \+ (.+)$/.exec(name)?.[1] ?? null

/** The race of a swap: "Dwarf + Rogue" → "Dwarf". */
export const raceOfSwap = (name: string) => name.replace(/ \+ .+$/, '')
