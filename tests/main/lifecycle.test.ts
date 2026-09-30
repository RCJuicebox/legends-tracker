import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerLifecycle } from '../../src/main/lifecycle'
import { Engine, type EngineEnv, type EngineStore } from '../../src/main/engine'
import { scanMoteHistory } from '../../src/main/moteHistory'
import { defaultSettings } from '../../src/main/storeCore'
import type { AppContext } from '../../src/main/context'
import type { MoteState } from '../../src/core/motes'
import type { MoteStock } from '../../src/shared/types'

// How the app ends (lifecycle.ts), with Electron stood in for: the handlers registerLifecycle hands to
// app.on are kept, and before-quit is fired by hand.

type Handler = (...args: unknown[]) => void
const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  calls: [] as string[],
  onHotkeys: null as null | (() => void)
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, fn: Handler) => {
      h.handlers.set(event, fn)
    },
    quit: () => {
      h.calls.push('quit')
    }
  },
  globalShortcut: {
    unregisterAll: () => {
      h.calls.push('unregister hotkeys')
      h.onHotkeys?.()
    }
  },
  powerMonitor: { on: () => {} },
  shell: { openExternal: async () => {} },
  ipcMain: { on: () => {}, handle: () => {} }
}))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(10)
  }
}

/** A context whose parts note, in `h.calls`, when each is stopped or saved. */
function fakeContext(o: { engine?: Engine; flushAll?: () => Promise<unknown>; updaterStop?: () => void } = {}) {
  const note = (what: string) => () => {
    h.calls.push(what)
  }
  const ctx = {
    windows: { quitting: false, showMain: note('show main'), recover: () => false, flush: async () => note('flush windows')() },
    overlays: { destroy: note('stop overlays'), recover: () => {} },
    engine: o.engine ?? { shutdown: note('stop engine'), board: { endWhere: () => [] }, pushFeed: () => {} },
    updater: { stop: o.updaterStop ?? note('stop updater'), status: { state: 'idle' }, install: note('install update') },
    watcher: { stop: note('stop game watcher') },
    achievementFiles: { stop: note('stop achievement poller') },
    inventoryFiles: { stop: note('stop inventory poller') },
    speech: { stop: note('stop speech') },
    store: { flushAll: o.flushAll ?? (async () => note('save stores')()) },
    features: [{ flush: async () => note('save followed plans')() }, {}, { flush: async () => note('save allakhazam pages')() }],
    logHistory: { flush: async () => note('save log history')() },
    installUpdate: async () => {}
  }
  return ctx as unknown as typeof ctx & AppContext
}

function beforeQuit() {
  const e = { preventDefault: vi.fn() }
  h.handlers.get('before-quit')!(e)
  return e
}

const STOPS = ['stop engine', 'stop updater', 'stop game watcher', 'stop achievement poller', 'stop inventory poller', 'stop speech', 'stop overlays', 'unregister hotkeys']

beforeEach(() => {
  h.handlers.clear()
  h.calls.length = 0
  h.onHotkeys = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Quitting', () => {
  it('holds the quit, stops everything, unregisters the hotkeys, saves, then quits', async () => {
    const ctx = fakeContext()
    registerLifecycle(ctx)
    const e = beforeQuit()
    expect(e.preventDefault).toHaveBeenCalled()
    expect(ctx.windows.quitting).toBe(true)
    await waitFor(() => h.calls.includes('quit'))
    expect(h.calls.slice(0, STOPS.length)).toEqual(STOPS)
    // The saves run side by side after the stops; quitting waits for them all.
    expect(h.calls.slice(STOPS.length, -1).sort()).toEqual(['flush windows', 'save allakhazam pages', 'save followed plans', 'save log history', 'save stores'])
    expect(h.calls.at(-1)).toBe('quit')
  })

  it('lets the quit through the second time round, once everything is saved', async () => {
    registerLifecycle(fakeContext())
    beforeQuit()
    await waitFor(() => h.calls.includes('quit'))
    // app.quit() fires before-quit again: this time it is not held.
    expect(beforeQuit().preventDefault).not.toHaveBeenCalled()
    expect(h.calls.filter((c) => c === 'stop engine').length).toBe(1)
  })

  it('stops and saves once when Quit is asked for again while saving', async () => {
    let finish = () => {}
    registerLifecycle(fakeContext({ flushAll: () => new Promise<void>((r) => (finish = r)) }))
    beforeQuit()
    const again = beforeQuit()
    expect(again.preventDefault).toHaveBeenCalled()
    await sleep(20)
    expect(h.calls).not.toContain('quit')
    finish()
    await waitFor(() => h.calls.includes('quit'))
    expect(h.calls.filter((c) => c === 'stop engine').length).toBe(1)
    expect(h.calls.filter((c) => c === 'quit').length).toBe(1)
  })

  it('carries on stopping the rest when one part fails to stop', async () => {
    registerLifecycle(
      fakeContext({
        updaterStop: () => {
          throw new Error('stuck')
        }
      })
    )
    beforeQuit()
    await waitFor(() => h.calls.includes('quit'))
    expect(h.calls.slice(0, STOPS.length - 1)).toEqual(STOPS.filter((s) => s !== 'stop updater'))
  })

  it('quits anyway when saving takes over three seconds', async () => {
    vi.useFakeTimers()
    registerLifecycle(fakeContext({ flushAll: () => new Promise(() => {}) }))
    beforeQuit()
    await vi.advanceTimersByTimeAsync(2900)
    expect(h.calls).not.toContain('quit')
    await vi.advanceTimersByTimeAsync(200)
    expect(h.calls.at(-1)).toBe('quit')
  })

  it('restarts into an update only after everything is saved, without a second shutdown', async () => {
    const ctx = fakeContext()
    ctx.updater.status.state = 'ready'
    registerLifecycle(ctx)
    await ctx.installUpdate()
    expect(h.calls.slice(0, STOPS.length)).toEqual(STOPS)
    expect(h.calls.at(-1)).toBe('install update')
    expect(h.calls).not.toContain('quit')
    // The installer's own quit goes straight through.
    expect(beforeQuit().preventDefault).not.toHaveBeenCalled()
  })

  it('does not restart into an update that is not downloaded', async () => {
    const ctx = fakeContext()
    registerLifecycle(ctx)
    await ctx.installUpdate()
    expect(h.calls).toEqual([])
  })
})

describe('Quitting with the real engine', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'lt141c-quit-'))
  })
  afterEach(async () => {
    await sleep(50)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('has stopped watching and written the mote mark before the hotkeys go and the stores are saved', async () => {
    const logs = join(dir, 'game', 'Logs')
    await fs.mkdir(logs, { recursive: true })
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, '[Thu Sep 24 16:00:00 2026] You have entered Neriak.\r\n')
    const cell = <T>(value: T) => ({ get: () => value, set: (v: T) => void (value = v) })
    const store = {
      settings: cell({ ...defaultSettings(), installDir: join(dir, 'game'), logFile }),
      triggers: cell([]),
      rules: cell({}),
      casts: cell({}),
      motes: cell<MoteState>({ active: null, sessions: [], daily: {} }),
      stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
      respawns: cell({}),
      buffs: cell({ people: {}, wanted: {}, active: {} }),
      motesFresh: false,
      characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
    } satisfies EngineStore
    const env: EngineEnv = {
      moteWorkerPath: '',
      isGameRunning: async () => false,
      findInstall: async () => '',
      soundDirs: () => [],
      dataDir: dir,
      scanMotes: (job, progress) => ({ done: scanMoteHistory(job, progress), stop: () => {} })
    }
    const noop = () => {}
    const engine = new Engine(
      store,
      { synthesize: async () => Buffer.alloc(0) },
      {
        timers: noop,
        alert: noop,
        audio: noop,
        status: noop,
        feed: noop,
        archive: noop,
        motes: noop,
        moteScan: noop,
        stock: noop,
        combat: noop,
        loot: noop,
        respawns: noop,
        pet: noop,
        buffs: noop
      },
      env
    )
    try {
      await engine.startWatching()
      await sleep(250)
      await fs.appendFile(logFile, '[Thu Sep 24 16:05:00 2026] You looted 2 Mote of Major Potential from Reward Chest and stored it in your currency.\r\n')
      await waitFor(() => engine.motes.state.daily['2026-09-24']?.major === 2)

      const seen: { watching: boolean; mark: boolean }[] = []
      h.onHotkeys = () => seen.push({ watching: engine.status.watching, mark: existsSync(join(dir, 'catchup.json')) })
      registerLifecycle(fakeContext({ engine }))
      beforeQuit()
      await waitFor(() => h.calls.includes('quit'))
      expect(seen).toEqual([{ watching: false, mark: true }])
      expect(h.calls.indexOf('unregister hotkeys')).toBeLessThan(h.calls.indexOf('save stores'))
    } finally {
      engine.shutdown()
    }
  })
})

describe('Crashed pages', () => {
  it('makes a crashed page again three times in five minutes, then leaves it closed and says so once', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext()
    const recovered: string[] = []
    const feed: string[] = []
    ctx.windows.recover = () => false
    ctx.overlays.recover = () => {
      recovered.push('overlay')
      return true
    }
    ctx.engine.pushFeed = (_kind: string, text: string) => void feed.push(text)
    registerLifecycle(ctx)
    const wc = { getURL: () => 'file:///app/out/renderer/overlay.html?host=1' }
    const crash = () => h.handlers.get('render-process-gone')!({}, wc, { reason: 'crashed', exitCode: 1 })
    for (let i = 0; i < 5; i++) {
      crash()
      await vi.advanceTimersByTimeAsync(1500)
    }
    expect(recovered).toHaveLength(3)
    expect(feed).toHaveLength(1)
    expect(feed[0]).toContain('overlay.html')
    // Five minutes on, it is made again.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    crash()
    await vi.advanceTimersByTimeAsync(1500)
    expect(recovered).toHaveLength(4)
  })
})
