import { num } from '../../../core/format'
import type { StatsSheet } from '../../../core/statsSheet'
import type { Auto, Note, Row, Val } from '../../../core/statsModel'

// Small pieces the Stats tabs share: the sheet's setter, number fields, notes and the step-by-step trace.

/** A change to the sheet: fields, or a function of the latest sheet giving them. */
export type SetSheet = (patch: Partial<StatsSheet> | ((s: StatsSheet) => Partial<StatsSheet>)) => void

/** A number input. With `auto`, the value comes from a file unless typed over; clearing it goes back. */
export function NumField({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  auto,
  autoFrom,
  title
}: {
  label: string
  hint?: string
  /** The detail for those who want it (a spell effect's number), on hover. */
  title?: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  auto?: number
  autoFrom?: string
}) {
  const overridden = auto !== undefined && value !== undefined
  return (
    <label className="field" title={title}>
      <span>
        {label}
        {hint && <em className="faint"> {hint}</em>}
      </span>
      <div className="row tight">
        <input
          type="number"
          className="grow"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          placeholder={auto !== undefined ? String(auto) : '0'}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') return onChange(auto !== undefined ? undefined : 0)
            const v = step < 1 ? parseFloat(raw) : Math.floor(parseFloat(raw))
            onChange(Number.isFinite(v) ? Math.max(min, max !== undefined ? Math.min(max, v) : v) : 0)
          }}
        />
        {auto !== undefined &&
          (overridden ? (
            <button className="chip warn" title={`Your figure. Click to go back to ${auto} from ${autoFrom}.`} onClick={(e) => (e.preventDefault(), onChange(undefined))}>
              yours ×
            </button>
          ) : (
            <span className="chip ok" title={`From ${autoFrom}. Type to override.`}>
              {autoFrom}
            </span>
          ))}
      </div>
    </label>
  )
}

export interface TabProps {
  s: StatsSheet
  set: SetSheet
  setOverride: (k: keyof StatsSheet['overrides'], v: number | undefined) => void
  auto: Auto
  val: Val
  trio: string[]
  primary: string
  skill: (id: number) => number
}

export function Notes({ notes }: { notes: Note[] }) {
  return (
    <ul className="stats-notes">
      {notes.map(([kind, title, text], i) => (
        <li key={i} className={kind}>
          <b>{title}</b> {text}
        </li>
      ))}
    </ul>
  )
}

export function Trace({ rows }: { rows: Row[] }) {
  return (
    <details className="stats-trace">
      <summary>Show every step</summary>
      <div className="table-scroll">
        <table className="table small">
          <tbody>
            {rows.map(([label, value, note], i) =>
              label.startsWith('#') ? (
                <tr key={i}>
                  <td colSpan={3} className="stats-trace-head">
                    {label.slice(1)}
                  </td>
                </tr>
              ) : (
                <tr key={i}>
                  <td>{label}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {typeof value === 'number' ? num(value) : value}
                  </td>
                  <td className="faint">{note}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </details>
  )
}
