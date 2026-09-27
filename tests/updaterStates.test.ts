import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../src/shared/runtime'

// electron-updater is a stand-in that records its handlers, so each of its events can be raised by
// hand; nothing is fetched from GitHub. Whether the copy is installed is switched per test.
const h = vi.hoisted(() => {
  const handlers: Record<string, (...args: never[]) => void> = {}
  const autoUpdater = {
    handlers,
    logger: null as unknown,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on(event: string, fn: (...args: never[]) => void) {
      handlers[event] = fn
      return autoUpdater
    },
    checkForUpdates: vi.fn(async (): Promise<unknown> => null),
    quitAndInstall: vi.fn()
  }
  return { app: { isPackaged: true, getVersion: () => '1.0.0' }, autoUpdater }
})
vi.mock('electron', () => ({ app: h.app }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: h.autoUpdater } }))
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { Updater } = await import('../src/main/updater')

const HOUR = 60 * 60 * 1000

/** Raises one of electron-updater's events. */
function emit(event: string, ...args: unknown[]): void {
  const fn = h.autoUpdater.handlers[event] as ((...a: unknown[]) => void) | undefined
  if (!fn) throw new Error(`no handler for ${event}`)
  fn(...args)
}

function packaged() {
  const seen: UpdateState[] = []
  const u = new Updater((s) => seen.push(s))
  u.start()
  return { u, seen }
}

beforeEach(() => {
  h.app.isPackaged = true
  for (const k of Object.keys(h.autoUpdater.handlers)) delete h.autoUpdater.handlers[k]
  h.autoUpdater.checkForUpdates.mockReset().mockResolvedValue(null)
  h.autoUpdater.quitAndInstall.mockReset()
  h.autoUpdater.autoDownload = false
  h.autoUpdater.autoInstallOnAppQuit = false
  vi.useFakeTimers({ now: new Date('2026-09-27T12:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the updater in a development run', () => {
  it('says it is a development copy, and never checks', async () => {
    h.app.isPackaged = false
    const seen: UpdateState[] = []
    const u = new Updater((s) => seen.push(s))
    expect(u.status).toEqual({ state: 'dev' })
    u.start()
    expect(h.autoUpdater.handlers).toEqual({})
    await u.check()
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(seen).toEqual([])
    expect(u.status).toEqual({ state: 'dev' })
  })
})

describe('the updater in an installed copy', () => {
  it('starts idle, never having checked', () => {
    expect(new Updater(() => undefined).status).toEqual({ state: 'idle', checkedAt: 0 })
  })

  it('downloads updates on its own and installs them when the app quits', () => {
    packaged()
    expect(h.autoUpdater.autoDownload).toBe(true)
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('checks fifteen seconds after starting, and then every hour', async () => {
    const { u } = packaged()
    await vi.advanceTimersByTimeAsync(14_999)
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    u.stop()
    await vi.advanceTimersByTimeAsync(3 * HOUR)
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('reports checking, then idle with the time of the check when nothing is newer', () => {
    const { u, seen } = packaged()
    emit('checking-for-update')
    expect(u.status).toEqual({ state: 'checking' })
    emit('update-not-available', { version: '1.0.0' })
    expect(u.status).toEqual({ state: 'idle', checkedAt: Date.parse('2026-09-27T12:00:00Z') })
    expect(seen.map((s) => s.state)).toEqual(['checking', 'idle'])
  })

  it('goes from available straight to downloading at 0%, with the release notes as plain text', () => {
    const { u } = packaged()
    emit('update-available', { version: '2.0.0', releaseNotes: '<p>Faster &amp; <b>better</b></p>' })
    expect(u.status).toEqual({ state: 'downloading', version: '2.0.0', percent: 0, notes: 'Faster & better' })
  })

  it('reports download progress as a whole percentage, keeping the version and notes', () => {
    const { u } = packaged()
    emit('update-available', { version: '2.0.0', releaseNotes: 'Notes for testers' })
    emit('download-progress', { percent: 41.6 })
    expect(u.status).toEqual({ state: 'downloading', version: '2.0.0', percent: 42, notes: 'Notes for testers' })
  })

  it('reports progress with no version when the download was never announced', () => {
    const { u } = packaged()
    emit('checking-for-update')
    emit('download-progress', { percent: 10 })
    expect(u.status).toEqual({ state: 'downloading', version: '', percent: 10, notes: undefined })
  })

  it('is ready to install once downloaded, with notes from a list of versions', () => {
    const { u, seen } = packaged()
    emit('update-available', { version: '2.0.0' })
    emit('update-downloaded', {
      version: '2.0.0',
      releaseNotes: [
        { version: '2.0.0', note: '<ul><li>One</li><li>Two</li></ul>' },
        { version: '1.9.0', note: 'Older' }
      ]
    })
    expect(u.status).toEqual({ state: 'ready', version: '2.0.0', notes: '- One\n- Two\n\nOlder' })
    expect(seen.map((s) => s.state)).toEqual(['downloading', 'ready'])
  })

  it('does not check again while downloading or once ready', async () => {
    const { u } = packaged()
    emit('update-available', { version: '2.0.0' })
    await u.check()
    emit('update-downloaded', { version: '2.0.0' })
    await u.check()
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('restarts into the new version only once it has downloaded', () => {
    const { u } = packaged()
    u.install()
    emit('update-available', { version: '2.0.0' })
    u.install()
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
    emit('update-downloaded', { version: '2.0.0' })
    u.install()
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })
})

describe('the updater failing', () => {
  it('explains a 404 as nothing to offer yet', () => {
    const { u } = packaged()
    emit('error', new Error('HttpError: 404 \n"method: GET url: https://github.com/…/latest.yml"\nlots of headers'))
    expect(u.status).toEqual({ state: 'error', message: 'the update server has nothing to offer yet (404); try again later' })
  })

  it('explains a network failure as GitHub being out of reach', () => {
    const { u } = packaged()
    emit('error', new Error('getaddrinfo ENOTFOUND github.com'))
    expect(u.status).toEqual({ state: 'error', message: 'could not reach GitHub (offline?)' })
    emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(u.status).toEqual({ state: 'error', message: 'could not reach GitHub (offline?)' })
  })

  it('keeps only the first line of anything else, cut at 140 characters', () => {
    const { u } = packaged()
    emit('error', new Error(`${'x'.repeat(200)}\nsecond line`))
    expect(u.status).toEqual({ state: 'error', message: `${'x'.repeat(140)}…` })
    emit('error', 'checksum mismatch\nmore')
    expect(u.status).toEqual({ state: 'error', message: 'checksum mismatch' })
  })

  it('reports a check that throws as an error, and checks again when asked', async () => {
    const { u } = packaged()
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('connect ETIMEDOUT 140.82.112.3:443'))
    await u.check()
    expect(u.status).toEqual({ state: 'error', message: 'could not reach GitHub (offline?)' })
    await u.check()
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })
})
