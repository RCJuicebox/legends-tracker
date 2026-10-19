// A page's side of one of its Web Workers (LT-637): the worker made when first needed and kept, each
// ask numbered so its reply finds it. A worker that fails to load or dies fails what waits on it and
// is marked broken, so its caller can do the work on the page instead, slower but right; a worker made
// afresh on each ask would fail the same way every time.

/** What a worker client sends and gets back: every message carries the ask's number. */
interface Numbered {
  id: number
}

export interface WorkerClient<Req extends Numbered, Rep extends Numbered> {
  /** Sends `request` with a number of its own; resolves with the reply that carries it. */
  ask(request: Req extends unknown ? Omit<Req, 'id'> : never): Promise<Rep>
  /** Whether the worker failed: the caller works on the page from then on. */
  readonly broken: boolean
}

/**
 * A client for the worker `make` starts (`new Worker(new URL('./x.ts', import.meta.url), …)`, written
 * where the worker's file is, for the bundler). `what` names it in the error: "The gear optimiser".
 */
export function workerClient<Req extends Numbered, Rep extends Numbered>(what: string, make: () => Worker): WorkerClient<Req, Rep> {
  let worker: Worker | null = null
  let broken = false
  let next = 0
  const waiting = new Map<number, { resolve: (r: Rep) => void; reject: (e: Error) => void }>()

  const start = (): Worker => {
    const w = make()
    w.onmessage = (e: MessageEvent<Rep>) => {
      const call = waiting.get(e.data.id)
      if (!call) return
      waiting.delete(e.data.id)
      call.resolve(e.data)
    }
    w.onerror = (e) => {
      e.preventDefault()
      const err = new Error(`${what} stopped: ${e.message || 'it could not be loaded'}`)
      console.warn(err.message)
      for (const call of waiting.values()) call.reject(err)
      waiting.clear()
      w.terminate()
      if (worker === w) worker = null
      broken = true
    }
    return w
  }

  return {
    ask(request) {
      worker ??= start()
      const id = ++next
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        worker!.postMessage({ ...request, id })
      })
    },
    get broken() {
      return broken
    }
  }
}
