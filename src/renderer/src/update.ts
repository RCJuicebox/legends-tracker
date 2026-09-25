import { useEffect, useState } from 'react'
import { api } from './api'
import type { UpdateState } from '../../main/updater'

export type { UpdateState }

export function useUpdate(): { status: UpdateState | null; version: string } {
  const [status, setStatus] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    let live = true
    api.invoke<{ status: UpdateState; version: string }>('update:status').then(
      (r) => {
        if (!live) return
        setStatus(r.status)
        setVersion(r.version)
      },
      // No status: the page says it cannot check, and a later push fills it in.
      () => {}
    )
    const off = api.on('state:update', (s: UpdateState) => setStatus(s))
    return () => {
      live = false
      off()
    }
  }, [])
  return { status, version }
}
