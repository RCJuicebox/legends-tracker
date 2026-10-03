import { BrowserWindow, screen, type WebContents } from 'electron'
import type { CombatSnapshot, OverlayConfig, TimerView } from '../shared/types'
import { closedKey } from '../shared/combat'
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

/** An overlay alone in its window (arranging), or the overlays of one monitor (playing). */
type OverlayPage = 'overlay' | 'overlays'

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
 * - Topmost is re-asserted every two seconds while shown and the game is in front: a borderless-windowed game re-asserts its
 *   own z-order and can end up above overlays that were topmost when created.
 * - Hidden (the game in the background), they get no pushes and their pages are throttled; the
 *   newest timers and meter reach them when they show again.
 * - Arrange mode lifts all of that so the windows can be dragged and resized.
 * - A meter overlay still sees the mouse move over it, so its page can ask for the mouse back while
 *   the pointer is on its controls. Forwarding the moves installs a low-level mouse hook that every
 *   mouse event on the system then passes through this process for, so it is on only while the
 *   pointer is over a meter: the pointer is looked at ten times a second instead (LT-341).
 */
export class OverlayManager {
  private readonly windows = new Map<string, BrowserWindow>()
  /** Play mode: one window per display that has overlays, by display id. */
  private readonly hosts = new Map<number, { win: BrowserWindow; ids: string[]; origin: { x: number; y: number }; sent?: string }>()
  private configs: OverlayConfig[] = []
  private arranging = false
  private topmostTimer: NodeJS.Timeout | null = null
  private readonly last: Streams = { timers: [], combat: null, achievements: null }
  private shown = true
  private displayTimer: NodeJS.Timeout | null = null
  private followingDisplays = false
  /** A monitor changed while the overlays were hidden: they are placed again as they show. */
  private displaysChanged = false
  /** Whether the game is the window in front: topmost is fought for only then (LT-358). */
  private gameInFront = true
  /** Alerts of the last few seconds, for a host that loads or shows just after them (LT-362). */
  private recentAlerts: { text: string; color: string; durationSec: number; at: number }[] = []
  /** Ten times a second while a meter is up: is the pointer over it. */
  private cursorTimer: NodeJS.Timeout | null = null
  /** How each host takes the mouse now, so it is changed only when it changes. */
  private readonly mouseState = new WeakMap<BrowserWindow, MouseState>()
  /** Meters whose page has asked for the mouse (the pointer on the header, or unlocked and on it). */
  private readonly wantMouse = new Set<string>()

  constructor(private readonly host: OverlayHost) {}

  /**
   * Places the overlays again when a monitor is plugged in or out, or its resolution or scaling
   * changes: each host covers its overlays on one display, worked out when it was made. Once the app
   * is ready (`screen` is not usable before); changes a moment apart are taken as one. The hosts are
   * moved, not made again, so the overlays do not blank; a change of the work area alone (the taskbar)
   * moves nothing, and a change while they are hidden waits until they show (LT-349).
   */
  followDisplays(): void {
    if (this.followingDisplays) return
    this.followingDisplays = true
    const changed = (_e?: unknown, _d?: unknown, metrics?: string[]) => {
      if (metrics?.length && metrics.every((m) => m === 'workArea')) return
      if (this.displayTimer) clearTimeout(this.displayTimer)
      this.displayTimer = setTimeout(() => {
        this.displayTimer = null
        // Arranging, each overlay has its own window where the player is dragging it: left be.
        if (this.arranging) return
        if (!this.shown) {
          this.displaysChanged = true
          return
        }
        this.apply(this.configs)
      }, 750)
    }
    screen.on('display-added', changed)
    screen.on('display-removed', changed)
    screen.on('display-metrics-changed', changed)
  }

  /** Which window is in front: the game, or another (this app's own included). */
  setGameInFront(inFront: boolean): void {
    this.gameInFront = inFront
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
      this.followCursor()
      return
    }
    for (const [id, win] of this.windows) {
      // Gone or hidden.
      const c = configs.find((x) => x.id === id)
      if (!c?.visible) {
        win.destroy()
        this.windows.delete(id)
      }
    }
    for (const c of configs) {
      if (!c.visible) continue
      const win = this.windows.get(c.id) ?? this.create(c)
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
      // Only while the game is in front: above Task Manager or a chat window the player brought up,
      // the overlays have no business fighting for the top (LT-358).
      this.topmostTimer = setInterval(() => {
        if (!this.shown || !this.gameInFront) return
        for (const w of this.allWindows) w.setAlwaysOnTop(true, 'screen-saver')
      }, 2000)
    }
  }

  private closeWindows(): void {
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.destroy()
    this.windows.clear()
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
      // A meter header click changes one overlay's options: only its host is told, and no window is
      // moved that has not moved (LT-361).
      const b = h.win.getBounds()
      if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) h.win.setBounds(bounds)
      h.ids = list.map((c) => c.id)
      h.origin = { x, y }
      const sent = JSON.stringify([list, h.origin])
      if (sent !== h.sent) {
        h.sent = sent
        push(h.win.webContents, 'overlay:host', { configs: list, origin: h.origin })
      }
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
    // Clicks go through to the game; moves come only while the pointer is over a meter (followCursor).
    this.setWinMouse(win, 'through')
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

  private hostHas(win: BrowserWindow, kind: Kind): boolean {
    return this.kindsOf(win).has(kind)
  }

  /** The kinds a window draws: a host's overlays', or the one overlay an arranging window is. */
  private kindsOf(win: BrowserWindow): Set<Kind> {
    for (const h of this.hosts.values()) if (h.win === win) return new Set(this.configs.filter((c) => h.ids.includes(c.id)).map((c) => c.kind))
    for (const [id, w] of this.windows) if (w === win) return new Set(this.configs.filter((c) => c.id === id).map((c) => c.kind))
    return new Set()
  }

  /** The latest of every stream a page draws, and alerts still up: as it loads, and as it shows again. */
  private catchUp(wc: WebContents, kinds: Set<Kind>): void {
    for (const key of Object.keys(STREAMS) as (keyof Streams)[]) {
      const { channel, kind } = STREAMS[key]
      const value = this.last[key]
      if (!kinds.has(kind) || value === null) continue
      // A page that loads or shows again gets the whole meter, closed fights and all.
      if (key === 'combat') this.closedSent.delete(wc)
      if (key === 'combat') this.pushCombat(wc, value as CombatSnapshot)
      else push(wc, channel, value as never)
    }
    if (kinds.has('alerts')) for (const a of this.liveAlerts()) push(wc, 'overlay:alert', a)
  }

  /** The alerts raised in the last few seconds that are still up. */
  private liveAlerts() {
    const now = Date.now()
    this.recentAlerts = this.recentAlerts.filter((a) => now - a.at < ALERT_KEEP_MS && a.at + a.durationSec * 1000 > now)
    return this.recentAlerts
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

  /** Which closed fights and sessions each meter page has, by closedKey. */
  private readonly closedSent = new WeakMap<WebContents, string>()

  /** A meter snapshot to one page: whole when the page lacks the closed ones, else the open ones alone. */
  private pushCombat(wc: WebContents, snap: CombatSnapshot): void {
    const key = closedKey(snap)
    if (this.closedSent.get(wc) === key) {
      push(wc, 'overlay:combat', { ...snap, fights: snap.fights.filter((s) => s.open), sessions: snap.sessions.filter((s) => s.open), openOnly: true })
      return
    }
    this.closedSent.set(wc, key)
    push(wc, 'overlay:combat', snap)
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
    // An overlay has a window of its own only while arranging, when it takes the mouse to be dragged;
    // never so small it cannot be found and grabbed again (LT-351).
    win.setIgnoreMouseEvents(!this.arranging)
    win.setMinimumSize(MIN_ARRANGE.width, MIN_ARRANGE.height)
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
    this.host.load(win, 'overlay', { id: c.id })
    this.windows.set(c.id, win)
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
    if (show && this.displaysChanged) {
      this.displaysChanged = false
      this.apply(this.configs)
    }
    this.followCursor()
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
    this.followCursor()
    for (const [id, win] of this.windows) {
      const cfg = this.configs.find((c) => c.id === id)
      win.setIgnoreMouseEvents(!on)
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
    if (this.arranging || this.configs.find((c) => c.id === id)?.kind !== 'meter') return
    if (interactive) this.wantMouse.add(id)
    else this.wantMouse.delete(id)
    this.lookAtCursor()
  }

  /** Looks at the pointer ten times a second while a meter is up and the overlays are shown; else not at all. */
  private followCursor(): void {
    const want = this.shown && !this.arranging && this.configs.some((c) => c.visible && c.kind === 'meter')
    if (want && !this.cursorTimer) this.cursorTimer = setInterval(() => this.lookAtCursor(), CURSOR_MS)
    else if (!want && this.cursorTimer) {
      clearInterval(this.cursorTimer)
      this.cursorTimer = null
      for (const h of this.hosts.values()) if (!h.win.isDestroyed()) this.setWinMouse(h.win, 'through')
    }
  }

  /**
   * Each host with a meter: the mouse while its page asks, the pointer's moves while the pointer is
   * over (or just beside) a meter, so the page sees it come onto the header; otherwise plain
   * click-through, with no hook.
   */
  private lookAtCursor(): void {
    if (this.arranging) return
    const p = screen.getCursorScreenPoint()
    for (const h of this.hosts.values()) {
      if (h.win.isDestroyed()) continue
      const meters = this.configs.filter((c) => c.kind === 'meter' && h.ids.includes(c.id))
      if (!meters.length) continue
      const near = meters.some((c) => {
        const r = onScreen(c)
        return p.x >= r.x - NEAR_PX && p.x < r.x + r.width + NEAR_PX && p.y >= r.y - NEAR_PX && p.y < r.y + r.height + NEAR_PX
      })
      this.setWinMouse(h.win, meters.some((c) => this.wantMouse.has(c.id)) ? 'mouse' : near ? 'moves' : 'through')
    }
  }

  private setWinMouse(win: BrowserWindow, state: MouseState): void {
    if (this.mouseState.get(win) === state) return
    this.mouseState.set(win, state)
    if (state === 'mouse') win.setIgnoreMouseEvents(false)
    else if (state === 'moves') win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(true)
  }

  combat(snapshot: CombatSnapshot): void {
    this.last.combat = snapshot
    this.toPages('meter', (wc) => this.pushCombat(wc, snapshot))
  }

  /** The faction plan's step and the Slayer counts, for the achievements overlays. */
  achievements(track: AchievementTrack | null): void {
    this.send('achievements', track)
  }

  /** Only to pages that draw timers: an alerts-only or meter-only host has no use for five a second. */
  timers(views: TimerView[]): void {
    this.send('timers', views)
  }

  /**
   * An alert is for now: one raised while the overlays are hidden is not shown later. The last few
   * seconds' are kept for a host that is still loading (just started, or placed again).
   */
  alert(payload: { text: string; color: string; durationSec: number }): void {
    const a = { ...payload, at: Date.now() }
    this.recentAlerts.push(a)
    if (this.recentAlerts.length > 20) this.recentAlerts.shift()
    this.toPages('alerts', (wc) => push(wc, 'overlay:alert', a))
  }

  destroy(): void {
    if (this.topmostTimer) clearInterval(this.topmostTimer)
    this.topmostTimer = null
    if (this.cursorTimer) clearInterval(this.cursorTimer)
    this.cursorTimer = null
    if (this.displayTimer) clearTimeout(this.displayTimer)
    this.displayTimer = null
    this.closeWindows()
    this.closeHosts()
  }
}

/** A host's hold on the mouse: none (`through`), the pointer's moves only, or the mouse. */
type MouseState = 'through' | 'moves' | 'mouse'
/** The smallest an overlay can be dragged to while arranging. */
const MIN_ARRANGE = { width: 120, height: 48 }
/** How long an alert is kept for a host that loads after it. */
const ALERT_KEEP_MS = 5000
/** How often the pointer is looked at while a meter is up, and how near a meter it counts as on it. */
const CURSOR_MS = 100
const NEAR_PX = 12

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
