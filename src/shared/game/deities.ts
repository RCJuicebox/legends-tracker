// The deities a Legends character can have, once. Pure data with no imports, like classes.ts.

/**
 * As the game names them in Loadouts, in the order of the client's "Deity Unlock - …" achievements
 * (20000301 Agnostic, 20000302 Bertoxxulous …). Resources/Faction/FactionAssociations.txt keys the
 * gods' faction modifiers 201 (Bertoxxulous) to 216 (Veeshan) in the same order; Agnostic has none.
 */
export const DEITIES = [
  'Agnostic',
  'Bertoxxulous',
  'Brell Serilis',
  'Cazic Thule',
  'Erollisi Marr',
  'Bristlebane',
  'Innoruuk',
  'Karana',
  'Mithaniel Marr',
  'Prexus',
  'Quellious',
  'Rallos Zek',
  'Rodcet Nife',
  'Solusek Ro',
  'Tribunal',
  'Tunare',
  'Veeshan'
] as const

const bare = (s: string) =>
  s
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z]/g, '')

/** A deity as the game spells it ("Cazic-Thule" and "The Tribunal" are read too), or '' for anything else. */
export function deityName(name: string): string {
  const n = bare(name)
  return (n && DEITIES.find((d) => bare(d) === n)) || ''
}

/** The key of a deity's faction modifiers (Bertoxxulous 201 … Veeshan 216); null for Agnostic, which has none, and for a name not known. */
export function deityKey(name: string): number | null {
  const n = bare(name)
  const i = n ? DEITIES.findIndex((d) => bare(d) === n) : -1
  return i > 0 ? 200 + i : null
}
