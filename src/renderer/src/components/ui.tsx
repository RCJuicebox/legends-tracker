import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { GoContext, type SettingsTab } from '../nav'
import { useDebounced } from '../hooks'
import { num } from '../../../core/format'
import type { PageId } from '../main'
import type { SpellCategory } from '../../../shared/types'
import { ICON_PATHS, type IconName } from '../../../shared/icons'
import { CATEGORY_LABELS } from '../../../shared/types'
import { ago, clock, iconUrl } from '../api'
import { showToast } from '../toast'

// One clock for every "3m ago" on screen: it ticks each half minute while any is shown, so an age
// keeps up with time on a page left open, and stops when none is.
const ageListeners = new Set<() => void>()
let ageNow = Date.now()
let ageTimer: ReturnType<typeof setInterval> | null = null

function subscribeAge(listener: () => void): () => void {
  ageListeners.add(listener)
  if (!ageTimer) {
    ageNow = Date.now()
    ageTimer = setInterval(() => {
      ageNow = Date.now()
      for (const l of ageListeners) l()
    }, 30_000)
  }
  return () => {
    ageListeners.delete(listener)
    if (!ageListeners.size && ageTimer) {
      clearInterval(ageTimer)
      ageTimer = null
    }
  }
}

/** How long ago `t` was ("3m ago", "just now"), kept up to date while it shows; `never` for no time. */
export function Ago({ t, never = 'never' }: { t: number; never?: string }) {
  const now = useSyncExternalStore(subscribeAge, () => ageNow)
  return <>{t ? ago(t, Math.max(now, t)) : never}</>
}

/**
 * The time left until `until` ("4:12"), ticking each second by itself, so the page around it does not
 * draw again every second (LT-401); `done` once it has passed.
 */
export function Countdown({ until, done }: { until: number; done: ReactNode }) {
  const [now, setNow] = useState(Date.now())
  const left = until - now
  const running = left > 0
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  return <>{left > 0 ? clock(left / 1000) : done}</>
}

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
const NUMBER_IDLE_MS = 400

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

export function CategoryChip({ category }: { category: SpellCategory }) {
  return <span className={`chip ${category}`}>{CATEGORY_LABELS[category]}</span>
}

export function SpellIcon({ icon, large }: { icon?: number; large?: boolean }) {
  const [ok, setOk] = useState(true)
  if (icon === undefined || !ok) return <div className={`spell-icon${large ? ' lg' : ''}`} />
  return <img className={`spell-icon${large ? ' lg' : ''}`} src={iconUrl(icon)} alt="" onError={() => setOk(false)} />
}

export type { IconName }

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

/**
 * A command to type in game, such as /outputfile inventory, with a button beside it that copies it,
 * to paste into the chat box instead of typing it.
 */
export function GameCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const copy = (e: React.MouseEvent) => {
    // It sits inside clickable rows and labels too: the copy is all the click does.
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(cmd).then(
      () => {
        setCopied(true)
        showToast(`Copied ${cmd}: paste it into the game's chat box`)
      },
      () => showToast('Could not copy', { tone: 'bad' })
    )
  }
  return (
    <span className="game-cmd">
      <span className="mono">{cmd}</span>
      <button type="button" className={`game-cmd-copy${copied ? ' done' : ''}`} onClick={copy} title={`Copy ${cmd}`} aria-label={`Copy ${cmd} to the clipboard`}>
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </span>
  )
}

const GAME_COMMAND = /(\/outputfile [a-z]+)/i

/** Text with each /outputfile command in it shown as a GameCommand, for messages written as plain strings. */
export function WithCommands({ text }: { text: string }) {
  const parts = text.split(GAME_COMMAND)
  if (parts.length === 1) return <>{text}</>
  return <>{parts.map((p, i) => (i % 2 ? <GameCommand key={i} cmd={p} /> : p))}</>
}

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
      <span className="lt-mergebar grow" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctDone}>
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
const ROW_LISTS = 'tbody, .ach-obj, .fp-steps li, .lt-focus-row, .dm-aux, .bc-rows'

/** The widest a Tip's words are drawn. */
const TIP_WIDTH = 320

/** Room the popover needs to the right before it opens leftwards instead. */
const INFO_WIDTH = 350

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

/**
 * A row of tabs: one idiom for every page that has views. Keyboard as a tab list should be: the
 * arrow keys, Home and End move between tabs, and only the chosen one is in the Tab order. Always
 * buttons, so a page's views never look like a choice inside it (`Segmented`).
 */
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
  className = ''
}: {
  value: T
  tabs: readonly (readonly [T, string])[]
  onChange: (v: T) => void
  label: string
  className?: string
}) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = tabs[(to + tabs.length) % tabs.length][0]
    onChange(next)
    const list = (e.currentTarget as HTMLElement).parentElement
    requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus())
  }
  return (
    <div role="tablist" aria-label={label} className={`row gap-8 ${className}`.trim()}>
      {tabs.map(([id, text], i) => (
        <button
          key={id}
          role="tab"
          data-tab={id}
          aria-selected={value === id}
          tabIndex={value === id ? 0 : -1}
          className={`btn${value === id ? ' on' : ' ghost'}`}
          onClick={() => onChange(id)}
          onKeyDown={(e) => move(e, i)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** A Segmented's choice: `[value, label]`, with a tooltip as a third, or in full when it can be off. */
export type SegmentOption<T> = readonly [T, ReactNode] | readonly [T, ReactNode, string] | { value: T; label: ReactNode; title?: string; disabled?: boolean }

/** A choice given as a tuple, in full. */
function fullOption<T>(o: SegmentOption<T>): { value: T; label: ReactNode; title?: string; disabled?: boolean } {
  if (!Array.isArray(o)) return o as { value: T; label: ReactNode; title?: string; disabled?: boolean }
  const [value, label, title] = o as readonly [T, ReactNode, string?]
  return { value, label, title }
}

/** How far back a count of casts or swings looks: the same four choices wherever one is asked. */
export const DAY_WINDOWS = [
  [7, '7 days'],
  [14, '14 days'],
  [30, '30 days'],
  [0, 'All logs']
] as const satisfies readonly SegmentOption<number>[]

/** One of a few choices, side by side: a view's mode, an order, a scope. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  title
}: {
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (v: T) => void
  label: string
  /** What the choice as a whole means, on hover. */
  title?: string
}) {
  return (
    <span className="lt-seg" role="group" aria-label={label} title={title}>
      {options.map((o) => {
        const { value: v, label: text, title: tip, disabled } = fullOption(o)
        return (
          <button key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} title={tip} disabled={disabled} onClick={() => onChange(v)}>
            {text}
          </button>
        )
      })}
    </span>
  )
}

/** A chip that shows or hides one kind of thing; off is dashed and struck through. */
export function ToggleChip({
  on,
  onChange,
  children,
  title,
  className = ''
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  title?: string
  className?: string
}) {
  return (
    <button className={`chip toggle-chip ${className}${on ? '' : ' off'}`.trim()} aria-pressed={on} title={title} onClick={() => onChange(!on)}>
      {children}
    </button>
  )
}

/** A filter as you type; Escape clears it. */
export function FilterBox({
  value,
  onChange,
  label,
  placeholder = 'Filter…',
  width,
  className
}: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder?: string
  width?: number | string
  className?: string
}) {
  return (
    <input
      type="search"
      className={className}
      placeholder={placeholder}
      aria-label={label}
      value={value}
      style={width ? { width, textTransform: 'none' } : { textTransform: 'none' }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Escape' && value && (e.preventDefault(), onChange(''))}
    />
  )
}

export { sortRows, type Sort } from '../../../core/sort'
import type { Sort } from '../../../core/sort'

/** A column header that sorts its table: a click sorts by it, another click reverses. */
export function SortTh<K extends string>({
  k,
  sort,
  onSort,
  children,
  num,
  title,
  after
}: {
  k: K
  sort: Sort<K>
  onSort: (s: Sort<K>) => void
  children: ReactNode
  num?: boolean
  title?: string
  /** Beside the sorting button, not in it: an Info, which cannot sit inside a button. */
  after?: ReactNode
}) {
  const active = sort.key === k
  return (
    <th className={num ? 'num' : undefined} title={title} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => onSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {children}
        <span aria-hidden="true">{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
      </button>
      {after && <> {after}</>}
    </th>
  )
}

/**
 * A row of values as a small line, oldest on the left, with the last one marked: a trend at a glance
 * beside the number it belongs to. Nothing is drawn for fewer than two values.
 */
export function Sparkline({ values, width = 64, height = 16, title }: { values: number[]; width?: number; height?: number; title?: string }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => 1 + (i / (values.length - 1)) * (width - 2)
  const y = (v: number) => (hi === lo ? height / 2 : height - 2 - ((v - lo) / (hi - lo)) * (height - 4))
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values.length - 1
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      {title && <title>{title}</title>}
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx={x(last)} cy={y(values[last])} r="2" fill="currentColor" />
    </svg>
  )
}
