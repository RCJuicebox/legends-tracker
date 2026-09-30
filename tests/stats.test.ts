import { describe, expect, it } from 'vitest'
import { computeAc, type AcInputs } from '../src/core/acModel'
import {
  avoidanceFromHitRate,
  baseAccuracy,
  damageBonusPct,
  doubleAttackChance,
  dualWieldChance,
  hitChance,
  stanceAccuracy,
  swingsPerRound,
  tripleAttackChance,
  windowOffense
} from '../src/core/combatModel'
import { aaEffects, aaTotal, latestAas } from '../src/core/aa'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The test character (Shadowknight/Monk/Shaman Iksar at 50, unbuffed) as the in-game Inventory
// window read on 12 September, with the calculator inputs worked out then.
const reading = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'baseline-2026-09-12.json'), 'utf8'))
const inputs = reading.calculator_check.inputs
const baseline: AcInputs = {
  trio: ['shd', 'mnk', 'shm'],
  cls: 'shd',
  race: 'iksar',
  level: reading.character.level,
  defense: inputs.defense_skill,
  agility: inputs.functional_agility,
  heroicAgility: inputs.heroic_agility,
  heroicStrength: 0,
  drunk: 0,
  itemAC: inputs.worn_ac,
  shieldAC: inputs.shield_ac,
  itemAvoidance: inputs.item_avoidance,
  foodDrinkAC: 0,
  tributeAC: 0,
  acBuffs: 0,
  armorOfWisdom: 0,
  herosFortitude: 0,
  combatStability: inputs.spa_259_pct,
  softCap: inputs.soft_cap_table,
  multiplier: inputs.post_cap_multiplier,
  // Not in the reading as numbers: the Monk's weight is "under 17", and evasion is taken as the same AAs.
  weight: 14,
  evasion: inputs.spa_259_pct
}

describe('AC', () => {
  it("reproduces the Inventory window's mitigation, soft cap and avoidance", () => {
    const r = computeAc(baseline)
    expect([r.mitigation, r.effCap, r.avoidance]).toEqual(reading.vitals.ac)
  })

  it('predicted the ring-off reading before it was taken (the ring 28 AC and 9 agility)', () => {
    const ring = reading.ring_off.ring_contribution
    const r = computeAc({ ...baseline, itemAC: inputs.worn_ac - ring.ac, agility: inputs.functional_agility - ring.each_stat })
    expect([r.mitigation, r.effCap, r.avoidance]).toEqual(reading.ring_off.vitals.ac)
  })

  it("gives Dzarn's worked example: displayed 10,480 and mitigation 3,413", () => {
    const r = computeAc({
      trio: ['shd'],
      cls: 'shd',
      race: 'other',
      level: 100,
      defense: 390,
      agility: 1295,
      heroicAgility: 395,
      heroicStrength: 310,
      weight: 0,
      drunk: 0,
      itemAC: 5470,
      shieldAC: 350,
      itemAvoidance: 100,
      foodDrinkAC: 0,
      tributeAC: 0,
      acBuffs: 0,
      armorOfWisdom: 620,
      herosFortitude: 500,
      combatStability: 82,
      evasion: 0,
      softCap: 488,
      multiplier: 0.33
    })
    expect(r.displayed).toBe(10480)
    expect(r.mitigation).toBe(3413)
  })

  it('holds worn AC to 25 + 6 × level below 50 on the server side only', () => {
    const r = computeAc({ ...baseline, level: 30, itemAC: 400 })
    expect(r.srv.twinkCapped).toBe(true)
    expect(r.disp.twinkCapped).toBe(false)
  })
})

describe('combat', () => {
  it("reproduces the stats window's Attack line, bare-fisted and in Offensive", () => {
    expect(windowOffense(270, 230)).toBe(373)
    const acc = baseAccuracy(230, 270)
    expect(acc).toBe(625)
    expect(stanceAccuracy(acc, 25)).toBe(reading.vitals.attack[1])
    expect(stanceAccuracy(acc, 10)).toBe(687)
  })

  it('rolls to hit the way the dummy parses measured it', () => {
    // Offensive hit Test Sixty 70.01% (solving to avoidance ~468); Balanced was then predicted at 65.9% and hit 66.10%.
    expect(Math.round(avoidanceFromHitRate(0.7001, 781))).toBe(468)
    expect(hitChance(687, 468)).toBeCloseTo(0.659, 3)
    expect(hitChance(1, 500)).toBeCloseTo(0.001, 3)
  })

  it('gives about 3.05 swings a round for the parsed setup', () => {
    const dp = doubleAttackChance(240, 50)
    const swings = swingsPerRound({ double: dp, triple: tripleAttackChance(100), dual: dualWieldChance(252, 50, 42), doubleSkill: 240 })
    expect(dp).toBeCloseTo(0.58, 5)
    expect(swings).toBeGreaterThan(3)
  })
})

describe('AAs from the log', () => {
  const log = [
    '[Sat Sep 12 16:23:15 2026] You say, hello',
    '[Sat Sep 12 16:23:16 2026] Ability #33: Combat Stability',
    '[Sat Sep 12 16:23:16 2026] Description: Increases the armor class soft cap of your class by 10%.',
    '[Sat Sep 12 16:23:16 2026] Cost per Level: 3',
    '[Sat Sep 12 16:23:16 2026] Ability #34: Physical Enhancement',
    '[Sat Sep 12 16:23:16 2026] Description: Increases the armor class soft cap by 2% and',
    'increases your melee avoidance by 2%.',
    '[Sat Sep 12 16:23:16 2026] Cost per Level: 5',
    '[Sat Sep 12 16:23:17 2026] Ability #33: Combat Stability',
    '[Sat Sep 12 16:23:17 2026] Description: Increases the armor class soft cap of your class by 10%.',
    '[Sat Sep 12 16:23:17 2026] Cost per Level: 3',
    '[Sat Sep 12 16:24:00 2026] You have entered The Plane of Hate.'
  ].join('\n')

  it('reads the newest dump, once per ability, with wrapped descriptions', () => {
    const aa = latestAas(log)!
    expect(aa.count).toBe(2)
    expect(aaTotal(aa, 'softcap_pct')).toBe(12)
    expect(aaTotal(aa, 'avoidance_pct')).toBe(2)
    expect(latestAas('[Sat Sep 12 16:23:15 2026] nothing here')).toBeNull()
  })
})

describe('AAs from the log, on single-digit days', () => {
  it('reads a dump whose day is space-padded, and keeps the stamp exactly as written', () => {
    const log = [
      '[Wed Sep  9 16:23:16 2026] Ability #33: Combat Stability',
      '[Wed Sep  9 16:23:16 2026] Description: Increases the armor class soft cap of your class by 10%.',
      '[Wed Sep  9 16:23:16 2026] Cost per Level: 3'
    ].join('\n')
    const aa = latestAas(log)!
    expect(aa.count).toBe(1)
    expect(aa.when).toBe('Wed Sep  9 16:23:16 2026')
    expect(log.indexOf(`[${aa.when}] Ability #`)).toBe(0)
  })

  it('keeps a dump that runs across midnight together, and splits dumps minutes apart', () => {
    const entry = (stamp: string, id: number, name: string) => [
      `[${stamp}] Ability #${id}: ${name}`,
      `[${stamp}] Description: Increases the armor class soft cap of your class by 10%.`,
      `[${stamp}] Cost per Level: 3`
    ]
    const across = [...entry('Wed Sep  9 23:59:59 2026', 33, 'Combat Stability'), ...entry('Thu Sep 10 00:00:00 2026', 34, 'Other')].join('\n')
    expect(latestAas(across)!.count).toBe(2)
    const apart = [...entry('Thu Sep 10 00:00:00 2026', 33, 'Combat Stability'), ...entry('Thu Sep 10 00:05:00 2026', 34, 'Other')].join('\n')
    expect(latestAas(apart)!.count).toBe(1)
  })
})

describe('AA effects', () => {
  it('reads haste and armor class as well as the calculator figures', () => {
    expect(aaEffects('This passive ability grants a 10% increase in your current and maximum haste.')).toEqual({ haste_pct: 10 })
    expect(aaEffects('This passive ability increases your armor class by 24 points.')).toEqual({ ac: 24 })
    expect(aaEffects('This ability reduces the damage your opponent deals by 5%.')).toEqual({})
  })
})

describe('the melee damage table (EQEmu, below level 51)', () => {
  it('adds nothing under 115 Offense', () => {
    expect(damageBonusPct(false, 114)).toBe(100)
    expect(damageBonusPct(true, 0)).toBe(100)
  })

  it('averages its rows over the skipped share, a monk on its own table', () => {
    // At 115: ten rows, 100 to 109, averaging 104.5; 49% skipped (monks 45%).
    expect(damageBonusPct(false, 115)).toBeCloseTo(49 + 0.51 * 104.5, 6)
    expect(damageBonusPct(true, 115)).toBeCloseTo(45 + 0.55 * 104.5, 6)
    // At 400: 147 rows, the first 111 from 100 to 210 and 36 held at the 210 cap.
    expect(damageBonusPct(false, 400)).toBeCloseTo(49 + 0.51 * ((17205 + 36 * 210) / 147), 6)
  })
})
