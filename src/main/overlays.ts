import { BrowserWindow, screen, type WebContents } from 'electron'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../shared/types'
import type { AchievementTrack } from '../shared/tracking'
import type { PushChannel } from '../shared/ipc'
import { push } from './push'

type Kind = OverlayConfig['kind']

/** What the overlays are sent, stream by stream, each kept for a page that loads or shows later. */
interface Streams {
  timers: TimerView[]
  combat: CombatSnapshot | null
  achievements: AchievementTrack | null
}

/**
 * Which kind of overlay draws each stream, and the channel it goes on: a new kind with data of its
 * own is a row here, a field in Streams, and its region on the page.
 */
const STREAMS = {
  timers: { channel: 'overlay:timers', kind: 'timers' },
  combat: { channel: 'overlay:combat', kind: 'meter' },
  achievements: { channel: 'overlay:achievements', kind: 'achievements' }
} as const satisfies Record<keyof Streams, { channel: PushChannel; kind: Kind }>

/** The alerts overlay has a page of its own, without React or the meter; the rest share one. */
type OverlayPage = 'overlay' | 'alerts' | 'overlays'
const pageFor = (kind: Kind): OverlayPage => (kind === 'alerts' ? 'alerts' : 'overlay')

export interface OverlayHost {
  load: (win: BrowserWindow, page: OverlayPage, query: Record<string, string>) => void
  preload: string
  onBoundsChanged: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void
}

/**
 * Transparent, click-through, never-focused, always-on-top windows over the game.
 *
 * While playing, the overlays on one monitor share one window (a host), sized to just cover them,
 * each overlay a region of its page: one renderer instead of one per overlay (some 100 MB each).
 * Arranging gives each overlay a window of its own again, so it can be dragged and resized by its
 * edges, and from one monitor to another; the hosts come back when arranging ends.
 *
 * - Click-through (ignore mouse events), so a bar over the game never eats a click in combat.
 * - Never focusable: EverQuest stops taking keyboard input the moment it loses focus.
 * - Kept out of the taskbar and Alt-Tab.
 * - Topmost is re-asserted every two seconds while shown: a borderless-windowed game re-asserts its
 *   own z-order and can end up above overlays that were topmost when created.
 * - Hidden (the game in the background), they get no pushes and their pages are throttled; the
 *   newest timers and meter reach them when they show again.
 * - Arrange mode lifts all of that so the windows can be dragged and resized.
 * - A meter overlay still sees the mouse move over it (Windows forwards the moves while the window
 *   ignores clicks), so its page can ask for the mouse back while the pointer is on its controls.
 */
export class OverlayManager {
  private readonly windows = new Map<string, BrowserWindow>()
  /** Play mode: one window per display that has overlays, by display id. */
  private readonly hosts = new Map<number, { win: BrowserWindow; ids: string[]; origin: { x: number; y: number } }>()
  private readonly pages = new Map<string, OverlayPage>()
  private configs: OverlayConfig[] = []
  private arranging = false
  private topmostTimer: NodeJS.Timeout | null = null
  private readonly last: Streams = { timers: [], combat: null, achievements: null }
  private shown = true
  private displayTimer: NodeJS.Timeout | null = null
  private followingDisplays = false

  constructor(private readonly host: OverlayHost) {}

  /**
   * Places the overlays again when a monitor is plugged in or out, or its resolution or scaling
   * changes: each host covers its overlays on one display, worked out when it was made. Once the app
   * is ready (`screen` is not usable before); changes a moment apart are taken as one.
   */
  followDisplays(): void {
    if (this.followingDisplays) return
    this.followingDisplays = true
    const changed = () => {
      if (this.displayTimer) clearTimeout(this.displayTimer)
      this.displayTimer = setTimeout(() => {
        this.displayTimer = null
        // Arranging, each overlay has its own window where the player is dragging it: left be.
        if (this.arranging) return
        this.closeHosts()
        this.apply(this.configs)
      }, 750)
    }
    screen.on('display-added', changed)
    screen.on('display-removed', changed)
    screen.on('display-metrics-changed', changed)
  }

  get isArranging(): boolean {
    return this.arranging
  }

  apply(configs: OverlayConfig[]): void {
    this.configs = configs
    if (!this.arranging) {
      this.closeWindows()
      this.applyHosts()
      this.keepOnTop()
      return
    }
    for (const [id, win] of this.windows) {
      // Gone, hidden, or now another kind, whose page is another.
      const c = configs.find((x) => x.id === id)
      if (!c?.visible || pageFor(c.kind) !== this.pages.get(id)) {
        win.destroy()
        this.windows.delete(id)
        this.pages.delete(id)
      }
    }
    for (const c of configs) {
      if (!c.visible) continue
      const win = this.windows.get(c.id) ?? this.create(c)
      if (!this.arranging) win.setBounds(onScreen(c))
      // The alerts' text fades as a whole; the others fade their panel alone, on the page (opacityStyle).
      win.setOpacity(c.kind === 'alerts' ? c.opacity : 1)
      push(win.webContents, 'overlay:config', { config: c, arranging: this.arranging })
    }
    this.keepOnTop()
  }

  private get allWindows(): BrowserWindow[] {
    return [...this.windows.values(), ...[...this.hosts.values()].map((h) => h.win)].filter((w) => !w.isDestroyed())
  }

  /** Topmost is asserted again every two seconds while any overlay window is up. */
  private keepOnTop(): void {
    const any = this.windows.size > 0 || this.hosts.size > 0
    if (!any && this.topmostTimer) {
      clearInterval(this.topmostTimer)
      this.topmostTimer = null
    } else if (any && !this.topmostTimer) {
      this.topmostTimer = setInterval(() => {
        if (!this.shown) return
        for (const w of this.allWindows) w.setAlwaysOnTop(true, 'screen-saver')
      }, 2000)
    }
  }

  private closeWindows(): void {
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.destroy()
    this.windows.clear()
    this.pages.clear()
  }

  private closeHosts(): void {
    for (const h of this.hosts.values()) if (!h.win.isDestroyed()) h.win.destroy()
    this.hosts.clear()
  }

  /** The overlays grouped by the display each sits on, a host window per group over just their area. */
  private applyHosts(): void {
    const groups = new Map<number, OverlayConfig[]>()
    for (const c of this.configs) {
      if (!c.visible) continue
      const d = screen.getDisplayMatching(onScreen(c))
      groups.set(d.id, [...(groups.get(d.id) ?? []), c])
    }
    for (const [id, h] of this.hosts) {
      if (!groups.has(id)) {
        if (!h.win.isDestroyed()) h.win.destroy()
        this.hosts.delete(id)
      }
    }
    for (const [displayId, list] of groups) {
      const rects = list.map(onScreen)
      const x = Math.min(...rects.map((r) => r.x))
      const y = Math.min(...rects.map((r) => r.y))
      const bounds = { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
      let h = this.hosts.get(displayId)
      if (!h || h.win.isDestroyed()) {
        h = { win: this.createHost(bounds, displayId), ids: [], origin: { x, y } }
        this.hosts.set(displayId, h)
      }
      h.win.setBounds(bounds)
      h.ids = list.map((c) => c.id)
      h.origin = { x, y }
      push(h.win.webContents, 'overlay:host', { configs: list, origin: h.origin })
    }
  }

  private createHost(bounds: { x: number; y: number; width: number; height: number }, displayId: number): BrowserWindow {
    const win = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.host.preload, backgroundThrottling: false, sandbox: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    // Clicks go through to the game; moves still come, so a meter's header can ask for the mouse.
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setMenu(null)
    win.webContents.on('did-finish-load', () => {
      const h = this.hosts.get(displayId)
      if (!h) return
      push(win.webContents, 'overlay:host', { configs: this.configs.filter((c) => h.ids.includes(c.id)), origin: h.origin })
      this.catchUp(win.webContents, this.kindsOf(win))
      if (this.shown) win.showInactive()
      else win.webContents.setBackgroundThrottling(true)
    })
    this.host.load(win, 'overlays', { display: String(displayId) })
    return win
  }

  /** What a host page draws, asked for as it starts: a push sent while it loads may land before it listens. */
  hostState(displayId: number) {
    const h = this.hosts.get(displayId)
    if (!h) return null
    return {
      configs: this.configs.filter((c) => h.ids.includes(c.id)),
      origin: h.origin,
      timers: this.hostHas(h.win, 'timers') ? this.last.timers : [],
      combat: this.hostHas(h.win, 'meter') ? this.last.combat : null,
      achievements: this.hostHas(h.win, 'achievements') ? this.last.achievements : null
    }
  }

  private hostOf(id: string): BrowserWindow | null {
    for (const h of this.hosts.values()) if (h.ids.includes(id) && !h.win.isDestroyed()) return h.win
    return null
  }

  private hostHas(win: BrowserWindow, kind: Kind): boolean {
    return this.kindsOf(win).has(kind)
  }

  /** The kinds a window draws: a host's overlays', or the one overlay an arranging window is. */
  private kindsOf(win: BrowserWindow): Set<Kind> {
    for (const h of this.hosts.values()) if (h.win === win) return new Set(this.configs.filter((c) => h.ids.includes(c.id)).map((c) => c.kind))
    for (const [id, w] of this.windows) if (w === win) return new Set(this.configs.filter((c) => c.id === id).map((c) => c.kind))
    return new Set()
  }

  /** The latest of every stream a page draws: as it loads, and as it shows again. */
  private catchUp(wc: WebContents, kinds: Set<Kind>): void {
    for (const key of Object.keys(STREAMS) as (keyof Streams)[]) {
      const { channel, kind } = STREAMS[key]
      const value = this.last[key]
      if (kinds.has(kind) && value !== null) push(wc, channel, value as never)
    }
  }

  /** Every shown page that draws `kind`: hosts with such an overlay, and such an overlay's own window while arranging. */
  private toPages(kind: Kind, send: (wc: WebContents) => void): void {
    if (!this.shown) return
    for (const h of this.hosts.values()) if (!h.win.isDestroyed() && this.hostHas(h.win, kind)) send(h.win.webContents)
    for (const [id, w] of this.windows) if (!w.isDestroyed() && this.configs.find((c) => c.id === id)?.kind === kind) send(w.webContents)
  }

  /** A stream's newest: kept, and sent to the pages that draw it. */
  private send<K extends keyof Streams>(key: K, value: Streams[K]): void {
    this.last[key] = value
    const { channel, kind } = STREAMS[key]
    this.toPages(kind, (wc) => push(wc, channel, value as never))
  }

  private create(c: OverlayConfig): BrowserWindow {
    const win = new BrowserWindow({
      ...onScreen(c),
      transparent: true,
      frame: false,
      resizable: false,
      movable: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.host.preload, backgroundThrottling: false, sandbox: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    ignoreMouse(win, c.kind, true)
    win.setMenu(null)
    const report = () => {
      if (win.isDestroyed()) return
      const b = win.getBounds()
      // Kept here too, so the host drawn when arranging ends puts the overlay where it was left.
      this.configs = this.configs.map((x) => (x.id === c.id ? { ...x, x: b.x, y: b.y, width: b.width, height: b.height } : x))
      this.host.onBoundsChanged(c.id, b)
    }
    win.on('moved', report)
    win.on('resized', report)
    win.webContents.on('did-finish-load', () => {
      const cfg = this.configs.find((x) => x.id === c.id) ?? c
      push(win.webContents, 'overlay:config', { config: cfg, arranging: this.arranging })
      this.catchUp(win.webContents, new Set([cfg.kind]))
      if (this.shown) win.showInactive()
      else win.webContents.setBackgroundThrottling(true)
    })
    const page = pageFor(c.kind)
    this.host.load(win, page, { id: c.id })
    this.windows.set(c.id, win)
    this.pages.set(c.id, page)
    return win
  }

  /** The overlays are up (not hidden with the game in the background, or gone). */
  get isShown(): boolean {
    return this.shown
  }

  /** Puts every overlay window back on top at once: the game came to the front, or they just showed. */
  reassertTop(): void {
    if (!this.shown) return
    for (const w of this.allWindows) w.setAlwaysOnTop(true, 'screen-saver')
  }

  /**
   * Shows or hides every overlay without closing it. A hidden page is throttled (its timers slow, its
   * clock stops) and sent nothing; it is brought up to date as it shows again.
   */
  setShown(show: boolean): void {
    if (show === this.shown) return
    this.shown = show
    for (const h of this.hosts.values()) {
      const w = h.win
      if (w.isDestroyed()) continue
      if (show) {
        w.webContents.setBackgroundThrottling(false)
        this.catchUp(w.webContents, this.kindsOf(w))
        w.showInactive()
        w.setAlwaysOnTop(true, 'screen-saver')
      } else {
        w.hide()
        w.webContents.setBackgroundThrottling(true)
      }
    }
    for (const w of this.windows.values()) {
      if (w.isDestroyed()) continue
      if (show) {
        w.webContents.setBackgroundThrottling(false)
        this.catchUp(w.webContents, this.kindsOf(w))
        w.showInactive()
        w.setAlwaysOnTop(true, 'screen-saver')
      } else {
        w.hide()
        w.webContents.setBackgroundThrottling(true)
      }
    }
  }

  setArranging(on: boolean): void {
    this.arranging = on
    // Arranging swaps the hosts for a window per overlay, and back.
    if (on) this.closeHosts()
    this.apply(this.configs)
    for (const [id, win] of this.windows) {
      const cfg = this.configs.find((c) => c.id === id)
      ignoreMouse(win, cfg?.kind ?? 'timers', !on)
      win.setFocusable(on)
      win.setResizable(on)
      if (cfg) push(win.webContents, 'overlay:config', { config: cfg, arranging: on })
    }
  }

  /** An overlay whose page crashed is closed and made afresh; false when `wc` is not an overlay's. */
  recover(wc: Electron.WebContents): boolean {
    for (const [displayId, h] of this.hosts) {
      if (h.win.isDestroyed() || h.win.webContents !== wc) continue
      h.win.destroy()
      this.hosts.delete(displayId)
      this.apply(this.configs)
      return true
    }
    for (const [id, win] of this.windows) {
      if (win.isDestroyed() || win.webContents !== wc) continue
      win.destroy()
      this.windows.delete(id)
      this.apply(this.configs)
      return true
    }
    return false
  }

  /** A meter overlay's page asks for the mouse while the pointer is on its controls, and gives it back after. */
  setMouse(id: string, interactive: boolean): void {
    if (this.arranging) return
    const host = this.hostOf(id)
    if (host) {
      if (this.configs.find((c) => c.id === id)?.kind === 'meter') ignoreMouse(host, 'meter', !interactive)
      return
    }
    const win = this.windows.get(id)
    const cfg = this.configs.find((c) => c.id === id)
    if (win && !win.isDestroyed() && cfg?.kind === 'meter') ignoreMouse(win, 'meter', !interactive)
  }

  combat(snapshot: CombatSnapshot): void {
    this.send('combat', snapshot)
  }

  /** The faction plan's step and the Slayer counts, for the achievements overlays. */
  achievements(track: AchievementTrack | null): void {
    this.send('achievements', track)
  }

  /** Only to pages that draw timers: an alerts-only or meter-only host has no use for five a second. */
  timers(views: TimerView[]): void {
    this.send('timers', views)
  }

  /** An alert is for now: not kept, so one raised while the overlays are hidden is not shown later. */
  alert(payload: { text: string; color: string; durationSec: number }): void {
    this.toPages('alerts', (wc) => push(wc, 'overlay:alert', payload))
  }

  destroy(): void {
    if (this.topmostTimer) clearInterval(this.topmostTimer)
    this.topmostTimer = null
    if (this.displayTimer) clearTimeout(this.displayTimer)
    this.displayTimer = null
    this.closeWindows()
    this.closeHosts()
  }
}

/** Click-through, with mouse moves still forwarded to a meter so its page knows when the pointer is on it. */
function ignoreMouse(win: BrowserWindow, kind: Kind, ignore: boolean): void {
  if (ignore && kind === 'meter') win.setIgnoreMouseEvents(true, { forward: true })
  else win.setIgnoreMouseEvents(ignore)
}

/** Saved positions can point at a monitor that is no longer attached; pull those back onto one that is. */
function onScreen(c: OverlayConfig) {
  const rect = { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width), height: Math.round(c.height) }
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return rect.x < a.x + a.width - 40 && rect.x + rect.width > a.x + 40 && rect.y < a.y + a.height - 40 && rect.y + rect.height > a.y
  })
  if (visible) return rect
  const a = screen.getPrimaryDisplay().workArea
  return { ...rect, x: a.x + Math.max(0, Math.min(rect.x - a.x, a.width - rect.width)), y: a.y + 100 }
}
