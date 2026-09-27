// Spell effect ids (SPAs) as spells_us.txt numbers them, named once. EQEmu's spdat.h is the reference.

export const SPA = {
  HP: 0,
  AC: 1,
  ATTACK: 2,
  MOVEMENT: 3,
  HASTE: 11,
  CHARM: 22,
  BIND: 25,
  MEZ: 31,
  SUMMON_PET: 33,
  SUMMON_SKELETON_PET: 71,
  SUMMON_WARDER: 106,
  PROC: 85,
  HEAL_OVER_TIME: 100,
  FOCUS_DURATION: 128,
  LIMIT_MAX_LEVEL: 134,
  LIMIT_EFFECT: 137,
  LIMIT_TYPE: 138,
  LIMIT_MIN_TICKS: 140
} as const

/** The seven stats' SPAs → their sheet abbreviations. */
export const STAT_SPA: Readonly<Record<number, 'STR' | 'DEX' | 'AGI' | 'STA' | 'INT' | 'WIS' | 'CHA'>> = { 4: 'STR', 5: 'DEX', 6: 'AGI', 7: 'STA', 8: 'INT', 9: 'WIS', 10: 'CHA' }

/** The five resists' SPAs → their sheet names. */
export const RESIST_SPA: Readonly<Record<number, 'FIRE' | 'COLD' | 'POISON' | 'DISEASE' | 'MAGIC'>> = { 46: 'FIRE', 47: 'COLD', 48: 'POISON', 49: 'DISEASE', 50: 'MAGIC' }

/** Effects that summon a pet: a pet, a skeleton, a warder. */
export const SUMMON_SPAS: readonly number[] = [SPA.SUMMON_PET, SPA.SUMMON_SKELETON_PET, SPA.SUMMON_WARDER]
