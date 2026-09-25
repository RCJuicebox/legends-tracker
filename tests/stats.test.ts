import { describe, expect, it } from 'vitest'
import { computeAc, type AcInputs } from '../src/core/acModel'
import { avoidanceFromHitRate, baseAccuracy, doubleAttackChance, dualWieldChance, hitChance, stanceAccuracy, swingsPerRound, tripleAttackChance, windowOffense } from '../src/core/combatModel'
import { aaTotal, latestAas } from '../src/core/aa'

// A Shadowknight/Monk/Shaman Iksar at 50, unbuffed: the in-game Inventory window read 467 / 439 / 501.
const baseline: AcInputs = {
  trio: ['shd', 'mnk', 'shm'], cls: 'shd', race: 'iksar', level: 50, defense: 230, agility: 178, heroicAgility: 0, heroicStrength: 0,
  weight: 14, drunk: 0, itemAC: 251, shieldAC: 0, itemAvoidance: 0, foodDrinkAC: 0, tributeAC: 0, acBuffs: 0, armorOfWisdom: 0,
  herosFortitude: 0, combatStability: 12, evasion: 12, softCap: 392, multiplier: 0.33
}

describe('AC', () => {
  it("reproduces the Inventory window's mitigation, soft cap and avoidance", () => {
    const r = computeAc(baseline)
    expect([r.mitigation, r.effCap, r.avoidance]).toEqual([467, 439, 501])
  })

  it('predicted the ring-off reading before it was taken (12 Sep: 249 worn, the ring 28 AC and 9 agility)', () => {
    expect(computeAc({ ...baseline, itemAC: 249 }).mitigation).toBe(467)
    const r = computeAc({ ...baseline, itemAC: 249 - 28, agility: 169 })
    expect([r.mitigation, r.effCap, r.avoidance]).toEqual([454, 439, 499])
  })

  it("gives Dzarn's worked example: displayed 10,480 and mitigation 3,413", () => {
    const r = computeAc({
      trio: ['shd'], cls: 'shd', race: 'other', level: 100, defense: 390, agility: 1295, heroicAgility: 395, heroicStrength: 310, weight: 0, drunk: 0,
      itemAC: 5470, shieldAC: 350, itemAvoidance: 100, foodDrinkAC: 0, tributeAC: 0, acBuffs: 0, armorOfWisdom: 620, herosFortitude: 500,
      combatStability: 82, evasion: 0, softCap: 488, multiplier: 0.33
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
    expect(stanceAccuracy(acc, 25)).toBe(781)
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
