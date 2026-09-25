import { useCallback, useState } from 'react'

// View choices (which page, which tab) kept in this window's local storage so the app reopens where it
// was left. Storage can be unavailable or cleared; the default is used then.
const PREFIX = 'lt:'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

/** Sets a remembered choice from outside the page that shows it, e.g. to open another page on a given tab. */
export function remember<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // The choice still applies for this session.
  }
}

/** useState that survives closing the window and restarting the app. */
export function useRemembered<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback))
  const set = useCallback(
    (v: T) => {
      setValue(v)
      remember(key, v)
    },
    [key]
  )
  return [value, set]
}
