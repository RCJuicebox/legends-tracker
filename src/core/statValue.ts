// What a point of each stat is worth to one character, and roles that weigh outcomes rather than
// raw stats. A role says how much it values HP, mana, AC, avoidance, offense, haste…; the character's
// own classes, level and current stats say how much of each outcome a point of STA, WIS, AGI… buys.
// The formulas are the ones the Stats page reproduces from the game (EQEmu's, checked in game):
//   HP per STA        the two best classes' hp factor, summed, × the base-HP AA bonus; STA over 255
//                     counts half
//   mana per WIS/INT  each casting class's mana factor × the stat's conversion slope (1 up to 100,
//                     2.5 to 200, 1.25 past 200), each class using its own stat
//   end per STR/STA/DEX/AGI  the two best endurance factors × the slope ÷ 4 (it averages the four)
//   offense per STR   ⅔ above 75
//   avoidance per AGI 8000/36000, raised by melee-avoidance AAs; and AC sum +1 per 20 AGI

import type { Weights } from './upgrades'

/** Per class, from the game's Resources/basedata.txt at the character's level. */
export interface ClassFactors {
  hp: number
  mana: number
  end: number
}

/** Classes whose mana comes from wisdom; the other casters use intelligence. */
const WIS_CASTERS = ['clr', 'dru', 'shm', 'pal', 'rng', 'bst']

export interface CharacterStats {
  STR: number
  STA: number
  AGI: number
  DEX: number
  WIS: number
  INT: number
}

export interface Conversions {
  hpPerSta: number
  manaPerWis: number
  manaPerInt: number
  endPer: Record<'STR' | 'STA' | 'AGI' | 'DEX', number>
  offensePerStr: number
  avoidancePerAgi: number
  /** In gear-AC terms: AGI adds to the AC sum at 1/20, gear AC at 4/3. */
  acPerAgi: number
  /** Plain-language notes on what shaped the numbers, for the page to show. */
  notes: string[]
}

/** How much a stat's next point moves the game's stat conversion. */
export function statSlope(x: number): number {
  return x <= 100 ? 1 : x <= 200 ? 2.5 : 1.25
}

export function conversions(o: {
  classes: string[]
  factors: Record<string, ClassFactors>
  stats: CharacterStats
  /** Base-HP AAs (Natural Durability), %. */
  hpBonusPct: number
  /** Melee-avoidance AAs (SPA 172), %. */
  evasionPct: number
}): Conversions {
  const f = o.classes.map((c) => ({ c, ...(o.factors[c] ?? { hp: 0, mana: 0, end: 0 }) }))
  const topTwo = (key: 'hp' | 'end') =>
    f
      .map((x) => x[key])
      .sort((a, b) => b - a)
      .slice(0, 2)
      .reduce((a, b) => a + b, 0)
  const notes: string[] = []
  const staHalf = o.stats.STA > 255
  const hpPerSta = topTwo('hp') * (1 + o.hpBonusPct / 100) * (staHalf ? 0.5 : 1)
  if (staHalf) notes.push(`STA is past 255, where each point counts half: ${hpPerSta.toFixed(1)} HP a point`)
  else notes.push(`${hpPerSta.toFixed(1)} HP per point of STA`)
  const wisCasters = f.filter((x) => x.mana > 0 && WIS_CASTERS.includes(x.c))
  const intCasters = f.filter((x) => x.mana > 0 && !WIS_CASTERS.includes(x.c))
  const manaPerWis = wisCasters.reduce((a, x) => a + x.mana, 0) * statSlope(o.stats.WIS)
  const manaPerInt = intCasters.reduce((a, x) => a + x.mana, 0) * statSlope(o.stats.INT)
  if (manaPerWis) notes.push(`${manaPerWis.toFixed(1)} mana per WIS${o.stats.WIS > 200 ? ' (past 200, half as much)' : ''}`)
  if (manaPerInt) notes.push(`${manaPerInt.toFixed(1)} mana per INT${o.stats.INT > 200 ? ' (past 200, half as much)' : ''}`)
  const endFactor = topTwo('end') / 4
  const endPer = {
    STR: endFactor * statSlope(o.stats.STR),
    STA: endFactor * statSlope(o.stats.STA),
    AGI: endFactor * statSlope(o.stats.AGI),
    DEX: endFactor * statSlope(o.stats.DEX)
  }
  return {
    hpPerSta,
    manaPerWis,
    manaPerInt,
    endPer,
    offensePerStr: o.stats.STR >= 75 ? 2 / 3 : 0,
    avoidancePerAgi: (8000 / 36000) * (1 + o.evasionPct / 100),
    acPerAgi: 1 / 20 / (4 / 3),
    notes
  }
}

export type RoleKey =
  | 'hp' | 'mana' | 'end' | 'ac' | 'avoidance' | 'offense' | 'attack' | 'procs'
  | 'haste' | 'resists' | 'hpRegen' | 'manaRegen' | 'endRegen' | 'ratio'

export type RoleWeights = Record<RoleKey, number>

export const ROLE_LABELS: Record<RoleKey, string> = {
  hp: 'HP', mana: 'Mana', end: 'Endurance', ac: 'AC (gear)', avoidance: 'Avoidance', offense: 'Offense', attack: 'Attack (ATK)',
  procs: 'Procs (DEX)', haste: 'Haste %', resists: 'Resists', hpRegen: 'HP regen', manaRegen: 'Mana regen', endRegen: 'End regen',
  ratio: 'Weapon ratio'
}

/**
 * What each role values, per unit of outcome. Tank is in HP-equivalents: 1 gear AC ≈ 8 HP (tanks
 * commonly count 7-12 under the cap; the soft-cap rule then quarters it), a point of HP regen a tick
 * ≈ 25 HP over a fight. Melee values Offense, haste and weapon ratio; Caster values mana and its regen.
 */
export const ROLE_PRESETS: Record<string, RoleWeights> = {
  Balanced: { hp: 0.6, mana: 0.4, end: 0.2, ac: 5, avoidance: 0.8, offense: 1, attack: 0.5, procs: 0.4, haste: 8, resists: 0.8, hpRegen: 15, manaRegen: 12, endRegen: 3, ratio: 40 },
  Tank: { hp: 1, mana: 0.15, end: 0.1, ac: 8, avoidance: 1.5, offense: 0.5, attack: 0.3, procs: 0.2, haste: 6, resists: 1.2, hpRegen: 25, manaRegen: 3, endRegen: 3, ratio: 40 },
  Melee: { hp: 0.25, mana: 0, end: 0.3, ac: 2, avoidance: 0.3, offense: 2, attack: 1, procs: 0.8, haste: 15, resists: 0.3, hpRegen: 5, manaRegen: 0, endRegen: 5, ratio: 80 },
  Caster: { hp: 0.3, mana: 1, end: 0, ac: 1.5, avoidance: 0.2, offense: 0, attack: 0, procs: 0, haste: 0, resists: 0.6, hpRegen: 5, manaRegen: 30, endRegen: 0, ratio: 0 }
}

/** The role's weights turned into what a raw point of each item stat is worth to this character. */
export function rawWeights(role: RoleWeights, c: Conversions): Weights {
  return {
    ac: role.ac,
    hp: role.hp,
    mana: role.mana,
    end: role.end,
    str: role.offense * c.offensePerStr + role.end * c.endPer.STR,
    sta: role.hp * c.hpPerSta + role.end * c.endPer.STA,
    agi: role.avoidance * c.avoidancePerAgi + role.ac * c.acPerAgi + role.end * c.endPer.AGI,
    dex: role.procs + role.end * c.endPer.DEX,
    wis: role.mana * c.manaPerWis,
    int: role.mana * c.manaPerInt,
    cha: 0,
    resists: role.resists,
    haste: role.haste,
    attack: role.attack,
    hpRegen: role.hpRegen,
    manaRegen: role.manaRegen,
    endRegen: role.endRegen,
    ratio: role.ratio
  }
}
