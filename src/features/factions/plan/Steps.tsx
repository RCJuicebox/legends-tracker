import type { ReactNode } from 'react'
import { duration } from '../../../core/format'
import { fmtCoin } from '../../../core/loot'
import type { PlanChoices } from '../../../shared/settings'
import type { FactionTrackView } from '../../../shared/tracking'
import type { FactionPlan, PlanStep } from '../planTypes'
import { Effects } from './Effects'
import { Doing, Flags, ItemsLine, KIND_LABEL, sourceNote } from './parts'

/** What a step's time holds besides the kills or hand-ins. */
function timeNote(st: PlanStep): string | undefined {
  const parts = [st.travel ? `${duration(st.travel)} to get there` : '', st.swap ? `${duration(st.swap)} to swap race and back` : ''].filter(Boolean)
  return parts.length ? `Including ${parts.join(' and ')}` : undefined
}

/** The plan, step by step: each with what it does to the achievements, and the buttons to follow it, lock its way in or rule it out. */
export function Steps({
  plan,
  choices,
  onLock,
  onExclude,
  onWork,
  now,
  hint
}: {
  plan: FactionPlan
  choices: PlanChoices
  onLock: (factions: string[], id: string | null) => void
  onExclude: (id: string, out: boolean) => void
  /** Makes a step the one the Now card and the overlay follow. */
  onWork: (index: number) => void
  /** The step the character being played is on, as the achievements overlay follows it. */
  now: FactionTrackView['current']
  /** Anything to do first for a step, such as a race swap. */
  hint: (st: PlanStep) => ReactNode
}) {
  if (!plan.steps.length) return <div className="card empty mb-16">Nothing the planner knows raises the achievements left. Open each one below for what there is.</div>
  return (
    <div className="card mb-16">
      <h2>
        The plan, step by step<span className="spacer"></span>
        <span className="faint small mono">≈ {duration(plan.seconds)}</span>
      </h2>
      <ol className="fp-steps">
        {plan.steps.map((st, i) => {
          const a = st.activity
          const lockable = st.finishes.filter((f) => choices.locks[f] !== a.id)
          const isNow = !!now && now.index === i && now.id === a.id
          return (
            <li key={a.id + i} className={`fp-step${isNow ? ' now' : ''}`}>
              <span className="fp-num">{i + 1}</span>
              <div className="fp-body">
                <div className="fp-head">
                  <span className="fp-zone">{a.zone || 'Somewhere'}</span>
                  <span className={`chip fp-kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                  {st.restores && (
                    <span className="chip fp-restore" title="It finishes no achievement: it brings factions back to 0 or above">
                      restore
                    </span>
                  )}
                  {st.reaches.length > 0 && !st.finishes.length && (
                    <span className="chip fp-restore" title="It finishes no achievement itself: it raises a faction to where a quicker quest's NPC takes it">
                      opens a way
                    </span>
                  )}
                  {isNow && (
                    <span className="chip fp-now-chip" title="The step you are on: the achievements overlay follows it">
                      now
                    </span>
                  )}
                  <Doing a={a} />
                  <Flags a={a} />
                  <span className="spacer" />
                  <span className="mono" title={`${st.units.toLocaleString()} ${a.kind === 'kill' ? 'kills' : 'hand-ins'}`}>
                    ×{st.units.toLocaleString()}
                  </span>
                  <span className="mono fp-time" title={timeNote(st)}>
                    {duration(st.seconds)}
                  </span>
                </div>
                {hint(st)}
                {a.kind === 'quest' && a.line && <div className="faint small">“{a.line}”</div>}
                {a.items && a.items.length > 0 && (
                  <div className="small">
                    <ItemsLine items={a.items} units={st.units} back={a.back} />
                    {st.copper > 0 && <span className="faint"> · about {fmtCoin(Math.round(st.copper))} to buy</span>}
                  </div>
                )}
                {a.kind === 'kill' && a.mobs && a.mobs.length > 2 && <div className="faint small fp-mobs">{a.mobs.join(', ')}</div>}
                <div className="row tight fp-effects">
                  <Effects step={st} />
                  <span className="spacer" />
                  <span className="faint small">{sourceNote(a)}</span>
                  {!isNow && (
                    <button
                      className="btn small ghost"
                      onClick={() => onWork(i)}
                      title="Follow this step now, on the Now card and the overlay, until your kills or hand-ins go toward another"
                    >
                      Work on this
                    </button>
                  )}
                  {lockable.length > 0 && (
                    <button className="btn small ghost" onClick={() => onLock(lockable, a.id)} title={`Keep this for ${lockable.join(', ')}: the plan is built around it`}>
                      Lock in
                    </button>
                  )}
                  {st.locked.length === 0 && (
                    <button className="btn small ghost" onClick={() => onExclude(a.id, true)} title="Leave this out of the plan">
                      Rule out
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
