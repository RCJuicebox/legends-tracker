import type { Notification, TimerView } from '../shared/types'

export interface BoardTimer extends TimerView {
  /** Identity: the same spell on two targets is two timers; refreshing one never resets the other. */
  key: string
  /** Base spell name, for spell timers. */
  spell?: string
  onWarn: Notification[]
  onExpire: Notification[]
  warned: boolean
  /** Spell timers end on the log's fade line. Past their estimate they linger this long before being dropped. */
  graceMs: number
  meta?: Record<string, unknown>
}

export type EndReason = 'faded' | 'expired' | 'died' | 'zoned' | 'cleared' | 'replaced'

export interface BoardEvents {
  onChange: () => void
  onNotify: (n: Notification[], timer: BoardTimer) => void
  onEnd?: (timer: BoardTimer, reason: EndReason) => void
}

/**
 * Every running timer, spell-tracked or trigger-made, in one place. `tick` is a pure function of the
 * clock it is given, so tests advance time instead of waiting for it.
 */
export class TimerBoard {
  private readonly timers = new Map<string, BoardTimer>()
  private seq = 0

  constructor(private readonly events: BoardEvents) {}

  nextId(): string {
    return `t${++this.seq}`
  }

  get(key: string): BoardTimer | undefined {
    return this.timers.get(key)
  }

  list(): BoardTimer[] {
    return [...this.timers.values()]
  }

  views(): TimerView[] {
    return this.list()
      .sort((a, b) => a.endsAt - b.endsAt)
      .map((t) => ({
        id: t.id, label: t.label, target: t.target, source: t.source, category: t.category, icon: t.icon,
        color: t.color, overlay: t.overlay, startedAt: t.startedAt, endsAt: t.endsAt, exact: t.exact,
        warnSec: t.warnSec, rank: t.rank
      }))
  }

  upsert(timer: BoardTimer): void {
    this.timers.set(timer.key, timer)
    this.events.onChange()
  }

  /** Moves a timer's end, re-arming its warning if the new end is later. */
  reschedule(key: string, endsAt: number, exact: boolean): void {
    const t = this.timers.get(key)
    if (!t) return
    if (endsAt > t.endsAt + 500) t.warned = false
    t.endsAt = endsAt
    t.exact = exact
    this.events.onChange()
  }

  end(key: string, reason: EndReason): BoardTimer | undefined {
    const t = this.timers.get(key)
    if (!t) return undefined
    this.timers.delete(key)
    this.events.onEnd?.(t, reason)
    this.events.onChange()
    return t
  }

  endWhere(pred: (t: BoardTimer) => boolean, reason: EndReason): BoardTimer[] {
    const ended = this.list().filter(pred)
    for (const t of ended) {
      this.timers.delete(t.key)
      this.events.onEnd?.(t, reason)
    }
    if (ended.length) this.events.onChange()
    return ended
  }

  tick(now: number): void {
    let changed = false
    for (const t of this.list()) {
      if (!t.warned && t.warnSec > 0 && now >= t.endsAt - t.warnSec * 1000 && now < t.endsAt + (t.exact ? Math.min(t.graceMs, 3000) : t.graceMs)) {
        t.warned = true
        if (t.onWarn.length) this.events.onNotify(t.onWarn, t)
      }
      // An exact end (a DoT pinned by its ticks) needs little grace: some, like Harm Touch, print no
      // "worn off" line at all, and should not sit on "fading…" for long.
      const grace = t.exact ? Math.min(t.graceMs, 3000) : t.graceMs
      if (now >= t.endsAt + grace) {
        this.timers.delete(t.key)
        if (t.onExpire.length) this.events.onNotify(t.onExpire, t)
        this.events.onEnd?.(t, 'expired')
        changed = true
      }
    }
    if (changed) this.events.onChange()
  }

  clear(): void {
    this.timers.clear()
    this.events.onChange()
  }
}
