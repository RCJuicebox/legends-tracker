import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TimerView } from '../../../shared/types'
import { clock, iconUrl, roman } from '../api'

export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}

export function TimerBar({ t, now, showTarget }: { t: TimerView; now: number; showTarget: boolean }) {
  const total = Math.max(1, t.endsAt - t.startedAt)
  const left = t.endsAt - now
  const overdue = left < 0
  const warning = !overdue && t.warnSec > 0 && left <= t.warnSec * 1000
  // How much of the bar is filled, 0 to 1. An overdue bar is full, striped. The fill is scaled and
  // its bright edge slid along, rather than resized, so each tick costs no layout.
  const shown = overdue ? 1 : Math.max(0, Math.min(1, left / total))
  const [iconOk, setIconOk] = useState(true)
  return (
    <div className={`timer${warning ? ' warning' : ''}${overdue ? ' overdue' : ''}`} style={{ ['--c' as string]: t.color }}>
      <div className="track">
        <div className="fill" style={{ transform: `scaleX(${shown})` }} />
        <div className="edge" style={{ transform: `translateX(${(shown - 1) * 100}%)` }} />
      </div>
      {t.icon !== undefined && iconOk ? <img src={iconUrl(t.icon)} alt="" onError={() => setIconOk(false)} /> : <div className="noicon" />}
      <div className="label">
        {t.label}
        {t.rank ? <span className="rank">{roman(t.rank)}</span> : null}
        {showTarget && t.target ? <span className="tgt">{t.target === 'You' ? '' : `· ${t.target}`}</span> : null}
      </div>
      <div className="time">
        {overdue ? (
          'fading…'
        ) : (
          <>
            {!t.exact && <span className="approx">~</span>}
            {clock(left / 1000)}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Bars sorted soonest-first, so the urgent one is always in the same place. Grouped mode puts a
 * heading over each target, which is how you read DoTs across several mobs at a glance.
 */
export function TimerBars({
  timers,
  grouped,
  fontSize = 15,
  empty
}: {
  timers: TimerView[]
  grouped: boolean
  fontSize?: number
  empty?: ReactNode
}) {
  const now = useNow(100, timers.length > 0)
  // The order and the groups change only when the timers do, not on each tick.
  const sorted = useMemo(() => [...timers].sort((a, b) => a.endsAt - b.endsAt), [timers])
  const ordered = useMemo(() => {
    if (!grouped) return []
    const groups = new Map<string, TimerView[]>()
    for (const t of sorted) {
      const g = t.target || t.label
      const key = t.target ? g.toLowerCase() : `~${g}`
      groups.set(key, [...(groups.get(key) ?? []), t])
    }
    // "You" first, then targets by whichever has the most urgent timer.
    return [...groups.entries()].sort(([a], [b]) => (a === 'you' ? -1 : b === 'you' ? 1 : 0))
  }, [sorted, grouped])
  if (!sorted.length) return <>{empty ?? null}</>
  const style = { ['--fs' as string]: `${fontSize}px` }
  if (!grouped) {
    return (
      <div className="timers" style={style}>
        {sorted.map((t) => (
          <TimerBar key={t.id} t={t} now={now} showTarget />
        ))}
      </div>
    )
  }
  return (
    <div className="timers" style={style}>
      {ordered.map(([key, list]) => (
        <div className="timer-group" key={key}>
          {list[0].target && <div className="timer-group-head">{list[0].target === 'You' ? 'You' : list[0].target}</div>}
          {list.map((t) => (
            <TimerBar key={t.id} t={t} now={now} showTarget={false} />
          ))}
        </div>
      ))}
    </div>
  )
}
