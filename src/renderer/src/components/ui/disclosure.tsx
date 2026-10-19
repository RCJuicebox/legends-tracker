import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

// What opens on asking: a fold, a tooltip, an info button.

/**
 * The one way a row, a card or a list opens and folds: a caret that turns, before what it opens (a
 * name, a heading), or alone with a `label` for a screen reader. In a table row that opens on a click
 * anywhere, `stop` keeps its own click from toggling twice.
 */
export function Disclosure({
  open,
  onToggle,
  children,
  label,
  className = '',
  title,
  disabled,
  stop
}: {
  open: boolean
  onToggle: () => void
  children?: ReactNode
  label?: string
  className?: string
  title?: string
  disabled?: boolean
  stop?: boolean
}) {
  return (
    <button
      type="button"
      className={`disclosure ${className}`.trim()}
      aria-expanded={open}
      aria-label={children ? undefined : label}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        if (stop) e.stopPropagation()
        onToggle()
      }}
    >
      <span className="caret" aria-hidden="true" />
      {children}
    </button>
  )
}

/**
 * Something with an explanation behind it: the explanation is its hover title, and it can be reached
 * by Tab, where the same words show beside it (a title alone reaches only the mouse). The words are
 * drawn fixed to the window, so a table that scrolls cannot clip them; they go on a scroll.
 *
 * In a table's rows, or a list of achievement objectives, a Tip is not a Tab stop of its own: a
 * hundred rows were three hundred stops (LT-481). There its words are read out with the row instead.
 */
export function Tip({
  text,
  className = '',
  children,
  ...rest
}: { text: string; className?: string; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, 'title' | 'className' | 'children'>) {
  const [at, setAt] = useState<CSSProperties | null>(null)
  const self = useRef<HTMLSpanElement>(null)
  const [inRows, setInRows] = useState(false)
  // In a list of rows (a table, a plan's steps, the focus and buff lists) a Tip is read in place, not
  // a Tab stop each: a 30-step plan was ~120 stops before the next control (LT-576, LT-712).
  useLayoutEffect(() => setInRows(!!self.current?.closest(ROW_LISTS)), [])
  useEffect(() => {
    if (!at) return
    const hide = () => setAt(null)
    window.addEventListener('scroll', hide, true)
    return () => window.removeEventListener('scroll', hide, true)
  }, [at])
  return (
    <span
      {...rest}
      ref={self}
      className={`tip ${className}`.trim()}
      tabIndex={inRows ? undefined : 0}
      title={text}
      onFocus={(e) => {
        if (!e.currentTarget.matches(':focus-visible')) return
        const r = e.currentTarget.getBoundingClientRect()
        setAt({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - TIP_WIDTH - 8)) })
      }}
      onBlur={() => setAt(null)}
    >
      {children}
      {inRows && <span className="sr-only">{` (${text})`}</span>}
      {at && (
        <span className="tip-pop" role="tooltip" style={at}>
          {text}
        </span>
      )}
    </span>
  )
}

/** Where a Tip is one of many in rows: tables, objective lists, the plans' step lists and the row lists of Spell Timers, the meter and Buffs. */
export const ROW_LISTS = 'tbody, .ach-obj, .fp-steps li, .lt-focus-row, .dm-aux, .bc-rows'

/** The widest a Tip's words are drawn. */
export const TIP_WIDTH = 320

/** Room the popover needs to the right before it opens leftwards instead. */
export const INFO_WIDTH = 350

/**
 * An explanation behind a small "i": opens on click or Enter, so it reaches the keyboard as well as the
 * mouse, and closes on Escape, a click anywhere else, or a scroll. It is drawn fixed to the window, so
 * a table that scrolls sideways cannot clip it: leftwards near the right edge, upwards near the bottom.
 */
export function Info({ text, label = 'What this means' }: { text: ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<CSSProperties>({})
  useEffect(() => {
    if (!open) return
    const close = () => {
      if (ref.current) ref.current.open = false
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    // Fixed where it opened, it would stay put while the page moved under it: it closes instead.
    const onScroll = (e: Event) => !pop.current?.contains(e.target as Node) && close()
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])
  // Once drawn, its height is known: one that would run off the bottom opens above the "i" instead.
  useLayoutEffect(() => {
    const p = pop.current
    const s = ref.current?.querySelector('summary')
    if (!open || !p || !s || at.bottom !== undefined) return
    const r = s.getBoundingClientRect()
    if (p.getBoundingClientRect().bottom > window.innerHeight - 8 && r.top - 6 > p.offsetHeight) setAt({ ...at, top: undefined, bottom: window.innerHeight - r.top + 6 })
  }, [open, at])
  return (
    <details
      ref={ref}
      className="info"
      onToggle={(e) => {
        const d = e.currentTarget
        const s = d.querySelector('summary')
        if (d.open && s) {
          const r = s.getBoundingClientRect()
          setAt(
            r.left + INFO_WIDTH > window.innerWidth
              ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right - 8) }
              : { top: r.bottom + 6, left: Math.max(8, r.left - 8) }
          )
        }
        setOpen(d.open)
      }}
    >
      <summary aria-label={label} title={typeof text === 'string' ? text : undefined}>
        i
      </summary>
      <div className="info-pop" ref={pop} style={at}>
        {text}
      </div>
    </details>
  )
}
