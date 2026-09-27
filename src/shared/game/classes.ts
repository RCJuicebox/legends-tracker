// The sixteen classes, once. Pure data with no imports, so settings types, core and every page can
// share it.

/**
 * One row per class, in the game's class-number order: 1 Warrior … 16 Berserker. The spell file's
 * class-level columns and Resources tables run in this order. `id` is the tracker's key (also the
 * sheet's and /who's, lowercased); `code` is how /who, item "Class:" lines and the wiki abbreviate it.
 */
export const CLASS_TABLE = [
  { id: 'war', number: 1, name: 'Warrior', code: 'WAR' },
  { id: 'clr', number: 2, name: 'Cleric', code: 'CLR' },
  { id: 'pal', number: 3, name: 'Paladin', code: 'PAL' },
  { id: 'rng', number: 4, name: 'Ranger', code: 'RNG' },
  { id: 'shd', number: 5, name: 'Shadow Knight', code: 'SHD' },
  { id: 'dru', number: 6, name: 'Druid', code: 'DRU' },
  { id: 'mnk', number: 7, name: 'Monk', code: 'MNK' },
  { id: 'brd', number: 8, name: 'Bard', code: 'BRD' },
  { id: 'rog', number: 9, name: 'Rogue', code: 'ROG' },
  { id: 'shm', number: 10, name: 'Shaman', code: 'SHM' },
  { id: 'nec', number: 11, name: 'Necromancer', code: 'NEC' },
  { id: 'wiz', number: 12, name: 'Wizard', code: 'WIZ' },
  { id: 'mag', number: 13, name: 'Magician', code: 'MAG' },
  { id: 'enc', number: 14, name: 'Enchanter', code: 'ENC' },
  { id: 'bst', number: 15, name: 'Beastlord', code: 'BST' },
  { id: 'ber', number: 16, name: 'Berserker', code: 'BER' }
] as const

export type ClassId = (typeof CLASS_TABLE)[number]['id']
export type ClassName = (typeof CLASS_TABLE)[number]['name']

/** Names in class-number order: index i is class number i + 1, and the spell file's column i. */
export const CLASS_NAMES: readonly ClassName[] = CLASS_TABLE.map((c) => c.name)

/** The game files number classes the classic way: 1 Warrior … 16 Berserker. */
export const CLASS_NUMBER = Object.fromEntries(CLASS_TABLE.map((c) => [c.id, c.number])) as Record<ClassId, number>

/** Class ids grouped the way pickers list them: melee, then priests, then casters. */
export const CLASS_IDS_BY_ROLE: readonly ClassId[] = ['war', 'pal', 'shd', 'rng', 'mnk', 'brd', 'rog', 'ber', 'bst', 'clr', 'dru', 'shm', 'enc', 'mag', 'nec', 'wiz']

/** [id, name] pairs in picker order. */
export const CLASSES: readonly (readonly [ClassId, ClassName])[] = CLASS_IDS_BY_ROLE.map((id) => [id, className(id) as ClassName] as const)

export function isClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && CLASS_TABLE.some((c) => c.id === v)
}

/** `shd` → "Shadow Knight"; anything else comes back as given. */
export function className(id: string): string {
  return CLASS_TABLE.find((c) => c.id === id)?.name ?? id
}

/** `shd` → "SHD", the way /who abbreviates classes. */
export function classCode(id: string): string {
  return CLASS_TABLE.find((c) => c.id === id)?.code ?? id.toUpperCase()
}

/** "Shadow Knight", "Shadow_Knight", "Shadowknight" or "SHD" → `shd`; null when it names no class. */
export function classIdOf(name: string): ClassId | null {
  const n = name.replace(/[^a-z]/gi, '').toLowerCase()
  return CLASS_TABLE.find((c) => c.name.replace(/[^a-z]/gi, '').toLowerCase() === n || c.id === n)?.id ?? null
}

/** The index of a class's column in the spell file's class levels. */
export function classColumn(id: string): number {
  return (CLASS_TABLE.find((c) => c.id === id)?.number ?? 0) - 1
}
