import { useContext } from 'react'
import { useLive, useSettled } from '../state'
import { act } from '../toast'
import { GoContext } from '../nav'
import { characterKey } from '../../../core/validate'
import { who } from '../../../core/format'

/**
 * The Play pages' word while the log is not being watched: whose log it is, what waits on it, and a
 * way to start, where each page used to say "nothing yet" as if nothing had happened (LT-569).
 */
export function NotWatching({ what }: { what: string }) {
  const watching = useLive((l) => l.status.watching)
  const logFile = useSettled((s) => s.settings.logFile)
  const go = useContext(GoContext)
  if (watching) return null
  const name = logFile ? who(characterKey(logFile)) : ''
  return (
    <div className="notice row mb-16">
      <span className="grow">
        Not watching{name ? ` ${name}’s log` : ''}: {what} come in while it is watched.
      </span>
      {logFile ? (
        <button className="btn small primary" onClick={() => void act('watch:start')}>
          Start watching{name ? ` ${name}` : ''}
        </button>
      ) : (
        <span className="small">
          Follow a character log on{' '}
          {go ? (
            <button className="link-button inline" onClick={() => go('settings', 'logs')}>
              Settings › Log files
            </button>
          ) : (
            'Settings › Log files'
          )}{' '}
          first.
        </span>
      )}
    </div>
  )
}
