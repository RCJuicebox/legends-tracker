import { describe, expect, it } from 'vitest'
import { zonePaces } from '../../../src/features/slayer/main'

describe("the Slayer history's pace in each zone, for the faction plan (LT-734)", () => {
  it('gives every zone hunted a quarter hour its kills an hour, by zone key, and leaves out the rest', () => {
    const z = (sec: number, kills: number) => ({ sec, kills, last: 0, mobs: {} })
    expect(zonePaces({ 'The Plane of Fear': z(1800, 60), Befallen: z(600, 40) })).toEqual({ planeoffear: 120 })
  })
})
