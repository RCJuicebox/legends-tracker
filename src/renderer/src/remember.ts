import { useCallback, useEffect, useState } from 'react'

// View choices (which page, which tab) kept in this window's local storage so the app reopens where it
// was left. Storage can be unavailable or cleared; the default is used then.
const PREFIX = 'lt:'

/** What is on screen showing each choice now, told when it is set from elsewhere. */
const watchers = new Map<string, Set<(v: unknown) => void>>()

/** A remembered value, or the fallback when there is none or storage is unavailable. */
export function recall<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

/** Sets a remembered choice from outside the page that shows it, e.g. to open another page on a given tab; a page showing it follows. */
export function remember<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // The choice still applies for this session.
  }
  for (const tell of watchers.get(key) ?? []) tell(value)
}

/** useState that survives closing the window and restarting the app. */
export function useRemembered<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => recall(key, fallback))
  useEffect(() => {
    const tell = (v: unknown) => setValue(v as T)
    const told = watchers.get(key) ?? new Set()
    watchers.set(key, told.add(tell))
    return () => void told.delete(tell)
  }, [key])
  const set = useCallback(
    (v: T) => {
      setValue(v)
      remember(key, v)
    },
    [key]
  )
  return [value, set]
}
