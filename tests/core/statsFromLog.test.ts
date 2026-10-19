import { describe, expect, it } from 'vitest'
import { statsFromLog } from '../../src/core/statsFromLog'
import type { MeleeProfile } from '../../src/core/meleeTally'
import type { ItemInfo } from '../../src/shared/types'

describe('what Stats › Combat can take from the log (LT-739)', () => {
  const profile: MeleeProfile = {
    activeMin: 10,
    damage: 0,
    dpm: 0,
    skills: { punch: { hits: 80, damage: 0, misses: 20, crits: 8 }, kick: { hits: 20, damage: 0, misses: 0, crits: 2 } },
    procs: {},
    from: '2026-10-06',
    to: '2026-10-19'
  }
  const fist = { found: true, statsblock: 'Slot: PRIMARY SECONDARY<br>Skill: Hand to Hand Atk Delay: 22<br>DMG: 32 ATK: +5' } as unknown as ItemInfo

  it('sums the melee, maps skill names to ids, and reads the Primary and worn ATK', () => {
    const r = statsFromLog({
      profile,
      skills: { Kick: { value: 180, at: 1 }, 'Hand to Hand': { value: 220, at: 2 }, 'Not a skill': { value: 5, at: 3 } },
      worn: [{ location: 'Primary', name: "Wu's Fist of Mastery +10", id: 1, count: 1, augs: [] }],
      items: { 'wus fist of mastery': fist }
    })
    expect(r.melee).toEqual({ hits: 100, crits: 10, misses: 20, from: '2026-10-06', to: '2026-10-19' })
    expect(r.skills[30]).toBe(180)
    expect(r.skills[28]).toBe(220)
    expect(r.weapon).toBe(28)
    expect(r.itemATK).toBeGreaterThan(0)
  })

  it('says nothing of melee with none, and Hand to Hand with nothing in Primary', () => {
    const r = statsFromLog({ profile: null, skills: {}, worn: [], items: {} })
    expect(r.melee).toBeUndefined()
    expect(r.weapon).toBe(28)
    expect(r.itemATK).toBeUndefined()
  })
})
