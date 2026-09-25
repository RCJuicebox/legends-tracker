import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './api'

export interface Invoked<T> {
  data: T | null
  /** Why the last call failed; '' when it did not. */
  error: string
  /** Ask again. */
  reload: () => void
  /** Replace the answer, from a push or a write's reply. Takes a value or an updater. */
  setData: (next: T | null | ((prev: T | null) => T | null)) => void
}

/**
 * The answer to an invoke, asked again whenever the channel, the arguments or `deps` change. Only
 * the newest call's answer is kept: a slow reply to an older call never overwrites a newer one. A
 * failed call keeps what was there and says why. A null channel asks nothing (not ready yet).
 */
export function useInvoke<T>(channel: string | null, args: unknown[] = [], deps: unknown[] = []): Invoked<T> {
  const [data, setDataState] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const argsRef = useRef(args)
  argsRef.current = args
  const key = JSON.stringify(args)
  useEffect(() => {
    if (channel === null) return
    let live = true
    api.invoke<T>(channel, ...argsRef.current).then(
      (v) => {
        if (!live) return
        setDataState(v)
        setError('')
      },
      (e) => live && setError(errorMessage(e))
    )
    return () => {
      live = false
    }
  }, [channel, key, tick, ...deps])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback((next: T | null | ((prev: T | null) => T | null)) => {
    setDataState(next as T | null)
    setError('')
  }, [])
  return { data, error, reload, setData }
}

/** A ref that always holds the latest value, for callbacks that outlive a render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/**
 * Runs `fn` once calls stop for `ms`. `flush` runs a pending call now; one still pending when the
 * component unmounts runs then.
 */
export function useDebounced<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useLatest(fn)
  const pending = useRef<{ args: A; timer: ReturnType<typeof setTimeout> } | null>(null)
  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    fnRef.current(...p.args)
  }, [fnRef])
  const call = useCallback(
    (...args: A) => {
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = { args, timer: setTimeout(flush, ms) }
    },
    [flush, ms]
  )
  useEffect(() => flush, [flush])
  return { call, flush }
}
