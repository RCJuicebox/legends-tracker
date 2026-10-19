import { barFill, barsArea, findGroupBars, GroupHealthAlarm, type Frame, type GroupBar } from '../core/groupHealth'
import type { GroupHealthFromWorker, GroupHealthToWorker, ScreenArea } from './groupHealth'

// The group health watch's loop, as the worker runs it (groupHealthWorker.ts), with the screen, the
// clock and the post back to the main process handed in, so a test can drive it with frames of its
// own (LT-627). Until the Group window is found, one monitor is searched every few seconds, backing
// off to a minute, and only while the game is in front; found, its bars are copied five times a
// second and each member going low is posted to say.

/** Between samples of the bars once found. */
const SAMPLE_MS = 200
/** Between searches for the window while it is not found: from four seconds, doubling each time nothing is found, to a minute (LT-549). */
export const SEARCH_MS = 4000
const SEARCH_MAX_MS = 60_000
/** A search again while it is found, for members who joined below the rows already read. */
const RECHECK_MS = 15_000
/** Samples in a row a bar cannot be read before the window is looked for again (a second). */
const LOST_SAMPLES = 5
/** Unreadable for this long before the rows are given up: a spell book over the window for a moment keeps what was said (LT-550). */
export const GONE_MS = 10_000

export interface LoopDeps {
  /** A piece of the screen, in physical pixels. */
  capture: (x: number, y: number, width: number, height: number) => Frame
  post: (m: GroupHealthFromWorker) => void
  now: () => number
  /** Runs `fn` after `ms`; the loop asks for its next step this way. */
  later: (fn: () => void, ms: number) => void
  /** The bars in a frame, and how full one is: the real readers unless a test stands in. */
  find?: (f: Frame) => GroupBar[]
  fill?: (f: Frame, b: GroupBar) => number | null
}

const same = (a: GroupBar[], b: GroupBar[]) => a.length === b.length && a.every((x, i) => x.left === b[i].left && x.right === b[i].right && x.top === b[i].top)

export class GroupHealthLoop {
  private on = false
  /** The game is in front: the only time its window can be searched for. */
  private front = true
  private searchWait = SEARCH_MS
  private lostSince = 0
  private areas: ScreenArea[] = []
  /** The monitor to search next; the one the window was last on goes first. */
  private nextArea = 0
  bars: GroupBar[] = []
  private lost = 0
  private lastSearch = 0
  private scheduled = false
  readonly alarm = new GroupHealthAlarm(25, 35)
  private readonly find: (f: Frame) => GroupBar[]
  private readonly fill: (f: Frame, b: GroupBar) => number | null

  constructor(private readonly deps: LoopDeps) {
    this.find = deps.find ?? findGroupBars
    this.fill = deps.fill ?? barFill
  }

  /** Looks for the window on one monitor, or on monitor `only` when given; true when it is there. */
  private search(only?: number): boolean {
    this.lastSearch = this.deps.now()
    if (!this.areas.length) return false
    const i = only ?? this.nextArea % this.areas.length
    const a = this.areas[i]
    const found = this.find(this.deps.capture(a.x, a.y, a.width, a.height))
    if (!found.length) {
      if (only === undefined) {
        this.nextArea = i + 1
        // Every monitor looked at and nothing: wait longer before the next round.
        if (this.nextArea % this.areas.length === 0) this.searchWait = Math.min(SEARCH_MAX_MS, this.searchWait * 2)
      }
      return false
    }
    this.nextArea = i
    this.searchWait = SEARCH_MS
    // Rows found again where they were keep what was said of them: the alarm goes by each row's place.
    if (!same(found, this.bars)) {
      this.bars = found
      this.deps.post({ kind: 'bars', bars: this.bars })
    }
    this.lost = 0
    this.lostSince = 0
    return true
  }

  private sample(): void {
    const area = barsArea(this.bars)
    const frame = this.deps.capture(area.x, area.y, area.width, area.height)
    const fills = this.bars.map((b) => this.fill(frame, b))
    if (fills.some((f) => f === null)) {
      this.lost++
      this.lostSince ||= this.deps.now()
    } else {
      this.lost = 0
      this.lostSince = 0
    }
    for (const low of this.alarm.update(
      fills,
      this.bars.map((b) => b.top)
    ))
      this.deps.post({ kind: 'low', ...low })
  }

  /** One turn of the loop: a search or a sample, and the next turn asked for. */
  step(): void {
    this.scheduled = false
    if (!this.on) return
    try {
      const now = this.deps.now()
      if (!this.bars.length) {
        // Searched only while the game is in front: its window is nowhere else.
        if (this.front && now - this.lastSearch >= this.searchWait) this.search()
      } else if (this.lost >= LOST_SAMPLES || now - this.lastSearch >= RECHECK_MS) {
        // Gone from where it was: it is looked for on its own monitor, then the others in turn. Rows
        // unreadable for a moment (a window over them) are kept; given up after ten seconds.
        if (!this.search(this.nextArea % Math.max(1, this.areas.length)) && this.lost >= LOST_SAMPLES && this.lostSince && now - this.lostSince >= GONE_MS) {
          this.bars = []
          this.alarm.reset()
          this.deps.post({ kind: 'bars', bars: this.bars })
        }
      } else this.sample()
    } catch (e) {
      this.deps.post({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      this.bars = []
    }
    this.scheduled = true
    this.deps.later(() => this.step(), this.bars.length ? SAMPLE_MS : 500)
  }

  /** What the main process sends: the monitors and the line, whether the game is in front, or a group change. */
  message(m: GroupHealthToWorker): void {
    if (m.kind === 'config') {
      this.areas = m.areas
      this.alarm.setLine(m.belowPct, m.rearmPct)
      const was = this.on
      const wasFront = this.front
      this.on = m.on
      this.front = m.front
      // The game back in front, or the monitors changed: looked for soon, from the short wait again.
      if ((this.on && !was) || (this.front && !wasFront)) {
        this.lastSearch = 0
        this.searchWait = SEARCH_MS
        if (!this.scheduled) this.step()
      }
    } else if (m.kind === 'search') {
      // Someone joined or left: looked for at once, not at the next search or recheck.
      this.lastSearch = 0
      this.searchWait = SEARCH_MS
      if (this.bars.length) this.lost = LOST_SAMPLES
    }
  }
}
