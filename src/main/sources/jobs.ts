import type { JobView } from '../../shared/ipc'

// Long jobs (a wiki download, a mote rescan, a log check, a meter rebuild): each says what it is
// doing and how far along it is, and each can be cancelled. The main window shows them in one strip
// above whatever page is open.

export interface Job {
  /** Aborted when the player cancels; a job checks it between steps. */
  signal: AbortSignal
  progress(fraction: number | null, detail?: string): void
}

class JobRegistry {
  private readonly jobs = new Map<string, JobView & { abort: AbortController }>()
  /** Each job running, by id: a second start of it is handed this (LT-609). */
  private readonly running = new Map<string, Promise<unknown>>()
  private sink: ((jobs: JobView[]) => void) | null = null
  private timer: NodeJS.Timeout | null = null

  onChange(sink: (jobs: JobView[]) => void): void {
    this.sink = sink
  }

  /** Runs `work` as a job; a second start of the same id waits for the first instead. */
  run<T>(id: string, label: string, work: (job: Job) => Promise<T>): Promise<T> {
    const had = this.running.get(id)
    if (had) return had as Promise<T>
    const p = this.start(id, label, work)
    this.running.set(id, p)
    void p.then(
      () => this.running.delete(id),
      () => this.running.delete(id)
    )
    return p
  }

  private async start<T>(id: string, label: string, work: (job: Job) => Promise<T>): Promise<T> {
    const abort = new AbortController()
    this.jobs.set(id, { id, label, fraction: null, detail: '', abort })
    this.changed()
    try {
      return await work({
        signal: abort.signal,
        progress: (fraction, detail) => {
          const j = this.jobs.get(id)
          if (!j) return
          j.fraction = fraction
          if (detail !== undefined) j.detail = detail
          this.changed()
        }
      })
    } finally {
      this.jobs.delete(id)
      this.changed()
    }
  }

  /** Whether a job of this id is running. */
  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  cancel(id: string): void {
    this.jobs.get(id)?.abort.abort()
  }

  list(): JobView[] {
    return [...this.jobs.values()].map(({ abort: _abort, ...v }) => v)
  }

  private changed(): void {
    if (this.timer || !this.sink) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.sink?.(this.list())
    }, 250)
  }
}

export const jobs = new JobRegistry()

/** Thrown into a job's work when it was cancelled. */
class Cancelled extends Error {
  constructor() {
    super('Cancelled')
  }
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Cancelled()
}
