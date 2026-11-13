import { describe, expect, it } from 'vitest'
import { combineScans, mergeRebuilt, type CharacterScan } from '../../src/core/moteMerge'
import type { MoteCounts, MoteState } from '../../src/core/motes'

const scan = (logPath: string, daily: Record<string, MoteCounts>, dailyFragments?: Record<string, MoteCounts>): CharacterScan => ({
  logPath,
  stem: logPath,
  state: { active: null, sessions: [], daily, ...(dailyFragments ? { dailyFragments } : {}) },
  lastTime: 0,
  end: 0
})

describe('a rebuild of the mote history', () => {
  it("adds every character's fragments up by day, beside the motes", () => {
    const rebuilt = combineScans(
      {
        characters: [scan('a.txt', { '2026-11-12': { major: 1 } }, { '2026-11-12': { superior: 1 } }), scan('b.txt', {}, { '2026-11-12': { superior: 2, minor: 1 } })],
        days: ['2026-11-12']
      },
      'a.txt',
      false
    )
    expect(rebuilt.daily).toEqual({ '2026-11-12': { major: 1 } })
    expect(rebuilt.dailyFragments).toEqual({ '2026-11-12': { superior: 3, minor: 1 } })
  })

  it("takes the logs' fragment counts for the days they cover and keeps the others", () => {
    const current: MoteState = { active: null, sessions: [], daily: {}, dailyFragments: { '2026-11-11': { major: 4 }, '2026-11-12': { major: 9 } } }
    const merged = mergeRebuilt(current, { sessions: [], daily: {}, dailyFragments: { '2026-11-12': { major: 1 } }, days: ['2026-11-12'], active: null })
    expect(merged.dailyFragments).toEqual({ '2026-11-11': { major: 4 }, '2026-11-12': { major: 1 } })
  })
})
