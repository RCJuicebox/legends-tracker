import { useEffect } from 'react'
import { api } from '../api'
import { useInvoke } from '../hooks'
import { act } from '../toast'

/**
 * The long jobs under way (a wiki download, a mote rescan, a log check, a meter rebuild), above
 * whatever page is open, each with how far along it is and a way to stop it.
 */
export function Jobs() {
  const q = useInvoke('jobs:list')
  const setData = q.setData
  useEffect(() => api.on('state:jobs', (list) => setData(list)), [setData])
  const list = q.data ?? []
  if (!list.length) return null
  return (
    <div className="jobs" role="status" aria-live="polite">
      {list.map((j) => (
        <div key={j.id} className="job row">
          <span className="grow">
            {j.label}
            {j.detail && <span className="faint small"> · {j.detail}</span>}
          </span>
          {j.fraction !== null && (
            <span className="job-bar" role="progressbar" aria-label={j.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(j.fraction * 100)}>
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
