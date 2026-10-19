import { describe, expect, it } from 'vitest'
import { exportChange, weeksOf } from '../../src/core/progress'

describe('Achievements › Progress (FEAT-032)', () => {
  it('counts completions a week, the newest week ending today', () => {
    const now = new Date(2026, 9, 19, 15, 0).getTime()
    const at = (d: number) => new Date(2026, 9, d, 12, 0).getTime()
    const weeks = weeksOf(
      [
        { name: 'a', at: at(19) },
        { name: 'b', at: at(14) },
        { name: 'c', at: at(12) }
      ],
      now
    )
    expect(weeks).toHaveLength(12)
    expect(weeks.slice(0, 2).map((w) => w.n)).toEqual([2, 1])
  })

  it('says what an export added since the one before', () => {
    const a = { at: 1, total: 10, done: { 'Slayer › Conquest': 2 }, slayer: { dogs: 40, cats: 10 } }
    const b = { at: 2, total: 12, done: { 'Slayer › Conquest': 3, 'General › Skills': 1 }, slayer: { dogs: 100, cats: 10 } }
    expect(exportChange(b, a)).toEqual({
      done: 2,
      slayer: 60,
      sections: [
        ['Slayer › Conquest', 1],
        ['General › Skills', 1]
      ]
    })
    expect(exportChange(a, undefined)).toEqual({ done: 0, slayer: 0, sections: [] })
  })
})
