import { foregroundWindowRect } from './win32'
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { app, screen } from 'electron'
import { groupHealthPhrase, namesFromWords, type GroupBar, type LowHealth } from '../core/groupHealth'
import { RE_GROUP_CHANGE } from '../core/combatLines'
import type { AppContext } from './context'
import type { AppFeature } from './appFeature'
import type { EngineFeature } from './engine'
import { captureRect } from './screenPixels'
import { discardScreens, ocrImage, writeBmp } from './ocr'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { log } from './log'
import { handle } from './ipc/handle'
// oxlint-disable-next-line import/default -- electron-vite's ?modulePath import: the build supplies the default export
import groupHealthWorkerPath from './groupHealthWorker?modulePath'

// Says when a group member's health drops to the line set on the Triggers page (25% unless changed).
// The log never prints anyone's health, so it is read off the screen: the worker finds JuiceboxUI's
// Group window and watches its bars; this side says who, by reading the names off the window with
// OCR whenever the rows change. It runs only while the game does and the switch is on.

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
  { kind: 'config'; on: boolean; areas: ScreenArea[]; belowPct: number; rearmPct: number; front: boolean } | { kind: 'search' } | { kind: 'ping' } | { kind: 'stop' }

export type GroupHealthFromWorker =
  { kind: 'bars'; bars: GroupBar[] } | ({ kind: 'low' } & LowHealth) | { kind: 'error'; message: string } | { kind: 'pong'; koffi: boolean; error?: string }

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

/** Back over the line by this much before a member is said again. */
const REARM_ABOVE = 10

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

  register(ctx: AppContext): void {
    this.ctx = ctx
    sources.add('groupHealth', {
      label: 'Group health',
      kind: 'screen',
      what: "Your group's health bars in JuiceboxUI's Group window, watched on the screen while the game runs, for the Triggers page's group health alert."
    })
    handle('groupHealth:selfTest', () => this.selfTest())
    const feature: EngineFeature = {
      id: 'groupHealth',
      line: (l) => {
        if (l.text.includes(' group') && RE_GROUP_CHANGE.test(l.text)) this.worker?.postMessage({ kind: 'search' } satisfies GroupHealthToWorker)
      },
      // Five times a second: cheap, and it starts or stops the watch as the game opens and closes.
      tick: () => this.apply(),
      reconfigure: () => this.apply()
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
    const on = s.enabled && this.ctx.watcher.gameRunning === true
    if (!on) {
      if (this.worker) this.stop()
      const why = s.enabled ? 'Waiting for the game.' : 'Off: switch it on on the Triggers page.'
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
    const key = `${s.belowPct}|${front}|${areas.map((a) => `${a.x},${a.y}`).join(';')}`
    if (this.worker && !force && key === this.lastConfig) return
    // A watch that ended badly is started again, but not more than twice a minute.
    if (!this.worker && Date.now() < this.retryAt) return
    this.lastConfig = key
    if (!this.worker) this.start()
    this.worker!.postMessage({ kind: 'config', on: true, areas, belowPct: s.belowPct, rearmPct: s.belowPct + REARM_ABOVE, front } satisfies GroupHealthToWorker)
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
    else if (m.kind === 'bars') {
      this.bars = m.bars
      this.names = m.bars.map((b) => this.namesByTop.get(b.top) ?? '')
      const n = m.bars.length
      if (!n) {
        this.namesByTop.clear()
        sources.ok('groupHealth', 'No group members in the Group window, or it is not on the screen.')
      } else {
        const read = this.names.filter(Boolean)
        sources.ok('groupHealth', `Watching ${n} group member${n === 1 ? '' : 's'}${read.length ? `: ${read.join(', ')}` : ''}.`)
        // Only rows without a name yet are read (an OCR run takes a third of a second).
        if (this.names.some((x) => !x)) void this.readNames(++this.rowsSeen)
      }
    } else if (m.kind === 'low') this.say(m)
  }

  private say(low: LowHealth): void {
    const name = this.names[low.slot - 1] || `Group member ${low.slot}`
    const s = this.ctx.store.settings.get().groupHealth
    this.ctx.engine.notify([
      // Cuts in only when the member is well under the line: above half of it, a queued recast cue is not dropped for it (LT-550).
      { kind: 'speak', text: groupHealthPhrase(s.speech, name, low.pct), interrupt: low.pct <= s.belowPct / 2 },
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
    const height = Math.max(...bars.map((b) => b.top)) + 20 - y
    const path = join(cacheDir(), `screen-group-${Date.now().toString(36)}.bmp`)
    try {
      const f = captureRect(x, y, width, height)
      await writeBmp(path, width, height, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength))
      const words = (await ocrImage(path, 4)).map((w) => ({ ...w, x: w.x + x, y: w.y + y }))
      if (seen !== this.rowsSeen) return
      const found = namesFromWords(bars, words)
      this.names = bars.map((_, i) => found[i] || this.names[i] || '')
      bars.forEach((b, i) => this.names[i] && this.namesByTop.set(b.top, this.names[i]))
      const read = this.names.filter(Boolean)
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
