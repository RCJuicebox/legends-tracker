import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../../src/main/context'
import type { EngineFeature } from '../../src/main/engine'
import type { GroupHealthFromWorker, GroupHealthToWorker } from '../../src/main/groupHealth'
import { sources } from '../../src/main/sources/registry'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../tempDir'

// The group health watch's main side with its worker stood in (LT-627): started and configured as the
// game runs, what its messages do, and a worker that dies started again after a while.

const h = vi.hoisted(() => ({
  dir: '',
  game: '',
  ready: true,
  capture: (() => ({ x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4) })) as (x: number, y: number, w: number, h: number) => unknown,
  released: 0
}))
vi.mock('electron', () => ({
  app: { isReady: () => h.ready, getPath: () => h.dir, whenReady: () => Promise.resolve() },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1000, height: 800 } }], dipToScreenRect: (_w: unknown, b: unknown) => b, on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} }
}))
vi.mock('../../src/main/win32', () => ({ foregroundWindowRect: () => ({ x: 10, y: 10, width: 500, height: 400 }) }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => h.dir }))
vi.mock('../../src/main/screenPixels', () => ({
  captureRect: (x: number, y: number, w: number, hh: number) => h.capture(x, y, w, hh),
  gdiAvailable: () => true,
  releaseCapture: () => void h.released++
}))
vi.mock('../../src/main/ocr', () => ({ writeBmp: async () => undefined, ocrImage: async () => [], discardScreens: async () => undefined }))
vi.mock('../../src/main/groupHealthWorker?modulePath', () => ({ default: 'worker.js' }))

const { GroupHealth } = await import('../../src/main/groupHealth')
const { JUICEBOX_PROFILE } = await import('../../src/core/groupHealth')

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

function setup(o: { enabled?: boolean; myManaPct?: number; skin?: string } = {}) {
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
      watchPct: 40,
      skin: o.skin ?? 'JuiceboxUI',
      calibrated: {} as Record<string, unknown>,
      myManaPct: o.myManaPct ?? 0,
      myManaSpeech: 'Mana at {pct} percent'
    },
    overlays: []
  }
  const watcher = { gameRunning: true as boolean | null, state: { foregroundName: 'eqgame', foregroundPid: 1, gameRunning: true } }
  let feature: EngineFeature | null = null
  const ctx = {
    store: { settings: { get: () => settings } },
    installDir: () => h.game,
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
      {
        kind: 'config',
        on: true,
        areas: [{ x: 0, y: 0, width: 1000, height: 800 }],
        belowPct: 25,
        rearmPct: 35,
        front: true,
        manaPct: 0,
        rowLines: {},
        profile: JUICEBOX_PROFILE,
        myManaPct: 0,
        group: true
      }
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

  it('watches your own mana with the group alert off, and says it in its own words (FEAT-043)', () => {
    const { workers, notified, tick, row } = setup({ enabled: false, myManaPct: 20 })
    tick()
    expect(workers).toHaveLength(1)
    expect(workers[0].posted[0]).toMatchObject({ kind: 'config', myManaPct: 20, group: false })
    workers[0].emit('message', { kind: 'player', bar: { left: 31, right: 294, top: 61 } } satisfies GroupHealthFromWorker)
    expect(row().detail).toContain('Watching your mana')
    workers[0].emit('message', { kind: 'bars', bars: [] } satisfies GroupHealthFromWorker)
    expect(row().detail).toContain('Watching your mana')
    workers[0].emit('message', { kind: 'low', slot: 1, pct: 17, what: 'myMana' } satisfies GroupHealthFromWorker)
    expect(notified.slice(-2)).toEqual([
      { kind: 'speak', text: 'Mana at 17 percent', interrupt: false },
      { kind: 'text', text: 'Mana 17%', color: '#5b75ae', durationSec: 4 }
    ])
    workers[0].emit('message', { kind: 'player', bar: null } satisfies GroupHealthFromWorker)
    expect(row().detail).toContain('No group members')
  })

  it("reads the skin's profile from its file, and puts the colours sampled for it in its place (FEAT-040)", async () => {
    h.game = tempDir('lt-gh-skin-')
    mkdirSync(join(h.game, 'uifiles', 'Arcane'), { recursive: true })
    writeFileSync(join(h.game, 'uifiles', 'Arcane', 'legends-tracker.json'), JSON.stringify({ groupHealth: { hpInner: 12 } }))
    try {
      const { workers, settings, tick, feature } = setup({ skin: 'Arcane' })
      tick()
      // JuiceboxUI's until the file is read, then the skin's.
      expect(workers[0].posted.at(-1)).toMatchObject({ profile: JUICEBOX_PROFILE })
      await vi.waitFor(() => expect(workers[0].posted.at(-1)).toMatchObject({ profile: { hpInner: 12 } }))
      const sampled = { ...JUICEBOX_PROFILE.colours, hp: [220, 60, 110] }
      settings.groupHealth.calibrated = { Arcane: sampled }
      feature().reconfigure!()
      expect(workers[0].posted.at(-1)).toMatchObject({ profile: { hpInner: 12, colours: sampled } })
    } finally {
      h.game = ''
    }
  })

  it('samples the colours off a Group window on the screen, says so, and frees its copies (FEAT-040)', async () => {
    const { gh, notified } = setup()
    // One member row in JuiceboxUI's colours: health half full, mana and endurance under it.
    const f = { x: 0, y: 0, width: 300, height: 80, data: new Uint8Array(300 * 80 * 4) }
    const put = (x: number, y: number, w: number, hh: number, c: readonly number[]) => {
      for (let r = y; r < y + hh; r++) for (let col = x; col < x + w; col++) f.data.set([c[2], c[1], c[0], 0], (r * f.width + col) * 4)
    }
    const c = JUICEBOX_PROFILE.colours
    for (const [top, hh, ink, pct] of [
      [10, 18, c.hp, 0.5],
      [30, 12, c.mana, 0.4],
      [44, 12, c.end, 0.7]
    ] as const) {
      put(20, top, 204, hh, c.outline)
      put(21, top + 1, 202, hh - 2, c.empty)
      put(21, top + 1, Math.floor(202 * pct), hh - 2, ink)
    }
    h.capture = () => f
    const released = h.released
    try {
      const r = await gh.calibrate()
      expect(r).toEqual({ colours: c, seen: ['outline', 'empty', 'hp', 'mana', 'end'], rows: 1 })
      expect(notified.at(-1)).toMatchObject({ kind: 'speak', text: 'Group colours sampled' })
      expect(h.released).toBe(released + 1)
      // Nothing there, the game in front: looked at once more, then said.
      h.capture = () => ({ x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4) })
      expect((await gh.calibrate()).rows).toBe(0)
      expect(notified.at(-1)).toMatchObject({ kind: 'speak', text: 'No group window found' })
    } finally {
      h.capture = () => ({ x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4) })
    }
  })
})
