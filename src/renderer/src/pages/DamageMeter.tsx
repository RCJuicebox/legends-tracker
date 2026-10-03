import { Meter } from '../components/Meter'
import type { PageId } from '../main'

export function DamageMeter({ go }: { go?: (page: PageId) => void }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Damage Meter</h1>
          <p>
            Every fight the log can see, read from the last hour at start and live from then on: who dealt what, what hit your side, who healed, and what fired on its own. Fight or
            Session, for everyone, your group, or just you. When a fight ends, how much of the log is read back at start and whether a zone starts a new session are set in{' '}
            {go ? (
              <button className="link-button inline" onClick={() => go('settings')}>
                Settings
              </button>
            ) : (
              'Settings'
            )}
            .
          </p>
        </div>
      </div>
      <Meter standalone />
    </>
  )
}
