// How the app is keeping up, in the numbers a "the meter missed a pull" or "the cue was late" report
// needs (FEAT-018): how late the engine's clock laps, how long one slice of the log takes to handle,
// the tailer's counts, lines a part failed on, what the busiest pushes cost, how long a cue waits
// for its phrase, and the heap. Copy diagnostics shows them, and main.log has them every ten minutes
// while a log is watched. No Electron import, so the engine can use it under test.

import type { TailerStats } from '../core/tailer'

/** The last `size` samples, for a high percentile and the worst. */
export class Samples {
  private readonly v: number[] = []
  private next = 0

  constructor(private readonly size = 3000) {}

  add(n: number): void {
    if (this.v.length < this.size) this.v.push(n)
    else this.v[this.next] = n
    this.next = (this.next + 1) % this.size
  }

  get count(): number {
    return this.v.length
  }

  /** The 99th percentile and the worst, in whole units; null with nothing yet. */
  summary(): { p99: number; max: number } | null {
    if (!this.v.length) return null
    const sorted = [...this.v].sort((a, b) => a - b)
    return { p99: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]), max: Math.round(sorted[sorted.length - 1]) }
  }

  clear(): void {
    this.v.length = 0
    this.next = 0
  }
}

/** One push channel's count since the last report, and the size of every tenth, measured. */
interface PushCount {
  count: number
  sampled: number
  bytes: number
}

class Perf {
  /** How much later than its fifth of a second each lap of the engine's clock came, in ms. */
  readonly tickLate = new Samples()
  /** From a cue being due to its phrase going to the audio window, in ms. */
  readonly cue = new Samples(500)
  private pushes = new Map<string, PushCount>()
  private since = Date.now()

  /** The tailer's counts at the last report to main.log, so each report says its own ten minutes (LT-607). */
  private tailerAt: TailerStats | null = null
  private failuresAt = 0
  private unreadAt = 0

  /** A push went out; every tenth is measured (unless `measure` is false), the rest counted. */
  push(channel: string, value: unknown, measure = true): void {
    let p = this.pushes.get(channel)
    if (!p) this.pushes.set(channel, (p = { count: 0, sampled: 0, bytes: 0 }))
    if (p.count++ % 10 === 0 && measure) {
      p.sampled++
      p.bytes += JSON.stringify(value)?.length ?? 0
    }
  }

  /** Lines of text: what Copy diagnostics shows and main.log is given. */
  report(o: { tailer?: TailerStats | null; lineFailures: number; unreadLines?: number }): string[] {
    const minutes = Math.max(1 / 60, (Date.now() - this.since) / 60_000)
    const ms = (s: { p99: number; max: number } | null) => (s ? `p99 ${s.p99} ms, worst ${s.max} ms` : 'none yet')
    // The tailer's counts since the last report; all of them when it started again since (another log).
    const at = this.tailerAt
    const t =
      o.tailer && at && o.tailer.polls >= at.polls
        ? {
            ...o.tailer,
            polls: o.tailer.polls - at.polls,
            slices: o.tailer.slices - at.slices,
            bytes: o.tailer.bytes - at.bytes,
            lines: o.tailer.lines - at.lines,
            failures: o.tailer.failures - at.failures
          }
        : o.tailer
    const heap = process.memoryUsage()
    const pushes = [...this.pushes.entries()]
      .map(([ch, p]) => `${ch} ${Math.round(((p.sampled ? p.bytes / p.sampled : 0) * p.count) / minutes / 1024)} KB/min (${Math.round(p.count / minutes)} a minute)`)
      .join(', ')
    return [
      `  Engine clock late: ${ms(this.tickLate.summary())} over ${this.tickLate.count} laps`,
      `  Cue waited for its phrase: ${ms(this.cue.summary())}`,
      t
        ? `  Log reading: ${t.polls} polls, ${t.slices} slices, ${(t.bytes / 1048576).toFixed(1)} MB, ${t.lines} lines; longest slice ${Math.round(t.maxSliceMs)} ms; ${t.failures} failed reads`
        : '  Log reading: not watching',
      `  Lines a part failed on: ${Math.max(0, o.lineFailures - this.failuresAt)} (${o.lineFailures} this run)`,
      // Lines no part took, chat left out (FEAT-025): a jump after a game patch is a wording that changed.
      `  Lines nothing read: ${Math.max(0, (o.unreadLines ?? 0) - this.unreadAt)} (${o.unreadLines ?? 0} this run)`,
      `  Pushes over ${Math.round(minutes)} min: ${pushes || 'none'}`,
      `  Main heap: ${Math.round(heap.heapUsed / 1048576)} of ${Math.round(heap.heapTotal / 1048576)} MB`
    ]
  }

  /**
   * Starts the counts afresh after each report to main.log: the pushes, the cue and lap samples, and
   * the tailer's counts and longest slice from here (LT-607).
   */
  restart(o: { tailer?: TailerStats | null; lineFailures?: number; unreadLines?: number } = {}): void {
    this.pushes = new Map()
    this.since = Date.now()
    this.cue.clear()
    this.tickLate.clear()
    if (o.tailer) {
      o.tailer.maxSliceMs = 0
      this.tailerAt = { ...o.tailer }
    }
    this.failuresAt = o.lineFailures ?? this.failuresAt
    this.unreadAt = o.unreadLines ?? this.unreadAt
  }
}

/** The app's one set of performance counts. */
export const perf = new Perf()
