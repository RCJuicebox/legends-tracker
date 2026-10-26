import { describe, expect, it } from 'vitest'
import { GONE_MS, GroupHealthLoop, SEARCH_MS } from '../../src/main/groupHealthLoop'
import type { GroupHealthFromWorker } from '../../src/main/groupHealth'
import { JUICEBOX_PROFILE, type Frame, type GroupBar, type GroupHealthProfile } from '../../src/core/groupHealth'

// The group health watch's loop, driven with frames of its own (LT-627): where and when it searches,
// what it posts, and how it keeps the rows through a window over them.

const AREA = { x: 0, y: 0, width: 1000, height: 800 }
const OTHER = { x: 1000, y: 0, width: 1000, height: 800 }
const ROWS: GroupBar[] = [
  { left: 20, right: 200, top: 100 },
  { left: 20, right: 200, top: 120 }
]

function loop(
  o: {
    bars?: (area: { x: number; y: number }) => GroupBar[]
    fills?: () => (number | null)[]
    manas?: () => (number | null)[]
    player?: () => GroupBar | null
    myMana?: () => number | null
  } = {}
) {
  const posted: GroupHealthFromWorker[] = []
  /** The profile each search for the rows was made with. */
  const profiles: GroupHealthProfile[] = []
  let playerSearches = 0
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
    find: (f, p) => {
      profiles.push(p)
      return o.bars?.({ x: f.x, y: f.y }) ?? []
    },
    findPlayer: () => {
      playerSearches++
      return o.player?.() ?? null
    },
    playerFill: () => o.myMana?.() ?? null,
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
  return { l, posted, captured, tick, time: () => now, steps, profiles, playerSearches: () => playerSearches }
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

describe('your own mana (FEAT-043)', () => {
  const MANA: GroupBar = { left: 31, right: 294, top: 61 }

  it('finds the Player window solo, with the Group window not watched, and says your mana once it falls to the line', () => {
    let mana: number | null = 0.5
    const { l, posted, captured, tick, profiles } = loop({ bars: () => ROWS, player: () => MANA, myMana: () => mana })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, myManaPct: 20, group: false })
    // Searched once: the rows not looked for, your bar found and posted.
    expect(profiles).toEqual([])
    expect(posted).toEqual([{ kind: 'player', bar: MANA }])
    tick(200)
    // Sampled by itself, a small piece around the bar.
    expect(captured.at(-1)).toEqual({ x: 29, y: 59, width: 268, height: 18 })
    mana = 0.18
    tick(200)
    // A cast bar over it: skipped, not taken for a fall or a rise.
    mana = null
    tick(200)
    mana = 0.17
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toEqual([{ kind: 'low', slot: 1, pct: 17, what: 'myMana' }])
    tick(200)
    expect(posted.filter((m) => m.kind === 'low')).toHaveLength(1)
  })

  it('reads no mana while paused for Cannibalization, and says it again once back if still low', () => {
    let mana = 0.5
    const { l, posted, tick } = loop({ player: () => MANA, myMana: () => mana })
    const config = (myManaPaused: boolean) =>
      l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, myManaPct: 70, group: false, myManaPaused })
    config(false)
    const lows = () => posted.filter((m) => m.kind === 'low')
    config(true)
    tick(200)
    tick(200)
    expect(lows()).toEqual([])
    config(false)
    tick(200)
    tick(200)
    expect(lows()).toEqual([{ kind: 'low', slot: 1, pct: 50, what: 'myMana' }])
    // Used again while still low: said again when ready, though never back over the line.
    config(true)
    mana = 0.6
    tick(200)
    config(false)
    tick(200)
    tick(200)
    expect(lows()).toHaveLength(2)
  })

  it('looks for the Player window only while the cue is on, and forgets it when switched off', () => {
    const { l, posted, tick, playerSearches } = loop({ bars: () => ROWS, player: () => MANA, myMana: () => 0.9 })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true })
    tick(200)
    expect(playerSearches()).toBe(0)
    expect(posted).toEqual([{ kind: 'bars', bars: ROWS }])
    // Switched on: looked for at the next step, with the rows.
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, myManaPct: 20 })
    tick(200)
    expect(playerSearches()).toBe(1)
    expect(posted.at(-1)).toEqual({ kind: 'player', bar: MANA })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, myManaPct: 0 })
    expect(posted.at(-1)).toEqual({ kind: 'player', bar: null })
    // The group switched off too: the rows let go.
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, group: false })
    expect(posted.at(-1)).toEqual({ kind: 'bars', bars: [] })
  })

  it('goes back to searching when your bar is gone and no rows are watched', () => {
    let player: GroupBar | null = MANA
    const { l, posted, tick, captured } = loop({ player: () => player, myMana: () => 0.9 })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, myManaPct: 20, group: false })
    player = null
    // Rechecked after fifteen seconds: gone, posted, and searched for again from the short wait.
    tick(15_000)
    expect(posted.at(-1)).toEqual({ kind: 'player', bar: null })
    const n = captured.length
    tick(500)
    expect(captured).toHaveLength(n)
    tick(SEARCH_MS)
    expect(captured).toHaveLength(n + 1)
  })
})

describe("the skin's profile (FEAT-040)", () => {
  it('searches with the profile it is sent, and searches afresh when it changes', () => {
    const { l, posted, profiles, tick } = loop({ bars: () => ROWS })
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true })
    expect(profiles).toEqual([JUICEBOX_PROFILE])
    // The same profile again: nothing new.
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, profile: JUICEBOX_PROFILE })
    expect(profiles).toHaveLength(1)
    const other = { ...JUICEBOX_PROFILE, hpInner: 12 }
    l.message({ kind: 'config', on: true, areas: [AREA], belowPct: 25, rearmPct: 35, front: true, profile: other })
    tick(200)
    // The rows let go, then found again with the new one at the next step.
    expect(posted.slice(-2)).toEqual([
      { kind: 'bars', bars: [] },
      { kind: 'bars', bars: ROWS }
    ])
    expect(profiles.at(-1)).toBe(other)
  })
})
