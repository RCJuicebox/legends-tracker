import { describe, expect, it } from 'vitest'
import { TimerBoard, type BoardTimer, type EndReason } from '../src/core/timers'
import type { Notification } from '../src/shared/types'

const speak = (text: string): Notification => ({ kind: 'speak', text, interrupt: false })

function timer(over: Partial<BoardTimer>): BoardTimer {
  return {
    key: 'k', id: 't1', label: 'Test', target: '', source: 'trigger', color: '#fff', overlay: 'targets',
    startedAt: 0, endsAt: 60_000, exact: false, warnSec: 10, onWarn: [speak('warn')], onExpire: [speak('end')],
    warned: false, graceMs: 0, ...over
  }
}

function board() {
  const said: string[] = []
  const ended: [string, EndReason][] = []
  let changes = 0
  const b = new TimerBoard({
    onChange: () => changes++,
    onNotify: (ns) => ns.forEach((n) => n.kind === 'speak' && said.push(n.text)),
    onEnd: (t, reason) => ended.push([t.key, reason])
  })
  return { b, said, ended, changes: () => changes }
}

describe('TimerBoard', () => {
  it('warns once, then expires with its end notification after the grace', () => {
    const { b, said, ended } = board()
    b.upsert(timer({ graceMs: 2000 }))
    b.tick(49_999)
    expect(said).toEqual([])
    b.tick(50_000)
    b.tick(55_000)
    expect(said).toEqual(['warn'])
    b.tick(61_999)
    expect(b.get('k')).toBeDefined()
    b.tick(62_000)
    expect(said).toEqual(['warn', 'end'])
    expect(ended).toEqual([['k', 'expired']])
    expect(b.list()).toEqual([])
  })

  it('caps the grace of an exact end at three seconds', () => {
    const { b } = board()
    b.upsert(timer({ exact: true, graceMs: 14_000 }))
    b.tick(62_999)
    expect(b.get('k')).toBeDefined()
    b.tick(63_000)
    expect(b.get('k')).toBeUndefined()
  })

  it('re-arms the warning when rescheduled later, but not for a nudge of half a second or less', () => {
    const { b, said } = board()
    b.upsert(timer({}))
    b.tick(50_000)
    b.reschedule('k', 60_500, true)
    b.tick(51_000)
    expect(said).toEqual(['warn'])
    expect(b.get('k')!.exact).toBe(true)
    b.reschedule('k', 90_000, false)
    b.tick(79_000)
    expect(b.get('k')!.warned).toBe(false)
    b.tick(80_000)
    expect(said).toEqual(['warn', 'warn'])
  })

  it('ends by key or by test with a reason, and clears everything without notifications', () => {
    const { b, said, ended, changes } = board()
    b.upsert(timer({ key: 'a' }))
    b.upsert(timer({ key: 'b', target: 'rat' }))
    b.upsert(timer({ key: 'c', target: 'rat' }))
    expect(b.end('a', 'faded')?.key).toBe('a')
    expect(b.end('a', 'faded')).toBeUndefined()
    expect(b.endWhere((t) => t.target === 'rat', 'died').map((t) => t.key)).toEqual(['b', 'c'])
    expect(ended).toEqual([['a', 'faded'], ['b', 'died'], ['c', 'died']])
    b.upsert(timer({ key: 'd' }))
    const before = changes()
    b.clear()
    expect(b.list()).toEqual([])
    expect(changes()).toBe(before + 1)
    expect(said).toEqual([])
  })

  it('lists views soonest first, and lets timers be ended while walking values()', () => {
    const { b } = board()
    b.upsert(timer({ key: 'late', id: 'x', endsAt: 90_000 }))
    b.upsert(timer({ key: 'soon', id: 'y', endsAt: 30_000 }))
    expect(b.views().map((v) => v.id)).toEqual(['y', 'x'])
    for (const t of b.values()) b.end(t.key, 'cleared')
    expect(b.list()).toEqual([])
  })
})
