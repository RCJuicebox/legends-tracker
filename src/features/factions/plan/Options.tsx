import { useState } from 'react'
import { Disclosure, NumberInput, Tip } from '../../../renderer/src/components/ui'
import { duration, wikiUrl } from '../../../core/format'
import type { PlanChoices } from '../../../shared/settings'
import { plannable } from '../ways'
import type { PlanOption } from '../planTypes'
import { Doing, Flags, ItemsLine, KIND_LABEL, signed, sourceNote } from './parts'

const SHOWN = 8

/** Every way there is to raise one achievement (the first few until Show all), to lock one in, rule one out or give it your own pace. */
export function Options({
  faction,
  options,
  choices,
  swaps,
  onLock,
  onExclude,
  onPace
}: {
  faction: string
  options: PlanOption[]
  choices: PlanChoices
  /** Whether the plan swaps race for a quest another race opens. */
  swaps: boolean
  onLock: (factions: string[], id: string | null) => void
  onExclude: (id: string, out: boolean) => void
  onPace: (id: string, perHour: number | undefined) => void
}) {
  const [all, setAll] = useState(false)
  if (!options.length)
    return (
      <div className="faint small" style={{ padding: '6px 4px' }}>
        Neither your log nor eqlwiki knows anything that raises {faction}.{' '}
        <a href={wikiUrl(faction)} target="_blank" rel="noreferrer">
          eqlwiki
        </a>
      </div>
    )
  const shown = all ? options : options.slice(0, SHOWN)
  return (
    <div className="stack gap-6 fp-options">
      {shown.map((o) => {
        const a = o.activity
        const locked = choices.locks[faction] === a.id
        const out = choices.excluded.includes(a.id)
        const usable = plannable(a, choices, swaps)
        const h = a.hits[faction]
        return (
          <div key={a.id} className={`fp-opt${locked ? ' locked' : ''}${usable ? '' : ' unusable'}`}>
            <div className="row tight">
              <span className={`chip fp-kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
              <Doing a={a} />
              <span className="faint small">{a.zone}</span>
              {o.chosen && <span className="chip ok">in the plan</span>}
              {!o.chosen && o.used && <span className="chip">in the plan for others</span>}
              {a.once && !locked && (
                <Tip className="chip warn" text={`Taken to be once only: ${a.once}. Lock it in if you know it repeats.`}>
                  one-time?
                </Tip>
              )}
              <Flags a={a} />
              <span className="spacer" />
              <span
                className="mono small"
                title={a.guessed?.includes(faction) ? 'Amount guessed: the usual one in your log, or a typical Legends amount when it has too few' : undefined}
              >
                {signed(h)}
                {a.guessed?.includes(faction) ? '?' : ''} each
              </span>
              <span className="mono small">
                ×{o.units.toLocaleString()} ≈ {duration(o.seconds)}
              </span>
            </div>
            {a.items && a.items.length > 0 && (
              <div className="small">
                <ItemsLine items={a.items} units={o.units} back={a.back} />
              </div>
            )}
            {a.line && a.kind === 'quest' && <div className="faint small">“{a.line}”</div>}
            <div className="row tight">
              <span className="faint small">
                {sourceNote(a)}; {o.rateFrom === 'yours' ? 'your pace' : o.rateFrom === 'log' ? 'the pace from your log' : 'an estimated pace'}, {duration(o.unitSeconds)} a{' '}
                {a.kind === 'kill' ? 'kill' : 'hand-in'}
                {a.once ? `; once only? ${a.once}` : ''}
                {a.blocked ? `; ${a.blocked}` : ''}
                {a.note ? `; ${a.note}` : ''}
              </span>
              {o.lowersOpen.length > 0 && <span className="warn-text small">lowers {o.lowersOpen.join(', ')}</span>}
              <span className="spacer" />
              <label className="row tight small faint" title={`Your own ${a.kind === 'kill' ? 'kills' : 'hand-ins'} an hour, when you know better than the estimate`}>
                per hour
                <NumberInput value={choices.perHour[a.id]} placeholder={String(Math.round(3600 / o.unitSeconds))} min={0} width={70} onChange={(v) => onPace(a.id, v)} />
              </label>
              {locked ? (
                <button className="btn small on" onClick={() => onLock([faction], null)} title="Let the plan choose again">
                  Locked in ✕
                </button>
              ) : (
                <button className="btn small ghost" onClick={() => onLock([faction], a.id)} title={`Finish ${faction} with this, and build the plan around it`}>
                  Lock in
                </button>
              )}
              {!locked && (
                <button className="btn small ghost" onClick={() => onExclude(a.id, !out)} title={out ? 'Let the plan use it again' : 'Leave it out of the plan'}>
                  {out ? 'Allow' : 'Rule out'}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {options.length > SHOWN && (
        <Disclosure className="small" open={all} onToggle={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${options.length}`}
        </Disclosure>
      )}
    </div>
  )
}
