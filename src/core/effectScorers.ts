import { score, type Weights } from './gearFinder'
import { effectScore, procWorth, wornStats, wornWorth, type EffectSpell, type EffectWorth } from './itemEffects'
import { meleeProfile, type MeleeProfile } from './meleeTally'
import type { EffectValue } from './gearOptimizer'

// What worn effects and procs are worth in the weights' terms, built from plain data: the page builds
// it for what it shows, and the gear worker builds the same from the same data for the optimiser
// (LT-390), since functions cannot be sent to a worker.

/** Everything the worth of a worn effect or proc comes from. */
export interface EffectInputs {
  spells: Record<string, EffectSpell>
  /** The character's melee over the days looked at; null with no log to read. */
  profile: MeleeProfile | null
  level: number
  dex: number
  /** Weapons in hand now that carry each proc, by name. */
  carriers: [string, number][]
}

export interface EffectScorers {
  wornWorth: (name: string) => EffectWorth | null
  procWorth: (name: string) => EffectWorth | null
  wornScore: (name: string) => number
  wornStatScore: (name: string) => number
  procScore: (name: string) => number
  value: EffectValue
}

const NO_MELEE = meleeProfile({}, { from: '', to: '' })

export function effectScorers(i: EffectInputs, weights: Weights): EffectScorers {
  const { spells, level, dex } = i
  const carriers = new Map(i.carriers)
  // With no melee in the log, what an effect does is still shown and its stats still count.
  const melee = i.profile ?? NO_MELEE
  const wornWorthOf = (name: string) => (spells[name] ? wornWorth(spells[name], melee, level) : null)
  const procWorthOf = (name: string) => (spells[name] ? procWorth(spells[name], melee, { level, dex, carriers: carriers.get(name) ?? 1 }) : null)
  // Stats a worn effect gives are priced as on an item: set-wide, so no weapon ratio or haste.
  const statWeights = { ...weights, ratio: 0, rangedRatio: 0, haste: 0 }
  const wornStatScore = (name: string) => (spells[name] ? score(wornStats(spells[name], level), statWeights) : 0)
  const wornScore = (name: string) => effectScore(wornWorthOf(name)?.dpm ?? 0, melee, weights.ratio) + wornStatScore(name)
  const procScore = (name: string) => effectScore(procWorthOf(name)?.dpm ?? 0, melee, weights.ratio)
  return {
    wornWorth: wornWorthOf,
    procWorth: procWorthOf,
    wornScore,
    wornStatScore,
    procScore,
    value: { worn: (names) => names.reduce((s, n) => s + wornScore(n), 0), proc: procScore }
  }
}
