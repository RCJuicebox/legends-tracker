import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { MoteScanJob, MoteScanResult } from '../src/main/moteHistory'

// No thread is started. Both ends of the mote history reader are tested against a stand-in for
// worker_threads: the worker script with a fake parentPort (and the scan itself replaced), and the
// main process's side with a fake Worker whose messages are raised by hand.
const h = vi.hoisted(() => ({
  posted: [] as unknown[],
  job: null as unknown,
  workers: [] as unknown[],
  scan: null as unknown as (job: unknown, progress: (message: string, fraction: number) => void) => Promise<unknown>
}))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeWorker extends Emitter {
    readonly terminate = vi.fn(async () => {
      queueMicrotask(() => this.emit('exit', 1))
      return 1
    })
    constructor(
      readonly path: string,
      readonly options: { workerData: unknown }
    ) {
      super()
      h.workers.push(this)
    }
  }
  return {
    Worker: FakeWorker,
    parentPort: { postMessage: (m: unknown) => h.posted.push(m) },
    get workerData() {
      return h.job
    }
  }
})
vi.mock('../src/main/moteHistory', () => ({ scanMoteHistory: (job: unknown, progress: (m: string, f: number) => void) => h.scan(job, progress) }))
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { workerScanner } = await import('../src/main/engine/moteCatchUp')

const JOB: MoteScanJob = { archiveDir: 'C:\\scratch\\archive', logs: [{ logPath: 'C:\\scratch\\Logs\\eqlog_Tester_testzone.txt', stem: 'eqlog_Tester_testzone' }] }
const RESULT = { characters: [] } as unknown as MoteScanResult

type FakeWorker = EventEmitter & { path: string; options: { workerData: unknown }; terminate: ReturnType<typeof vi.fn> }

/** Loads the worker script afresh, as a new thread would, and waits for it to post its last message. */
async function runWorkerScript(): Promise<unknown[]> {
  vi.resetModules()
  await import('../src/main/moteWorker')
  await vi.waitFor(() => expect(h.posted.some((m) => (m as { kind: string }).kind !== 'progress')).toBe(true))
  return h.posted
}

beforeEach(() => {
  h.posted.length = 0
  h.workers.length = 0
  h.job = JOB
})

describe('the mote history worker script', () => {
  it('scans the job it was given, posting progress and then the result', async () => {
    let seen: unknown
    h.scan = async (job, progress) => {
      seen = job
      progress('Reading eqlog_Tester_testzone.txt…', 0.25)
      progress('Reading archives…', 0.75)
      return RESULT
    }
    const posted = await runWorkerScript()
    expect(seen).toBe(JOB)
    expect(posted).toEqual([
      { kind: 'progress', message: 'Reading eqlog_Tester_testzone.txt…', fraction: 0.25 },
      { kind: 'progress', message: 'Reading archives…', fraction: 0.75 },
      { kind: 'done', result: RESULT }
    ])
  })

  it('posts the error message when the scan fails', async () => {
    h.scan = async () => {
      throw new Error('the archive is damaged')
    }
    expect(await runWorkerScript()).toEqual([{ kind: 'error', message: 'the archive is damaged' }])
  })

  it('posts something readable when the scan fails with a bare value', async () => {
    h.scan = () => Promise.reject('no such folder')
    expect(await runWorkerScript()).toEqual([{ kind: 'error', message: 'no such folder' }])
  })
})

describe('reading mote history on a worker thread', () => {
  function start() {
    const progress: [string, number][] = []
    const run = workerScanner('C:\\app\\moteWorker.js')(JOB, (m, f) => progress.push([m, f]))
    const worker = h.workers.at(-1) as FakeWorker
    return { run, worker, progress }
  }

  it('starts the worker script with the job', () => {
    const { worker } = start()
    expect(worker.path).toBe('C:\\app\\moteWorker.js')
    expect(worker.options.workerData).toBe(JOB)
  })

  it('passes progress on, and finishes with the result', async () => {
    const { run, worker, progress } = start()
    worker.emit('message', { kind: 'progress', message: 'half way', fraction: 0.5 })
    worker.emit('message', { kind: 'done', result: RESULT })
    worker.emit('exit', 0)
    expect(await run.done).toBe(RESULT)
    expect(progress).toEqual([['half way', 0.5]])
  })

  it('fails with the message the worker posts', async () => {
    const { run, worker } = start()
    worker.emit('message', { kind: 'error', message: 'the archive is damaged' })
    await expect(run.done).rejects.toThrow('the archive is damaged')
  })

  it('fails when the worker itself throws', async () => {
    const { run, worker } = start()
    worker.emit('error', new Error('out of memory'))
    await expect(run.done).rejects.toThrow('out of memory')
  })

  it('fails when the worker exits without an answer', async () => {
    const { run, worker } = start()
    worker.emit('exit', 7)
    await expect(run.done).rejects.toThrow('the reader stopped (7)')
  })

  it('ends the worker when stopped, and fails with "stopped" so it is not taken for an error', async () => {
    const { run, worker } = start()
    run.stop()
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(run.done).rejects.toThrow(/^stopped$/)
  })
})
