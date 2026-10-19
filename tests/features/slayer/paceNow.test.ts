import { describe, expect, it } from 'vitest'
import { paceNow } from '../../../src/features/slayer/core'

// The Slayer step at the player's pace now (FEAT-022): its mobs killed in its zone over the last twenty
// minutes, an hour's worth, and the step's time at that pace beside the plan's.

const MIN = 60_000
const NOW = 10 * 60 * MIN
const step = { zone: 'Clan Crushbone', seconds: 3600, mobs: [{ name: 'an orc pawn', n: 120 }] }
const kills = (times: number[], zone = 'Clan Crushbone') => new Map([['an orc pawn', { name: 'an orc pawn', times, zones: times.map(() => zone) }]])

describe('paceNow', () => {
  it('is the last twenty minutes’ kills of the step’s mobs, an hour’s worth, with the step’s time at it', () => {
    // 40 kills over the last 10 minutes: 240 an hour; 120 left takes half an hour; the plan assumed 120 an hour.
    const times = Array.from({ length: 40 }, (_, i) => NOW - 10 * MIN + i * 15_000)
    expect(paceNow(step, kills(times), NOW)).toEqual({ perHour: 240, seconds: 1800, planPerHour: 120 })
  })

  it('leaves out older kills, other zones’ and other mobs’, and says nothing on too few', () => {
    expect(paceNow(step, kills([NOW - 30 * MIN, NOW - 25 * MIN, NOW - MIN]), NOW)).toBeUndefined()
    expect(
      paceNow(
        step,
        kills(
          Array.from({ length: 10 }, (_, i) => NOW - i * MIN),
          'Befallen'
        ),
        NOW
      )
    ).toBeUndefined()
    expect(paceNow({ ...step, mobs: [{ name: 'a gnoll', n: 5 }] }, kills(Array.from({ length: 10 }, (_, i) => NOW - i * MIN)), NOW)).toBeUndefined()
    expect(paceNow(step, undefined, NOW)).toBeUndefined()
  })

  it('takes at least five minutes: a burst is not an hour’s pace', () => {
    const burst = Array.from({ length: 10 }, (_, i) => NOW - 60_000 + i * 6000)
    expect(paceNow(step, kills(burst), NOW)?.perHour).toBe(120)
  })
})
