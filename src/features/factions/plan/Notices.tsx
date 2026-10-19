import { useState } from 'react'
import { ago } from '../../../renderer/src/api'
import { GameCommand } from '../../../renderer/src/components/ui'
import { num, who, wikiUrl } from '../../../core/format'
import type { FactionPlanData } from '../planner'

// What the Plan tab says above the plan (LT-638): a deity to renounce, a race the Cities plan lacks,
// the exports it is missing, standings that are approximate, and the web pages it could not read again.

/** Web notices put away this session, by what they said: the same failure stays away, a new one shows. */
const dismissedNotices = new Set<string>()

export function Notices({
  character,
  data,
  deity,
  cities,
  hasExport,
  achievementsExport,
  now
}: {
  character: string
  data: FactionPlanData
  /** The character's deity, as its record has it ('' when none is set). */
  deity: string
  cities: boolean
  /** Whether there is a factions export to start from. */
  hasExport: boolean
  achievementsExport: boolean
  now: number
}) {
  const [, setDismissed] = useState(0)
  const dismissNotice = (key: string) => {
    dismissedNotices.add(key)
    setDismissed((x) => x + 1)
  }
  return (
    <>
      {deity !== 'Agnostic' && (
        <div className="notice mb-16">
          This plan counts {who(character)} as Agnostic, the deity with no faction modifiers: renouncing your faith is the first step.{' '}
          {deity ? `${who(character)} worships ${deity}. ` : 'No deity is set on the Stats page. '}
          {data.agnostic ? (
            'Agnostic is unlocked: pick it in Loadouts.'
          ) : (
            <>
              {data.agnostic === false ? 'Unlock Agnostic' : 'If Agnostic is not unlocked yet, unlock it'} with{' '}
              <a href={wikiUrl('Renouncing Your Faith')} target="_blank" rel="noreferrer">
                Renouncing Your Faith
              </a>{' '}
              (level 46 and up: the Emissary of Zebuxoruk in the Oasis of Marr, then defeat Cazic Thule in the Plane of Fear and Innoruuk in the Plane of Hate), then pick it in
              Loadouts.
            </>
          )}
        </div>
      )}
      {cities && !data.raceMods && (
        <div className="notice mb-16">
          No race on record for {who(character)}, so the Cities plan cannot tell how each city&apos;s guards con you: it aims for each guards&apos; faction at 0 before any race or
          class modifiers. Pick the race on the Stats page, or type <GameCommand cmd="/who" /> in game.
        </div>
      )}
      {/* What is missing, in one notice rather than one each above the plan for weeks (LT-455). */}
      {(!hasExport || !achievementsExport) && (
        <div className="notice mb-16">
          {!hasExport && !achievementsExport ? (
            <>
              No factions or achievements export for {who(character)} yet: every standing counts from 0, and an achievement counts as done only while its standing is at 2000. Type{' '}
              <GameCommand cmd="/outputfile faction" /> and <GameCommand cmd="/outputfile achievements" /> in game for a plan from where you really stand.
            </>
          ) : !hasExport ? (
            <>
              No factions export for {who(character)} yet, so every standing counts from 0. Type <GameCommand cmd="/outputfile faction" /> in game for a plan from where you really
              stand.
            </>
          ) : (
            <>
              No achievements export for {who(character)} yet, so an achievement counts as done only while its standing is at 2000. Type{' '}
              <GameCommand cmd="/outputfile achievements" /> in game to plan only what is really left.
            </>
          )}
        </div>
      )}
      {data.approximate && data.approximate.length > 0 && (
        <div className="notice warn mb-16">
          {data.approximate.length === 1 ? `${data.approximate[0]}’s standing is` : `${num(data.approximate.length)} standings are`} approximate (
          {data.approximate.slice(0, 3).join(', ')}
          {data.approximate.length > 3 ? ', …' : ''}): the log saw more changes since {who(character)}’s factions export than it keeps, so the plan may start from the wrong place.
          Type <GameCommand cmd="/outputfile faction" /> in game to plan from where you really stand.
        </div>
      )}
      {/* The web being out of reach is a passing state, not a fault: amber, and put away for the session (LT-455). */}
      {data.wiki.error && !dismissedNotices.has(`wiki:${data.wiki.error}`) && (
        <div className="notice warn row mb-16">
          <span className="grow">
            Could not read eqlwiki again ({data.wiki.error}); the pages read {ago(data.wiki.fetchedAt, now)} serve meanwhile.
          </span>
          <button className="btn small ghost" onClick={() => dismissNotice(`wiki:${data.wiki.error}`)}>
            Hide
          </button>
        </div>
      )}
      {data.alla.error && !dismissedNotices.has(`alla:${data.alla.error}`) && (
        <div className="notice warn row mb-16">
          <span className="grow">Could not read Allakhazam ({data.alla.error}); it is tried again in ten minutes, and the plan goes on without the pages not yet read.</span>
          <button className="btn small ghost" onClick={() => dismissNotice(`alla:${data.alla.error}`)}>
            Hide
          </button>
        </div>
      )}
    </>
  )
}
