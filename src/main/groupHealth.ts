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

export type GroupHealthToWorker = { kind: 'config'; on: boolean; areas: ScreenArea[]; belowPct: number; rearmPct: number } | { kind: 'search' }

export type GroupHealthFromWorker = { kind: 'bars'; bars: GroupBar[] } | ({ kind: 'low' } & LowHealth) | { kind: 'error'; message: string }

/** Back over the line by this much before a member is said again. */
const REARM_ABOVE = 10

export class GroupHealth implements AppFeature {
  readonly id = 'groupHealth'
  private worker: Worker | null = null
  private ctx!: AppContext
  private bars: GroupBar[] = []
  private names: string[] = []
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
    const key = `${s.belowPct}`
    if (this.worker && !force && key === this.lastConfig) return
    // A watch that ended badly is started again, but not more than twice a minute.
    if (!this.worker && Date.now() < this.retryAt) return
    this.lastConfig = key
    if (!this.worker) this.start()
    const areas = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds))
    this.worker!.postMessage({ kind: 'config', on: true, areas, belowPct: s.belowPct, rearmPct: s.belowPct + REARM_ABOVE } satisfies GroupHealthToWorker)
  }

  private start(): void {
    const w = new Worker(groupHealthWorkerPath)
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

  private stop(): void {
    const w = this.worker
    this.worker = null
    this.bars = []
    void w?.terminate()
  }

  private message(m: GroupHealthFromWorker): void {
    if (m.kind === 'error') sources.fail('groupHealth', new Error(m.message))
    else if (m.kind === 'bars') {
      this.bars = m.bars
      this.names = []
      const n = m.bars.length
      if (!n) sources.ok('groupHealth', 'No group members in the Group window, or it is not on the screen.')
      else {
        sources.ok('groupHealth', `Watching ${n} group member${n === 1 ? '' : 's'}.`)
        void this.readNames(++this.rowsSeen)
      }
    } else if (m.kind === 'low') this.say(m)
  }

  private say(low: LowHealth): void {
    const name = this.names[low.slot - 1] || `Group member ${low.slot}`
    const s = this.ctx.store.settings.get().groupHealth
    this.ctx.engine.notify([
      { kind: 'speak', text: groupHealthPhrase(s.speech, name, low.pct), interrupt: true },
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
      this.names = namesFromWords(bars, words)
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
