import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from './api'
import { showError } from './toast'
import { itemKey } from '../../core/inventory'
import type { ItemInfo } from '../../shared/types'
import type { AchievementTrack } from '../../shared/tracking'
import type { InvokeChannel, InvokeResult, Invokes, LootView } from '../../shared/ipc'
import { mergeLoot } from '../../core/loot'

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
/** Whether two answers hold the same data (as they would cross the IPC boundary). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** The loot list, as the main process pushes it: whole, or the entries added since (mergeLoot). */
export function useLootView(): Invoked<LootView> {
  const q = useInvoke('loot:get')
  const setData = q.setData
  useEffect(() => api.on('state:loot', (v: LootView) => setData((had) => mergeLoot(had, v))), [setData])
  return q
}

export function useInvoke<K extends InvokeChannel>(channel: K | null, args?: Parameters<Invokes[K]>, deps: unknown[] = []): Invoked<InvokeResult<K>> {
  type T = InvokeResult<K>
  const [data, setDataState] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const argsRef = useRef(args)
  argsRef.current = args
  const key = JSON.stringify(args ?? [])
  useEffect(() => {
    if (channel === null) return
    let live = true
    api.invoke(channel, ...((argsRef.current ?? []) as Parameters<Invokes[K]>)).then(
      (v) => {
        if (!live) return
        // A reload that brings back what is shown keeps the old value, so a page polled every few
        // seconds draws nothing again until something changes.
        setDataState((prev) => (prev !== null && sameData(prev, v) ? prev : v))
        setError('')
      },
      (e) => live && setError(errorMessage(e))
    )
    return () => {
      live = false
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `deps` is this hook's own dependency list, passed through like useEffect's
  }, [channel, key, tick, ...deps])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const setData = useCallback((next: T | null | ((prev: T | null) => T | null)) => {
    setDataState(next as T | null)
    setError('')
  }, [])
  return { data, error, reload, setData }
}

/** The faction plan's step and the Slayer counts for the character being played, as the achievements overlay has them. */
export function useAchievementTrack(): AchievementTrack | null {
  const [track, setTrack] = useState<AchievementTrack | null>(null)
  useEffect(() => {
    let live = true
    // The main process reads the counts every half minute only while something shows them: this page
    // says it is open, and again each minute, and that it closed.
    const ask = () =>
      api.invoke('achievements:track', true).then(
        (t) => live && t && setTrack(t),
        () => undefined
      )
    void ask()
    const again = setInterval(() => void ask(), 60_000)
    const off = api.on('state:achievementTrack', (t: AchievementTrack) => setTrack(t))
    return () => {
      live = false
      clearInterval(again)
      off()
      void api.invoke('achievements:track', false).catch(() => undefined)
    }
  }, [])
  return track
}

/** A ref that always holds the latest value, for callbacks that outlive a render. */
/** The value as the same object for as long as its contents stay the same: settings come back from each save as new objects. */
export function useSameContents<T>(value: T): T {
  const key = JSON.stringify(value)
  return useMemo(() => JSON.parse(key) as T, [key])
}

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

/**
 * What the wiki says of each named item, looked up once per name while the page is open. An answer is
 * kept whenever it comes (it is keyed by name), so one that outlives a later ask is still right; a
 * failed lookup (offline) lets the names be asked again next time.
 */
export function useItemInfo(names: string[]): { info: Record<string, ItemInfo>; refresh: (name: string) => Promise<void> } {
  const [info, setInfo] = useState<Record<string, ItemInfo>>({})
  const [asked] = useState(() => new Set<string>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const want = names.filter((n) => !asked.has(itemKey(n)))
    if (!want.length) return
    for (const n of want) asked.add(itemKey(n))
    api.invoke('inventory:lookup', want).then(
      (r) => mounted.current && setInfo((prev) => ({ ...prev, ...r })),
      () => {
        for (const n of want) asked.delete(itemKey(n))
      }
    )
  }, [names, asked])
  /** Reads one item's page again from eqlwiki. */
  const refresh = useCallback(async (name: string) => {
    const r = await api.invoke('inventory:lookup', [name], true)
    if (mounted.current) setInfo((prev) => ({ ...prev, ...r }))
  }, [])
  return { info, refresh }
}

/** A search as the player types: after a pause, and only the newest answer kept. */
export function useSearch<K extends 'spells:search' | 'focus:search'>(channel: K, q: string): InvokeResult<K> {
  const [results, setResults] = useState(() => [] as unknown as InvokeResult<K>)
  useEffect(() => {
    if (q.trim().length < 3) return setResults([] as unknown as InvokeResult<K>)
    let live = true
    const id = setTimeout(
      () =>
        (api.invoke as (c: K, q: string) => Promise<InvokeResult<K>>)(channel, q).then(
          (r) => live && setResults(r),
          (e) => live && showError('Search failed', e)
        ),
      200
    )
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [channel, q])
  return results
}
