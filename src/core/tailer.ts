import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { decodeCp1252 } from './logLine'
import { fileIdentity } from './fileIdentity'

type ResetReason = 'truncated' | 'replaced'

export interface TailerOptions {
  /** Skip what the file already holds when the tailer first attaches. A file that appears later is read whole. */
  startAtEnd: boolean
  pollMs?: number
  /** `end`: the byte offset just past the last line given, so a reader elsewhere can pick up exactly there. */
  onLines: (lines: string[], end: number) => void
  /** `skipped`: the new file was already large, so reading goes on from its end rather than its top. */
  onReset?: (reason: ResetReason, skipped: boolean) => void
  onMissing?: () => void
  onSize?: (size: number) => void
  /**
   * `read`: the log could not be read FAIL_AFTER polls running (it is still tried every poll).
   * `lines`: `onLines` threw; the slice's later lines and the next slices are still given.
   */
  onError?: (e: unknown, where: 'read' | 'lines') => void
  /** The log reads again after `onError(…, 'read')`. */
  onRecovered?: () => void
}

/** What the tailer has done since it started, for diagnostics (LT-385). */
export interface TailerStats {
  polls: number
  slices: number
  bytes: number
  lines: number
  /** The longest the lines of one slice took to handle, in ms. */
  maxSliceMs: number
  failures: number
}

/** Reads come in bounded slices, so a burst of combat never turns into one large read. */
const SLICE = 256 * 1024
/**
 * A log the game starts afresh is a few lines long when it is first seen. One already larger than
 * this (a backup restored over the log, another file swapped in) is old play: replayed through the
 * live pipeline it would speak every trigger and start a timer for every old cast (LT-373), so it is
 * read on from its end, and the catch-up readers fill in what they need.
 */
const REPLAY_MAX = 1024 * 1024
/** A sharing violation while the game writes clears by the next poll; this many in a row (3 s) is not that. */
const FAIL_AFTER = 30

/**
 * Follows a log file by polling. Filesystem events do not fire reliably for the game's buffered
 * appends, so this polls instead.
 *
 * One handle stays open while the file is the same file, instead of reopening it for every read:
 * less contention with the game writing it, and less for antivirus to look at again. Node opens
 * files shareable for delete, so the handle never stops the log archiver renaming the log away.
 * File identity (volume serial + file index) at the path tells a rotated-in replacement apart from
 * the same file continuing; then the old handle is closed and the new file opened.
 */
export class LogTailer {
  private timer: NodeJS.Timeout | null = null
  private pos = 0
  private identity = ''
  private partial = ''
  private first = true
  private running = false
  private missing = false
  private handle: FileHandle | null = null
  /** Polls in a row that failed to read. */
  private failures = 0
  readonly stats: TailerStats = { polls: 0, slices: 0, bytes: 0, lines: 0, maxSliceMs: 0, failures: 0 }
  /**
   * Bumped by start and stop. A poll or read begun under an older generation was overtaken (stopped,
   * perhaps restarted) and must neither read on nor schedule another poll, or two loops would run.
   */
  private generation = 0

  constructor(
    readonly path: string,
    private readonly opts: TailerOptions
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll(++this.generation)
  }

  stop(): void {
    this.running = false
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    void this.release()
  }

  /** Closes the handle; the next read opens the file again. */
  async release(): Promise<void> {
    const h = this.handle
    this.handle = null
    await h?.close().catch(() => undefined)
  }

  /** How often to look: a tenth of a second while the game writes, a second while it is closed (LT-374). */
  setPollMs(ms: number): void {
    this.opts.pollMs = ms
  }

  private schedule(gen: number): void {
    if (this.running && gen === this.generation) this.timer = setTimeout(() => void this.poll(gen), this.opts.pollMs ?? 100)
  }

  private async poll(gen: number): Promise<void> {
    this.stats.polls++
    try {
      await this.readOnce()
      if (this.failures >= FAIL_AFTER) this.opts.onRecovered?.()
      this.failures = 0
    } catch (e) {
      // A transient sharing violation while the game writes clears by the next poll; one that does
      // not is said once, and the log is still tried every poll.
      this.stats.failures++
      if (++this.failures === FAIL_AFTER) this.opts.onError?.(e, 'read')
    }
    this.schedule(gen)
  }

  /** One polling step. Public so tests can drive it without timers. */
  async readOnce(): Promise<void> {
    const gen = this.generation
    const overtaken = () => gen !== this.generation
    let stat
    try {
      stat = await fs.stat(this.path, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.release()
        if (!this.missing) this.opts.onMissing?.()
        this.missing = true
        return
      }
      throw e
    }
    const identity = fileIdentity(stat)
    const size = Number(stat.size)
    this.missing = false

    if (this.first) {
      this.first = false
      this.identity = identity
      this.pos = this.opts.startAtEnd ? size : 0
    } else if (identity !== this.identity) {
      await this.release()
      this.identity = identity
      const skip = size > REPLAY_MAX
      this.pos = skip ? size : 0
      this.partial = ''
      this.opts.onReset?.('replaced', skip)
    } else if (size < this.pos) {
      const skip = size > REPLAY_MAX
      this.pos = skip ? size : 0
      this.partial = ''
      this.opts.onReset?.('truncated', skip)
    }
    this.opts.onSize?.(size)
    if (size === this.pos) return

    if (overtaken()) return
    if (!this.handle) {
      const h = await fs.open(this.path, 'r')
      let hs
      try {
        hs = await h.stat({ bigint: true })
      } catch (e) {
        // Not kept, so closed here: left to the garbage collector it would stay open until then.
        await h.close().catch(() => undefined)
        throw e
      }
      // The file could be swapped between the stat and the open; only keep a handle to the one stat
      // saw, and none at all if the tailer was stopped meanwhile.
      if (fileIdentity(hs) !== this.identity || overtaken() || this.handle) {
        await h.close()
        return
      }
      this.handle = h
    }
    // Read through this handle even if release() drops this.handle meanwhile; a closed one just throws.
    const h = this.handle
    const buf = Buffer.allocUnsafe(SLICE)
    try {
      while (this.pos < size) {
        const want = Math.min(SLICE, size - this.pos)
        const { bytesRead } = await h.read(buf, 0, want, this.pos)
        // Stopped mid-read: a newer read owns the position now.
        if (overtaken() || bytesRead <= 0) break
        this.pos += bytesRead
        this.stats.slices++
        this.stats.bytes += bytesRead
        const started = performance.now()
        this.emit(decodeCp1252(buf.subarray(0, bytesRead)))
        this.stats.maxSliceMs = Math.max(this.stats.maxSliceMs, performance.now() - started)
      }
    } catch (e) {
      if (overtaken()) return
      // A handle that went bad (the file swapped under it) is dropped; the next poll reopens.
      if (this.handle === h) await this.release()
      throw e
    }
  }

  private emit(text: string): void {
    const parts = (this.partial + text).split('\n')
    // The last piece has no newline yet: hold it until the rest of the line arrives.
    this.partial = parts.pop() ?? ''
    const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.length > 0)
    // Windows-1252 decodes one byte to one character, so the held piece's length is its size in bytes.
    if (!lines.length) return
    this.stats.lines += lines.length
    // The position has moved past these lines, so a reader that throws must not stop the rest of the
    // slice reaching the others (LT-340): it is told, and reading goes on.
    try {
      this.opts.onLines(lines, this.pos - this.partial.length)
    } catch (e) {
      this.opts.onError?.(e, 'lines')
    }
  }
}
