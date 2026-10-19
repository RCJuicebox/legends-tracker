import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ago, clock } from '../../api'

// Times that count on their own: how long ago, how long to go.

// One clock for every "3m ago" on screen: it ticks each half minute while any is shown, so an age
// keeps up with time on a page left open, and stops when none is.
export const ageListeners = new Set<() => void>()
export let ageNow = Date.now()
export let ageTimer: ReturnType<typeof setInterval> | null = null

export function subscribeAge(listener: () => void): () => void {
  ageListeners.add(listener)
  if (!ageTimer) {
    ageNow = Date.now()
    ageTimer = setInterval(() => {
      ageNow = Date.now()
      for (const l of ageListeners) l()
    }, 30_000)
  }
  return () => {
    ageListeners.delete(listener)
    if (!ageListeners.size && ageTimer) {
      clearInterval(ageTimer)
      ageTimer = null
    }
  }
}

/** How long ago `t` was ("3m ago", "just now"), kept up to date while it shows; `never` for no time. */
export function Ago({ t, never = 'never' }: { t: number; never?: string }) {
  const now = useSyncExternalStore(subscribeAge, () => ageNow)
  return <>{t ? ago(t, Math.max(now, t)) : never}</>
}

/**
 * The time left until `until` ("4:12"), ticking each second by itself, so the page around it does not
 * draw again every second (LT-401); `done` once it has passed.
 */
export function Countdown({ until, done }: { until: number; done: ReactNode }) {
  const [now, setNow] = useState(Date.now())
  const left = until - now
  const running = left > 0
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  return <>{left > 0 ? clock(left / 1000) : done}</>
}
