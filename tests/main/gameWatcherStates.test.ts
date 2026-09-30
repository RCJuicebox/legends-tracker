import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameState } from '../../src/main/gameWatcher'

// Windows is not asked: the four calls the watcher makes are stand-ins set per test. The watcher
// looks four times a second, and asks whether the game runs on every twelfth look (every 3s).
vi.mock('../../src/main/win32', () => ({
  win32Available: vi.fn(() => true),
  foregroundPid: vi.fn(() => 0),
  isProcessRunning: vi.fn((): boolean | null => false),
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

const EVERY_GAME_CHECK_MS = 12 * 250

function watcher() {
  const changes: { state: GameState; previous: GameState }[] = []
  const w = new GameWatcher((state, previous) => changes.push({ state: { ...state }, previous: { ...previous } }))
  return { w, changes }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(win32.win32Available).mockReset().mockReturnValue(true)
  vi.mocked(win32.foregroundPid).mockReset().mockReturnValue(0)
  vi.mocked(win32.isProcessRunning).mockReset().mockReturnValue(false)
  vi.mocked(win32.processName).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('watching whether the game runs', () => {
  it('reports the game starting at the next check after it launches', () => {
    const { w, changes } = watcher()
    w.start()
    expect(changes).toEqual([])
    vi.mocked(win32.isProcessRunning).mockReturnValue(true)
    vi.advanceTimersByTime(EVERY_GAME_CHECK_MS - 250)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(250)
    expect(changes).toHaveLength(1)
    expect(changes[0].previous.gameRunning).toBe(false)
    expect(changes[0].state.gameRunning).toBe(true)
    expect(w.state.gameRunning).toBe(true)
    w.stop()
  })

  it('reports the game stopping', () => {
    vi.mocked(win32.isProcessRunning).mockReturnValue(true)
    const { w, changes } = watcher()
    w.start()
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true])
    vi.mocked(win32.isProcessRunning).mockReturnValue(false)
    vi.advanceTimersByTime(EVERY_GAME_CHECK_MS)
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true, false])
    w.stop()
  })

  it('counts the game as running when Windows cannot say', () => {
    vi.mocked(win32.isProcessRunning).mockReturnValue(null)
    const { w, changes } = watcher()
    w.start()
    expect(w.state.gameRunning).toBe(true)
    expect(changes.map((c) => c.state.gameRunning)).toEqual([true])
    w.stop()
  })

  it('keeps an unknown answer as running rather than flipping to stopped', () => {
    vi.mocked(win32.isProcessRunning).mockReturnValue(true)
    const { w, changes } = watcher()
    w.start()
    vi.mocked(win32.isProcessRunning).mockReturnValue(null)
    vi.advanceTimersByTime(3 * EVERY_GAME_CHECK_MS)
    expect(changes).toHaveLength(1)
    expect(w.state.gameRunning).toBe(true)
    w.stop()
  })

  it('asks about the game only every twelfth look, and reports nothing while nothing changes', () => {
    const { w, changes } = watcher()
    w.start()
    vi.advanceTimersByTime(2 * EVERY_GAME_CHECK_MS)
    // The first look, then one per 3s.
    expect(win32.isProcessRunning).toHaveBeenCalledTimes(3)
    expect(win32.isProcessRunning).toHaveBeenCalledWith('eqgame.exe')
    expect(win32.foregroundPid).toHaveBeenCalledTimes(25)
    expect(changes).toEqual([])
    w.stop()
  })
})

describe('asking once whether the game runs', () => {
  it('passes on a yes or a no, and counts not knowing as running', async () => {
    vi.mocked(win32.isProcessRunning).mockReturnValue(true)
    expect(await isGameRunning()).toBe(true)
    vi.mocked(win32.isProcessRunning).mockReturnValue(false)
    expect(await isGameRunning()).toBe(false)
    vi.mocked(win32.isProcessRunning).mockReturnValue(null)
    expect(await isGameRunning()).toBe(true)
  })
})

describe('watching the foreground window', () => {
  it('reports a change of foreground window within a quarter second, with its name', () => {
    const { w, changes } = watcher()
    w.start()
    vi.mocked(win32.foregroundPid).mockReturnValue(42)
    vi.advanceTimersByTime(250)
    expect(changes).toHaveLength(1)
    expect(changes[0].state).toEqual({ foregroundPid: 42, foregroundName: 'eqgame', gameRunning: false })
    vi.mocked(win32.foregroundPid).mockReturnValue(7)
    vi.advanceTimersByTime(250)
    expect(changes[1].state.foregroundName).toBe('chrome')
    expect(changes[1].previous.foregroundName).toBe('eqgame')
    w.stop()
  })

  it('looks the name up only when the foreground process changes', () => {
    vi.mocked(win32.foregroundPid).mockReturnValue(42)
    const { w, changes } = watcher()
    w.start()
    expect(win32.processName).toHaveBeenCalledTimes(1)
    vi.mocked(win32.isProcessRunning).mockReturnValue(true)
    vi.advanceTimersByTime(EVERY_GAME_CHECK_MS)
    // The game started while it stayed in front: reported, with the name it already had.
    expect(changes.at(-1)!.state).toEqual({ foregroundPid: 42, foregroundName: 'eqgame', gameRunning: true })
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
