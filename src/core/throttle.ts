// Two small shapes the engine repeats: a view pushed at most so often, and live lines held back while
// history is read.

/** Work a throttled view does on a steady beat, whether or not anything changed. */
export interface Heartbeat {
  /** It runs at least this often. */
  everyMs: number
  /** Runs at each beat and before each send, and may mark the view changed. */
  beat: (now: number) => void
}

/**
 * A view that goes out when it has changed, no more than once per `minMs`. With a heartbeat, the
 * beat also runs whenever `everyMs` has passed since the last time, changed or not; a view it marks
 * changed goes out with it.
 */
export class Throttled {
  private dirty = false
  private sentAt = 0

  constructor(
    private readonly minMs: number,
    private readonly send: () => void,
    private readonly heartbeat?: Heartbeat
  ) {}

  /** Something in the view changed. */
  mark(): void {
    this.dirty = true
  }

  /** Beats if the beat is due, and sends if it changed and the wait is over. */
  tick(now: number): void {
    const waited = now - this.sentAt
    if (!((this.dirty && waited > this.minMs) || (this.heartbeat && waited > this.heartbeat.everyMs))) return
    this.sentAt = now
    this.heartbeat?.beat(now)
    if (!this.dirty) return
    this.dirty = false
    this.send()
  }

  /** It went out just now by another way: the wait starts again. */
  sent(now: number): void {
    this.dirty = false
    this.sentAt = now
  }
}

/**
 * Live lines held while history is read, so a reader sees every line once and in order. It holds at
 * most `max`; past that it is `full`, and the history read should stop and let them through.
 */
export class Backlog<T> {
  private lines: T[] | null = null

  constructor(private readonly max = 200_000) {}

  get active(): boolean {
    return this.lines !== null
  }

  get full(): boolean {
    return this.size >= this.max
  }

  /** Lines held now. */
  get size(): number {
    return this.lines?.length ?? 0
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
