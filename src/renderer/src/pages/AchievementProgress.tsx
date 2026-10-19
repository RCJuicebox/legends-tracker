import { useMemo } from 'react'
import { day, isoDays, numExact as num, signed } from '../../../core/format'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { Pending } from '../components/ui'
import { exportChange, weeksOf } from '../../../core/progress'

// Achievements › Progress over time (FEAT-032): achievements done a week from the log's completion
// lines, each export against the one before it (done, the Slayer counts, the sections that moved), and
// the factions moved each day.

const EXPORTS = 10
const DAYS = 14

export function Progress({ character }: { character: string }) {
  const [open, setOpen] = useRemembered('ach.progress', false)
  const q = useInvoke(open && character ? 'achievements:progress' : null, [character], [open])
  const p = q.data
  const now = Date.now()
  const weeks = useMemo(() => (p ? weeksOf(p.completions, now) : []), [p, now])
  const most = Math.max(1, ...weeks.map((w) => w.n))
  const exports = p
    ? p.snapshots
        .map((s, i) => ({ s, change: exportChange(s, p.snapshots[i - 1]) }))
        .reverse()
        .slice(0, EXPORTS)
    : []
  const days = p
    ? Object.entries(p.factionDays)
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, DAYS)
    : []
  return (
    <details className="card mb-16" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <b>Progress over time</b> <span className="faint small">achievements a week, each export against the last, factions moved a day</span>
      </summary>
      {!p ? (
        <Pending what="your progress" error={q.error} retry={q.reload} />
      ) : (
        <div className="grid two mt-8" style={{ alignItems: 'start' }}>
          <div>
            <h3 className="small">Achievements done, a week</h3>
            {!p.completions.length ? (
              <div className="faint small">Your log has no &ldquo;You have completed achievement&rdquo; line yet.</div>
            ) : (
              weeks.map((w) => (
                <div key={w.from} className="lt-bar" title={`From ${day(w.from, now)}`}>
                  <span>{day(w.from, now)}</span>
                  <span className="bar soft">
                    <i style={{ width: `${(w.n / most) * 100}%` }} />
                  </span>
                  <b>{w.n}</b>
                </div>
              ))
            )}
            <h3 className="small mt-16">Factions moved, a day</h3>
            {!days.length ? (
              <div className="faint small">No faction has moved in your log.</div>
            ) : (
              days.map(([d, moves]) => {
                const top = Object.entries(moves)
                  .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                  .slice(0, 4)
                return (
                  <div key={d} className="small">
                    <span className="faint">{isoDays(d, now)}</span> ·{' '}
                    {top.map(([f, n], i) => (
                      <span key={f}>
                        {i > 0 && ', '}
                        {f} {signed(n)}
                      </span>
                    ))}
                    {Object.keys(moves).length > top.length && <span className="faint"> +{Object.keys(moves).length - top.length} more</span>}
                  </div>
                )
              })
            )}
          </div>
          <div>
            <h3 className="small">Your exports</h3>
            {!exports.length ? (
              <div className="faint small">Each achievements export from here on is kept small, to compare with the next.</div>
            ) : (
              <table className="table small">
                <tbody>
                  {exports.map(({ s, change }) => (
                    <tr key={s.at}>
                      <td className="nowrap">{day(s.at, now)}</td>
                      <td className="mono">{num(s.total)}</td>
                      <td>
                        {change.done ? <b>{signed(change.done)}</b> : <span className="faint">—</span>}
                        {change.slayer > 0 && <span className="faint"> · {num(change.slayer)} Slayer kills</span>}
                        {change.sections.length > 0 && <div className="faint">{change.sections.map(([k, n]) => `${k.split(' › ').pop()} ${signed(n)}`).join(', ')}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </details>
  )
}
