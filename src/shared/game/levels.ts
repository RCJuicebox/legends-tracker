/**
 * Legends' level cap. The spell file carries live EverQuest's later spells too (level 51 to 130);
 * nobody in Legends can cast those. Raise it with the game's.
 */
export const LEVEL_CAP = 50

/**
 * How many levels under you a mob cons green, by your level: [your level up to, levels under]. The
 * classic server's own table (TAKP, EQMacEmu Mob::GetLevelCon); Legends cons the same: since Juicebox
 * reached 50, "You could probably win this fight" came for levels 1 to 32 and the next con from 33.
 */
const GREEN_UNDER: [number, number][] = [
  [7, 4],
  [8, 5],
  [12, 6],
  [16, 7],
  [20, 8],
  [24, 9],
  [28, 10],
  [30, 11],
  [32, 12],
  [36, 13],
  [40, 14],
  [44, 16],
  [48, 17],
  [52, 18],
  [54, 19],
  [56, 20],
  [60, 21],
  [61, 19],
  [62, 17]
]

/** The highest level of mob that cons green (or lower) to a character of this level: 32 for a level 50. */
export function greenConMax(level: number): number {
  return level - (GREEN_UNDER.find(([upTo]) => level <= upTo)?.[1] ?? 16)
}
