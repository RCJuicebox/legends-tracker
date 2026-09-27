import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { showError } from '../toast'
import { CATALOG_FORMAT } from '../../../core/wikiItem'
import type { CatalogState } from '../../../shared/ipc'

/** The wiki's item catalog as stored on this PC, and a way to fetch it again. */
export function useCatalog() {
  const q = useInvoke('gear:catalog')
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
  const state = q.data
  const [autoRefreshed, setAutoRefreshed] = useState(false)
  useEffect(() => {
    if (state?.file && (state.file.format ?? 1) < CATALOG_FORMAT && !state.progress.busy && !autoRefreshed) {
      setAutoRefreshed(true)
      void refresh()
    }
  }, [state?.file, state?.progress.busy, autoRefreshed, refresh])
  return { state, refresh, error: q.error, reload }
}
