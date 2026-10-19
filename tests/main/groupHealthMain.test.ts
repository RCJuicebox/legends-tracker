import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../../src/main/context'
import type { EngineFeature } from '../../src/main/engine'
import type { GroupHealthFromWorker, GroupHealthToWorker } from '../../src/main/groupHealth'
import { sources } from '../../src/main/sources/registry'

// The group health watch's main side with its worker stood in (LT-627): started and configured as the
// game runs, what its messages do, and a worker that dies started again after a while.

const h = vi.hoisted(() => ({ dir: '', ready: true }))
vi.mock('electron', () => ({
  app: { isReady: () => h.ready, getPath: () => h.dir, whenReady: () => Promise.resolve() },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1000, height: 800 } }], dipToScreenRect: (_w: unknown, b: unknown) => b, on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} }
}))
vi.mock('../../src/main/win32', () => ({ foregroundWindowRect: () => ({ x: 10, y: 10, width: 500, height: 400 }) }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => h.dir }))
vi.mock('../../src/main/screenPixels', () => ({ captureRect: () => ({ x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4) }), gdiAvailable: () => true }))
vi.mock('../../src/main/ocr', () => ({ writeBmp: async () => undefined, ocrImage: async () => [], discardScreens: async () => undefined }))
vi.mock('../../src/main/groupHealthWorker?modulePath', () => ({ default: 'worker.js' }))

const { GroupHealth } = await import('../../src/main/groupHealth')

class FakeWorker extends EventEmitter {
  posted: GroupHealthToWorker[] = []
  ended = false
  postMessage(m: GroupHealthToWorker): void {
    this.posted.push(m)
  }
  terminate(): void {
    this.ended = true
  }
}

function setup(o: { enabled?: boolean } = {}) {
  const workers: FakeWorker[] = []
  const notified: unknown[] = []
  const settings = {
    groupHealth: {
      enabled: o.enabled ?? true,
      belowPct: 25,
      speech: '{name} is at {pct}',
      manaPct: 0,
      manaSpeech: '{name} is low on mana',
      watchNames: [] as string[],
      watchPct: 40
    },
    overlays: []
  }
  const watcher = { gameRunning: true as boolean | null, state: { foregroundName: 'eqgame', foregroundPid: 1, gameRunning: true } }
  let feature: EngineFeature | null = null
  const ctx = {
    store: { settings: { get: () => settings } },
    watcher,
    engine: { use: (f: EngineFeature) => (feature = f), notify: (ns: unknown[]) => notified.push(...ns), pushFeed: () => {} }
  } as unknown as AppContext
  const gh = new GroupHealth(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w
  })
  gh.register(ctx)
  const tick = () => feature!.tick!(Date.now())
  const row = () => sources.list().find((s) => s.id === 'groupHealth')!
  return { gh, ctx, workers, notified, settings, watcher, tick, row, feature: () => feature! }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 18, 20, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('GroupHealth', () => {
  it('starts the worker as the game runs, with the monitor the game is on and the line, and stops it when turned off', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    const { workers, settings, tick } = setup()
    tick()
    expect(workers).toHaveLength(1)
    expect(workers[0].posted).toEqual([
      { kind: 'config', on: true, areas: [{ x: 0, y: 0, width: 1000, height: 800 }], belowPct: 25, rearmPct: 35, front: true, manaPct: 0, rowLines: {} }
    ])
    // The same settings again: nothing more is sent.
    tick()
    expect(workers[0].posted).toHaveLength(1)
    // The line moved: told.
    settings.groupHealth.belowPct = 40
    tick()
    expect(workers[0].posted.at(-1)).toMatchObject({ belowPct: 40, rearmPct: 50 })
    settings.groupHealth.enabled = false
    tick()
    // Told to stop, so it frees its screen copies (LT-559); ended outright when it has not in a second.
    expect(workers[0].posted.at(-1)).toEqual({ kind: 'stop' })
    expect(workers[0].ended).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(workers[0].ended).toBe(true)
    expect(workers).toHaveLength(1)
  })

  it('leaves a worker that ends itself when told to stop', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    const { workers, settings, tick } = setup()
    tick()
    settings.groupHealth.enabled = false
    tick()
    workers[0].emit('exit', 0)
    vi.advanceTimersByTime(1000)
    expect(workers[0].ended).toBe(false)
  })

  it('says a member who is low, cutting in only well under the line, and reports the rows it watches', () => {
    const { workers, notified, tick, row } = setup()
    tick()
    const w = workers[0]
    w.emit('message', {
      kind: 'bars',
      bars: [
        { left: 20, right: 200, top: 100 },
        { left: 20, right: 200, top: 120 }
      ]
    } satisfies GroupHealthFromWorker)
    expect(row().detail).toContain('Watching 2 group members')
    w.emit('message', { kind: 'low', slot: 2, pct: 20 } satisfies GroupHealthFromWorker)
    // Urgent either way: to the front of the speech queue, never dropped (LT-719); it cuts in only well under the line.
    expect(notified[0]).toEqual({ kind: 'speak', text: 'Group member 2 is at 20', interrupt: false, urgent: true })
    w.emit('message', { kind: 'low', slot: 1, pct: 10 } satisfies GroupHealthFromWorker)
    expect(notified[2]).toMatchObject({ kind: 'speak', interrupt: true })
    // Low mana: its own words, not urgent (LT-751).
    w.emit('message', { kind: 'low', slot: 2, pct: 12, what: 'mana' } satisfies GroupHealthFromWorker)
    expect(notified.at(-2)).toEqual({ kind: 'speak', text: 'Group member 2 is low on mana', interrupt: false })
    w.emit('message', { kind: 'bars', bars: [] } satisfies GroupHealthFromWorker)
    expect(row().detail).toContain('No group members')
  })

  it('tells a group change to the worker, and starts a worker that died again after half a minute', () => {
    const { workers, tick, feature } = setup()
    tick()
    feature().line!({ text: 'Fenwick has joined the group.', time: Date.now() })
    expect(workers[0].posted.at(-1)).toEqual({ kind: 'search' })
    workers[0].emit('exit', 1)
    tick()
    expect(workers).toHaveLength(1)
    vi.setSystemTime(Date.now() + 31_000)
    tick()
    expect(workers).toHaveLength(2)
  })

  it('answers the self-test from a worker of its own, and ends it', async () => {
    const { gh, workers } = setup()
    const asked = gh.selfTest()
    const w = workers[0]
    expect(w.posted).toEqual([{ kind: 'ping' }])
    w.emit('message', { kind: 'pong', koffi: true } satisfies GroupHealthFromWorker)
    expect(await asked).toEqual({ pong: true, koffi: true })
    expect(w.ended).toBe(true)
  })
})
