import { useState } from 'react'
import { api, errorMessage } from '../api'
import { duration } from '../../../core/format'
import { showError } from '../toast'
import { CategoryChip, NumberInput } from '../components/ui'
import { type KnownSpell, type LogCheckRow } from '../../../shared/types'

// Spell Timers' check against your log: each spell's real land-to-fade time beside the calculation.

export function LogCheck({ known, onSaved }: { known: KnownSpell[]; onSaved: (k: KnownSpell[]) => void }) {
  const [rows, setRows] = useState<LogCheckRow[] | null>(null)
  const [added, setAdded] = useState<Record<string, number>>({})

  /** Sets the spell's extra focus so the calculation uses the focus the log implies. */
  const addFocus = async (r: LogCheckRow) => {
    if (r.impliedFocusPct === null) return
    const rule = known.find((k) => k.name === r.spell)?.rule ?? {}
    const extra = (rule.extraFocusPct ?? 0) + (r.impliedFocusPct - r.focusPct)
    try {
      onSaved(await api.invoke('spells:rule', r.spell, { ...rule, extraFocusPct: extra || undefined }))
      setAdded((a) => ({ ...a, [r.rankedName]: extra }))
    } catch (e) {
      showError(`Could not set the focus on ${r.spell}`, e)
    }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mbs, setMbs] = useState(100)

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      setRows(await api.invoke('spells:checkLog', mbs))
    } catch (e) {
      // Stopped from the jobs strip: nothing went wrong.
      if (errorMessage(e) !== 'Cancelled') setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>
        Check against your log <span className="spacer" />
        <span className="row tight" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
          last
          <NumberInput value={mbs} min={10} max={2000} step={50} width={80} label="Megabytes of log to check" onChange={(v) => setMbs(v ?? 100)} />
          MB
        </span>
        <button className="btn small" onClick={() => void run()} disabled={busy}>
          {busy ? 'Reading…' : 'Run check'}
        </button>
      </h2>
      <p className="muted small mt-0">
        A diagnostic, not a data source: replays recent history and compares each spell's real landing-to-fade time with the calculation. A mismatch usually means a focus effect
        missing from, or wrongly set in, the list above; the row shows the total focus that spell would need.
      </p>
      {error && (
        <div className="notice bad" role="alert">
          Could not check the log: {error}
        </div>
      )}
      {rows && rows.length === 0 && <div className="empty">No complete land-to-fade pairs found in that part of the log.</div>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Spell</th>
                <th>Type</th>
                <th>Samples</th>
                <th>Log median</th>
                <th>Calculated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r) => (
                <tr key={r.rankedName}>
                  <td>{r.rankedName}</td>
                  <td>
                    <CategoryChip category={r.category} />
                  </td>
                  <td className="muted">{r.samples}</td>
                  <td className="mono">{duration(r.observedMedianSec)}</td>
                  <td className="mono">
                    {r.calculatedEarliestSec}–{duration(r.calculatedLatestSec)}
                  </td>
                  <td>
                    {r.fits ? (
                      <span className="chip ok">Fits</span>
                    ) : (
                      <span className="row tight">
                        <span className="chip warn" title={r.impliedFocusRange ? `Fits with focus ${r.impliedFocusRange[0]}% to ${r.impliedFocusRange[1]}%` : ''}>
                          Off{r.impliedFocusPct !== null ? ` — needs ≈ ${r.impliedFocusPct}% focus in total` : ''}
                        </span>
                        {r.impliedFocusPct !== null &&
                          (added[r.rankedName] !== undefined ? (
                            <span className="chip ok">
                              Extra focus set: {added[r.rankedName] > 0 ? '+' : ''}
                              {added[r.rankedName]}%
                            </span>
                          ) : (
                            <button
                              className="btn small"
                              title={`Sets ${r.spell}'s extra focus so its focus comes to ${r.impliedFocusPct}% (it is ${r.focusPct}% now). Run the check again to see it fit.`}
                              onClick={() => void addFocus(r)}
                            >
                              Add this focus
                            </button>
                          ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
