import { createReadStream, existsSync, promises as fs, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { parseMoteLoot, type MoteTracker } from '../../core/motes'
import type { LogLine } from '../../core/logLine'
import { listLogs } from '../game'
import { readLines } from '../logReading'
import { identityOf, offsetBefore } from '../sources/logHistory'
import { sameFile } from '../../core/fileIdentity'
import { combineScans, mergeRebuilt, samePath } from '../moteMerge'
import type { MoteScanJob, MoteScanResult } from '../moteHistory'
import type { MoteStockKeeper } from '../moteStock'
import { log } from '../log'
import { Backlog } from './throttle'
import type { EngineEnv, EngineOutputs, EngineStore, MoteScanner } from './contracts'
import type { Notifier } from './notifier'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** In the hour clocks go back, log stamps repeat: catching up by time looks back this much further. */
const DST_SLACK_MS = 3600_000

/**
 * catchup.json: how far into which log mote tracking had read when the app last closed. Every line
 * before `offset` was handled. It holds only while motes.json says the same `seenUntil`; otherwise
 * catching up goes by the lines' times instead.
 */
interface CatchUpMark {
  logFile: string
  /** The file's identity (volume and file index), so an archived-and-replaced log is not mistaken for it. */
  id: string
  offset: number
  seenUntil: number
}

/** Where the live tailer is. */
export interface TailInfo {
  /** The watched log, or '' when none is. */
  logFile(): string
  /** Just past the last line it gave, else where it attached; -1 before it knows. */
  position(): number
  /** Watching is starting, or the tailer has yet to take its first look. */
  settling(): boolean
}

export interface MoteHooks {
  motes: () => MoteTracker
  stock: MoteStockKeeper
  tail: TailInfo
  archiveDir: () => string
  gameRunning: () => boolean
  /** The mote history changed: the page hears soon. */
  changed: () => void
}

/**
 * Mote history from the log: catching up on what was logged while the app was closed, and rebuilding
 * the whole history from every log and archive. While either reads, live lines wait so none is lost
 * or counted twice; where they begin in the log is where reading must stop.
 */
export class MoteCatchUp {
  readonly backlog = new Backlog<LogLine>()
  /** Where in `backlogLog` the waiting lines begin: history reads up to there. -1 until known. */
  private backlogFrom = -1
  private backlogLog = ''
  /** Every line of `logFile` before `offset` has been through mote tracking. */
  private linePos: { logFile: string; offset: number } | null = null
  private scan: { stop: () => void } | null = null
  scanning = ''
  scanProgress = 0

  constructor(
    private readonly store: EngineStore,
    private readonly env: EngineEnv,
    private readonly out: Pick<EngineOutputs, 'moteScan' | 'motes'>,
    private readonly notifier: Notifier,
    private readonly hooks: MoteHooks
  ) {}

  private get markFile(): string {
    return join(this.env.dataDir, 'catchup.json')
  }

  private get motes(): MoteTracker {
    return this.hooks.motes()
  }

  /** A live line: held while history is read, else counted now. */
  live(line: LogLine): void {
    if (!this.backlog.hold(line)) this.motes.handle(line)
  }

  /** The tailer handed over lines up to `end`: all of that has been through mote tracking, unless history is still being read. */
  linesRead(logFile: string, end: number): void {
    if (!this.backlog.active) this.linePos = { logFile, offset: end }
  }

  /** The tailer took its first look: if history is being read, it stops here. */
  attached(logFile: string, size: number): void {
    if (this.backlog.active && this.backlogFrom < 0) {
      this.backlogFrom = size
      this.backlogLog = logFile
    }
  }

  /** The log was truncated or replaced under the tailer. */
  tailReset(logFile: string, reason: string): void {
    if (this.backlog.active && samePath(this.backlogLog, logFile)) {
      // Where history reading was to stop is in the old file; the waiting lines are the new one's.
      log.warn(`The log was ${reason} while mote history was being read; lines around the switch may be counted twice.`)
      this.backlogFrom = -1
      this.backlogLog = ''
    }
  }

  /** From here live lines wait, and the tailer's position says where reading history must stop. */
  private begin(): void {
    this.backlog.begin()
    this.backlogFrom = this.hooks.tail.position()
    this.backlogLog = this.backlogFrom >= 0 ? this.hooks.tail.logFile() : ''
  }

  /** Where the waiting lines begin in `logFile`, waiting a moment for a tailer that is just starting; -1 if not known. */
  private async mark(logFile: string): Promise<number> {
    for (let i = 0; i < 200 && this.backlogFrom < 0 && this.hooks.tail.settling(); i++) await sleep(25)
    return this.backlogFrom >= 0 && samePath(this.backlogLog, logFile) ? this.backlogFrom : -1
  }

  /** History is read: the lines that waited are handled now, in order. */
  private end(logFile: string, reached: number): void {
    const waiting = this.backlog.end()
    this.backlogFrom = -1
    this.backlogLog = ''
    for (const line of waiting) this.motes.handle(line)
    const pos = this.hooks.tail.position()
    if (this.hooks.tail.logFile() && pos >= 0) this.linePos = { logFile: this.hooks.tail.logFile(), offset: pos }
    else if (reached > 0) this.linePos = { logFile, offset: reached }
    this.store.motes.set(this.motes.state)
    this.hooks.changed()
  }

  private readMark(): CatchUpMark | null {
    try {
      const m = JSON.parse(readFileSync(this.markFile, 'utf8')) as CatchUpMark
      return typeof m.logFile === 'string' && typeof m.offset === 'number' && typeof m.seenUntil === 'number' && typeof m.id === 'string' ? m : null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Ignoring ${this.markFile}:`, e)
      return null
    }
  }

  /** Written on the way out, alongside motes.json: how far mote tracking read. */
  saveMark(): void {
    const p = this.linePos
    // Mid-read, what is on disk is not caught up; the next start goes by times instead.
    if (!p || this.backlog.active) return
    try {
      const st = statSync(p.logFile, { bigint: true })
      const mark: CatchUpMark = { logFile: p.logFile, id: identityOf(st), offset: p.offset, seenUntil: this.motes.state.seenUntil ?? 0 }
      writeFileSync(this.markFile + '.tmp', JSON.stringify(mark), 'utf8')
      renameSync(this.markFile + '.tmp', this.markFile)
    } catch (e) {
      log.warn('Could not save where mote tracking got to:', e)
    }
  }

  /**
   * The live tailer starts at the end of the log, so anything logged while the app was closed (a run
   * entered, motes looted) is read here first, from where mote tracking last left off: the offset in
   * catchup.json when it still matches, else the first line older than the last one tracked.
   */
  async catchUp(logFile: string): Promise<void> {
    const motesSince = this.motes.state.seenUntil ?? 0
    const stockSince = this.hooks.stock.view().seenUntil ?? 0
    const since = motesSince || stockSince
    if (!logFile || this.backlog.active || !since) return
    this.begin()
    let reached = 0
    try {
      const mark = this.readMark()
      // Used once: a crash before the next clean exit must not replay from it again.
      try {
        rmSync(this.markFile, { force: true })
      } catch (e) {
        log.warn(`Could not remove ${this.markFile}:`, e)
      }
      const st = await fs.stat(logFile, { bigint: true })
      const exact = !!mark && samePath(mark.logFile, logFile) && sameFile({ id: mark.id, size: mark.offset }, { id: identityOf(st), size: Number(st.size) }) && mark.seenUntil === motesSince
      const from = exact ? mark!.offset : await offsetBefore(logFile, since, { slackMs: DST_SLACK_MS })
      if (exact) this.hooks.stock.resume()
      const onLine = (line: LogLine) => {
        if (exact || line.time > motesSince) this.motes.handle(line)
        else if (line.time >= stockSince) {
          // Already tracked, but newer than the stock: count its motes into the stock only.
          const loot = parseMoteLoot(line.text)
          if (loot) this.hooks.stock.add(loot, line.time)
        }
      }
      const until = await this.mark(logFile)
      const end = until >= 0 ? until : Number(st.size)
      reached = from
      if (end > from) reached += await readLines(createReadStream(logFile, { start: from, end: end - 1 }), onLine, { flushLast: false })
      // The tailer attached while this read: read on to where it took over.
      const later = until < 0 && samePath(this.backlogLog, logFile) ? this.backlogFrom : -1
      if (later > reached) reached += await readLines(createReadStream(logFile, { start: reached, end: later - 1 }), onLine, { flushLast: false })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') log.info(`No log to catch up on at ${logFile}.`)
      else log.warn(`Catching up on motes from ${logFile} failed:`, e)
    } finally {
      this.end(logFile, reached)
    }
  }

  private setScan(message: string, fraction = 0): void {
    this.scanning = message
    this.scanProgress = fraction
    this.out.moteScan({ scanning: message, scanProgress: fraction })
  }

  /**
   * Rebuilds mote history from every character's log in the Logs folder and their archives, merges
   * it into the history kept, then carries on live. Only progress goes out while it reads.
   */
  async rebuild(installDir: string, watched: string, view: () => Parameters<EngineOutputs['motes']>[0]): Promise<void> {
    if (this.scan || this.backlog.active) {
      this.notifier.pushFeed('info', 'Already reading your logs.')
      return
    }
    this.begin()
    let reached = 0
    try {
      this.setScan('Getting ready to read your logs…')
      const paths = installDir ? (await listLogs(installDir)).map((l) => l.path) : []
      if (watched && !paths.some((p) => samePath(p, watched)) && existsSync(watched)) paths.push(watched)
      if (!paths.length) {
        this.notifier.pushFeed('info', 'No character logs to read mote history from.')
        return
      }
      const until = watched ? await this.mark(watched) : -1
      const job: MoteScanJob = {
        archiveDir: this.hooks.archiveDir(),
        logs: paths.map((p) => ({ logPath: p, stem: basename(p, '.txt'), ...(until >= 0 && samePath(p, watched) ? { end: until } : {}) }))
      }
      const run = (this.env.scanMotes ?? workerScanner(this.env.moteWorkerPath))(job, (m, f) => this.setScan(m, f))
      this.scan = run
      const scanned = await run.done
      const merged = mergeRebuilt(this.motes.state, combineScans(scanned, watched, this.hooks.gameRunning()))
      const w = scanned.characters.find((c) => samePath(c.logPath, watched))
      if (merged.seenUntil === undefined && w?.lastTime) merged.seenUntil = w.lastTime
      this.motes.state = merged
      reached = w?.end ?? 0
      // The tailer attached while the logs were read: read on to where it took over.
      const later = w && until < 0 && samePath(this.backlogLog, watched) ? this.backlogFrom : -1
      if (later > reached) reached += await readLines(createReadStream(watched, { start: reached, end: later - 1 }), (l) => this.motes.handle(l), { flushLast: false })
      const crawls = merged.sessions.filter((s) => s.kind === 'crawl').length
      const n = scanned.characters.length
      this.notifier.pushFeed('loot', `Mote history rebuilt from ${n} character log${n === 1 ? '' : 's'}: ${crawls} crawl${crawls === 1 ? '' : 's'}.`)
    } catch (e) {
      log.error('Rebuilding mote history failed:', e)
      this.notifier.pushFeed('warn', `Could not read mote history: ${(e as Error).message}`)
    } finally {
      this.scan = null
      this.end(watched, reached)
      this.setScan('')
      this.out.motes(view())
    }
  }

  /** Stops a rebuild in progress and writes where mote tracking got to. */
  shutdown(): void {
    this.scan?.stop()
    this.saveMark()
  }
}

/** Reads mote history on a worker thread, so nothing it does can be felt in the app, the overlays or the live tailer. */
export function workerScanner(path: string): MoteScanner {
  return (job, progress) => {
    const worker = new Worker(path, { workerData: job })
    let stopped = false
    const done = new Promise<MoteScanResult>((resolve, reject) => {
      worker.on('message', (m: { kind: 'progress'; message: string; fraction: number } | { kind: 'done'; result: MoteScanResult } | { kind: 'error'; message: string }) => {
        if (m.kind === 'progress') progress(m.message, m.fraction)
        else if (m.kind === 'done') resolve(m.result)
        else reject(new Error(m.message))
      })
      worker.on('error', reject)
      worker.on('exit', (code) => code !== 0 && reject(new Error(stopped ? 'stopped' : `the reader stopped (${code})`)))
    })
    return {
      done,
      stop: () => {
        stopped = true
        worker.terminate().catch((e: unknown) => log.warn('Stopping the mote history reader failed:', e))
      }
    }
  }
}
