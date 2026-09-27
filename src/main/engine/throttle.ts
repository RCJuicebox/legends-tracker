// Two small shapes the engine repeats: a view pushed at most so often, and live lines held back while
// history is read.

/** A view that goes out when it has changed, no more than once per `minMs`. */
export class Throttled {
  private dirty = false
  private sentAt = 0

  constructor(
    private readonly minMs: number,
    private readonly send: () => void
  ) {}

  /** Something in the view changed. */
  mark(): void {
    this.dirty = true
  }

  /** Sends if it changed and the wait is over. */
  tick(now: number): void {
    if (!this.dirty || now - this.sentAt <= this.minMs) return
    this.dirty = false
    this.sentAt = now
    this.send()
  }

  /** It went out just now by another way: the wait starts again. */
  sent(now: number): void {
    this.dirty = false
    this.sentAt = now
  }
}

/** Live lines held while history is read, so a reader sees every line once and in order. */
export class Backlog<T> {
  private lines: T[] | null = null

  get active(): boolean {
    return this.lines !== null
  }

  begin(): void {
    this.lines = []
  }

  /** Holds the line while history is being read; false means handle it now. */
  hold(line: T): boolean {
    if (!this.lines) return false
    this.lines.push(line)
    return true
  }

  /** History is read: the held lines, in order. Holding stops. */
  end(): T[] {
    const lines = this.lines ?? []
    this.lines = null
    return lines
  }
}
