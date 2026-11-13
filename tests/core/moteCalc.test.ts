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
    expect(plan(fixItem({ lvl: 0, to: 5 }), {}, { superior: 1 })).toMatchObject({ reached: 4, xp: 1, afterFragments: [0, 0, 0, 0, 0, 0, 0, 0, 0] })
    // Two Lesser fragments take a +0 item to +3 1/8; the game hands back the rest.
    const p = plan(fixItem({ lvl: 0, to: 5 }), {}, { lesser: 4 })
    expect(p.steps[0].uses).toEqual([{ kind: 'fragment', m: 2, n: 1 }])
    expect(p.steps[1].carried).toBe(2)
    expect(p.steps[2].uses).toEqual([{ kind: 'fragment', m: 2, n: 1 }])
    expect(p.steps[3].short).toBe(2)
    expect(p).toMatchObject({ covered: 3, reached: 3, xp: 1 })
    expect(p.afterFragments![2]).toBe(2)
  })

  it('spends motes first, even where a fragment would give the xp cheaper', () => {
    // On a +1 item a Minor fragment gives 3 xp for a worth of 4, a Lesser mote 2 for 4: the mote still goes first.
    const p = plan(fixItem({ lvl: 1, to: 2 }), { lesser: 1 }, { minor: 1 })
    expect(p.steps[0].uses).toEqual([{ kind: 'mote', m: 2, n: 1 }])
    expect(p.afterFragments![1]).toBe(1)
    // With no mote left, a fragment pays, but only one that fits: +0 to +2 takes 3 xp and an Infinitesimal mote gives 1,
    // so a Lesser fragment's 4 or a Minor's 3 would go past +2. Both are kept: the plan is 2 Minor motes short.
    const r = plan(fixItem({ lvl: 0, to: 2 }), { infinitesimal: 1 }, { lesser: 1, minor: 1 })
    expect(r.steps[1]).toMatchObject({ uses: [], short: 2 })
    expect(r.covered).toBe(1)
    // Making a Superior from four Greater costs what a Superior on hand does: motes before a Grand fragment.
    const q = plan(fixItem({ lvl: 6, to: 7 }), { greater: 20 }, { grand: 1 })
    expect(q.steps[0].uses).toEqual([{ kind: 'mote', m: 6, n: 10 }])
    expect(q.afterFragments![7]).toBe(1)
  })

  it('never spends a fragment whose xp would go past the level planned to', () => {
    // A Minor fragment's 3 xp on a +0 item planned to +1 (1 xp) would waste 2.
    expect(plan(fixItem({ lvl: 0, to: 1 }), {}, { minor: 1 })).toMatchObject({ covered: 0, steps: [{ short: 1, uses: [] }] })
    // Planned to +2 (3 xp) it fits exactly.
    expect(plan(fixItem({ lvl: 0, to: 2 }), {}, { minor: 1 })).toMatchObject({ covered: 2, reached: 2, xp: 0 })
    // Of those that fit, the cheapest by spell worth: two Infinitesimal (2 xp for 2) before a Minor (3 for 4).
    expect(plan(fixItem({ lvl: 0, to: 2 }), {}, { minor: 1, infinitesimal: 2 }).steps[0].uses).toEqual([{ kind: 'fragment', m: 0, n: 1 }])
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
