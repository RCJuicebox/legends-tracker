import { basename } from 'node:path'
import { LogClock, type LogLine } from '../../core/logLine'
import { LogTailer } from '../../core/tailer'
import { log } from '../log'
import type { EngineFeature } from './feature'
import type { FeedItem, WatchStatus } from '../../shared/types'

// The watched log, followed (LT-638: out of the engine): one tailer at a time, each line handed to
// every part in turn, and what goes wrong said once. A part that throws loses that line (or lap) to
// itself only (LT-340); a log that will not read is said until it reads again.

/** How often the log is looked at: while the game runs, and while it does not. */
export const LIVE_POLL_MS = 100
export const IDLE_POLL_MS = 1000

export interface Tail {
  tailer: LogTailer
  logFile: string
  /** The size when the tailer attached: it reads on from there. -1 until its first look. */
  start: number
  /** Just past the last line it gave. -1 until it has given one. */
  end: number
  /** Keeps the lines' times in order across the hour the clocks go back. */
  clock: LogClock
}

/** What the follower needs of the engine. */
export interface FollowHost {
  readonly status: WatchStatus
  /** The parts that follow the log, in order. */
  readonly features: readonly EngineFeature[]
  pushFeed(kind: FeedItem['kind'], text: string): void
  emitStatus(): void
  /** The size or last-line time changed: the status goes out at the next throttle. */
  statusChanged(): void
  /** Lines arrived: the sound player is about to be busy. */
  lines(): void
  /** Every part has had the lines: a new timer's bar goes out with its line. */
  linesDone(): void
  /** A line no part took (FEAT-025). */
  unread(line: LogLine): void
  /** The tailer attached at `size`; the log was cut short or replaced. */
  attached(logFile: string, size: number): void
  reset(logFile: string, reason: 'truncated' | 'replaced'): void
  /** Archiving is moving the log away on purpose. */
  archiving(): boolean
}

export class LogFollower {
  tail: Tail | null = null
  private missing = false
  /** The tailer has said the log keeps failing to read, and has not said it reads again. */
  private readFailing = false
  /** Lines (or laps) a part threw on this run, and when each part was last said in main.log. */
  failures = 0
  private readonly warned = new Map<string, number>()
  /** When a part last threw: its error leaves the status a minute after. */
  private errorAt = 0

  constructor(private readonly host: FollowHost) {}

  /** Starts following `logFile` from its end, the tail before it let go. */
  follow(logFile: string, pollMs: number): Tail {
    this.tail?.tailer.stop()
    this.missing = false
    const tail: Tail = {
      logFile,
      start: -1,
      end: -1,
      clock: new LogClock(Date.now),
      tailer: new LogTailer(logFile, {
        startAtEnd: true,
        pollMs,
        onLines: (lines, end) => this.tail === tail && this.onLines(tail, lines, end),
        onReset: (reason, skipped) => this.tail === tail && this.onReset(tail, reason, skipped),
        onMissing: () => this.tail === tail && this.onMissing(tail),
        onSize: (size) => this.tail === tail && this.onSize(tail, size),
        onError: (e, where) => this.tail === tail && this.onError(e, where),
        onRecovered: () => this.tail === tail && this.onRecovered()
      })
    }
    this.tail = tail
    tail.tailer.start()
    return tail
  }

  stop(): void {
    this.tail?.tailer.stop()
    this.tail = null
  }

  setPollMs(ms: number): void {
    this.tail?.tailer.setPollMs(ms)
  }

  /**
   * One part that throws loses that line (or lap) to itself only: every other part still gets it
   * (LT-340). Said in main.log at most once a minute a part, and on the chat log's Data Sources row
   * until a minute goes by without another.
   */
  failed(f: EngineFeature, what: string, e: unknown): void {
    const now = Date.now()
    this.failures++
    if (now - (this.warned.get(f.id) ?? 0) >= 60_000) {
      this.warned.set(f.id, now)
      log.warn(`The ${f.id} part failed on ${what} (${this.failures} failure${this.failures === 1 ? '' : 's'} this run):`, e)
    }
    this.errorAt = now
    const text = `The ${f.id} part failed on ${what}: ${e instanceof Error ? e.message : String(e)}`
    if (this.host.status.logError !== text && !this.readFailing) {
      this.host.status.logError = text
      this.host.emitStatus()
    }
  }

  /** A lap of the clock: a part's error leaves the status a minute after its last. */
  tick(now: number): void {
    if (this.errorAt && !this.readFailing && now - this.errorAt > 60_000) {
      this.errorAt = 0
      this.host.status.logError = undefined
      this.host.emitStatus()
    }
  }

  private onSize(t: Tail, size: number): void {
    const status = this.host.status
    if (t.start < 0) {
      t.start = size
      this.host.attached(t.logFile, size)
    }
    if (this.missing) {
      this.missing = false
      status.watching = true
      this.host.pushFeed('info', `${basename(t.logFile)} is back; watching it again.`)
      this.host.statusChanged()
    }
    if (size !== status.logSize) this.host.statusChanged()
    status.logSize = size
  }

  private onReset(t: Tail, reason: 'truncated' | 'replaced', skipped: boolean): void {
    t.end = skipped ? -1 : 0
    this.host.reset(t.logFile, reason)
    if (skipped) {
      // Old play, not new: replayed, every trigger in it would speak and every cast start a timer.
      this.host.pushFeed('info', `${reason === 'replaced' ? 'Another file took the log’s place' : 'The log was cut short'}, already holding earlier play; reading on from its end.`)
      return
    }
    this.host.pushFeed('info', reason === 'replaced' ? 'A new log file was started.' : 'The log was truncated; reading from the top.')
  }

  private onMissing(t: Tail): void {
    this.missing = true
    this.host.status.watching = false
    const text = `${basename(t.logFile)} is gone (moved or deleted). Waiting for the game to write it again.`
    // Archiving moves the log away on purpose; the game starts a new one at its next line.
    this.host.pushFeed(this.host.archiving() ? 'info' : 'warn', text)
    this.host.emitStatus()
  }

  private onLines(t: Tail, lines: string[], end: number): void {
    t.end = end
    this.host.lines()
    for (const raw of lines) {
      const line = t.clock.parse(raw)
      if (!line) continue
      let took = false
      for (const f of this.host.features) {
        if (!f.line) continue
        try {
          if (f.line(line)) took = true
        } catch (e) {
          // A part that threw on a line read it, as far as the report goes: the failure is said on its own.
          took = true
          this.failed(f, 'a line', e)
        }
      }
      if (!took) this.host.unread(line)
    }
    for (const f of this.host.features) {
      try {
        f.linesRead?.(t.logFile, end)
      } catch (e) {
        this.failed(f, 'where the log is read to', e)
      }
    }
    this.host.linesDone()
  }

  private onError(e: unknown, where: 'read' | 'lines'): void {
    if (where === 'lines') {
      // Each part's own failures are caught in onLines; this is the wiring itself.
      log.warn('Handling log lines failed:', e)
      return
    }
    this.readFailing = true
    log.warn('Reading the log keeps failing:', e)
    this.host.status.logError = `Reading the log keeps failing: ${e instanceof Error ? e.message : String(e)}`
    this.host.pushFeed('warn', `${this.host.status.logError}. Still trying.`)
    this.host.emitStatus()
  }

  private onRecovered(): void {
    this.readFailing = false
    this.host.status.logError = undefined
    this.host.pushFeed('info', 'The log reads again.')
    this.host.emitStatus()
  }
}
