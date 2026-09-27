import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { log } from './log'
import type { UpdateState } from '../shared/runtime'

// electron-updater checks the GitHub Releases named in the build's `publish` settings, downloads a
// newer installer in the background, and runs it when the app restarts. Settings live in
// %APPDATA%\Legends Tracker, outside the install folder, so they survive every update. The check
// runs shortly after start and then every hour; a new version is announced with a Windows
// notification when it is found and again, to click on, when it has downloaded.

export type { UpdateState }

/** Between automatic checks; Check for updates in Settings asks at any time. */
const CHECK_EVERY_MS = 60 * 60 * 1000

export class Updater {
  status: UpdateState = app.isPackaged ? { state: 'idle', checkedAt: 0 } : { state: 'dev' }
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onStatus: (s: UpdateState) => void) {}

  start(): void {
    // A development run has no release to compare against.
    if (!app.isPackaged) return
    const { autoUpdater } = electronUpdater
    // Its download and checksum trouble would otherwise go to a console nobody sees in an installed copy.
    autoUpdater.logger = { info: (m) => log.info('Updater:', m), warn: (m) => log.warn('Updater:', m), error: (m) => log.error('Updater:', m), debug: () => undefined }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'idle', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0, notes: notesText(info.releaseNotes) }))
    autoUpdater.on('download-progress', (p) => {
      const s = this.status.state === 'downloading' ? this.status : { version: '', notes: undefined }
      this.set({ state: 'downloading', version: s.version, percent: Math.round(p.percent), notes: s.notes })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, notes: notesText(info.releaseNotes) }))
    autoUpdater.on('error', (e) => {
      log.warn('Update failed:', e)
      this.set({ state: 'error', message: friendly(e) })
    })
    // Give the app a moment to settle before the first check.
    setTimeout(() => void this.check(), 15_000)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  async check(): Promise<void> {
    if (!app.isPackaged || this.status.state === 'downloading' || this.status.state === 'ready') return
    try {
      await electronUpdater.autoUpdater.checkForUpdates()
    } catch (e) {
      log.warn('Update check failed:', e)
      this.set({ state: 'error', message: friendly(e) })
    }
  }

  /** Restarts into the downloaded version. */
  install(): void {
    if (this.status.state !== 'ready') return
    log.info(`Restarting to install ${this.status.version}`)
    electronUpdater.autoUpdater.quitAndInstall(true, true)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private set(s: UpdateState): void {
    if (s.state === 'ready') log.info(`Update ${s.version} downloaded`)
    else if (s.state === 'downloading' && this.status.state !== 'downloading') log.info(`Downloading update ${s.version}`)
    this.status = s
    this.onStatus(s)
  }
}

/** A release's notes as plain text: GitHub hands them over as HTML, or as a list per version. */
export function notesText(notes: string | { version: string; note: string | null }[] | null | undefined): string | undefined {
  const text = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n\n') : (notes ?? '')
  const plain = text
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain || undefined
}

/** electron-updater's errors carry whole HTTP responses; keep what a player can act on. */
function friendly(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  // No release with an installer for Windows yet, or the newest is still being published.
  if (/\b404\b/.test(text)) return 'the update server has nothing to offer yet (404); try again later'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/.test(text)) return 'could not reach GitHub (offline?)'
  const first = text.split('\n')[0].trim()
  return first.length > 140 ? `${first.slice(0, 140)}…` : first
}
