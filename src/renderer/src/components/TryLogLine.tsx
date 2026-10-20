import { useContext } from 'react'
import { GoContext } from '../nav'
import { handOff, TEST_CARD } from '../handoff'

/**
 * "Try a log line": opens the Triggers page with its Test card in view, where pasted lines run
 * through Spell Timers and every trigger. The one test panel; Live and Spell Timers link to it.
 * Nothing where the page cannot go there.
 */
export function TryLogLineLink({ className = 'link-button inline' }: { className?: string }) {
  const go = useContext(GoContext)
  if (!go) return null
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        handOff('triggers', TEST_CARD)
        go('triggers')
      }}
    >
      Try a log line
    </button>
  )
}
