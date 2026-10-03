import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TimerView } from '../../../shared/types'
import { clock, iconUrl, roman } from '../api'

const onVisibility = (l: () => void) => {
  document.addEventListener('visibilitychange', l)
  return () => document.removeEventListener('visibilitychange', l)
}

/** False while the window is hidden (in the tray, or an overlay hidden with the game). */
function usePageVisible(): boolean {
  return useSyncExternalStore(onVisibility, () => document.visibilityState !== 'hidden')
}

/** The time, ticking every `intervalMs` while active and the window can be seen. */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(Date.now())
  const visible = usePageVisible()
  const running = active && visible
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, running])
  return now
}

/** The last seconds of a bar: its own colour until SHIFT_MS are left, amber halfway, red at the end. */
const SHIFT_MS = 12_000
const AMBER = '#e0a03a'
const RED = '#ef5a4f'

/** The system's "show fewer animations": the bars then step with the clock to the very end. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * The bar drains in steps, set where it stands at each tick of the clock: a bar that moves a third
 * of a pixel a second is not worth an animation frame (LT-339: a sixth of the cost with five bars
 * up). Its last twelve seconds glide: one animation of the fill and edge to the end, and the bar's
 * colour (the track's `color`, which the fill and edge paint with) running to amber and then red.
 * The fill is scaled and its bright edge slid, rather than resized, so neither costs layout. With
 * fewer animations asked for, the bar steps to the very end, turning amber and then red in two
 * steps. An overdue bar is full, striped.
 */
function useDrain(startedAt: number, endsAt: number, overdue: boolean, color: string, now: number) {
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const left = endsAt - now
  const glide = !reduced && !overdue && left <= SHIFT_MS
  // Set before the first paint, so a new bar never flashes full.
  useLayoutEffect(() => {
    if (overdue || glide) return
    const part = Math.max(0, Math.min(1, Math.max(0, left) / Math.max(1, endsAt - startedAt)))
    if (fill.current) fill.current.style.transform = `scaleX(${part})`
    if (edge.current) edge.current.style.transform = `translateX(${(part - 1) * 100}%)`
    if (track.current) track.current.style.color = left > SHIFT_MS ? color : left > SHIFT_MS / 2 ? AMBER : RED
  }, [glide, overdue, startedAt, endsAt, color, left])
  useEffect(() => {
    if (!glide) return
    const timing: KeyframeAnimationOptions = { duration: Math.max(1, endsAt - startedAt), easing: 'linear', fill: 'forwards' }
    const runs = [
      fill.current?.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], timing),
      edge.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], timing)
    ]
    const at = Date.now()
    for (const r of runs) if (r) r.currentTime = Math.max(0, at - startedAt)
    const shift = track.current?.animate([{ color }, { color: AMBER }, { color: RED }], { duration: SHIFT_MS, easing: 'linear', fill: 'both' })
    if (shift) shift.currentTime = Math.max(0, at - (endsAt - SHIFT_MS))
    return () => [...runs, shift].forEach((r) => r?.cancel())
  }, [glide, startedAt, endsAt, color])
  return { track, fill, edge }
}

function TimerBar({ t, now, showTarget }: { t: TimerView; now: number; showTarget: boolean }) {
  const left = t.endsAt - now
  const overdue = left < 0
  const warning = !overdue && t.warnSec > 0 && left <= t.warnSec * 1000
  const { track, fill, edge } = useDrain(t.startedAt, t.endsAt, overdue, t.color, now)
  const [iconOk, setIconOk] = useState(true)
  return (
    <div className={`timer${warning ? ' warning' : ''}${overdue ? ' overdue' : ''}`} style={{ ['--c' as string]: t.color }}>
      <div className="track" ref={track}>
        <div className="fill" ref={fill} />
        <div className="edge" ref={edge} />
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
export function TimerBars({ timers, grouped, fontSize = 15, empty }: { timers: TimerView[]; grouped: boolean; fontSize?: number; empty?: ReactNode }) {
  // The bars step with this clock and glide only at the end; the clocks read whole seconds, so
  // twice a second is enough, and four times near a warning so it lands on time.
  const [fast, setFast] = useState(false)
  const now = useNow(fast ? 250 : 500, timers.length > 0)
  const nearWarning = timers.some((t) => {
    const left = t.endsAt - now
    return left > -1000 && left <= t.warnSec * 1000 + 1500
  })
  if (nearWarning !== fast) setFast(nearWarning)
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
