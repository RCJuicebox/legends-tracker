import { useEffect, useRef } from 'react'
import { api } from '../api'
import { duration } from '../../../core/format'
import { useInvoke } from '../hooks'
import { act } from '../toast'

/**
 * The long jobs under way (a wiki download, a mote rescan, a log check, a meter rebuild), above
 * whatever page is open, each with how far along it is, about how long is left once that can be
 * told (LT-426: a first recipe download is some seven minutes, not the one it said), and a way to
 * stop it. A screen reader hears a job start and end, not every step of its progress (LT-485).
 */
export function Jobs() {
  const q = useInvoke('jobs:list')
  const setData = q.setData
  useEffect(() => api.on('state:jobs', (list) => setData(list)), [setData])
  const list = q.data ?? []
  // Where each job was when first seen, for its pace.
  const seen = useRef(new Map<string, { at: number; fraction: number }>())
  const now = Date.now()
  for (const j of list) if (j.fraction !== null && !seen.current.has(j.id)) seen.current.set(j.id, { at: now, fraction: j.fraction })
  for (const id of seen.current.keys()) if (!list.some((j) => j.id === id)) seen.current.delete(id)
  const left = (id: string, fraction: number | null): string => {
    const first = seen.current.get(id)
    if (fraction === null || !first || now - first.at < 5000 || fraction - first.fraction < 0.02) return ''
    const secs = ((1 - fraction) * (now - first.at)) / 1000 / (fraction - first.fraction)
    return secs >= 30 ? `about ${duration(Math.round(secs / 60) * 60)} left` : 'nearly done'
  }
  if (!list.length) return null
  return (
    <div className="jobs">
      <span className="sr-only" role="status" aria-live="polite">
        {list.map((j) => j.label).join('; ')}
      </span>
      {list.map((j) => (
        <div key={j.id} className="job row">
          <span className="grow">
            {j.label}
            {j.detail && <span className="faint small"> · {j.detail}</span>}
            {left(j.id, j.fraction) && <span className="faint small"> · {left(j.id, j.fraction)}</span>}
          </span>
          {j.fraction !== null && (
            <span className="job-bar" role="progressbar" aria-busy="true" aria-label={j.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.fraction * 100)}>
              <span style={{ width: `${Math.round(j.fraction * 100)}%` }} />
            </span>
          )}
          <button className="btn small ghost" onClick={() => void act('jobs:cancel', j.id)}>
            Cancel
          </button>
        </div>
      ))}
    </div>
  )
}
