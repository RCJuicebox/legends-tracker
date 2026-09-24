import { describe, expect, it } from 'vitest'
import { fixItem, levelFromName, makeable, plan } from '../src/core/moteCalc'

describe('mote upgrade planner', () => {
  it('uses the rank-N+1 mote: a +6 item with 5 xp takes 9 Superior (59 xp needed, 7 each, 4 over)', () => {
    const p = plan(fixItem({ name: "Wu's Fist of Mastery +6", lvl: 6, xp: 5, to: 7 }), { superior: 9 })
    expect(p.steps[0]).toMatchObject({ from: 6, to: 7, need: 59, count: 9, over: 4, short: 0 })
    expect(p.covered).toBe(1)
    expect(p.reached).toBe(7)
    expect(p.after![6]).toBe(0)
  })

  it('combines up from lower ranks for a shortfall, and says how', () => {
    // Needs 9 Superior; has 7, plus 4 Greater that combine into 2 more.
    const p = plan(fixItem({ lvl: 6, xp: 5, to: 7 }), { superior: 7, greater: 4 })
    expect(p.steps[0].short).toBe(0)
    expect(p.steps[0].combos).toEqual([{ from: 5, n: 4, make: 2, to: 6 }])
    expect(p.after!.slice(5, 7)).toEqual([0, 0])
  })

  it('reports how many short, and stops planning past a step it cannot cover', () => {
    const p = plan(fixItem({ lvl: 6, xp: 0, to: 8 }), { superior: 3 })
    expect(p.steps[0].short).toBe(7) // 64 xp needs 10 Superior
    expect(p.steps[1].unsourced).toBe(true)
    expect(p.covered).toBe(0)
  })

  it('counts what could be combined', () => {
    // 2 Infinitesimal + 9 Minor → 10 Minor → 5 Lesser; with 4 Lesser that makes 9.
    expect(makeable([2, 9, 4], 2)).toBe(9)
  })

  it('has no mote past +9, and reads the level off a name', () => {
    expect(plan(fixItem({ lvl: 10, to: 11 }), {}).steps[0].noMote).toBe(true)
    expect(levelFromName('Engineer’s Ring +6')).toBe(6)
    expect(fixItem({ lvl: 6, xp: 999, to: 3 })).toMatchObject({ lvl: 6, xp: 63, to: 7 })
  })
})
