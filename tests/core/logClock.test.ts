import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAaDumps } from '../../src/core/aa'
import { LogClock, parseLogLine } from '../../src/core/logLine'

// New York's clocks go back at 02:00 on Sunday 1 November 2026: 01:00 to 01:59 happens twice.
const zone = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

const at = (clock: string, text = "You say, 'hi'") => `[Sun Nov 01 ${clock} 2026] ${text}`

describe('the hour the clocks go back', () => {
  it('is read twice the same way by the plain parser, which is why the clock is needed', () => {
    expect(parseLogLine(at('01:30:00'))!.time).toBe(Date.UTC(2026, 10, 1, 5, 30))
  })

  it('keeps times in order through the repeated hour', () => {
    const clock = new LogClock()
    const times = ['00:59:58', '01:30:00', '01:59:59', '01:00:00', '01:30:00', '01:59:59', '02:00:00'].map((t) => clock.parse(at(t))!.time)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    // The second 01:30 is an hour after the first; 02:00 is standard time, an hour after the second 01:00.
    expect(times[4] - times[1]).toBe(3_600_000)
    expect(times[6] - times[3]).toBe(3_600_000)
  })

  it('leaves a step back outside that hour alone', () => {
    const clock = new LogClock()
    clock.parse(`[Tue Sep 01 12:30:00 2026] a`)
    expect(clock.parse(`[Tue Sep 01 11:30:00 2026] b`)!.time).toBe(new Date(2026, 8, 1, 11, 30).getTime())
  })

  it('keeps an AA dump whole when it runs across the change', () => {
    const lines = [
      at('01:59:58', 'Ability #1: Combat Stability'),
      at('01:59:58', 'Description: Raises your armor class soft cap by 10%.'),
      at('01:59:58', 'Cost per Level: 3'),
      at('01:00:00', 'Ability #2: Combat Fury'),
      at('01:00:00', 'Description: Improves your chance to land a critical hit with all skills by 5%.'),
      at('01:00:00', 'Cost per Level: 3')
    ]
    expect(findAaDumps(lines).map((d) => d.length)).toEqual([2])
  })
})
