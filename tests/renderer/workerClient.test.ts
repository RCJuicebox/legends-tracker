import { describe, expect, it, vi } from 'vitest'
import { workerClient } from '../../src/renderer/src/workerClient'

// The page's side of a Web Worker (LT-637): one worker for every ask, made at the first; each reply
// finds its ask by number; a worker that fails fails what waits and says it is broken.

type Req = { id: number; n: number }
type Rep = { id: number; doubled: number }

class FakeWorker {
  onmessage: ((e: MessageEvent<Rep>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  posted: Req[] = []
  ended = false
  postMessage(r: Req) {
    this.posted.push(r)
  }
  terminate() {
    this.ended = true
  }
  reply(r: Rep) {
    this.onmessage?.({ data: r } as MessageEvent<Rep>)
  }
}

describe('workerClient', () => {
  it('makes one worker at the first ask and matches each reply to its ask', async () => {
    const made: FakeWorker[] = []
    const c = workerClient<Req, Rep>('The doubler', () => {
      const w = new FakeWorker()
      made.push(w)
      return w as unknown as Worker
    })
    expect(made).toHaveLength(0)
    const a = c.ask({ n: 2 })
    const b = c.ask({ n: 5 })
    expect(made).toHaveLength(1)
    const [first, second] = made[0].posted
    expect([first.n, second.n]).toEqual([2, 5])
    expect(first.id).not.toBe(second.id)
    // Out of order, and a reply nobody waits for is dropped.
    made[0].reply({ id: second.id, doubled: 10 })
    made[0].reply({ id: 999, doubled: 0 })
    made[0].reply({ id: first.id, doubled: 4 })
    expect(await a).toEqual({ id: first.id, doubled: 4 })
    expect(await b).toEqual({ id: second.id, doubled: 10 })
    expect(c.broken).toBe(false)
  })

  it('fails what waits on a worker that fails, ends it and says it is broken', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = new FakeWorker()
    const c = workerClient<Req, Rep>('The doubler', () => w as unknown as Worker)
    const a = c.ask({ n: 1 })
    w.onerror?.({ message: '', preventDefault: () => {} } as unknown as ErrorEvent)
    await expect(a).rejects.toThrow('The doubler stopped: it could not be loaded')
    expect(w.ended).toBe(true)
    expect(c.broken).toBe(true)
    warn.mockRestore()
  })
})
