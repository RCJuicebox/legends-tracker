import { promises as fs } from 'node:fs'
import { decodeCp1252 } from './logLine'

export type ResetReason = 'truncated' | 'replaced'

export interface TailerOptions {
  /** Skip what the file already holds when the tailer first attaches. A file that appears later is read whole. */
  startAtEnd: boolean
  pollMs?: number
  onLines: (lines: string[]) => void
  onReset?: (reason: ResetReason) => void
  onMissing?: () => void
  onSize?: (size: number) => void
}

const MAX_READ = 1 << 20

/**
 * Follows a log file by polling. Filesystem events do not fire reliably for the game's buffered
 * appends, so this polls instead.
 *
 * The file is opened only for the moment of each read, so the tailer never holds a handle that
 * would stop the log archiver from renaming the log away. File identity (volume serial + file
 * index) tells a rotated-in replacement apart from the same file continuing.
 */
export class LogTailer {
  private timer: NodeJS.Timeout | null = null
  private pos = 0
  private identity = ''
  private partial = ''
  private first = true
  private running = false
  private missing = false

  constructor(
    readonly path: string,
    private readonly opts: TailerOptions
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.running) this.timer = setTimeout(() => void this.poll(), this.opts.pollMs ?? 100)
  }

  private async poll(): Promise<void> {
    try {
      await this.readOnce()
    } catch {
      // A transient sharing violation while the game writes; try again next poll.
    }
    this.schedule()
  }

  /** One polling step. Public so tests can drive it without timers. */
  async readOnce(): Promise<void> {
    let stat
    try {
      stat = await fs.stat(this.path, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        if (!this.missing) this.opts.onMissing?.()
        this.missing = true
        return
      }
      throw e
    }
    const identity = `${stat.dev}:${stat.ino}`
    const size = Number(stat.size)
    this.missing = false

    if (this.first) {
      this.first = false
      this.identity = identity
      this.pos = this.opts.startAtEnd ? size : 0
    } else if (identity !== this.identity) {
      this.identity = identity
      this.pos = 0
      this.partial = ''
      this.opts.onReset?.('replaced')
    } else if (size < this.pos) {
      this.pos = 0
      this.partial = ''
      this.opts.onReset?.('truncated')
    }
    this.opts.onSize?.(size)
    if (size === this.pos) return

    const handle = await fs.open(this.path, 'r')
    try {
      while (this.pos < size) {
        const want = Math.min(MAX_READ, size - this.pos)
        const buf = Buffer.allocUnsafe(want)
        const { bytesRead } = await handle.read(buf, 0, want, this.pos)
        if (bytesRead <= 0) break
        this.pos += bytesRead
        this.emit(decodeCp1252(buf.subarray(0, bytesRead)))
      }
    } finally {
      await handle.close()
    }
  }

  private emit(text: string): void {
    const parts = (this.partial + text).split('\n')
    // The last piece has no newline yet: hold it until the rest of the line arrives.
    this.partial = parts.pop() ?? ''
    const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.length > 0)
    if (lines.length) this.opts.onLines(lines)
  }
}
