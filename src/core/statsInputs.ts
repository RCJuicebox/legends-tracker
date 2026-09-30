import { DEFAULT_STANCES } from './combatModel'
import type { AaSummary } from './aa'

/** Everything the Stats page keeps for a character, stored as its sheet's `stats` (CharacterSheet). Anything a file provides is not stored here. */
export interface StatsInputs {
  classes: [string, string, string]
  level: number
  race: 'iksar' | 'other'
  /** Skill values from the in-game Skills window, by skill number. */
  skills: Record<string, number>
  // AC inputs
  agility: number
  heroicAgility: number
  heroicStrength: number
  weight: number
  drunk: number
  itemAvoidance: number
  foodDrinkAC: number
  tributeAC: number
  acBuffs: number
  armorOfWisdom: number
  herosFortitude: number
  /** Typed over what a file or AA provides; absent = use the file. */
  overrides: Partial<Record<'itemAC' | 'shieldAC' | 'softCap' | 'multiplier' | 'combatStability' | 'evasion' | 'spa169' | 'attackAA' | 'ambidexterity', number>>
  // Combat inputs
  weapon: number
  strength: number
  dexterity: number
  heroicDex: number
  dexCap: number
  itemATK: number
  doubleAttackBonus: number
  critDifficulty: number
  /** A crit rate measured from a parse, %; wins over the model when set. */
  measuredCrit: number
  stances: { name: string; pct: number }[]
  targetAvoidance: number
  parseHit: number
  parseAccuracy: number
  /** The newest /alternateadv list read from the log. */
  aa: AaSummary | null
  /** The last read of the in-game Stats window: numbers by the window's own labels. */
  window: { at: number; values: Record<string, number[]> } | null
}

export function defaultStatsInputs(): StatsInputs {
  return {
    classes: ['war', '', ''],
    level: 50,
    race: 'other',
    skills: {},
    agility: 0,
    heroicAgility: 0,
    heroicStrength: 0,
    weight: 0,
    drunk: 0,
    itemAvoidance: 0,
    foodDrinkAC: 0,
    tributeAC: 0,
    acBuffs: 0,
    armorOfWisdom: 0,
    herosFortitude: 0,
    overrides: {},
    weapon: 28,
    strength: 0,
    dexterity: 0,
    heroicDex: 0,
    dexCap: 255,
    itemATK: 0,
    doubleAttackBonus: 0,
    critDifficulty: 8900,
    measuredCrit: 0,
    stances: DEFAULT_STANCES.map((s) => ({ ...s })),
    targetAvoidance: 467,
    parseHit: 0,
    parseAccuracy: 0,
    aa: null,
    window: null
  }
}

/** A saved sheet over the defaults, so one saved by an older build gains new fields. */
export function readStatsInputs(saved: unknown): StatsInputs {
  const d = defaultStatsInputs()
  if (!saved || typeof saved !== 'object') return d
  const s = { ...d, ...(saved as Partial<StatsInputs>) }
  s.overrides = { ...(s.overrides ?? {}) }
  s.skills = { ...(s.skills ?? {}) }
  if (!Array.isArray(s.stances) || !s.stances.length) s.stances = d.stances
  if (!Array.isArray(s.classes) || s.classes.length !== 3) s.classes = d.classes
  return s
}
