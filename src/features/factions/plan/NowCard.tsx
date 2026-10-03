import type { ReactNode } from 'react'
import { Switch } from '../../../renderer/src/components/ui'
import { duration, who } from '../../../core/format'
import { STANDING_MAX } from '../core'
import type { PlanActivity } from '../catalog'
import type { FactionTrackView } from '../../../shared/tracking'
import { KIND_LABEL, signedPlain } from './parts'

const UNIT_WORDS: Record<PlanActivity['kind'], [string, string]> = { kill: ['kill', 'kills'], turnin: ['hand-in', 'hand-ins'], quest: ['hand-in', 'hand-ins'] }

/**
 * Where the character being played is in this plan, as the achievements overlay follows it: the step
 * it is on, counting down as the factions move, and the next. With the switch for its cues; the
 * overlay's own switch is on Overlays. For a character not being played it says what it will do.
 */
export function NowCard({
  character,
  track,
  hint,
  cues,
  onCues,
  onFirst
}: {
  character: string
  track: FactionTrackView | null
  /** Anything to do first for the step, such as a race swap. */
  hint?: ReactNode
  cues: boolean
  onCues: (on: boolean) => void
  /** Makes the plan's first step the one followed. */
  onFirst: () => void
}) {
  const step = track?.current ?? null
  return (
    <div className={`card mb-16 fp-now${step ? ' live' : ''}`}>
      <div className="row">
        <h2 className="m-0">
          {step ? 'Now' : track ? 'Every step is done' : 'In game'}
          {step && track && (
            <span className="faint small">
              {' '}
              step {step.index + 1} of {track.steps}
              {track.done ? `, ${track.done} done` : ''}
            </span>
          )}
        </h2>
        {step && step.index > 0 && (
          <button
            className="btn small ghost"
            onClick={onFirst}
            title="Follow the plan's first step again, on this card and the overlay, until your kills or hand-ins go toward another (or pick any step with Work on this)"
          >
            Back to step 1
          </button>
        )}
        <span className="spacer" />
        <label
          className="row tight small"
          title="Said aloud when a step is done, with the next; each achievement it finishes flashes on the alerts overlay. The same switch is on Overlays"
        >
          <Switch on={cues} onChange={onCues} label="Say when a step is done" /> Say when a step is done <span className="faint">(also on Overlays)</span>
        </label>
      </div>
      {step && track ? (
        <div className="stack gap-6 mt-10">
          <div className="fp-head">
            <span className="fp-zone">{step.zone || 'Somewhere'}</span>
            <span className={`chip fp-kind ${step.kind}`}>{KIND_LABEL[step.kind]}</span>
            <b>{step.kind === 'turnin' ? (step.npc ?? step.title) : step.title}</b>
            <span className="spacer" />
            <span className="mono">
              {step.unitsLeft.toLocaleString()} {UNIT_WORDS[step.kind][step.unitsLeft === 1 ? 0 : 1]} left
            </span>
            <span className="mono fp-time">{duration(step.secondsLeft)}</span>
          </div>
          {hint}
          <div className="fp-now-bar" title={`${Math.round(step.progress * 100)}% of the way since you started this step`}>
            <i style={{ width: `${Math.round(step.progress * 100)}%` }} />
          </div>
          <div className="row tight fp-effects">
            {step.goals.map((g) => (
              <span
                key={g.faction}
                className={`chip ${g.done ? 'ok' : ''}`.trim()}
                title={g.to === STANDING_MAX ? 'An achievement, done at 2000' : g.to === 0 ? 'Brought back to 0 or above' : 'Raised to where a later step’s NPC takes it'}
              >
                {g.achievement ?? g.faction} {signedPlain(Math.round(g.standing))} / {g.to.toLocaleString()}
              </span>
            ))}
            <span className="spacer" />
            {track.next && (
              <span className="faint small">
                Next, step {track.next.index + 1}: {track.next.kind === 'turnin' ? (track.next.npc ?? track.next.title) : track.next.title}
                {track.next.zone ? ` · ${track.next.zone}` : ''}
              </span>
            )}
          </div>
          <span className="faint small">About {duration(track.secondsLeft)} of steps left, as planned.</span>
        </div>
      ) : !track ? (
        <p className="faint small mb-0 mt-10">
          Play {who(character)} and this follows the plan as your factions move: the step you are on (the one your kills and hand-ins go the way of, or the first left in your
          zone), what it still wants, and the next. The achievements overlay shows the same over the game, with your Slayer counts.
        </p>
      ) : null}
    </div>
  )
}
