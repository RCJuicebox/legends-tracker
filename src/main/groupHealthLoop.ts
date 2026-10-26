import {
  barFill,
  barsArea,
  findGroupBars,
  findPlayerMana,
  GroupHealthAlarm,
  JUICEBOX_PROFILE,
  manaFill,
  playerArea,
  playerManaFill,
  type Frame,
  type GroupBar,
  type GroupHealthProfile
} from '../core/groupHealth'
import type { GroupHealthFromWorker, GroupHealthToWorker, ScreenArea } from './groupHealth'

// The group health watch's loop, as the worker runs it (groupHealthWorker.ts), with the screen, the
// clock and the post back to the main process handed in, so a test can drive it with frames of its
// own (LT-627). Until the Group window is found, one monitor is searched every few seconds, backing
// off to a minute, and only while the game is in front; found, its bars are copied five times a
// second and each member going low is posted to say. With your own mana cue on (FEAT-043), each search
// also looks for the Player window's mana bar, which is sampled with the rows, or alone when solo; it is
// not read while the main process says your Cannibalization is recasting.

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
  find?: (f: Frame, p: GroupHealthProfile) => GroupBar[]
  fill?: (f: Frame, b: GroupBar, p: GroupHealthProfile) => number | null
  mana?: (f: Frame, b: GroupBar, p: GroupHealthProfile) => number | null
  findPlayer?: (f: Frame, p: GroupHealthProfile) => GroupBar | null
  playerFill?: (f: Frame, b: GroupBar, p: GroupHealthProfile) => number | null
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
  /** Low mana, said apart from health; off (0) unless set (LT-751). */
  readonly manaAlarm = new GroupHealthAlarm(0, 10)
  private manaOn = false
  /** A health line of their own for some rows, by each row's top edge: named members (LT-751). */
  private rowLines: Record<number, number> = {}
  /** How the skin draws its bars (FEAT-040). */
  private profile: GroupHealthProfile = JUICEBOX_PROFILE
  /** Your own mana bar in the Player window, while your mana cue is on and it is found (FEAT-043). */
  player: GroupBar | null = null
  readonly myManaAlarm = new GroupHealthAlarm(0, 10)
  private myManaOn = false
  /** Your mana is not read for now: Cannibalization is recasting. */
  private myManaPaused = false
  /** The Group window is watched: off while only your own mana cue is on. */
  private groupOn = true
  private readonly find: NonNullable<LoopDeps['find']>
  private readonly fill: NonNullable<LoopDeps['fill']>
  private readonly mana: NonNullable<LoopDeps['mana']>
  private readonly findPlayer: NonNullable<LoopDeps['findPlayer']>
  private readonly playerFill: NonNullable<LoopDeps['playerFill']>

  constructor(private readonly deps: LoopDeps) {
    this.find = deps.find ?? findGroupBars
    this.fill = deps.fill ?? barFill
    this.mana = deps.mana ?? manaFill
    this.findPlayer = deps.findPlayer ?? findPlayerMana
    this.playerFill = deps.playerFill ?? playerManaFill
  }

  /** Something to sample: the Group window's rows or your mana bar. */
  private get watching(): boolean {
    return this.bars.length > 0 || this.player !== null
  }

  /** Your mana bar found, moved or gone: the main process told, so the sources page can say. */
  private setPlayer(bar: GroupBar | null): void {
    const was = this.player
    if (was === bar || (was && bar && same([was], [bar]))) return
    this.player = bar
    this.myManaAlarm.reset()
    this.deps.post({ kind: 'player', bar })
  }

  /** Looks for the window on one monitor, or on monitor `only` when given; true when it is there. */
  private search(only?: number): boolean {
    this.lastSearch = this.deps.now()
    if (!this.areas.length) return false
    const i = only ?? this.nextArea % this.areas.length
    const a = this.areas[i]
    const frame = this.deps.capture(a.x, a.y, a.width, a.height)
    const found = this.groupOn ? this.find(frame, this.profile) : []
    this.setPlayer(this.myManaOn ? this.findPlayer(frame, this.profile) : null)
    if (this.player) {
      this.nextArea = i
      this.searchWait = SEARCH_MS
    }
    if (!found.length) {
      if (only === undefined && !this.player) {
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
    if (this.bars.length) this.sampleRows()
    if (!this.player || this.myManaPaused) return
    // Read alone, a small piece of its own: the Player window is seldom near the Group window.
    const a = playerArea(this.player, this.profile)
    const fill = this.playerFill(this.deps.capture(a.x, a.y, a.width, a.height), this.player, this.profile)
    for (const low of this.myManaAlarm.update([fill], [this.player.top])) this.deps.post({ kind: 'low', ...low, what: 'myMana' })
  }

  private sampleRows(): void {
    const area = barsArea(this.bars, this.profile)
    const frame = this.deps.capture(area.x, area.y, area.width, area.height)
    const fills = this.bars.map((b) => this.fill(frame, b, this.profile))
    if (fills.some((f) => f === null)) {
      this.lost++
      this.lostSince ||= this.deps.now()
    } else {
      this.lost = 0
      this.lostSince = 0
    }
    const tops = this.bars.map((b) => b.top)
    for (const low of this.alarm.update(fills, tops, (i) => this.rowLines[tops[i]])) this.deps.post({ kind: 'low', ...low })
    if (!this.manaOn) return
    const manas = this.bars.map((b) => this.mana(frame, b, this.profile))
    for (const low of this.manaAlarm.update(manas, tops)) this.deps.post({ kind: 'low', ...low, what: 'mana' })
  }

  /** One turn of the loop: a search or a sample, and the next turn asked for. */
  step(): void {
    this.scheduled = false
    if (!this.on) return
    try {
      const now = this.deps.now()
      if (!this.watching) {
        // Searched only while the game is in front: its window is nowhere else.
        if (this.front && now - this.lastSearch >= this.searchWait) this.search()
      } else if ((this.bars.length && this.lost >= LOST_SAMPLES) || now - this.lastSearch >= RECHECK_MS) {
        // Gone from where it was: it is looked for on its own monitor, then the others in turn. Rows
        // unreadable for a moment (a window over them) are kept; given up after ten seconds.
        if (!this.search(this.nextArea % Math.max(1, this.areas.length)) && this.bars.length && this.lost >= LOST_SAMPLES && this.lostSince && now - this.lostSince >= GONE_MS) {
          this.bars = []
          this.alarm.reset()
          this.deps.post({ kind: 'bars', bars: this.bars })
        }
      } else this.sample()
    } catch (e) {
      this.deps.post({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      this.bars = []
      this.player = null
    }
    this.scheduled = true
    this.deps.later(() => this.step(), this.watching ? SAMPLE_MS : 500)
  }

  /** What the main process sends: the monitors and the line, whether the game is in front, or a group change. */
  message(m: GroupHealthToWorker): void {
    if (m.kind === 'config') {
      this.areas = m.areas
      this.alarm.setLine(m.belowPct, m.rearmPct)
      this.manaOn = (m.manaPct ?? 0) > 0
      this.manaAlarm.setLine(m.manaPct ?? 0, (m.manaPct ?? 0) + 10)
      this.rowLines = m.rowLines ?? {}
      this.groupOn = m.group ?? true
      if (!this.groupOn && this.bars.length) {
        this.bars = []
        this.alarm.reset()
        this.deps.post({ kind: 'bars', bars: this.bars })
      }
      const myMana = m.myManaPct ?? 0
      this.myManaAlarm.setLine(myMana, myMana + 10)
      const profile = m.profile ?? JUICEBOX_PROFILE
      const wasMyMana = this.myManaOn
      this.myManaOn = myMana > 0
      // Paused or back: said afresh from here, so mana still low when Cannibalization is ready again is said.
      const paused = m.myManaPaused ?? false
      if (paused !== this.myManaPaused) this.myManaAlarm.reset()
      this.myManaPaused = paused
      if (!this.myManaOn) this.setPlayer(null)
      // Another skin's bars, or your mana cue just on: looked for afresh.
      const newProfile = JSON.stringify(profile) !== JSON.stringify(this.profile)
      const fresh = newProfile || (this.myManaOn && !wasMyMana)
      if (newProfile) {
        this.profile = profile
        this.alarm.reset()
        this.manaAlarm.reset()
        this.setPlayer(null)
        if (this.bars.length) {
          this.bars = []
          this.deps.post({ kind: 'bars', bars: this.bars })
        }
      }
      const was = this.on
      const wasFront = this.front
      this.on = m.on
      this.front = m.front
      // The game back in front, or the monitors changed: looked for soon, from the short wait again.
      if ((this.on && !was) || (this.front && !wasFront) || fresh) {
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
