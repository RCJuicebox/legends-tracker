import { useState, type CSSProperties, type ReactNode } from 'react'
import type { SpellCategory } from '../../../shared/types'
import { CATEGORY_LABELS } from '../../../shared/types'
import { iconUrl } from '../api'

/** An on/off switch. Give it a `label` unless a wrapping <label> already names it. */
export function Switch({ on, onChange, title, label }: { on: boolean; onChange: (v: boolean) => void; title?: string; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
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
  return (
    <input
      type="number"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      style={width ? { width } : undefined}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  )
}

export function CategoryChip({ category }: { category: SpellCategory }) {
  return <span className={`chip ${category}`}>{CATEGORY_LABELS[category]}</span>
}

export function SpellIcon({ icon, large }: { icon?: number; large?: boolean }) {
  const [ok, setOk] = useState(true)
  if (icon === undefined || !ok) return <div className={`spell-icon${large ? ' lg' : ''}`} />
  return <img className={`spell-icon${large ? ' lg' : ''}`} src={iconUrl(icon)} alt="" onError={() => setOk(false)} />
}

const paths = {
  dashboard: <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />,
  spells: <path d="M7 2v11h3v9l7-12h-4l4-8z" />,
  triggers: <path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-6V11c0-3.1-1.6-5.6-4.5-6.3V4a2.5 2.5 0 0 0-5 0v.7C6.6 5.4 5 7.9 5 11v5l-2 2v1h18v-1l-2-2z" />,
  overlays: <path d="M4 4h16v12H4zm2 2v8h12V6zM8 18h8v2H8z" />,
  audio: <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />,
  logs: <path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-6 10h-4v-2h4zm4-4H6v-2h12z" />,
  settings: <path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />,
  play: <path d="M8 5v14l11-7z" />,
  stop: <path d="M6 6h12v12H6z" />,
  move: <path d="M10 9h4V6h3l-5-5-5 5h3v3zm-1 1H6V7l-5 5 5 5v-3h3v-4zm14 2-5-5v3h-3v4h3v3l5-5zm-9 3h-4v3H7l5 5 5-5h-3v-3z" />,
  mute: <path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5V12zM19 12a7 7 0 0 1-.6 2.8l1.5 1.5A9 9 0 0 0 14 3.2v2.1a7 7 0 0 1 5 6.7zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.8l2 2 1.3-1.3L4.3 3zM12 4 9.9 6.1 12 8.2z" />,
  plus: <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />,
  motes: <path d="M12 2 4 7v10l8 5 8-5V7l-8-5zm0 2.3 5.6 3.5L12 11.3 6.4 7.8 12 4.3zM6 9.6l5 3.1v6.1l-5-3.1V9.6zm7 9.2v-6.1l5-3.1v6.1l-5 3.1z" />,
  trophy: <path d="M19 4h-2V2H7v2H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 5A5 5 0 0 0 11 15v3H7v2h10v-2h-4v-3a5 5 0 0 0 3.6-3A5 5 0 0 0 21 7V6a2 2 0 0 0-2-2zM5 7V6h2v4a3 3 0 0 1-2-3zm14 0a3 3 0 0 1-2 3V6h2z" />,
  stats: <path d="M4 20h4V10H4v10zm6 0h4V4h-4v16zm6 0h4v-7h-4v7z" />,
  bag: <path d="M18 7h-2a4 4 0 0 0-8 0H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zm-6-2a2 2 0 0 1 2 2h-4a2 2 0 0 1 2-2zm6 15H6V9h2v2h2V9h4v2h2V9h2z" />,
  sparkle: <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
      {paths[name]}
    </svg>
  )
}

/** What a page shows before its data arrives: "Loading…", or why it could not load, with a retry. */
export function Pending({ error, retry, what = 'this' }: { error?: string; retry?: () => void; what?: string }) {
  if (!error) return <div className="empty">Loading…</div>
  return <LoadError error={error} retry={retry} what={what} />
}

/** A failed load, said plainly, with a retry. */
export function LoadError({ error, retry, what = 'this' }: { error: string; retry?: () => void; what?: string }) {
  return (
    <div className="notice bad row mb-16" role="alert">
      <span className="grow">
        Could not load {what}: {error}
      </span>
      {retry && (
        <button className="btn small" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  )
}

/**
 * A button for something that cannot be taken back. The first click asks; Yes does it, No (or
 * Escape) puts the button back.
 */
export function ConfirmButton({
  children,
  question = 'Are you sure?',
  onConfirm,
  className = 'btn small danger',
  title,
  label,
  disabled
}: {
  children: ReactNode
  question?: string
  onConfirm: () => void
  className?: string
  title?: string
  label?: string
  disabled?: boolean
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button className={className} title={title} aria-label={label} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  }
  return (
    <span className="confirm row tight" role="group" aria-label={question} onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
      <span className="small">{question}</span>
      <button
        className="btn small danger"
        autoFocus
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        Yes
      </button>
      <button className="btn small ghost" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  )
}

/** An explanation behind a small "i": opens on click or Enter, so it reaches the keyboard as well as the mouse. */
export function Info({ text, label = 'What this means' }: { text: ReactNode; label?: string }) {
  return (
    <details className="info">
      <summary aria-label={label} title={typeof text === 'string' ? text : undefined}>
        i
      </summary>
      <div className="info-pop">{text}</div>
    </details>
  )
}
