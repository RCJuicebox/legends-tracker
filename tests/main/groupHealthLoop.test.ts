import { describe, expect, it } from 'vitest'
import { GONE_MS, GroupHealthLoop, SEARCH_MS } from '../../src/main/groupHealthLoop'
import type { GroupHealthFromWorker } from '../../src/main/groupHealth'
import type { Frame, GroupBar } from '../../src/core/groupHealth'

// The group health watch's loop, driven with frames of its own (LT-627): where and when it searches,
// what it posts, and how it keeps the rows through a window over them.

const AREA = { x: 0, y: 0, width: 1000, height: 800 }
const OTHER = { x: 1000, y: 0, width: 1000, height: 800 }
const ROWS: GroupBar[] = [
  { left: 20, right: 200, top: 100 },
  { left: 20, right: 200, top: 120 }
]

function loop(o: { bars?: (area: { x: number; y: number }) => GroupBar[]; fills?: () => (number | null)[]; manas?: () => (number | null)[] } = {}) {
  const posted: GroupHealthFromWorker[] = []
  const captured: { x: number; y: number; width: number; height: number }[] = []
  let now = 1_000_000
  const steps: (() => void)[] = []
  const l = new GroupHealthLoop({
    capture: (x, y, width, height) => {
      captured.push({ x, y, width, height })
      return { x, y, width, height, data: new Uint8Array(0) } as unknown as Frame
    },
    post: (m) => posted.push(m),
    now: () => now,
    later: (fn) => steps.push(fn),
    find: (f) => o.bars?.({ x: f.x, y: f.y }) ?? [],
    fill: (_, b) => (o.fills?.() ?? [0.9, 0.9])[ROWS.findIndex((r) => r.top === b.top)],
    mana: (_, b) => (o.manas?.() ?? [0.9, 0.9])[ROWS.findIndex((r) => r.top === b.top)]
  })
  /** Runs the step scheduled last, `ms` later. */
  const tick = (ms: number) => {
    now += ms
    const fn = steps.pop()
    steps.length = 0
    fn?.()
  }
  return { l, posted, captured, tick, time: () => now, steps }
}

describe('GroupHealthLoop', () => {
  it('says low mana apart from health once switched on, and a named row at its own line (LT-751)', () => {
    let fills: (number | null)[] = [0.9, 0.9]
    let manas: (number | null)[] = [0.9, 0.9]
    const { l, posted, tick } = loop({ bars: () => ROWS, fills: () => fills, manas: () => manas })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true })
    manas = [0.1, 0.9]
    tick(200)
    tick(200)
    // Mana off: nothing.
    expect(posted.filter((m) => m.kind === 'low')).toEqual([])
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, manaPct: 15, rowLines: { 120: 40 } })
    fills = [0.9, 0.38]
    tick(200)
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toEqual([
      { kind: 'low', slot: 2, pct: 38 },
      { kind: 'low', slot: 1, pct: 10, what: 'mana' }
    ])
  })

  it('searches one monitor at a time only while the game is in front, backing off to a minute when nothing is found (LT-549)', () => {
    const { l, captured, tick, steps } = loop()
    l.message({ kind: 'config', on: true, areas: [AREA, OTHER], belowPct: 25, rearmPct: 35, front: true })
    // Turned on: the first monitor searched at once.
    expect(captured).toEqual([AREA])
    tick(500)
    expect(captured).toHaveLength(1)
    // Four seconds on: the other monitor; a round of both and nothing, the wait doubles.
    tick(SEARCH_MS)
    expect(captured).toEqual([AREA, OTHER])
    tick(SEARCH_MS)
    expect(captured).toHaveLength(2)
    tick(SEARCH_MS)
    expect(captured).toHaveLength(3)
    // Not in front: no search at all, however long.
    l.message({ kind: 'config', on: true, areas: [AREA, OTHER], belowPct: 25, rearmPct: 35, front: false })
    tick(120_000)
    tick(120_000)
    expect(captured).toHaveLength(3)
    // Back in front: looked for at the next turn, from the short wait again.
    l.message({ kind: 'config', on: true, areas: [AREA, OTHER], belowPct: 25, rearmPct: 35, front: true })
    tick(500)
    expect(captured).toHaveLength(4)
    expect(steps).toHaveLength(1)
  })

  it('finds the rows, samples them, says a member low once, and keeps the rows through a cover (LT-550)', () => {
    let fills: (number | null)[] = [0.9, 0.9]
    let there = true
    const { l, posted, captured, tick } = loop({ bars: (a) => (there && a.x === AREA.x ? ROWS : []), fills: () => fills })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true })
    expect(posted).toEqual([{ kind: 'bars', bars: ROWS }])
    // Samples copy the bars' area alone.
    tick(200)
    expect(captured.at(-1)).toMatchObject({ x: 18, y: 98 })
    // The second row falls to the line: said after two low samples, once.
    fills = [0.9, 0.2]
    tick(200)
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toEqual([{ kind: 'low', slot: 2, pct: 20 }])
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toHaveLength(1)
    // A window over the rows: five unreadable samples make it look again on its own monitor; the rows are still there, and nothing is said again.
    fills = [null, null]
    for (let i = 0; i < 5; i++) tick(200)
    there = true
    tick(200)
    expect(posted.filter((m) => m.kind === 'bars')).toHaveLength(1)
    fills = [0.9, 0.2]
    tick(200)
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toHaveLength(1)
    // Gone for good: given up only after ten seconds unreadable, then everyone starts over.
    there = false
    fills = [null, null]
    for (let i = 0; i < 6; i++) tick(200)
    expect(posted.filter((m) => m.kind === 'bars')).toHaveLength(1)
    tick(GONE_MS)
    expect(posted.at(-1)).toEqual({ kind: 'bars', bars: [] })
  })

  it('posts an error from a capture that throws, and goes on searching', () => {
    const posted: GroupHealthFromWorker[] = []
    const steps: (() => void)[] = []
    const l = new GroupHealthLoop({
      capture: () => {
        throw new Error('Windows would not copy the screen')
      },
      post: (m) => posted.push(m),
      now: () => 1_000_000,
      later: (fn) => steps.push(fn)
    })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true })
    expect(posted).toEqual([{ kind: 'error', message: 'Windows would not copy the screen' }])
    expect(steps).toHaveLength(1)
  })
})
