import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlanReply, PlanRequest } from '../../../src/features/factions/planWorker'
import type { FactionPlan } from '../../../src/features/factions/planTypes'

// The page's side of the planner worker, with a worker that answers when told to: a lane runs one ask
// at a time and keeps only the newest waiting behind it (LT-547).

const posted: PlanRequest[] = []
const workers: FakeWorker[] = []

class FakeWorker {
  onmessage: ((e: MessageEvent<PlanReply>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  constructor() {
    workers.push(this)
  }
  postMessage(r: PlanRequest) {
    posted.push(r)
  }
  terminate() {}
  /** Answers the ask with this id, as the worker does when its search is done. */
  answer(id: number) {
    this.onmessage?.({ data: { id, plan: { steps: [], seconds: id } as unknown as FactionPlan, ms: 1 } } as MessageEvent<PlanReply>)
  }
}

const had = globalThis.Worker
beforeAll(() => {
  globalThis.Worker = FakeWorker as unknown as typeof Worker
})
afterAll(() => {
  globalThis.Worker = had
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('runPlan', () => {
  it('in a lane, sends only the newest of the asks made while one runs', async () => {
    const { runPlan, Superseded } = await import('../../../src/features/factions/planRunner')
    const ask = () => runPlan({} as never, {} as never, {} as never, undefined, 'plan')
    const a = ask()
    const b = ask()
    const c = ask()
    expect(posted).toHaveLength(1)
    await expect(b).rejects.toBeInstanceOf(Superseded)
    workers[0].answer(posted[0].id)
    expect((await a).seconds).toBe(posted[0].id)
    await flush()
    // B never went to the worker; C went once A was done.
    expect(posted).toHaveLength(2)
    workers[0].answer(posted[1].id)
    expect((await c).seconds).toBe(posted[1].id)
    // Without a lane, every ask goes at once.
    void runPlan({} as never, {} as never, {} as never)
    void runPlan({} as never, {} as never, {} as never)
    expect(posted).toHaveLength(4)
  })
})
