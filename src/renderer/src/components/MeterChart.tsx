import { clock } from '../../../core/format'
import { useMemo } from 'react'
import { useRemembered } from '../remember'
import { useInvoke } from '../hooks'
import { durationSec, fmtRate, rolling } from '../../../core/combatView'
import type { Segment } from '../../../shared/types'

// The damage meter's DPS over time: you, your side and what hit you, second by second, fights end to end.

const LINES: { key: keyof NonNullable<Segment['timeline']>; label: string; color: string }[] = [
  { key: 'you', label: 'you', color: 'var(--accent)' },
  { key: 'pet', label: 'pet', color: 'var(--violet)' },
  { key: 'group', label: 'others', color: 'var(--teal)' },
  { key: 'inc', label: 'incoming', color: 'var(--red)' }
]
const WINDOW_SEC = 6

export function DpsChart({ seg }: { seg: Segment }) {
  const [hidden, setHidden] = useRemembered<string[]>('meter.chartHidden', [])
  const session = seg.kind === 'session'
  // A session's chart is its fights end to end, from the main process; asked again at most every
  // ten seconds while the session runs.
  const stitched = useInvoke(session ? 'combat:sessionTimeline' : null, [seg.id], [session && seg.open ? Math.floor(seg.endedAt / 10_000) : 0]).data
  const tl = session ? stitched : seg.timeline
  const seconds = Math.max(1, session ? (stitched?.you.length ?? 0) : Math.ceil(durationSec(seg)))
  const marks = session ? (stitched?.marks ?? []) : []
  const series = useMemo(() => {
    if (!tl) return null
    return LINES.map((l) => ({ ...l, values: rolling(tl[l.key], seconds, WINDOW_SEC), any: tl[l.key].some((v) => v > 0) }))
  }, [tl, seconds])
  if (!series || (session && !marks.length)) {
    return (
      <div className="dm-aux">
        <div className="dm-aux-head">DPS over time</div>
        <div className="faint small">{session ? 'No fights in this session yet.' : 'Nothing to chart yet.'}</div>
      </div>
    )
  }
  const shown = series.filter((s) => s.any && !hidden.includes(s.key))
  const max = Math.max(1, ...shown.flatMap((s) => s.values))
  const W = 520
  const H = 140
  const L = 36
  const B = 18
  const x = (i: number) => L + (i / Math.max(1, seconds - 1)) * (W - L - 6)
  const y = (v: number) => 6 + (1 - v / max) * (H - B - 6)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const step = seconds > 600 ? 120 : seconds > 240 ? 60 : seconds > 90 ? 30 : seconds > 30 ? 10 : 5
  const ticks: number[] = []
  for (let t = 0; t < seconds; t += step) ticks.push(t)
  return (
    <div className="dm-aux">
      <div className="dm-aux-head">
        DPS over time{' '}
        <span className="faint small">
          {session ? `${marks.length} fight${marks.length === 1 ? '' : 's'} end to end · ` : ''}
          {WINDOW_SEC}s rolling
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="stats-chart dm-chart"
        role="img"
        aria-label={session ? 'Damage per second over the fights of this session, end to end' : 'Damage per second over the fight'}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={L} x2={W - 6} y1={y(max * f)} y2={y(max * f)} />
            <text x={L - 4} y={y(max * f) + 4} textAnchor="end">
              {fmtRate(max * f)}
            </text>
          </g>
        ))}
        <line className="grid" x1={L} x2={W - 6} y1={y(0)} y2={y(0)} />
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 4} textAnchor="middle">
            {clock(t)}
          </text>
        ))}
        {marks.slice(1).map((m) => (
          <line key={m.at} className="dm-chart-mark" x1={x(m.at)} x2={x(m.at)} y1={6} y2={H - B}>
            <title>{m.name}</title>
          </line>
        ))}
        {shown.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.key === 'inc' ? 1.2 : 1.8} opacity={s.key === 'inc' ? 0.8 : 1} />
        ))}
      </svg>
      <div className="row tight small">
        {series
          .filter((s) => s.any)
          .map((s) => (
            <button
              key={s.key}
              className={`dm-legend${hidden.includes(s.key) ? ' off' : ''}`}
              aria-pressed={!hidden.includes(s.key)}
              onClick={() => setHidden(hidden.includes(s.key) ? hidden.filter((k) => k !== s.key) : [...hidden, s.key])}
              title={hidden.includes(s.key) ? 'Show this line' : 'Hide this line'}
            >
              <i style={{ background: s.color }} /> {s.label}
            </button>
          ))}
      </div>
    </div>
  )
}
