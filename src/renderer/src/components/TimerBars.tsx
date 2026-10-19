import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TimerView } from '../../../shared/types'
import { clock, iconUrl, roman } from '../api'
import { num } from '../../../core/format'
import { TICK_MS } from '../../../core/durations'
import { usePageVisible } from '../hooks'

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

/**
 * One clock per pace, shared by every bar on the page: each tick calls the bars, which write their
 * fill and their time straight into the page, so a tick renders nothing (LT-400). It stops while
 * the window cannot be seen, and catches every bar up as it shows again.
 */
const clocks = new Map<number, { timer: ReturnType<typeof setInterval>; subs: Set<(now: number) => void> }>()

function onClock(intervalMs: number, sub: (now: number) => void): () => void {
  let c = clocks.get(intervalMs)
  if (!c) {
    const subs = new Set<(now: number) => void>()
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      for (const s of subs) s(now)
    }, intervalMs)
    c = { timer, subs }
    clocks.set(intervalMs, c)
  }
  c.subs.add(sub)
  return () => {
    c.subs.delete(sub)
    if (!c.subs.size) {
      clearInterval(c.timer)
      clocks.delete(intervalMs)
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return
  const now = Date.now()
  for (const c of clocks.values()) for (const s of c.subs) s(now)
})

/** The last seconds of a bar: its own colour until SHIFT_MS are left, amber halfway, red at the end. */
const SHIFT_MS = 12_000

/** The theme's amber and red (the light theme's are darker), read when a bar needs them. */
function shiftColours(): { amber: string; red: string } {
  const s = getComputedStyle(document.documentElement)
  return { amber: s.getPropertyValue('--amber').trim() || '#e0a03a', red: s.getPropertyValue('--red').trim() || '#ef5a4f' }
}

/** The system's "show fewer animations": the bars then step four times a second to the very end, never ten. */
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

/** Where a bar is in its life: what changes its look beyond the fill and the time. */
type Phase = 'run' | 'near' | 'warn' | 'end' | 'end-warn' | 'over'

function phaseOf(t: TimerView, now: number, reduced: boolean): Phase {
  const left = t.endsAt - now
  if (left < 0) return 'over'
  // A warning pulses; the last twelve seconds step at 10 Hz, unless fewer animations are asked for.
  const warning = t.warnSec > 0 && left <= t.warnSec * 1000
  if (!reduced && left <= SHIFT_MS) return warning ? 'end-warn' : 'end'
  if (warning) return 'warn'
  // Close to its warning: the clock looks four times a second, so the warning lands on time.
  return left <= t.warnSec * 1000 + 1500 ? 'near' : 'run'
}

/**
 * The bar drains in steps, set where it stands at each tick of the clock: a bar that moves a third
 * of a pixel a second is not worth an animation frame (LT-339: a sixth of the cost with five bars
 * up). Its last twelve seconds step ten times a second, and the bar's colour (the track's `color`,
 * which the fill and edge paint with) turns amber at six seconds and red at the end: a glide at the
 * display's rate cost a third of a core whenever any bar was in its last twelve seconds (LT-548).
 * The fill is scaled and its bright edge slid, rather than resized, so neither costs layout. With
 * fewer animations asked for, the bar steps four times a second to the very end. An overdue bar is
 * full, striped.
 */
function TimerBar({ t, showTarget, onOpen }: { t: TimerView; showTarget: boolean; onOpen?: (t: TimerView) => void }) {
  const reduced = useReducedMotion()
  const [phase, setPhase] = useState<Phase>(() => phaseOf(t, Date.now(), reduced))
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const edge = useRef<HTMLDivElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const ticks = useRef<HTMLSpanElement>(null)
  const [iconOk, setIconOk] = useState(true)
  const overdue = phase === 'over'
  const warning = phase === 'warn' || phase === 'end-warn'

  // Each tick: the time, the fill where it stands, and the phase, which renders only when it
  // changes. Set before the first paint, so a new bar never flashes full.
  useLayoutEffect(() => {
    const step = (now: number) => {
      const left = t.endsAt - now
      const next = phaseOf(t, now, reduced)
      setPhase(next)
      if (next === 'over') return
      if (time.current) time.current.textContent = clock(Math.max(0, left) / 1000)
      if (ticks.current) ticks.current.textContent = ticksLeft(t, left)
      const part = Math.max(0, Math.min(1, Math.max(0, left) / Math.max(1, t.endsAt - t.startedAt)))
      if (fill.current) fill.current.style.transform = `scaleX(${part})`
      if (edge.current) edge.current.style.transform = `translateX(${(part - 1) * 100}%)`
      if (track.current) {
        const { amber, red } = shiftColours()
        track.current.style.color = left > SHIFT_MS ? t.color : left > SHIFT_MS / 2 ? amber : red
      }
    }
    step(Date.now())
    // The last twelve seconds step at 10 Hz; close to the warning, four times a second, so it lands on time.
    return onClock(phase === 'run' ? 500 : phase === 'end' || phase === 'end-warn' ? 100 : 250, step)
  }, [t, reduced, phase])

  return (
    <div className={`timer${warning ? ' warning' : ''}${overdue ? ' overdue' : ''}${t.caster ? ' has-caster' : ''}`} style={{ ['--c' as string]: t.color }}>
      <div className="track" ref={track}>
        <div className="fill" ref={fill} />
        <div className="edge" ref={edge} />
      </div>
      {t.icon !== undefined && iconOk ? <img src={iconUrl(t.icon)} alt="" onError={() => setIconOk(false)} /> : <div className="noicon" />}
      <div className="label">
        {onOpen && t.rule ? (
          <button
            type="button"
            className="timer-open"
            onClick={() => onOpen(t)}
            title={t.source === 'spell' ? 'Open its row on Spell Timers: why it runs this long' : 'Open its trigger on Triggers'}
          >
            {t.label}
          </button>
        ) : (
          t.label
        )}
        {t.rank ? <span className="rank">{roman(t.rank)}</span> : null}
        {showTarget && t.target ? <span className="tgt">{t.target === 'You' ? '' : `· ${t.target}`}</span> : null}
        {t.caster ? <span className="caster">by {t.caster}</span> : null}
        {t.tickDamage ? (
          <span className="ticks" title="Ticks still to come, and what the last one did">
            <span ref={ticks}>{ticksLeft(t, t.endsAt - Date.now())}</span> · {num(t.tickDamage)} a tick
          </span>
        ) : null}
      </div>
      <div className="time">
        {t.untilActed ? (
          <span title="Invisibility ends when you act, so there is no clock; the bar ends on the game’s own line">until you act</span>
        ) : overdue ? (
          'fading…'
        ) : (
          <>
            {t.warnSec > 0 && !warning && (
              <span className="cue" title={`The recast cue is said ${t.warnSec} seconds before the end`}>
                cue {t.warnSec}s
              </span>
            )}
            {!t.exact && <span className="approx">~</span>}
            <span ref={time}>{clock(Math.max(0, t.endsAt - Date.now()) / 1000)}</span>
          </>
        )}
      </div>
    </div>
  )
}

/** A DoT's ticks still to come: it wears off on a tick, so the time left in whole ticks, rounded up. */
function ticksLeft(t: TimerView, left: number): string {
  if (!t.exact) return ''
  const n = Math.max(0, Math.ceil(left / TICK_MS))
  return n === 1 ? '1 tick' : `${n} ticks`
}

/**
 * Bars sorted soonest-first, so the urgent one is always in the same place. Grouped mode puts a
 * heading over each target, which is how you read DoTs across several mobs at a glance. Each bar
 * keeps its own time; this renders only when the timers change. In an overlay too small for every
 * bar, the last line says how many are cut off (LT-352).
 */
export function TimerBars({
  timers,
  grouped,
  fontSize = 15,
  empty,
  onOpen
}: {
  timers: TimerView[]
  grouped: boolean
  fontSize?: number
  empty?: ReactNode
  /** On the Live page: a bar's name opens what sets it. Overlays have none. */
  onOpen?: (t: TimerView) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(0)
  // The order and the groups change only when the timers do.
  const sorted = useMemo(() => timers.filter((t) => !t.note).sort((a, b) => a.endsAt - b.endsAt), [timers])
  // Lines under the bars, not bars: the buffs overlay's "Missing: …" (LT-749).
  const notes = useMemo(() => timers.filter((t) => t.note), [timers])
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
  useLayoutEffect(() => {
    const el = box.current
    const frame = el?.closest('.overlay')
    if (!el || !frame) return
    const count = () => {
      const limit = frame.getBoundingClientRect().bottom
      let n = 0
      for (const bar of el.querySelectorAll('.timer')) if (bar.getBoundingClientRect().bottom > limit + 1) n++
      setHidden(n)
    }
    count()
    const watch = new ResizeObserver(count)
    watch.observe(frame)
    return () => watch.disconnect()
  }, [sorted, ordered, fontSize])
  if (!sorted.length && !notes.length) return <>{empty ?? null}</>
  const style = { ['--fs' as string]: `${fontSize}px` }
  return (
    <div className="timers" style={style} ref={box}>
      {grouped
        ? ordered.map(([key, list]) => (
            <div className="timer-group" key={key}>
              {list[0].target && <div className="timer-group-head">{list[0].target === 'You' ? 'You' : list[0].target}</div>}
              {list.map((t) => (
                <TimerBar key={t.id} t={t} showTarget={false} onOpen={onOpen} />
              ))}
            </div>
          ))
        : sorted.map((t) => <TimerBar key={t.id} t={t} showTarget onOpen={onOpen} />)}
      {hidden > 0 && <div className="timers-more">+{hidden} more</div>}
      {notes.map((n) => (
        <div key={n.id} className="timers-note" title={n.label}>
          {n.label}
        </div>
      ))}
    </div>
  )
}
