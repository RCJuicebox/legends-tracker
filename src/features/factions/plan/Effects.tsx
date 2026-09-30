import type { PlanStep } from '../planTypes'
import { plain, signed } from './parts'

/** What a step does to the achievements: done here, raised on the way, lowered, and what it takes off maxed factions. */
export function Effects({ step }: { step: PlanStep }) {
  const also = Object.entries(step.raises).filter(([f]) => !step.finishes.includes(f) && !step.reaches.some((r) => r.faction === f))
  const lowers = Object.entries(step.lowers)
  const maxed = Object.entries(step.maxedLowered)
  return (
    <>
      {step.unlocks.map((u) => (
        <span key={u} className="chip ok fp-unlock" title={`${u}: done here, so you can pick the race in Loadouts, and the plan may swap to it after`}>
          {u.replace(/^Race Unlock - /, '')} unlocked
        </span>
      ))}
      {step.finishes.map((f) => (
        <span
          key={f}
          className="chip ok"
          title={
            step.onTheWay[f]
              ? `Done here on the way: you locked it in to ${step.onTheWay[f]}, but this step gets it to 2000 first, so that is not needed for it`
              : step.locked.includes(f)
                ? 'Done here, as you locked in'
                : 'Done here'
          }
        >
          {f}
          {step.onTheWay[f] ? ' (on the way)' : step.locked.includes(f) ? ' (locked)' : ''}
        </span>
      ))}
      {step.reaches.map((r) => (
        <span
          key={`reach ${r.faction} ${r.opens}`}
          className="chip fp-reach"
          title={`Raised to ${r.to.toLocaleString()}, where ${r.opens}'s NPC takes it (${r.band}): a quicker way than going on with this`}
        >
          {r.faction} to {plain(r.to)} → opens {r.opens}
        </span>
      ))}
      {also.map(([f, v]) => (
        <span key={f} className="chip" title="Raised on the way; finished in a later step">
          {f} {signed(v)}
        </span>
      ))}
      {lowers.map(([f, v]) => (
        <span key={f} className="chip warn" title="Lowered while still to do: the plan makes these points up later">
          {f} {signed(-v)}
        </span>
      ))}
      {step.lifts.map((f) => (
        <span key={`up ${f}`} className="chip ok" title="Brought back from below zero here">
          {f} back to 0+
        </span>
      ))}
      {step.sinks.map((f) => (
        <span key={`down ${f}`} className="chip bad" title="Taken below zero here">
          {f} below 0
        </span>
      ))}
      {maxed.length > 0 && (
        <span
          className="faint small"
          title={maxed
            .sort((a, b) => b[1] - a[1])
            .map(([f, v]) => `${f} ${signed(-v)}`)
            .join('\n')}
        >
          {maxed.length <= 2
            ? `takes ${maxed.map(([f, v]) => `${Math.round(v).toLocaleString()} off ${f}`).join(' and ')} (maxed)`
            : `takes ${Math.round(maxed.reduce((n, [, v]) => n + v, 0)).toLocaleString()} off ${maxed.length} maxed factions`}
        </span>
      )}
    </>
  )
}
