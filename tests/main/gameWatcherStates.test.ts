import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../src/main/gameWatcher'

// Windows is not asked: the calls the watcher makes are stand-ins set per test. The watcher looks four
// times a second; it finds the game in front at once, or by a walk of the process list every 30 s, and
// then holds it by a handle that says when it ends, walking no more while it runs (LT-558).
const game = vi.hoisted(() => ({ ended: false, closed: 0 }))
vi.mock('../../src/main/win32', () => ({
  win32Available: vi.fn(() => true),
  foregroundPid: vi.fn(() => 0),
  findProcess: vi.fn((): number | null => 0),
  watchProcess: vi.fn(() => ({ ended: () => game.ended, close: () => void game.closed++ })),
  processName: vi.fn((pid: number) => (pid === 42 ? 'eqgame' : pid === 7 ? 'chrome' : '')),
  // What game.ts also imports, unused here.
  HKEY_CURRENT_USER: 0x80000001,
  HKEY_LOCAL_MACHINE: 0x80000002,
  isFixedDrive: vi.fn(() => null),
  registryString: vi.fn(() => '')
}))

const win32 = await import('../../src/main/win32')
const { GameWatcher } = await import('../../src/main/gameWatcher')
const { isGameRunning } = await import('../../src/main/game')

const EVERY_WALK_MS = 120 * 250

function watcher() {
  const changes: { state: GameState; previous: GameState }[] = []
  const w = new GameWatcher((state, previous) => changes.push({ state: { ...state }, previous: { ...previous } }))
  return { w, changes }
}

beforeEach(() => {
  vi.useFakeTimers()
  game.ended = false
  game.closed = 0
  vi.mocked(win32.win32Available).mockReset().mockReturnValue(true)
  vi.mocked(win32.foregroundPid).mockReset().mockReturnValue(0)
  vi.mocked(win32.findProcess).mockReset().mockReturnValue(0)
  vi.mocked(win32.watchProcess).mockClear()
  vi.mocked(win32.processName).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('watching whether the game runs', () => {
  it('finds a game started behind another window at the next walk, and holds it', () => {
    const { w, changes } = watcher()
    w.start()
    expect(changes).toEqual([])
    vi.mocked(win32.findProcess).mockReturnValue(4242)
    vi.advanceTimersByTime(EVERY_WALK_MS - 250)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(250)
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true])
    expect(win32.watchProcess).toHaveBeenCalledWith(4242)
    w.stop()
  })

  it('finds the game the moment it is in front, with no walk', () => {
    const { w, changes } = watcher()
    w.start()
    vi.mocked(win32.findProcess).mockClear()
    vi.mocked(win32.foregroundPid).mockReturnValue(42)
    vi.advanceTimersByTime(250)
    expect(changes.at(-1)!.state).toEqual({ foregroundPid: 42, foregroundName: 'eqgame', gameRunning: true })
    expect(win32.watchProcess).toHaveBeenCalledWith(42)
    expect(win32.findProcess).not.toHaveBeenCalled()
    w.stop()
  })

  it('says the game stopped within a quarter second of its handle saying so, and lets the handle go', () => {
    vi.mocked(win32.findProcess).mockReturnValue(4242)
    const { w, changes } = watcher()
    w.start()
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true])
    game.ended = true
    vi.mocked(win32.findProcess).mockReturnValue(0)
    vi.advanceTimersByTime(250)
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true, false])
    expect(game.closed).toBe(1)
    w.stop()
  })

  it('walks the process list no more while the game is held', () => {
    vi.mocked(win32.findProcess).mockReturnValue(4242)
    const { w } = watcher()
    w.start()
    expect(win32.findProcess).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5 * EVERY_WALK_MS)
    expect(win32.findProcess).toHaveBeenCalledTimes(1)
    w.stop()
    expect(game.closed).toBe(1)
  })

  it('counts the game as running when Windows cannot say', () => {
    vi.mocked(win32.findProcess).mockReturnValue(null)
    const { w, changes } = watcher()
    w.start()
    expect(w.state.gameRunning).toBe(true)
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true])
    w.stop()
  })

  it('walks only every 120th look while the game is not running, and reports nothing while nothing changes', () => {
    const { w, changes } = watcher()
    w.start()
    vi.advanceTimersByTime(2 * EVERY_WALK_MS)
    // The first look, then one per 30 s.
    expect(win32.findProcess).toHaveBeenCalledTimes(3)
    expect(win32.findProcess).toHaveBeenCalledWith('eqgame.exe')
    expect(win32.foregroundPid).toHaveBeenCalledTimes(241)
    expect(changes).toEqual([])
    w.stop()
  })
})

describe('asking once whether the game runs', () => {
  it('passes on a yes or a no, and counts not knowing as running', async () => {
    vi.mocked(win32.findProcess).mockReturnValue(4242)
    expect(await isGameRunning()).toBe(true)
    vi.mocked(win32.findProcess).mockReturnValue(0)
    expect(await isGameRunning()).toBe(false)
    vi.mocked(win32.findProcess).mockReturnValue(null)
    expect(await isGameRunning()).toBe(true)
  })
})

describe('watching the foreground window', () => {
  it('reports a change of foreground window within a quarter second, with its name', () => {
    const { w, changes } = watcher()
    w.start()
    vi.mocked(win32.foregroundPid).mockReturnValue(7)
    vi.advanceTimersByTime(250)
    expect(changes).toHaveLength(1)
    expect(changes[0].state).toEqual({ foregroundPid: 7, foregroundName: 'chrome', gameRunning: false })
    vi.mocked(win32.foregroundPid).mockReturnValue(42)
    vi.advanceTimersByTime(250)
    expect(changes[1].state.foregroundName).toBe('eqgame')
    expect(changes[1].previous.foregroundName).toBe('chrome')
    w.stop()
  })

  it('looks the name up only when the foreground process changes', () => {
    vi.mocked(win32.foregroundPid).mockReturnValue(7)
    const { w } = watcher()
    w.start()
    expect(win32.processName).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(EVERY_WALK_MS)
    expect(win32.processName).toHaveBeenCalledTimes(1)
    w.stop()
  })
})

describe('starting and stopping the watcher', () => {
  it('assumes the game is up and in front when Windows cannot be asked at all', () => {
    vi.mocked(win32.win32Available).mockReturnValue(false)
    const { w, changes } = watcher()
    w.start()
    expect(changes).toHaveLength(1)
    expect(changes[0].state).toEqual({ foregroundPid: 0, foregroundName: 'eqgame', gameRunning: true })
    vi.advanceTimersByTime(10_000)
    expect(win32.foregroundPid).not.toHaveBeenCalled()
    expect(changes).toHaveLength(1)
  })

  it('stops looking once stopped, and a second start does not look twice as often', () => {
    const { w } = watcher()
    w.start()
    w.start()
    vi.advanceTimersByTime(1000)
    expect(win32.foregroundPid).toHaveBeenCalledTimes(5)
    w.stop()
    vi.advanceTimersByTime(10_000)
    expect(win32.foregroundPid).toHaveBeenCalledTimes(5)
  })
})
