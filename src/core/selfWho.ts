// Your own /who keeps your character record current: Legends lets a character change its race and
// its classes, and /who shows both. It lists the classes in class-number order, not the player's, and
// a single level: the lowest of the three.

import { LEVEL_CAP } from './buffs'
import { className, type ClassName } from '../shared/game/classes'
import { playableRace, raceFromWho } from '../shared/game/races'
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

/**
 * The record after a /who of its character; null when the /who changes nothing. A /who under an
 * illusion prints the illusion's race, so a race matching the illusion on record leaves the race alone.
 */
export function recordFromWho(rec: CharacterSettings, who: SelfWho): CharacterSettings | null {
  const disguised = !!rec.illusion?.race && rec.illusion.race === playableRace(who.race)
  const race = disguised ? null : raceFromWho(rec.race, who.race)
  const classLevels = who.classes.length ? classLevelsFromWho(rec.classLevels, who.classes, who.level) : rec.classLevels
  // Key order counts: the first class is the player's main one.
  const sameClasses = JSON.stringify(classLevels) === JSON.stringify(rec.classLevels)
  if (!race && sameClasses) return null
  return { ...rec, ...(race ? { race } : {}), classLevels }
}

// ---- Illusions ----

/** An illusion on you: the race it shows ('' for none, or one that is not a playable race), and when the log said so. */
export interface IllusionSeen {
  race: string
  at: number
}

/** "You begin casting Illusion: Dark Elf.", or another caster's, "Mass Illusion" too. */
const ILLUSION_CAST = /^(?:You begin|.+ begins) casting (?:Mass )?Illusion: (.+)\.$/
/** What the game's illusions say on landing and on fading (spells_us_str.txt: nearly 500 of each). */
export const ILLUSION_LANDS = 'You feel different.'
export const ILLUSION_FADES = 'Your illusion fades.'
/** A landing this long after an illusion's cast began is that cast's (casts take seconds). */
const CAST_TO_LAND_MS = 30_000

/**
 * Illusions as the log shows them: one cast and then landing on you puts on its race; another landing
 * (an illusion whose cast was not seen) puts on none known; fading or dying takes it off. The log never
 * says when one runs out (Permanent Illusion makes them last 16.6 hours, through zoning), so it is on
 * until one of those lines.
 */
export class IllusionWatch {
  private cast: IllusionSeen | null = null

  /** What the line says of an illusion on you, or null when nothing. */
  line(text: string, at: number): IllusionSeen | null {
    const cast = text.includes('Illusion: ') ? ILLUSION_CAST.exec(text) : null
    if (cast) {
      this.cast = { race: playableRace(cast[1]), at }
      return null
    }
    if (text === ILLUSION_LANDS) {
      const race = this.cast && at - this.cast.at <= CAST_TO_LAND_MS ? this.cast.race : ''
      this.cast = null
      return { race, at }
    }
    if (text === ILLUSION_FADES || text === 'You died.' || text.startsWith('You have been slain by ')) return { race: '', at }
    return null
  }
}

/** "Monk 50/Bard 50/Enchanter 50", or "none". */
export function describeClasses(classLevels: CharacterSettings['classLevels']): string {
  return (
    Object.entries(classLevels)
      .map(([n, l]) => `${n} ${l}`)
      .join('/') || 'none'
  )
}
