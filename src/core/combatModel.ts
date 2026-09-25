// Melee, as far as it can be pinned down on EverQuest Legends. Two standards of evidence live here:
//  - Confirmed: the stats window's Attack line (Offense / Accuracy), the hit roll, and swings per round
//    all follow EQEmu's zone/attack.cpp, checked against screenshots and hour-long parses on the test
//    dummies. Skill caps come straight from the game's own Resources/skillcaps.txt.
//  - Not confirmed: the classic crit model. Parses show EverQuest Legends crits near 11-12% on every
//    class tried, whatever the dexterity, which the classic model cannot produce; a measured rate wins.

/** Classic EverQuest skill numbering, which the game's skill tables use. 79-82 are Legends' own. */
export const SKILL_NAMES: Record<number, string> = {
  0: '1H Blunt', 1: '1H Slashing', 2: '2H Blunt', 3: '2H Slashing', 4: 'Abjuration', 5: 'Alteration', 6: 'Apply Poison',
  7: 'Archery', 8: 'Backstab', 9: 'Bind Wound', 10: 'Bash', 11: 'Block', 12: 'Brass Instruments', 13: 'Channeling',
  14: 'Conjuration', 15: 'Defense', 16: 'Disarm', 17: 'Disarm Traps', 18: 'Divination', 19: 'Dodge', 20: 'Double Attack',
  21: 'Dragon Punch / Tail Rake', 22: 'Dual Wield', 23: 'Eagle Strike', 24: 'Evocation', 25: 'Feign Death', 26: 'Flying Kick',
  27: 'Forage', 28: 'Hand to Hand', 29: 'Hide', 30: 'Kick', 31: 'Meditate', 32: 'Mend', 33: 'Offense', 34: 'Parry',
  35: 'Pick Lock', 36: '1H Piercing', 37: 'Riposte', 38: 'Round Kick', 39: 'Safe Fall', 40: 'Sense Heading', 41: 'Singing',
  42: 'Sneak', 43: 'Specialize Abjure', 44: 'Specialize Alteration', 45: 'Specialize Conjuration', 46: 'Specialize Divination',
  47: 'Specialize Evocation', 48: 'Pick Pockets', 49: 'Stringed Instruments', 50: 'Swimming', 51: 'Throwing', 52: 'Tiger Claw',
  53: 'Tracking', 54: 'Wind Instruments', 55: 'Fishing', 56: 'Make Poison', 57: 'Tinkering', 58: 'Research', 59: 'Alchemy',
  60: 'Baking', 61: 'Tailoring', 62: 'Sense Traps', 63: 'Blacksmithing', 64: 'Fletching', 65: 'Brewing', 66: 'Alcohol Tolerance',
  67: 'Begging', 68: 'Jewelry Making', 69: 'Pottery', 70: 'Percussion Instruments', 71: 'Intimidation', 72: 'Berserking',
  73: 'Taunt', 74: 'Frenzy', 75: 'Remove Traps', 76: 'Triple Attack', 77: '2H Piercing',
  79: 'Athletics or Strategy', 80: 'Strategy or Athletics', 81: 'Smite', 82: 'Reave'
}

export const skillName = (id: number) => SKILL_NAMES[id] ?? `Skill ${id}`

export const OFFENSE = 33
export const DOUBLE_ATTACK = 20
export const DUAL_WIELD = 22
export const TRIPLE_ATTACK = 76

/** The weapon skills an auto-attack swings with. Bare-fisted is Hand to Hand. */
export const WEAPON_SKILLS: [number, string][] = [
  [28, 'Hand to Hand'], [0, '1H Blunt'], [1, '1H Slashing'], [36, '1H Piercing'], [2, '2H Blunt'], [3, '2H Slashing'], [77, '2H Piercing']
]

/** Strength over 75 adds two thirds of a point of Offense each (EQEmu Mob::offense, dev-confirmed). */
export function strengthOffense(str: number): number {
  return str >= 75 ? Math.floor((2 * str - 150) / 3) : 0
}

/** The window's first Attack number: weapon skill + the strength term. */
export function windowOffense(weaponSkill: number, str: number): number {
  return weaponSkill + strengthOffense(str)
}

/** The window's second number before a stance: (Offense skill + weapon skill + 17) × 1.21. */
export function baseAccuracy(offenseSkill: number, weaponSkill: number): number {
  return Math.floor(((offenseSkill + weaponSkill + 17) * 121) / 100)
}

/** A stance multiplies Accuracy by its hit bonus (SPA 184). */
export function stanceAccuracy(base: number, pct: number): number {
  return Math.floor((base * (100 + (pct || 0))) / 100)
}

/**
 * EQEmu's CheckHitChance: Roll0(accuracy) against Roll0(avoidance), a hit when the attacker's roll is
 * higher, ties split. In closed form (exact against every pair checked). Never reaches 100%.
 */
export function hitChance(accuracy: number, avoidance: number): number {
  const A = Math.max(1, Math.floor(accuracy || 0))
  const D = Math.max(1, Math.floor(avoidance || 0))
  return A >= D ? 1 - D / (2 * A) : A / (2 * D)
}

/** A measured hit rate turned back into the target's avoidance. */
export function avoidanceFromHitRate(p: number, accuracy: number): number {
  if (!(p > 0 && p < 1) || !(accuracy > 0)) return 0
  return p >= 0.5 ? 2 * accuracy * (1 - p) : accuracy / (2 * p)
}

/** Double attack per round: (skill + level) × (100 + bonus%) / 100 / 500. CheckDoubleAttack. */
export function doubleAttackChance(skill: number, level: number, bonusPct = 0): number {
  if (!skill) return 0
  return Math.min(1, ((skill + level) * (100 + bonusPct)) / 100 / 500)
}

/** Triple attack, rolled after a main-hand double: c × 100 / (c + 800) %. CheckTripleAttack. */
export function tripleAttackChance(skill: number, bonusPct = 0): number {
  if (!(skill > 0)) return 0
  const c = Math.floor(skill * (1 + bonusPct / 100))
  return Math.min(1, Math.floor((c * 100) / (c + 800)) / 100)
}

/** Dual wield: (skill + level + Ambidexterity) / 375. CheckDualWield. */
export function dualWieldChance(skill: number, level: number, ambidexterity = 0): number {
  if (!skill) return 0
  return Math.min(1, (skill + level + ambidexterity) / 375)
}

/** Classes that triple attack at all. */
export const TRIPLE_CLASSES = ['war', 'mnk', 'ber', 'rng']

/**
 * Average swings in a round: the main hand, its double, the triple after a double, the offhand, and
 * the offhand's own double once double attack skill reaches 150. Two hour-long parses measured 3.05
 * and 3.06 where this gives 3.05.
 */
export function swingsPerRound(p: { double: number; triple: number; dual: number; doubleSkill: number }): number {
  return 1 + p.double + p.double * p.triple + p.dual * (1 + (p.doubleSkill > 149 ? p.double : 0))
}

/** The melee damage table rows below level 51 (EQEmu, the commit Project 1999 cites). */
export const DAMAGE_TABLE = { mnk: { max: 220, skip: 45, minus: 100 }, other: { max: 210, skip: 49, minus: 105 } }
export const MELEE_CLASSES = ['war', 'pal', 'shd', 'rng', 'mnk', 'brd', 'rog', 'ber', 'bst']

/** The table's average damage, as % of base. Under 115 Offense it never applies. */
export function damageBonusPct(monk: boolean, offense: number): number {
  if (offense < 115) return 100
  const t = monk ? DAMAGE_TABLE.mnk : DAMAGE_TABLE.other
  const base = Math.max(10, Math.floor((offense - t.minus) / 2))
  let total = 0
  for (let e = 0; e < base; e++) total += Math.min(100 + e, t.max)
  return t.skip + (1 - t.skip / 100) * (total / base)
}

/**
 * The classic melee crit model (EQEmu Mob::TryCriticalHit; Sancus's beta parse is the same maths).
 * Contradicted on Legends, kept for comparison: only Warriors and Berserkers crit by nature, everyone
 * else needs SPA 169, and dexterity drives it.
 */
export function classicCritChance(p: { innate: boolean; dex: number; heroicDex: number; dexCap: number; spa169: number; difficulty: number }) {
  if (!p.innate && !p.spa169) return { p: 0, term: 0 }
  let d = 45 + Math.min(p.dex, 255)
  if (p.dex > 255) d += Math.min(Math.max(0, (p.dexCap || 255) - 255), p.dex - 255) * 0.2
  d += (p.heroicDex || 0) * 0.2
  if (!p.innate) d = (d * 3) / 5
  d *= 1 + (p.spa169 || 0) / 100
  return { p: Math.max(0, Math.min(1, d / (p.difficulty || 1))), term: d }
}

/** The stances and their bonus to Accuracy, as the stats window shows them. */
export const DEFAULT_STANCES = [
  { name: 'Offensive', pct: 25 },
  { name: 'Balanced', pct: 10 },
  { name: 'Striker', pct: 0 },
  { name: 'Ranged', pct: 0 },
  { name: 'Defensive', pct: 0 },
  { name: 'Evasive', pct: 0 },
  { name: 'Mage Hunter', pct: 0 },
  { name: 'Channeler', pct: 0 }
]
