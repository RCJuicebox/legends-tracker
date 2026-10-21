import { type ReactNode } from 'react'

// Choosing and narrowing: tabs, segments, chips that toggle, a filter box, sortable headings, a sparkline.

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
export function fullOption<T>(o: SegmentOption<T>): { value: T; label: ReactNode; title?: string; disabled?: boolean } {
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

/**
 * A chip that shows or hides one kind of thing, among others in a row (a filter): a small switch in
 * it says on or off at a glance, as Switch does for a setting; on is tinted in its kind's colour.
 */
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
      <span className="chip-switch" aria-hidden="true" />
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

export { sortRows, type Sort } from '../../../../core/sort'
import type { Sort } from '../../../../core/sort'

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
