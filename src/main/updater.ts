import { app } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater checks the GitHub Releases named in the build's `publish` settings, downloads a
// newer installer in the background, and runs it when the app restarts. Settings live in
// %APPDATA%\Legends Tracker, outside the install folder, so they survive every update.

export type UpdateState =
  | { state: 'dev' }
  | { state: 'idle'; checkedAt: number }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export class Updater {
  status: UpdateState = app.isPackaged ? { state: 'idle', checkedAt: 0 } : { state: 'dev' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onStatus: (s: UpdateState) => void) {}

  start(): void {
    // A development run has no release to compare against.
    if (!app.isPackaged) return
    const { autoUpdater } = electronUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'idle', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      const version = this.status.state === 'downloading' ? this.status.version : ''
      this.set({ state: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }))
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: friendly(e) }))
    // Give the app a moment to settle before the first check.
    setTimeout(() => void this.check(), 15_000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  async check(): Promise<void> {
    if (!app.isPackaged || this.status.state === 'downloading' || this.status.state === 'ready') return
    try {
      await electronUpdater.autoUpdater.checkForUpdates()
    } catch (e) {
      this.set({ state: 'error', message: friendly(e) })
    }
  }

  /** Restarts into the downloaded version. */
  install(): void {
    if (this.status.state === 'ready') electronUpdater.autoUpdater.quitAndInstall(true, true)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(s: UpdateState): void {
    this.status = s
    this.onStatus(s)
  }
}

/** electron-updater's errors carry whole HTTP responses; keep what a player can act on. */
function friendly(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/\b404\b/.test(text)) return 'no releases have been published yet'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/.test(text)) return 'could not reach GitHub (offline?)'
  const first = text.split('\n')[0].trim()
  return first.length > 140 ? `${first.slice(0, 140)}…` : first
}
