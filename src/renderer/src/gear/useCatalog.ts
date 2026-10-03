import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { showError } from '../toast'
import { CATALOG_FORMAT } from '../../../core/wikiItem'
import type { CatalogState } from '../../../shared/ipc'

/**
 * The catalog this window holds, for as long as it runs: a Gear tool opened again asks whether it
 * is still the one stored, and is not sent it again when it is (LT-389).
 */
let kept: CatalogState | null = null

/** Two answers alike enough not to draw again: compared by their catalog's date, never by its ten megabytes (LT-402). */
const sameCatalog = (a: CatalogState, b: CatalogState) =>
  a.file?.fetchedAt === b.file?.fetchedAt && !!a.file === !!b.file && a.stale === b.stale && JSON.stringify(a.progress) === JSON.stringify(b.progress)

/** The wiki's item catalog as stored on this PC, and a way to fetch it again. */
export function useCatalog() {
  const q = useInvoke('gear:catalog', [kept?.file?.fetchedAt ?? 0], [], { same: sameCatalog })
  const { setData, reload } = q
  useEffect(
    () =>
      api.on('state:catalog', (progress: CatalogState['progress']) => {
        setData((s) => (s ? { ...s, progress } : s))
        // A download finished, whoever started it: show what it stored.
        if (!progress.busy) reload()
      }),
    [setData, reload]
  )
  const refresh = useCallback(async () => {
    try {
      await api.invoke('gear:catalogRefresh')
    } catch (e) {
      showError('Could not download the item catalog', e)
    }
    // Read what is stored now, rather than trust a reply that another refresh may have overtaken.
    reload()
  }, [reload])
  // A catalog stored by an older build lacks what this one reads; fetch it again once, on its own.
  const reply = q.data
  useEffect(() => {
    if (reply?.file) kept = reply
  }, [reply])
  const state = reply?.same && kept ? { ...kept, stale: reply.stale, progress: reply.progress } : reply
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  useEffect(() => {
    if (state?.file && (state.file.format ?? 1) < CATALOG_FORMAT && !state.progress.busy && !autoRefreshed) {
      setAutoRefreshed(true)
      void refresh()
    }
  }, [state?.file, state?.progress.busy, autoRefreshed, refresh])
  return { state, refresh, error: q.error, reload }
}
