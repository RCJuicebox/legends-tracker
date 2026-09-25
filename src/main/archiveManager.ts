import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { archiveLog, compressLoose, findStaging, finishStaged, stagingOriginalName, type ArchiveOutcome } from '../core/archiver'
import { listArchives, listLogs, logIsIn } from './game'
import { log } from './log'
import type { AppSettings, ArchiveStatus, FeedItem } from '../shared/types'

export interface ArchiveManagerDeps {
  settings: () => AppSettings
  isGameRunning: () => Promise<boolean>
  onStatus: (status: ArchiveStatus) => void
  feed: (kind: FeedItem['kind'], text: string) => void
}

const LOG_NAME = /^eqlog_.+\.txt$/i

/**
 * Character log archiving: on request, automatically past a size, and finishing any archive the app
 * closed in the middle of. One archive runs at a time.
 */
export class ArchiveManager {
  readonly status: ArchiveStatus = { busy: false, message: '', pendingUntilGameExits: [], gameRunning: false, liveRotation: 'unknown' }
  private readonly abort = new AbortController()

  constructor(private readonly deps: ArchiveManagerDeps) {}

  archiveDir(): string {
    const s = this.deps.settings()
    return s.archive.archiveDir || join(s.installDir, 'Logs', 'archive')
  }

  private archiverDeps() {
    return {
      isGameRunning: this.deps.isGameRunning,
      signal: this.abort.signal,
      progress: (m: string) => this.set({ message: m })
    }
  }

  set(patch: Partial<ArchiveStatus>): void {
    Object.assign(this.status, patch)
    this.deps.onStatus({ ...this.status })
  }

  /** Archives a character log in the game's Logs folder. Anything else is refused: the archiver moves and deletes what it is given. */
  async archiveNow(logPath: string): Promise<ArchiveOutcome> {
    const path = typeof logPath === 'string' && logPath ? resolve(logPath) : ''
    if (!path || !LOG_NAME.test(basename(path)) || !logIsIn(path, this.deps.settings().installDir)) {
      log.warn('Refused to archive a file that is not a character log:', logPath)
      return { status: 'failed', message: 'Only character logs (eqlog_….txt) in the game’s Logs folder can be archived.' }
    }
    if (this.status.busy) return { status: 'failed', message: 'An archive is already in progress.' }
    this.set({ busy: true, message: `Archiving ${basename(path)}…` })
    try {
      const outcome = await archiveLog(path, this.archiveDir(), this.archiverDeps())
      this.report(path, outcome)
      return outcome
    } catch (e) {
      log.error(`Archiving ${path} failed:`, e)
      const outcome: ArchiveOutcome = { status: 'failed', message: `Archiving ${basename(path)} failed: ${(e as Error).message}` }
      this.report(path, outcome)
      return outcome
    } finally {
      this.set({ busy: false })
    }
  }

  /** Zips a loose log already in the archive folder. Only a character log there is accepted. */
  async compressLoose(txtPath: string): Promise<ArchiveOutcome> {
    const path = typeof txtPath === 'string' && txtPath ? resolve(txtPath) : ''
    if (!path || !LOG_NAME.test(basename(path)) || dirname(path).toLowerCase() !== resolve(this.archiveDir()).toLowerCase()) {
      log.warn('Refused to compress a file that is not a loose log in the archive folder:', txtPath)
      return { status: 'failed', message: 'Only uncompressed character logs (eqlog_….txt) in the archive folder can be compressed.' }
    }
    if (this.status.busy) return { status: 'failed', message: 'An archive is already in progress.' }
    this.set({ busy: true, message: `Compressing ${basename(path)}…` })
    try {
      const outcome = await compressLoose(path, this.archiverDeps())
      this.report(path, outcome)
      return outcome
    } catch (e) {
      log.error(`Compressing ${path} failed:`, e)
      const outcome: ArchiveOutcome = { status: 'failed', message: `Compressing ${basename(path)} failed: ${(e as Error).message}` }
      this.report(path, outcome)
      return outcome
    } finally {
      this.set({ busy: false })
    }
  }

  private report(logPath: string, o: ArchiveOutcome): void {
    const name = basename(logPath)
    const pending = this.status.pendingUntilGameExits.filter((p) => p !== logPath)
    if (o.status === 'archived') {
      const ratio = o.originalBytes ? Math.round((1 - o.zipBytes / o.originalBytes) * 100) : 0
      const msg = `Archived ${name}: ${mb(o.originalBytes)} → ${mb(o.zipBytes)} (${ratio}% smaller) as ${basename(o.zipPath)}`
      this.set({ message: msg, pendingUntilGameExits: pending, ...(o.liveHandoff ? { liveRotation: 'supported' as const } : {}) })
      this.deps.feed('archive', msg)
    } else if (o.status === 'deferred') {
      this.set({
        message: o.message,
        pendingUntilGameExits: [...pending, logPath],
        ...(o.reason === 'held-open' ? { liveRotation: 'unsupported' as const } : {})
      })
      this.deps.feed('archive', o.message)
    } else {
      this.set({ message: o.message, pendingUntilGameExits: pending })
      this.deps.feed('warn', o.message)
    }
  }

  /** Auto-archives any character log over the size threshold; retries deferred logs once the game has exited. */
  async check(): Promise<void> {
    const s = this.deps.settings()
    if (this.status.busy || !s.installDir) return
    const running = await this.deps.isGameRunning()
    if (running !== this.status.gameRunning) this.set({ gameRunning: running })
    const waitForExit = running && this.status.liveRotation === 'unsupported'
    for (const path of this.status.pendingUntilGameExits) {
      if (!running && existsSync(path) && !this.status.busy) return void (await this.archiveNow(path))
    }
    if (!s.archive.autoEnabled) return
    const logs = await listLogs(s.installDir)
    // An archive started by hand while the logs were listed is running now; leave it be.
    if (this.status.busy) return
    for (const l of logs) {
      if (l.size < s.archive.thresholdMB * 1048576) continue
      if (waitForExit || this.status.pendingUntilGameExits.includes(l.path)) continue
      this.deps.feed('archive', `${l.name} is ${mb(l.size)}, over the ${s.archive.thresholdMB} MB limit.`)
      await this.archiveNow(l.path)
      return
    }
  }

  /** An archive interrupted by the app closing leaves its moved log behind; finish it. */
  async resumeStaging(): Promise<void> {
    const dir = this.archiveDir()
    for (const staging of await findStaging(dir)) {
      const logPath = join(this.deps.settings().installDir, 'Logs', stagingOriginalName(staging))
      this.set({ busy: true, message: `Finishing an interrupted archive of ${basename(logPath)}…` })
      try {
        this.report(logPath, await finishStaged(staging, logPath, dir, this.archiverDeps()))
      } catch (e) {
        log.error(`Finishing the interrupted archive ${staging} failed:`, e)
        this.report(logPath, { status: 'failed', message: `Could not finish archiving ${basename(logPath)}: ${(e as Error).message}` })
      } finally {
        this.set({ busy: false })
      }
    }
  }

  async overview() {
    const s = this.deps.settings()
    const running = await this.deps.isGameRunning()
    if (running !== this.status.gameRunning) this.set({ gameRunning: running })
    return {
      logs: s.installDir ? await listLogs(s.installDir) : [],
      archives: await listArchives(this.archiveDir()),
      archiveDir: this.archiveDir(),
      status: { ...this.status }
    }
  }

  /** Stops waiting on any archive in progress; it resumes next start. */
  shutdown(): void {
    this.abort.abort()
  }
}

/** "12.3 MB", "150 MB": one decimal while small. */
export function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}
