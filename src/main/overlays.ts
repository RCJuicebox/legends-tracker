import { BrowserWindow, screen } from 'electron'
import type { OverlayConfig, TimerView } from '../shared/types'

export interface OverlayHost {
  load: (win: BrowserWindow, page: 'overlay', query: Record<string, string>) => void
  preload: string
  onBoundsChanged: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void
}

/**
 * Transparent, click-through, never-focused, always-on-top windows over the game.
 *
 * - Click-through (ignore mouse events), so a bar over the game never eats a click in combat.
 * - Never focusable: EverQuest stops taking keyboard input the moment it loses focus.
 * - Kept out of the taskbar and Alt-Tab.
 * - Topmost is re-asserted every two seconds: a borderless-windowed game re-asserts its own
 *   z-order and can end up above overlays that were topmost when created.
 * - Arrange mode lifts all of that so the windows can be dragged and resized.
 */
export class OverlayManager {
  private readonly windows = new Map<string, BrowserWindow>()
  private configs: OverlayConfig[] = []
  private arranging = false
  private topmostTimer: NodeJS.Timeout | null = null
  private lastTimers: TimerView[] = []
  private shown = true

  constructor(private readonly host: OverlayHost) {}

  get isArranging(): boolean {
    return this.arranging
  }

  apply(configs: OverlayConfig[]): void {
    this.configs = configs
    for (const [id, win] of this.windows) {
      if (!configs.some((c) => c.id === id && c.visible)) {
        win.destroy()
        this.windows.delete(id)
      }
    }
    for (const c of configs) {
      if (!c.visible) continue
      const win = this.windows.get(c.id) ?? this.create(c)
      if (!this.arranging) win.setBounds(onScreen(c))
      win.setOpacity(c.opacity)
      win.webContents.send('overlay:config', { config: c, arranging: this.arranging })
    }
    if (!this.topmostTimer) {
      this.topmostTimer = setInterval(() => {
        for (const w of this.windows.values()) if (!w.isDestroyed()) w.setAlwaysOnTop(true, 'screen-saver')
      }, 2000)
    }
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
    win.setIgnoreMouseEvents(true)
    win.setMenu(null)
    const report = () => {
      if (!win.isDestroyed()) this.host.onBoundsChanged(c.id, win.getBounds())
    }
    win.on('moved', report)
    win.on('resized', report)
    win.webContents.on('did-finish-load', () => {
      const cfg = this.configs.find((x) => x.id === c.id) ?? c
      win.webContents.send('overlay:config', { config: cfg, arranging: this.arranging })
      win.webContents.send('overlay:timers', this.lastTimers)
      if (this.shown) win.showInactive()
    })
    this.host.load(win, 'overlay', { id: c.id })
    this.windows.set(c.id, win)
    return win
  }

  /** Shows or hides every overlay without closing it, so bars stay current while hidden. */
  setShown(show: boolean): void {
    if (show === this.shown) return
    this.shown = show
    for (const w of this.windows.values()) {
      if (w.isDestroyed()) continue
      if (show) {
        w.showInactive()
        w.setAlwaysOnTop(true, 'screen-saver')
      } else w.hide()
    }
  }

  setArranging(on: boolean): void {
    this.arranging = on
    for (const [id, win] of this.windows) {
      win.setIgnoreMouseEvents(!on)
      win.setFocusable(on)
      win.setResizable(on)
      const cfg = this.configs.find((c) => c.id === id)
      if (cfg) win.webContents.send('overlay:config', { config: cfg, arranging: on })
    }
  }

  timers(views: TimerView[]): void {
    this.lastTimers = views
    for (const w of this.windows.values()) if (!w.isDestroyed()) w.webContents.send('overlay:timers', views)
  }

  alert(payload: { text: string; color: string; durationSec: number }): void {
    for (const [id, w] of this.windows) {
      const cfg = this.configs.find((c) => c.id === id)
      if (cfg?.kind === 'alerts' && !w.isDestroyed()) w.webContents.send('overlay:alert', payload)
    }
  }

  destroy(): void {
    if (this.topmostTimer) clearInterval(this.topmostTimer)
    for (const w of this.windows.values()) w.destroy()
    this.windows.clear()
  }
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
