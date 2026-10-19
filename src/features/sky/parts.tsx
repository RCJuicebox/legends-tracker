import { Tip } from '../../renderer/src/components/ui'
import { num } from '../../core/format'
import type { SkyItem } from './core'
import type { QuestView } from './views'

// The pieces Plan › Plane of Sky's tabs share: where an item drops, an item's chip, the wish control,
// a progress bar.

/** Where an item comes from, short: "Island 7, Sister of the Spire · No Drop"; several places joined by "or". */
export function whereOf(i: SkyItem): string {
  if (/^Wind Rune /.test(i.name)) return 'Any Plane of Sky mob'
  const at = i.drops.map((d) => (d.mob ? `Island ${d.island}, ${d.mob}` : `Island ${d.island}`)).join(' or ')
  return [at || 'Not from the Plane of Sky', i.noDrop ? 'No Drop' : ''].filter(Boolean).join(' · ')
}

/** An item a Test takes, as a chip: held of needed, ticked when there are enough. */
export function NeedChip({ item, have, need }: { item: SkyItem; have: number; need: number }) {
  const enough = have >= need
  return (
    <Tip className={`chip pill${enough ? ' ok' : have > 0 ? ' warn' : ''}`} text={`${item.name}: ${whereOf(item)}. You hold ${num(have)}, and need ${num(need)}.`}>
      {item.name} {num(have)}/{num(need)}
    </Tip>
  )
}

/** How many times a reward is wanted: a button to want it, then − and +. */
export function WantControl({ v, onWant }: { v: QuestView; onWant: (want: number) => void }) {
  const want = v.want
  if (!want)
    return (
      <button className="btn small ghost" onClick={() => onWant(1)} title="Put it on your wish list: its items are added up there">
        ☆ Want it
      </button>
    )
  return (
    <span className="row tight" role="group" aria-label={`Wanted ${want} times`}>
      <button className="btn small ghost" onClick={() => onWant(want - 1)} aria-label="Want it one time fewer">
        −
      </button>
      <Tip className="chip pill gold" text={v.times < want ? `On your wish list ${want} times; ${v.times} to go` : `On your wish list ${want} times`}>
        ★ ×{want}
      </Tip>
      <button className="btn small ghost" onClick={() => onWant(want + 1)} aria-label="Want it one time more">
        +
      </button>
    </span>
  )
}

/** A thin bar: done of total, with the words beside it. */
export function Bar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <span className="sky-bar-wrap" title={label}>
      <span className="small mono">
        {num(done)}/{num(total)}
      </span>
      <span className="sky-bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="small mono faint">{pct}%</span>
    </span>
  )
}
