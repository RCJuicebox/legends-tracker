// The races a Legends character can be, once. Pure data with no imports, like classes.ts.

/**
 * As /who writes them, in the order of the client's "created as a …" achievements, which name all
 * sixteen: the classic twelve, Iksar, then Kerran (where classic EQ had Vah Shir), Froglok and Drakkin.
 */
export const PLAYABLE_RACES = [
  'Human',
  'Barbarian',
  'Erudite',
  'Wood Elf',
  'High Elf',
  'Dark Elf',
  'Half Elf',
  'Dwarf',
  'Troll',
  'Ogre',
  'Halfling',
  'Gnome',
  'Iksar',
  'Kerran',
  'Froglok',
  'Drakkin'
] as const

/** A playable race as the game spells it, or '' for anything else: /who shows an illusion's form too ("Elemental"). */
export function playableRace(name: string): string {
  const n = name.trim().toLowerCase()
  return PLAYABLE_RACES.find((r) => r.toLowerCase() === n) ?? ''
}

/**
 * The race a character's record takes from a /who of them: the race /who showed when it is a playable
 * one other than the record's, else null. A race change shows here; so does an illusion of a playable
 * race, which the next /who without it puts back.
 */
export function raceFromWho(recorded: string | undefined, seen: string): string | null {
  const race = playableRace(seen)
  return race && race.toLowerCase() !== (recorded ?? '').trim().toLowerCase() ? race : null
}
