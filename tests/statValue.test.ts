import { describe, expect, it } from 'vitest'
import { conversions, rawWeights, ROLE_PRESETS, statSlope } from '../src/core/statValue'
import { isTwoHanded, restrictions } from '../src/core/upgrades'

// Shadowknight / Monk / Shaman at 50, as basedata.txt has them.
const factors = { shd: { hp: 4.8, mana: 4.5, end: 3.25 }, mnk: { hp: 4.25, mana: 0, end: 4.5 }, shm: { hp: 4.25, mana: 4.5, end: 3.25 } }
const base = { classes: ['shd', 'mnk', 'shm'], factors, hpBonusPct: 12, evasionPct: 12 }

describe('what a point of a stat is worth', () => {
  it('turns STA into HP with the two best hp factors, halved past 255', () => {
    const under = conversions({ ...base, stats: { STR: 234, STA: 250, AGI: 180, DEX: 162, WIS: 238, INT: 223 } })
    expect(under.hpPerSta).toBeCloseTo((4.8 + 4.25) * 1.12, 5)
    const over = conversions({ ...base, stats: { STR: 234, STA: 265, AGI: 180, DEX: 162, WIS: 238, INT: 223 } })
    expect(over.hpPerSta).toBeCloseTo(((4.8 + 4.25) * 1.12) / 2, 5)
  })

  it('gives each caster its own stat, and slows past 200', () => {
    expect([statSlope(90), statSlope(150), statSlope(238)]).toEqual([1, 2.5, 1.25])
    const c = conversions({ ...base, stats: { STR: 234, STA: 265, AGI: 180, DEX: 162, WIS: 238, INT: 150 } })
    expect(c.manaPerWis).toBeCloseTo(4.5 * 1.25, 5) // shaman
    expect(c.manaPerInt).toBeCloseTo(4.5 * 2.5, 5) // shadowknight, under 200
    expect(c.endPer.STR).toBeCloseTo(((4.5 + 3.25) / 4) * 1.25, 5)
  })

  it('makes a tank value STA for the HP it buys', () => {
    const c = conversions({ ...base, stats: { STR: 234, STA: 250, AGI: 180, DEX: 162, WIS: 238, INT: 223 } })
    const w = rawWeights(ROLE_PRESETS.Tank, c)
    expect(w.sta).toBeGreaterThan(10 * w.hp)
    expect(w.cha).toBe(0)
  })
})

describe('weapons', () => {
  it('knows a two-hander by its skill', () => {
    expect(isTwoHanded(restrictions('Slot: PRIMARY<br>\nSkill: 2H Slashing  Atk Delay: 40<br>'))).toBe(true)
    expect(isTwoHanded(restrictions('Slot: PRIMARY SECONDARY<br>\nSkill: Hand to Hand  Atk Delay: 22<br>'))).toBe(false)
  })
})
