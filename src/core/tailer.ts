import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
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

/** Reads come in bounded slices, so a burst of combat never turns into one large read. */
const SLICE = 256 * 1024

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
    void this.release()
  }

  /** Closes the handle; the next read opens the file again. */
  async release(): Promise<void> {
    const h = this.handle
    this.handle = null
    await h?.close().catch(() => undefined)
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
        await this.release()
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
      await this.release()
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

    if (!this.handle) {
      const h = await fs.open(this.path, 'r')
      // The file could be swapped between the stat and the open; only keep a handle to the one stat saw.
      const hs = await h.stat({ bigint: true })
      if (`${hs.dev}:${hs.ino}` !== this.identity) {
        await h.close()
        return
      }
      this.handle = h
    }
    const buf = Buffer.allocUnsafe(SLICE)
    try {
      while (this.pos < size) {
        const want = Math.min(SLICE, size - this.pos)
        const { bytesRead } = await this.handle.read(buf, 0, want, this.pos)
        if (bytesRead <= 0) break
        this.pos += bytesRead
        this.emit(decodeCp1252(buf.subarray(0, bytesRead)))
      }
    } catch (e) {
      // A handle that went bad (the file swapped under it) is dropped; the next poll reopens.
      await this.release()
      throw e
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
