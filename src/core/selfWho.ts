// Your own /who keeps your character record current: Legends lets a character change its race and
// its classes, and /who shows both. It lists the classes in class-number order, not the player's, and
// a single level: the lowest of the three.

import { LEVEL_CAP } from './buffs'
import { className, type ClassName } from '../shared/game/classes'
import { raceFromWho } from '../shared/game/races'
import type { CharacterSettings } from '../shared/types'

/** What a /who line says of the character being played. */
export interface SelfWho {
  race: string
  /** Tracker class ids, in /who's order. */
  classes: string[]
  /** The lowest of the classes' levels. */
  level: number
}

/**
 * The classes and their levels after a /who. Classes still there keep the player's order (the first
 * is their main one) and their level, raised to the level /who shows when below it; new ones follow in
 * /who's order, at that level. At the cap every class is at it. When every level on the record is
 * above the one shown, the lowest has come down to it (a level lost, or one typed in wrong).
 */
export function classLevelsFromWho(recorded: CharacterSettings['classLevels'], classes: string[], level: number): CharacterSettings['classLevels'] {
  const seen = classes.map((id) => className(id) as ClassName)
  const kept = (Object.keys(recorded) as ClassName[]).filter((n) => seen.includes(n))
  const order = [...kept, ...seen.filter((n) => !kept.includes(n))]
  const levels = order.map((n) => (level >= LEVEL_CAP ? level : Math.max(level, recorded[n] ?? level)))
  const low = levels.lastIndexOf(Math.min(...levels))
  if (levels[low] > level) levels[low] = level
  return Object.fromEntries(order.map((n, i) => [n, levels[i]]))
}

/** The record after a /who of its character; null when the /who changes nothing. */
export function recordFromWho(rec: CharacterSettings, who: SelfWho): CharacterSettings | null {
  const race = raceFromWho(rec.race, who.race)
  const classLevels = who.classes.length ? classLevelsFromWho(rec.classLevels, who.classes, who.level) : rec.classLevels
  // Key order counts: the first class is the player's main one.
  const sameClasses = JSON.stringify(classLevels) === JSON.stringify(rec.classLevels)
  if (!race && sameClasses) return null
  return { ...rec, ...(race ? { race } : {}), classLevels }
}

/** "Monk 50/Bard 50/Enchanter 50", or "none". */
export function describeClasses(classLevels: CharacterSettings['classLevels']): string {
  return (
    Object.entries(classLevels)
      .map(([n, l]) => `${n} ${l}`)
      .join('/') || 'none'
  )
}
