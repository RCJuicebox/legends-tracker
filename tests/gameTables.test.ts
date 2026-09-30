import { describe, expect, it } from 'vitest'
import { acCapsOf, classFactorsOf, parseGameTables, skillCapsOf } from '../src/core/gameTables'

// Rows as the game's Resources folder has them (skillcaps.txt, ACMitigation.txt, basedata.txt, read
// 2026-09-30). Class numbers are classic EverQuest's: 5 Shadow Knight, 7 Monk, 10 Shaman; skill 0 is
// 1H Blunt, 28 Hand to Hand, 33 Offense.
const SKILLCAPS = [
  '5^0^49^246^0^',
  '5^0^50^250^0^',
  '5^0^51^253^0^',
  '5^28^50^195^0^',
  '5^33^50^200^0^',
  '7^0^50^270^0^',
  '7^28^1^10^0^',
  '7^28^2^20^0^',
  '7^28^50^270^0^',
  '7^33^50^230^0^',
  '10^0^50^220^0^',
  '10^28^50^150^0^',
  '10^33^50^200^0^',
  ''
].join('\r\n')

const AC_MITIGATION = ['#CLASS^LVL^AC_CAP^SOFT_CAP_MULTIPLIER^', '5^49^390^0.33^', '5^50^392^0.33^', '7^49^358^0.3^', '7^50^360^0.3^', '10^50^348^0.28^'].join('\r\n')

const BASEDATA = ['50^5^1440^900^652^7^13^4.8^4.5^3.250^', '50^7^1275^0^900^7^13^4.25^0^4.5^', '50^10^1275^900^456^7^13^4.25^4.5^3.250^'].join('\r\n')

const tables = () => parseGameTables({ skillcaps: SKILLCAPS, acMitigation: AC_MITIGATION, basedata: BASEDATA })

describe("the game's tables", () => {
  it('reads each class’s skill caps by level, and gives the best of a trio at a level', () => {
    const t = tables()
    expect(t.skills.get(7)?.get(28)?.slice(0, 2)).toEqual([10, 20])
    // Monk/Shadow Knight/Shaman at 50: each skill at the best of the three, highest first.
    expect(skillCapsOf(t, ['mnk', 'shd', 'shm'], 50)).toEqual([
      { id: 0, cap: 270, from: 'mnk' },
      { id: 28, cap: 270, from: 'mnk' },
      { id: 33, cap: 230, from: 'mnk' }
    ])
    expect(skillCapsOf(t, ['shd', 'shm'], 50)).toEqual([
      { id: 0, cap: 250, from: 'shd' },
      { id: 33, cap: 200, from: 'shd' },
      { id: 28, cap: 195, from: 'shd' }
    ])
    // A level past the table's last row reads the last; an unknown class adds nothing.
    expect(skillCapsOf(t, ['shd'], 60).find((r) => r.id === 0)?.cap).toBe(253)
    expect(skillCapsOf(t, ['xyz'], 50)).toEqual([])
  })

  it('reads the AC soft cap and its multiplier, skipping the header', () => {
    const t = tables()
    expect(acCapsOf(t, ['shd', 'mnk', 'shm'], 50)).toEqual({ shd: { cap: 392, mult: 0.33 }, mnk: { cap: 360, mult: 0.3 }, shm: { cap: 348, mult: 0.28 } })
    expect(acCapsOf(t, ['mnk'], 49)).toEqual({ mnk: { cap: 358, mult: 0.3 } })
  })

  it('reads what a point of each stat is worth per class and level', () => {
    const t = tables()
    expect(classFactorsOf(t, ['shd', 'mnk'], 50)).toEqual({ shd: { hp: 4.8, mana: 4.5, end: 3.25 }, mnk: { hp: 4.25, mana: 0, end: 4.5 } })
    expect(classFactorsOf(t, ['shd'], 49)).toEqual({})
  })

  it('reads nothing from files that could not be read', () => {
    const t = parseGameTables({ skillcaps: '', acMitigation: '', basedata: '' })
    expect(skillCapsOf(t, ['mnk'], 50)).toEqual([])
    expect(acCapsOf(t, ['mnk'], 50)).toEqual({})
  })
})
