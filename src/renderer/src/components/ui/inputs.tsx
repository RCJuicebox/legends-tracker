import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// Inputs: a switch, a labelled field, a number typed in.

/** An on/off switch. Give it a `label` unless a wrapping <label> already names it. */
export function Switch({ on, onChange, title, label, disabled }: { on: boolean; onChange: (v: boolean) => void; title?: string; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={`switch${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    />
  )
}

export function Field({ label, hint, children, style }: { label: string; hint?: ReactNode; children: ReactNode; style?: CSSProperties }) {
  return (
    <label className="field" style={style}>
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  )
}

/** A number field waits this long after the last keystroke before it saves what is typed. */
export const NUMBER_IDLE_MS = 400

/**
 * A number field that saves what is typed when it is done being typed: on blur, Enter, or a pause,
 * never a keystroke at a time (typing 20 over 15 once saved "2", clamped to the least allowed, then
 * "60"). The value is clamped to min and max when saved; an emptied field saves nothing until it
 * loses focus, when it saves undefined (the caller's default) (LT-507).
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  width,
  placeholder,
  label
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  min?: number
  max?: number
  step?: number
  width?: number
  placeholder?: string
  /** The accessible name, when no <label> wraps it. */
  label?: string
}) {
  /** What is typed and not yet saved; null while the field shows the value. */
  const [draft, setDraft] = useState<string | null>(null)
  const latest = useRef({ value, onChange })
  latest.current = { value, onChange }
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))
  /** Saves the draft; `final` is the field being left, when an empty draft means the default. */
  const commit = (text: string, final: boolean) => {
    const { value: current, onChange: save } = latest.current
    if (text === '') {
      if (final && current !== undefined) save(undefined)
      return
    }
    const n = Number(text)
    if (!Number.isFinite(n)) return
    const v = clamp(n)
    if (v !== current) save(v)
  }
  useEffect(() => {
    if (draft === null) return
    const t = setTimeout(() => commit(draft, false), NUMBER_IDLE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  return (
    <input
      type="number"
      value={draft ?? value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      style={width ? { width } : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return
        commit(draft, true)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || draft === null) return
        commit(draft, true)
        setDraft(null)
      }}
    />
  )
}
