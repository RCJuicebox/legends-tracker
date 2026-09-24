import { useEffect, useState } from 'react'
import { api } from './api'
import type { UpdateState } from '../../main/updater'

export type { UpdateState }

export function useUpdate(): { status: UpdateState | null; version: string } {
  const [status, setStatus] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void api.invoke<{ status: UpdateState; version: string }>('update:status').then((r) => {
      setStatus(r.status)
      setVersion(r.version)
    })
    return api.on('state:update', (s: UpdateState) => setStatus(s))
  }, [])
  return { status, version }
}
