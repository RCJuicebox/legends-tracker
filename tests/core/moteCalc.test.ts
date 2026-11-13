import { describe, expect, it } from 'vitest'
import { fixItem, levelFromName, makeable, plan } from '../../src/core/moteCalc'

describe('mote upgrade planner', () => {
  it('uses the rank-N+1 mote: a +6 item with 5 xp takes 9 Superior (59 xp needed, 7 each), the 4 over carried on', () => {
    const p = plan(fixItem({ name: "Wu's Fist of Mastery +6", lvl: 6, xp: 5, to: 7 }), { superior: 9 })
    expect(p.steps[0]).toMatchObject({ from: 6, to: 7, need: 64, carried: 5, uses: [{ kind: 'mote', m: 6, n: 9 }] })
    expect(p.steps[0].short).toBeUndefined()
    expect(p.covered).toBe(1)
    expect(p.reached).toBe(7)
    expect(p.xp).toBe(4)
    expect(p.after![6]).toBe(0)
  })

  it('combines up from lower ranks once the stock that works runs out, and says how', () => {
    // Needs 9 Superior; has 7, plus 4 Greater (too low for a +6 item) that combine into 2 more.
    const p = plan(fixItem({ lvl: 6, xp: 5, to: 7 }), { superior: 7, greater: 4 })
    expect(p.steps[0].short).toBeUndefined()
    expect(p.steps[0].combos).toEqual([{ from: 5, n: 4, make: 2, to: 6 }])
    expect(p.steps[0].uses).toEqual([{ kind: 'mote', m: 6, n: 9 }])
    expect(p.after!.slice(5, 7)).toEqual([0, 0])
  })

  it('takes a mote on any item below its rank, xp past a level carrying on (in-game previews, 2026-11-12)', () => {
    // A Major mote (5 xp) on a +0 item showed +2 2/4.
    const p = plan(fixItem({ lvl: 0, to: 1 }), { major: 1 })
    expect(p).toMatchObject({ covered: 1, reached: 2, xp: 2 })
    expect(p.after![4]).toBe(0)
  })

  it('spends fragments at their item xp, and only below their rank', () => {
    // A Superior fragment (16 xp) on a +0 item showed +4 1/16.
    expect(plan(fixItem({ lvl: 0, to: 1 }), {}, { superior: 1 })).toMatchObject({ reached: 4, xp: 1, afterFragments: [0, 0, 0, 0, 0, 0, 0, 0, 0] })
    // Two Lesser fragments take a +0 item to +3 1/8; the game hands back the rest.
    const p = plan(fixItem({ lvl: 0, to: 5 }), {}, { lesser: 4 })
    expect(p.steps[0].uses).toEqual([{ kind: 'fragment', m: 2, n: 1 }])
    expect(p.steps[1].carried).toBe(2)
    expect(p.steps[2].uses).toEqual([{ kind: 'fragment', m: 2, n: 1 }])
    expect(p.steps[3].short).toBe(2)
    expect(p).toMatchObject({ covered: 3, reached: 3, xp: 1 })
    expect(p.afterFragments![2]).toBe(2)
  })

  it('spends what gives the item its xp cheapest first, by what it would give a spell instead', () => {
    // On a +0 item an Infinitesimal mote (1 xp for 1) beats a Minor fragment (3 xp for 4).
    const p = plan(fixItem({ lvl: 0, to: 2 }), { infinitesimal: 1 }, { minor: 1 })
    expect(p.steps[0].uses).toEqual([{ kind: 'mote', m: 0, n: 1 }])
    expect(p.steps[1].uses).toEqual([{ kind: 'fragment', m: 1, n: 1 }])
    // Making a Superior from four Greater costs what a Superior on hand does: cheaper than a Grand fragment.
    const q = plan(fixItem({ lvl: 6, to: 7 }), { greater: 20 }, { grand: 1 })
    expect(q.steps[0].uses).toEqual([{ kind: 'mote', m: 6, n: 10 }])
    expect(q.afterFragments![7]).toBe(1)
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
