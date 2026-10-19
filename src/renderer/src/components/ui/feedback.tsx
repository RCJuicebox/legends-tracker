import { useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { GoContext, type SettingsTab } from '../../nav'
import { useDebounced } from '../../hooks'
import { num } from '../../../../core/format'
import type { PageId } from '../../main'

// What a page says while it waits or when it fails, how far a job has got, and links to other pages.

/**
 * What a page or card shows before its data arrives: "Loading your motes…", or why it could not load,
 * with a retry. `hint` says what to check if it takes long.
 */
export function Pending({
  error,
  retry,
  what = 'this',
  doing,
  hint,
  inline
}: {
  error?: string
  retry?: () => void
  what?: string
  /** The whole phrase, where "Loading …" is not what is happening: "Reading your log". */
  doing?: string
  hint?: string
  /** Within a line of text or a table cell, rather than a block of its own. */
  inline?: boolean
}) {
  if (error) return <LoadError error={error} retry={retry} what={what} />
  const text = `${doing ?? (what === 'this' ? 'Loading' : `Loading ${what}`)}…`
  // A status, so a screen reader says it once without taking the focus.
  if (inline)
    return (
      <span className="faint" role="status">
        {text}
      </span>
    )
  return (
    <div className="empty" role="status">
      {text}
      {hint && <div className="faint small">{hint}</div>}
    </div>
  )
}

/**
 * Something that went wrong, in a line of text or under a control: red, small, and announced as it
 * appears. A load that failed outright is a LoadError instead, with its retry.
 */
export function ErrorText({ children, block }: { children: ReactNode; block?: boolean }) {
  return block ? (
    <div className="small bad-text" role="alert">
      {children}
    </div>
  ) : (
    <span className="small bad-text" role="alert">
      {children}
    </span>
  )
}

/**
 * A number a costly model runs on, taken once typing stops (LT-406, LT-700): each value on the way to
 * "1.5" ran the finder over eleven thousand items, and the round after it. Never below 0.
 */
export function TypedNumber({
  value,
  onCommit,
  ...rest
}: {
  value: number
  onCommit: (v: number) => void
  step: number
  title?: string
  style?: CSSProperties
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)
  // Taken from outside (a preset picked): shown, unless it is what is typed already.
  if (value !== shown) {
    setShown(value)
    if (Number(draft) !== value) setDraft(String(value))
  }
  const commit = useDebounced(onCommit, 250)
  return (
    <input
      type="number"
      min={0}
      {...rest}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        commit.call(Math.max(0, Number(e.target.value) || 0))
      }}
      onBlur={commit.flush}
    />
  )
}

/** A download's progress as a bar and its count: one look for the item catalog and the recipes (LT-701). */
export function Progress({ done, total, label, unit = 'pages', small }: { done: number; total: number; label: string; unit?: string; small?: boolean }) {
  const pctDone = total ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div className={`row ${small ? 'small' : ''}`} style={{ minWidth: small ? 220 : 360 }}>
      <span className="sr-only" role="status">
        {label}
      </span>
      <span className="bar thick merge grow" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
        <i style={{ width: `${pctDone}%` }} />
      </span>
      <span className="muted nowrap">
        {num(done)} of {total ? num(total) : '…'} {unit}
      </span>
    </div>
  )
}

/** Under a list cut short: "Showing 100 of 143 · Show all", rather than stopping in silence (LT-694). */
export function ShowingSome({ shown, total, onAll }: { shown: number; total: number; onAll?: () => void }) {
  if (shown >= total) return null
  return (
    <div className="faint small mt-8">
      Showing {num(shown)} of {num(total)}
      {onAll && (
        <>
          {' · '}
          <button type="button" className="link-button inline" onClick={onAll}>
            Show all
          </button>
        </>
      )}
    </div>
  )
}

/** Another page named in a sentence, as a link to it where the page can go there (LT-692). */
export function PageLink({ page, children }: { page: PageId; children: ReactNode }) {
  const go = useContext(GoContext)
  return go ? (
    <button type="button" className="link-button inline" onClick={() => go(page)}>
      {children}
    </button>
  ) : (
    <>{children}</>
  )
}

/** "Settings › General" and the like, as a link to that tab where the page can go there (LT-571). */
export function SettingsLink({ tab, children }: { tab: SettingsTab; children: ReactNode }) {
  const go = useContext(GoContext)
  return go ? (
    <button type="button" className="link-button inline" onClick={() => go('settings', tab)}>
      {children}
    </button>
  ) : (
    <>{children}</>
  )
}

/** A failed load, said plainly, with a retry. */
export function LoadError({ error, retry, what = 'this' }: { error: string; retry?: () => void; what?: string }) {
  const go = useContext(GoContext)
  return (
    <div className="notice bad row mb-16" role="alert">
      <span className="grow">
        Could not load {what}: {error}
      </span>
      {/* Where the answer usually is: what each source last said, and a Refresh (LT-487). */}
      {go && (
        <button className="btn small ghost" onClick={() => go('settings', 'sources')}>
          Data sources
        </button>
      )}
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
  const button = useRef<HTMLButtonElement>(null)
  // Focus went to Yes while asking; the button it came from, drawn again, takes it back, so a keyboard
  // user is not dropped onto the page (LT-678). Not on the first draw, which nobody asked for.
  const asked = useRef(false)
  useEffect(() => {
    if (asking) asked.current = true
    else if (asked.current) button.current?.focus()
  }, [asking])
  if (!asking) {
    return (
      <button ref={button} type="button" className={className} title={title} aria-label={label} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    )
  }
  return (
    <span
      className="confirm row tight"
      role="group"
      aria-label={question}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Its own Escape: not the form's around it, which would cancel the whole edit.
        e.stopPropagation()
        setAsking(false)
      }}
    >
      <span className="small">{question}</span>
      <button
        type="button"
        className="btn small danger"
        autoFocus
        onClick={() => {
          setAsking(false)
          onConfirm()
        }}
      >
        Yes
      </button>
      <button type="button" className="btn small ghost" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  )
}
