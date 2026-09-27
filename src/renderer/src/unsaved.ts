import { useSyncExternalStore } from 'react'

// Pages holding edits that are not saved yet, so the sidebar can mark them wherever the player is.

let pages: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function markUnsaved(page: string, unsaved: boolean): void {
  if (pages.has(page) === unsaved) return
  const next = new Set(pages)
  if (unsaved) next.add(page)
  else next.delete(page)
  pages = next
  for (const l of listeners) l()
}

export function useUnsaved(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pages
  )
}
