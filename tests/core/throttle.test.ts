import { describe, expect, it } from 'vitest'
import { Backlog, Throttled } from '../../src/core/throttle'

describe('Backlog', () => {
  it('holds lines while active, in order, and says when it holds as many as it will', () => {
    const b = new Backlog<number>(3)
    expect(b.hold(1)).toBe(false)
    b.begin()
    for (const n of [1, 2]) expect(b.hold(n)).toBe(true)
    expect(b.full).toBe(false)
    b.hold(3)
    expect(b).toMatchObject({ full: true, size: 3 })
    // Still held, so none is lost: the reader stops and lets them through.
    b.hold(4)
    expect(b.end()).toEqual([1, 2, 3, 4])
    expect(b).toMatchObject({ active: false, full: false, size: 0 })
  })
})

describe('Throttled', () => {
  it('sends a change at most once per wait, and nothing unchanged', () => {
    const sent: number[] = []
    let now = 10_000
    const t = new Throttled(1000, () => sent.push(now))
    t.tick(now)
    expect(sent).toEqual([])
    t.mark()
    t.tick(now)
    expect(sent).toEqual([10_000])
    t.mark()
    now += 1000
    t.tick(now)
    expect(sent).toEqual([10_000])
    now += 1
    t.tick(now)
    expect(sent).toEqual([10_000, 11_001])
  })

  it('beats on its heartbeat whether or not anything changed, and a change waits only the short wait', () => {
    const beats: number[] = []
    const sent: number[] = []
    let now = 10_000
    let markOnBeat = false
    const t: Throttled = new Throttled(1000, () => sent.push(now), {
      everyMs: 5000,
      beat: (at) => {
        beats.push(at)
        if (markOnBeat) t.mark()
      }
    })
    t.tick(now)
    expect(beats).toEqual([10_000])
    expect(sent).toEqual([])
    now += 4000
    t.tick(now)
    expect(beats).toEqual([10_000])
    now += 1001
    t.tick(now)
    expect(beats).toEqual([10_000, 15_001])
    // A change goes out a second after the last beat, with a beat before it.
    t.mark()
    now += 1001
    t.tick(now)
    expect(beats).toEqual([10_000, 15_001, 16_002])
    expect(sent).toEqual([16_002])
    // What the beat marks changed goes out with it.
    markOnBeat = true
    now += 5001
    t.tick(now)
    expect(sent).toEqual([16_002, 21_003])
  })
})
