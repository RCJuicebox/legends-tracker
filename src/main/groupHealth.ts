import { foregroundWindowRect } from './win32'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { app, screen } from 'electron'
import {
  calibrateColours,
  groupHealthPhrase,
  JUICEBOX_PROFILE,
  namesFromWords,
  type Calibration,
  type GroupBar,
  type GroupHealthProfile,
  type LowHealth
} from '../core/groupHealth'
import { RE_GROUP_CHANGE } from '../core/combatLines'
import type { AppContext } from './context'
import type { AppFeature } from './appFeature'
import type { EngineFeature } from './engine'
import { captureRect, releaseCapture } from './screenPixels'
import { readSkinGroupHealth } from './skinBuilds'
import { discardScreens, ocrImage, writeBmp } from './ocr'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { log } from './log'
import { handle } from './ipc/handle'
// oxlint-disable-next-line import/default -- electron-vite's ?modulePath import: the build supplies the default export
import groupHealthWorkerPath from './groupHealthWorker?modulePath'

// Says when a group member's health drops to the line set on the Triggers page (25% unless changed).
// The log never prints anyone's health, so it is read off the screen: the worker finds the skin's
// Group window and watches its bars; this side says who, by reading the names off the window with
// OCR whenever the rows change. It runs only while the game does and the switch is on, or your own
// mana cue is (FEAT-043). How the skin draws its bars is JuiceboxUI's unless the skin's file says,
// or its colours were sampled off the screen (FEAT-040).

/** A monitor, in physical pixels of the whole desktop. */
export interface ScreenArea {
  x: number
  y: number
  width: number
  height: number
}

/** How long a worker told to stop has to end itself before it is ended. */
const STOP_WAIT_MS = 1000

export type GroupHealthToWorker =
  | {
      kind: 'config'
      on: boolean
      areas: ScreenArea[]
      belowPct: number
      rearmPct: number
      front: boolean
      /** Low mana's line; 0 off (LT-751). */
      manaPct?: number
      /** A health line of their own for rows by their top edge: the named members' (LT-751). */
      rowLines?: Record<number, number>
      /** How the skin draws its bars (FEAT-040); JuiceboxUI's when left out. */
      profile?: GroupHealthProfile
      /** Your own mana's line, off the Player window; 0 off (FEAT-043). */
      myManaPct?: number
      /** Whether the Group window is watched at all: false while only your own mana cue is on. */
      group?: boolean
      /** Your own mana is not read for now: Cannibalization is recasting. */
      myManaPaused?: boolean
    }
  | { kind: 'search' }
  | { kind: 'ping' }
  | { kind: 'stop' }

export type GroupHealthFromWorker =
  | { kind: 'bars'; bars: GroupBar[] }
  | { kind: 'player'; bar: GroupBar | null }
  | ({ kind: 'low' } & LowHealth)
  | { kind: 'error'; message: string }
  | { kind: 'pong'; koffi: boolean; error?: string }

/** What the watch needs of its worker thread: node's Worker, or a stand-in in tests (LT-627). */
export interface WorkerLike {
  postMessage(m: GroupHealthToWorker): void
  on(event: 'message', fn: (m: GroupHealthFromWorker) => void): unknown
  on(event: 'error', fn: (e: Error) => void): unknown
  on(event: 'exit', fn: (code: number) => void): unknown
  terminate(): unknown
}

/** What the self-test says: whether the worker answered, and whether the Windows calls (koffi) loaded inside it. */
export interface GroupHealthSelfTest {
  pong: boolean
  koffi: boolean
  error?: string
}

/** You use Cannibalization (any rank; not the Cannibalize spells, which have no recast), or are told when it is ready. */
const RE_CANNI_USED = /^You (?:begin casting|hit yourself for \d+ points of unresistable damage by) Cannibalization\b/
const RE_CANNI_AGAIN = /^You can use the ability Cannibalization again in (\d+) minute\(s\) (\d+) seconds/

/** Back over the line by this much before a member is said again. */
const REARM_ABOVE = 10

/** How long "Calibrate from the screen" waits for the game to come to the front, and then for its windows to be drawn. */
const CALIBRATE_WAIT_MS = 20_000
const CALIBRATE_SETTLE_MS = 400

export class GroupHealth implements AppFeature {
  readonly id = 'groupHealth'
  private worker: WorkerLike | null = null
  constructor(private readonly makeWorker: () => WorkerLike = () => new Worker(groupHealthWorkerPath)) {}
  private ctx!: AppContext
  private bars: GroupBar[] = []
  private names: string[] = []
  /** Each row's name by its top edge, kept while the window stays put, so rows seen before are not read again (LT-550). */
  private namesByTop = new Map<number, string>()
  /** Bumped by each new set of rows, so names read for an older set are dropped. */
  private rowsSeen = 0
  /** What the watch was last set to, or why it is not running: a tick that changes neither does nothing. */
  private lastConfig = ''
  private retryAt = 0
  /** The skin's own profile as last read, by game folder and skin, and the one being read now. */
  private skinRead: { key: string; profile: GroupHealthProfile } | null = null
  private reading = ''
  /** Your mana bar is in view (FEAT-043), for what the sources page says. */
  private playerSeen = false
  /** When your Cannibalization is ready again, by the log's clock: your mana is read only from then. */
  private canniReadyAt = 0

  register(ctx: AppContext): void {
    this.ctx = ctx
    sources.add('groupHealth', {
      label: 'Group health',
      kind: 'screen',
      what: "Your group's health bars in the skin's Group window, and your own mana in its Player window when that cue is on, watched on the screen while the game runs, for the Triggers page's group health alert."
    })
    handle('groupHealth:selfTest', () => this.selfTest())
    handle('groupHealth:calibrate', () => this.calibrate())
    const feature: EngineFeature = {
      id: 'groupHealth',
      line: (l) => {
        if (l.text.includes('Cannibalization')) return this.canni(l.time, l.text)
        if (!l.text.includes(' group') || !RE_GROUP_CHANGE.test(l.text)) return false
        this.worker?.postMessage({ kind: 'search' } satisfies GroupHealthToWorker)
        return true
      },
      reset: () => (this.canniReadyAt = 0),
      // Five times a second: cheap, and it starts or stops the watch as the game opens and closes.
      tick: () => this.apply(),
      // Settings saved: the skin's file is read again too, in case it was rebuilt.
      reconfigure: () => {
        this.readSkin()
        this.apply()
      }
    }
    ctx.engine.use(feature)
    // Electron's screen module cannot be touched before the app is ready, and the context is built before.
    void app.whenReady().then(() => {
      // Monitors added, taken away or rearranged: the worker searches the new layout.
      const again = () => this.apply(true)
      screen.on('display-added', again)
      screen.on('display-removed', again)
      screen.on('display-metrics-changed', again)
      this.apply()
    })
  }

  private apply(force = false): void {
    if (!app.isReady()) return
    const s = this.ctx.store.settings.get().groupHealth
    const wanted = s.enabled || s.myManaPct > 0
    const on = wanted && this.ctx.watcher.gameRunning === true
    if (!on) {
      if (this.worker) this.stop()
      const why = wanted ? 'Waiting for the game.' : 'Off: switch it on on the Triggers page.'
      if (why !== this.lastConfig) sources.missing('groupHealth', why)
      this.lastConfig = why
      return
    }
    // Only the monitor the game's window is on is searched, and only while the game is in front: the
    // watch read whole monitors every four seconds for as long as the game ran, in front or not (LT-549).
    const front = this.ctx.watcher.state.foregroundName === 'eqgame'
    const rect = front ? foregroundWindowRect() : null
    const all = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds))
    const overlaps = (a: ScreenArea) => !!rect && a.x < rect.x + rect.width && rect.x < a.x + a.width && a.y < rect.y + rect.height && rect.y < a.y + a.height
    const areas = rect && all.some(overlaps) ? all.filter(overlaps) : all
    const rowLines = this.rowLines(s.watchNames, s.watchPct)
    const profile = this.profile()
    const myManaPaused = s.myManaCanniSec > 0 && Date.now() < this.canniReadyAt
    const key = `${myManaPaused}|${s.enabled}|${s.belowPct}|${s.manaPct}|${s.myManaPct}|${JSON.stringify(rowLines)}|${front}|${areas.map((a) => `${a.x},${a.y}`).join(';')}|${JSON.stringify(profile)}`
    if (this.worker && !force && key === this.lastConfig) return
    // A watch that ended badly is started again, but not more than twice a minute.
    if (!this.worker && Date.now() < this.retryAt) return
    this.lastConfig = key
    if (!this.worker) this.start()
    this.worker!.postMessage({
      kind: 'config',
      on: true,
      areas,
      belowPct: s.belowPct,
      rearmPct: s.belowPct + REARM_ABOVE,
      front,
      manaPct: s.manaPct,
      rowLines,
      profile,
      myManaPct: s.myManaPct,
      group: s.enabled,
      myManaPaused
    } satisfies GroupHealthToWorker)
  }

  /**
   * Cannibalization used, at `time`: your mana is not read until it is ready again, its recast later
   * (the Triggers page's, three minutes unless changed). The game saying how long is left
   * puts it right. The tick sends the pause to the worker, and its end.
   */
  private canni(time: number, text: string): boolean {
    const again = RE_CANNI_AGAIN.exec(text)
    if (again) this.canniReadyAt = time + (Number(again[1]) * 60 + Number(again[2])) * 1000
    else if (RE_CANNI_USED.test(text)) this.canniReadyAt = time + this.ctx.store.settings.get().groupHealth.myManaCanniSec * 1000
    else return false
    return true
  }

  /** The game folder and skin the profile is read for. */
  private skinKey(): { key: string; dir: string; skin: string } {
    const dir = this.ctx.installDir()
    const skin = this.ctx.store.settings.get().groupHealth.skin
    return { key: `${dir}|${skin}`, dir, skin }
  }

  /** Reads the skin's file for its profile, in the background; the watch is set again once it is read. */
  private readSkin(): void {
    const { key, dir, skin } = this.skinKey()
    if (this.reading === key) return
    this.reading = key
    void readSkinGroupHealth(dir, skin)
      .catch(() => null)
      .then((p) => {
        this.skinRead = { key, profile: p ?? JUICEBOX_PROFILE }
        if (this.reading === key) this.reading = ''
        this.apply()
      })
  }

  /** The skin's own profile (JuiceboxUI's until its file is read), without colours sampled off the screen. */
  private skinProfile(): GroupHealthProfile {
    const { key } = this.skinKey()
    if (this.skinRead?.key !== key) this.readSkin()
    return this.skinRead?.key === key ? this.skinRead.profile : JUICEBOX_PROFILE
  }

  /** How the bars are read: the skin's profile, with the colours sampled for it if there are any (FEAT-040). */
  private profile(): GroupHealthProfile {
    const s = this.ctx.store.settings.get().groupHealth
    const p = this.skinProfile()
    const sampled = s.calibrated[s.skin]
    return sampled ? { ...p, colours: sampled } : p
  }

  /**
   * "Calibrate from the screen" (FEAT-040): the colours sampled off the Group window, wherever it is
   * on a monitor. Asked from the app's own window, which may cover the game: when nothing is found at
   * once, the game is waited for to come to the front (twenty seconds at most) and the screen read
   * again. Said aloud too, as the player is in the game by then. The page keeps what comes back.
   */
  async calibrate(): Promise<Calibration> {
    const base = this.skinProfile()
    const areas = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds))
    const look = (): Calibration | null => {
      for (const a of areas) {
        const r = calibrateColours(captureRect(a.x, a.y, a.width, a.height), base)
        if (r.rows) return r
      }
      return null
    }
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const inFront = () => this.ctx.watcher.state.foregroundName === 'eqgame'
    try {
      let found = look()
      if (!found) {
        const until = Date.now() + CALIBRATE_WAIT_MS
        while (!inFront() && Date.now() < until) await wait(250)
        if (inFront()) {
          await wait(CALIBRATE_SETTLE_MS)
          found = look()
        }
      }
      const r = found ?? { colours: base.colours, seen: [], rows: 0 }
      log.info(`Group health colours sampled: ${r.rows} rows, ${r.seen.join(', ') || 'nothing'} seen`)
      this.ctx.engine.notify([{ kind: 'speak', text: r.rows ? 'Group colours sampled' : 'No group window found', interrupt: false }])
      return r
    } finally {
      // A whole monitor's copy is kept for the next of its size: none comes from this thread soon.
      releaseCapture()
    }
  }

  /** The named members' own health line, by the top of the row their name was read on (LT-751). */
  private rowLines(watch: string[], pct: number): Record<number, number> {
    const out: Record<number, number> = {}
    const wanted = new Set(watch.map((n) => n.toLowerCase()))
    if (!wanted.size) return out
    for (const [top, name] of this.namesByTop) if (wanted.has(name.toLowerCase())) out[top] = pct
    return out
  }

  /** Starts a worker of its own, asks it a ping and ends it: whether it loads at all, koffi included (the smoke test asks, LT-630). */
  selfTest(): Promise<GroupHealthSelfTest> {
    return new Promise((resolve) => {
      const w = this.makeWorker()
      let over = false
      const done = (r: GroupHealthSelfTest) => {
        if (over) return
        over = true
        clearTimeout(timer)
        w.terminate()
        resolve(r)
      }
      const timer = setTimeout(() => done({ pong: false, koffi: false, error: 'The worker did not answer in ten seconds.' }), 10_000)
      w.on('message', (m) => {
        if (m.kind === 'pong') done({ pong: true, koffi: m.koffi, ...(m.error ? { error: m.error } : {}) })
      })
      w.on('error', (e) => done({ pong: false, koffi: false, error: e.message }))
      w.postMessage({ kind: 'ping' })
    })
  }

  private start(): void {
    const w = this.makeWorker()
    this.worker = w
    this.bars = []
    sources.reading('groupHealth', 'Looking for the Group window…')
    w.on('message', (m: GroupHealthFromWorker) => this.message(m))
    w.on('error', (e) => sources.fail('groupHealth', e))
    w.on('exit', (code) => {
      if (this.worker !== w) return
      this.worker = null
      this.lastConfig = ''
      if (code === 0) return
      this.retryAt = Date.now() + 30_000
      sources.fail('groupHealth', new Error(`The group health watch stopped (${code}); starting it again shortly.`))
    })
  }

  /** Asks the worker to free what it holds and end; ended outright if it has not in a second (LT-559). */
  private stop(): void {
    const w = this.worker
    this.worker = null
    this.bars = []
    if (!w) return
    let ended = false
    w.on('exit', () => (ended = true))
    w.postMessage({ kind: 'stop' })
    setTimeout(() => ended || void w.terminate(), STOP_WAIT_MS).unref?.()
  }

  private message(m: GroupHealthFromWorker): void {
    if (m.kind === 'error') sources.fail('groupHealth', new Error(m.message))
    else if (m.kind === 'player') {
      this.playerSeen = m.bar !== null
      if (!this.bars.length) sources.ok('groupHealth', this.nobody())
    } else if (m.kind === 'bars') {
      this.bars = m.bars
      this.names = m.bars.map((b) => this.namesByTop.get(b.top) ?? '')
      const n = m.bars.length
      if (!n) {
        this.namesByTop.clear()
        sources.ok('groupHealth', this.nobody())
      } else {
        const read = this.names.filter(Boolean)
        sources.ok('groupHealth', `Watching ${n} group member${n === 1 ? '' : 's'}${read.length ? `: ${read.join(', ')}` : ''}.`)
        // Only rows without a name yet are read (an OCR run takes a third of a second).
        if (this.names.some((x) => !x)) void this.readNames(++this.rowsSeen)
      }
    } else if (m.kind === 'low') this.say(m)
  }

  /** What the sources page says with no rows to watch. */
  private nobody(): string {
    return this.playerSeen ? 'Watching your mana; no group members in the Group window.' : 'No group members in the Group window, or it is not on the screen.'
  }

  private say(low: LowHealth): void {
    const name = this.names[low.slot - 1] || `Group member ${low.slot}`
    const s = this.ctx.store.settings.get().groupHealth
    if (low.what === 'myMana') {
      this.ctx.engine.notify([
        { kind: 'speak', text: groupHealthPhrase(s.myManaSpeech, 'You', low.pct), interrupt: false },
        { kind: 'text', text: `Mana ${low.pct}%`, color: '#5b75ae', durationSec: 4 }
      ])
      this.ctx.engine.pushFeed('trigger', `Your mana at ${low.pct}%`)
      return
    }
    if (low.what === 'mana') {
      this.ctx.engine.notify([
        { kind: 'speak', text: groupHealthPhrase(s.manaSpeech, name, low.pct), interrupt: false },
        { kind: 'text', text: `${name} mana ${low.pct}%`, color: '#5b75ae', durationSec: 4 }
      ])
      this.ctx.engine.pushFeed('trigger', `Group mana: ${name} at ${low.pct}%`)
      return
    }
    this.ctx.engine.notify([
      // Cuts in only when the member is well under the line: above half of it, a queued recast cue is not dropped for it (LT-550).
      // Urgent either way: to the front of the queue, and never the phrase dropped when it is full (LT-719).
      { kind: 'speak', text: groupHealthPhrase(s.speech, name, low.pct), interrupt: low.pct <= s.belowPct / 2, urgent: true },
      { kind: 'text', text: `${name} ${low.pct}%`, color: '#ef5a4f', durationSec: 4 }
    ])
    this.ctx.engine.pushFeed('trigger', `Group health: ${name} at ${low.pct}%`)
    log.info(`Group health: ${name} at ${low.pct}% (row ${low.slot})`)
  }

  /** The members' names, read off the window once its rows are found: a picture of just the bars, through OCR. */
  private async readNames(seen: number): Promise<void> {
    const bars = this.bars
    const x = Math.min(...bars.map((b) => b.left)) - 2
    const y = Math.min(...bars.map((b) => b.top)) - 2
    const width = Math.max(...bars.map((b) => b.right)) + 3 - x
    const height = Math.max(...bars.map((b) => b.top)) + this.profile().hpInner + 4 - y
    const path = join(cacheDir(), `screen-group-${Date.now().toString(36)}.bmp`)
    try {
      const f = captureRect(x, y, width, height)
      await writeBmp(path, width, height, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength))
      const words = (await ocrImage(path, 4)).map((w) => ({ ...w, x: w.x + x, y: w.y + y }))
      if (seen !== this.rowsSeen) return
      const found = namesFromWords(bars, words, this.profile())
      this.names = bars.map((_, i) => found[i] || this.names[i] || '')
      bars.forEach((b, i) => this.names[i] && this.namesByTop.set(b.top, this.names[i]))
      const read = this.names.filter(Boolean)
      // A named member's own line follows their row now it is known.
      if (this.ctx.store.settings.get().groupHealth.watchNames.length) this.apply()
      sources.ok('groupHealth', `Watching ${bars.length} group member${bars.length === 1 ? '' : 's'}${read.length ? `: ${read.join(', ')}` : ''}.`)
    } catch (e) {
      log.warn('Could not read the group members’ names:', e)
    } finally {
      void discardScreens([path])
    }
  }

  async flush(): Promise<void> {
    this.stop()
  }
}
