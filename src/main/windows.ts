import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, Notification, screen, Tray, type Rectangle } from 'electron'
import { join } from 'node:path'
import { JsonFile, readJsonFile } from './storeCore'
import { push } from './push'
import { log, logDir } from './log'
import type { AudioSettings } from '../shared/types'
import type { AudioCommand, PushChannel, Pushes } from '../shared/ipc'

// The main window, the hidden audio window and the tray icon: creating them, remembering where the
// main window was, and sending them things.

export type Page = 'index' | 'overlay' | 'overlays' | 'audio'

/**
 * Loads one of the app's pages into a window: from the dev server in development, the built file otherwise.
 * A page that cannot be loaded (a damaged install) is logged; the main window's says so on screen, since
 * without it nothing would ever appear.
 */
export function loadPage(win: BrowserWindow, page: Page, query: Record<string, string> = {}): void {
  win.webContents.on('did-fail-load', (_e, code, description, url, mainFrame) => {
    // -3 is a load cut short by another (a reload), not a failure.
    if (!mainFrame || code === -3) return
    log.error(`The ${page} page could not be loaded (${description}, ${code}): ${url}`)
    if (page !== 'index') return
    void dialog.showMessageBox({
      type: 'error',
      title: 'Legends Tracker',
      message: 'Legends Tracker could not open its window',
      detail: `${description} (${code}) loading ${url}.\n\nReinstalling it should mend this. The details are in ${join(logDir(), 'main.log')}.`
    })
  })
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const qs = new URLSearchParams(query).toString()
    void win.loadURL(`${dev}/${page}.html${qs ? `?${qs}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', `${page}.html`), { query })
  }
}

interface WindowPlace {
  bounds: Rectangle
  maximized: boolean
  /** Told once that closing the window leaves the app in the tray. */
  trayTold?: boolean
  /** Written just before a restart into an update nobody asked for: when, and whether the window was in use. */
  relaunch?: { at: number; show: boolean }
}

/**
 * window.json as read back: a place only with four finite numbers of a sane size, the rest only of
 * its kind. A width that is not a number threw in new BrowserWindow, and the app could not start
 * until the file was deleted (LT-433).
 */
function windowPlace(v: unknown): WindowPlace | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const b = o.bounds as Record<string, unknown> | undefined
  const n = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
  const bounds = b && n(b.x, -100_000, 100_000) && n(b.y, -100_000, 100_000) && n(b.width, 200, 20_000) && n(b.height, 150, 20_000) ? (b as unknown as Rectangle) : null
  if (!bounds) return null
  const r = o.relaunch as Record<string, unknown> | undefined
  return {
    bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
    maximized: o.maximized === true,
    ...(o.trayTold === true ? { trayTold: true } : {}),
    ...(r && typeof r.at === 'number' && typeof r.show === 'boolean' ? { relaunch: { at: r.at, show: r.show } } : {})
  }
}

/** A relaunch note older than this is from a restart that never came back, and is ignored. */
const RELAUNCH_MS = 3 * 60 * 1000

export interface TrayActions {
  arranging: () => boolean
  setArranging: (on: boolean) => void
  muted: () => boolean
  toggleMute: () => void
  /** The version a downloaded update would install, or '' when there is none. */
  updateReady: () => string
  installUpdate: () => void
}

/** As many feed lines as the Live page keeps. */
const HELD_FEED_MAX = 300

/** The UI sizes offered, as Settings lists them. */
const UI_SCALES = [0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export class Windows {
  main: BrowserWindow | null = null
  private audio: BrowserWindow | null = null
  private tray: Tray | null = null
  /** Set once quitting has begun: closing the main window then closes it rather than hiding it. */
  quitting = false
  private readonly place: JsonFile<WindowPlace | null>

  /**
   * While the main window is in the tray or minimised its page is sent nothing: pushes wait here, the
   * newest of each kind plus every feed line, and go out when it shows again.
   */
  private mainHidden = false
  private readonly held = new Map<string, () => void>()
  private readonly heldFeed: Parameters<Pushes['state:feed']>[] = []

  constructor(private readonly opts: { preload: string; icon: string; audioSettings: () => AudioSettings; uiScale: () => number; setUiScale?: (scale: number) => void }) {
    const path = join(app.getPath('userData'), 'window.json')
    const r = readJsonFile(path)
    this.place = new JsonFile<WindowPlace | null>(path, r.state === 'ok' ? windowPlace(r.value) : null)
  }

  /** Where the main window was last, if that spot is still on a connected monitor. */
  private savedPlace(): WindowPlace | null {
    const place = this.place.get()
    const b = place?.bounds
    if (!place || !b || typeof b.x !== 'number') return null
    // Enough of the title bar must land on some display to grab it; otherwise use the default spot.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x + b.width - 100 > a.x && b.x + 100 < a.x + a.width && b.y >= a.y - 10 && b.y + 30 < a.y + a.height
    })
    return visible ? place : null
  }

  private rememberPlace(): void {
    const w = this.main
    if (!w || w.isDestroyed() || w.isMinimized()) return
    this.place.set({ ...this.place.get(), bounds: w.getNormalBounds(), maximized: w.isMaximized() })
  }

  createMain(): void {
    const place = this.savedPlace()
    // After a restart into an update nobody asked for, the window comes back only if it was in use:
    // over the game it would take the player's focus mid-fight. The app carries on from the tray.
    const relaunch = this.place.get()?.relaunch
    const quiet = !!relaunch && !relaunch.show && Date.now() - relaunch.at < RELAUNCH_MS
    if (relaunch) this.place.set({ ...this.place.get()!, relaunch: undefined })
    const w = new BrowserWindow({
      width: 1320,
      height: 860,
      ...(place?.bounds ?? {}),
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: windowBackground(),
      title: 'Legends Tracker',
      icon: this.opts.icon,
      titleBarStyle: 'hidden',
      titleBarOverlay: titleBarColours(),
      webPreferences: { preload: this.opts.preload, sandbox: true }
    })
    this.main = w
    // The caption buttons follow the theme, as the page does: a light page under dark buttons looks broken.
    const retint = () => {
      if (!w.isDestroyed()) {
        w.setTitleBarOverlay(titleBarColours())
        w.setBackgroundColor(windowBackground())
      }
    }
    nativeTheme.on('updated', retint)
    w.on('closed', () => nativeTheme.off('updated', retint))
    w.on('ready-to-show', () => {
      if (quiet) {
        this.setMainHidden(true)
        this.tellUpdated()
        return
      }
      if (place?.maximized) w.maximize()
      w.show()
    })
    w.webContents.on('did-finish-load', () => this.applyScale())
    // Ctrl and + or - steps the UI size, Ctrl+0 puts it back to 100%, as browsers do (LT-492).
    w.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return
      const now = this.opts.uiScale()
      // The size offered nearest the one set (a hand-edited 1.3 counts as 1.25).
      const at = UI_SCALES.reduce((best, f, i) => (Math.abs(f - now) < Math.abs(UI_SCALES[best] - now) ? i : best), 0)
      const next =
        input.key === '=' || input.key === '+'
          ? UI_SCALES[Math.min(UI_SCALES.length - 1, at + 1)]
          : input.key === '-'
            ? UI_SCALES[Math.max(0, at - 1)]
            : input.key === '0'
              ? 1
              : null
      if (next === null) return
      e.preventDefault()
      if (next !== now) this.opts.setUiScale?.(next)
    })
    for (const event of ['move', 'resize', 'maximize', 'unmaximize'] as const) w.on(event as 'move', () => this.rememberPlace())
    w.on('hide', () => this.setMainHidden(true))
    w.on('minimize', () => this.setMainHidden(true))
    w.on('show', () => this.setMainHidden(false))
    w.on('restore', () => this.setMainHidden(false))
    w.on('close', (e) => {
      this.rememberPlace()
      void this.place.flush()
      if (!this.quitting) {
        // Overlays and audio keep running from the tray.
        e.preventDefault()
        w.hide()
        this.tellTray()
      }
    })
    loadPage(w, 'index')
  }

  /** The first time the window closes, a word that the app is still running, and where it went. */
  private tellTray(): void {
    const place = this.place.get()
    if (!place || place.trayTold || !Notification.isSupported()) return
    this.place.set({ ...place, trayTold: true })
    new Notification({
      title: 'Legends Tracker is still running',
      body: 'Timers, overlays and speech carry on from the tray. Quit from the tray icon when you are done.',
      icon: this.opts.icon
    }).show()
  }

  /**
   * Before a restart into an update nobody asked for: notes whether the main window is in use (open,
   * not minimised, and in front), so the restarted app knows whether to bring it back.
   */
  async noteRelaunch(): Promise<void> {
    const w = this.main
    const show = !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused()
    const place = this.place.get() ?? (w && !w.isDestroyed() ? { bounds: w.getNormalBounds(), maximized: w.isMaximized() } : null)
    if (!place) return
    this.place.set({ ...place, relaunch: { at: Date.now(), show } })
    await this.place.flush()
  }

  /** Back from an update in the tray: a word that it happened, and where the app is. */
  private tellUpdated(): void {
    if (!Notification.isSupported()) return
    new Notification({
      title: `Legends Tracker updated to ${app.getVersion()}`,
      body: 'It restarted in the tray, so your game kept the screen. Your settings, timers and overlays are as they were.',
      icon: this.opts.icon
    }).show()
  }

  /** The UI size setting, on the main window (overlays have their own text sizes). */
  /** The theme changed: the window's own background (seen while it paints) follows. */
  applyTheme(): void {
    if (this.main && !this.main.isDestroyed()) this.main.setBackgroundColor(windowBackground())
  }

  applyScale(): void {
    if (this.main && !this.main.isDestroyed()) this.main.webContents.setZoomFactor(this.opts.uiScale())
  }

  createAudio(): void {
    this.audio = new BrowserWindow({
      show: false,
      webPreferences: { preload: this.opts.preload, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    })
    this.audio.webContents.on('did-finish-load', () => {
      this.audioConfig()
      if (this.devicesWatched) this.watchDevices(true)
    })
    loadPage(this.audio, 'audio')
  }

  /** Brings back a crashed main or audio window; false when `wc` is neither. */
  recover(wc: Electron.WebContents): boolean {
    if (this.main && !this.main.isDestroyed() && this.main.webContents === wc) {
      wc.reload()
      return true
    }
    if (this.audio && !this.audio.isDestroyed() && this.audio.webContents === wc) {
      this.audio.destroy()
      this.createAudio()
      return true
    }
    return false
  }

  /**
   * A main window that kept crashing is closed rather than left blank: the tray's Open then makes a
   * fresh one (LT-438). False when `wc` is not the main window's.
   */
  giveUp(wc: Electron.WebContents): boolean {
    if (!this.main || this.main.isDestroyed() || this.main.webContents !== wc) return false
    this.main.destroy()
    this.main = null
    return true
  }

  /** The tray icon: click to open, right-click for the menu. */
  createTray(actions: TrayActions): void {
    this.tray = new Tray(trayImage(this.opts.icon))
    this.tray.setToolTip('Legends Tracker')
    const menu = () => {
      const update = actions.updateReady()
      return Menu.buildFromTemplate([
        { label: 'Open', click: () => this.showMain() },
        { label: actions.arranging() ? 'Lock overlays' : 'Arrange overlays', click: () => actions.setArranging(!actions.arranging()) },
        { label: actions.muted() ? 'Unmute' : 'Mute', click: () => actions.toggleMute() },
        ...(update ? [{ label: `Restart to update to ${update}`, click: () => actions.installUpdate() }] : []),
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() }
      ])
    }
    this.tray.on('click', () => this.showMain())
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(menu()))
  }

  showMain(): void {
    if (!this.main || this.main.isDestroyed()) this.createMain()
    this.main?.show()
    this.main?.focus()
  }

  /** Sends the main window a push; held while it is hidden (see mainHidden). */
  toMain<K extends PushChannel>(channel: K, ...args: Parameters<Pushes[K]>): void {
    const w = this.main
    if (!w || w.isDestroyed()) return
    if (!this.mainHidden) return push(w.webContents, channel, ...args)
    if (channel === 'state:feed') {
      this.heldFeed.push(args as Parameters<Pushes['state:feed']>)
      if (this.heldFeed.length > HELD_FEED_MAX) this.heldFeed.shift()
      return
    }
    // A pet update is per character; the rest replace what the page shows.
    const key = channel === 'state:pet' ? `${channel}:${(args[0] as { character?: string } | undefined)?.character}` : channel
    this.held.delete(key)
    this.held.set(key, () => this.main && !this.main.isDestroyed() && push(this.main.webContents, channel, ...args))
  }

  /** The main window is open, not in the tray or minimised. */
  get mainShown(): boolean {
    return !!this.main && !this.main.isDestroyed() && !this.mainHidden
  }

  private setMainHidden(hidden: boolean): void {
    this.mainHidden = hidden
    const w = this.main
    if (hidden || !w || w.isDestroyed()) return
    for (const send of this.held.values()) send()
    for (const args of this.heldFeed) push(w.webContents, 'state:feed', ...args)
    this.held.clear()
    this.heldFeed.length = 0
  }

  /** Whether a page lists the output devices; kept, so an audio window made afresh is told too. */
  private devicesWatched = false

  /**
   * The audio window lists the output devices, and follows them changing, only while a page shows
   * them: listing them at start kept Chromium's capture service (some 94 MB) running all evening (LT-447).
   */
  watchDevices(on: boolean): void {
    this.devicesWatched = on
    if (this.audio && !this.audio.isDestroyed()) push(this.audio.webContents, 'audio:watchDevices', on)
  }

  toAudio(cmd: AudioCommand): void {
    if (this.audio && !this.audio.isDestroyed()) push(this.audio.webContents, 'audio:play', cmd)
  }

  /** The audio window follows the audio settings: device, volumes. */
  audioConfig(): void {
    if (this.audio && !this.audio.isDestroyed()) push(this.audio.webContents, 'audio:config', this.opts.audioSettings())
  }

  audioPid(): number | undefined {
    return this.audio?.webContents.getOSProcessId()
  }

  /** Steps the main window aside (for a screen read) and returns a way to bring it back. */
  stepAside(): () => void {
    const w = this.main
    const wasVisible = !!w?.isVisible()
    w?.hide()
    return () => {
      if (wasVisible) {
        w?.show()
        w?.focus()
      }
    }
  }

  /** Dialogs sit on the main window when there is one. */
  openDialog(opts: Electron.OpenDialogOptions) {
    return this.main && !this.main.isDestroyed() ? dialog.showOpenDialog(this.main, opts) : dialog.showOpenDialog(opts)
  }

  saveDialog(opts: Electron.SaveDialogOptions) {
    return this.main && !this.main.isDestroyed() ? dialog.showSaveDialog(this.main, opts) : dialog.showSaveDialog(opts)
  }

  showError(message: string, detail: string): void {
    const opts: Electron.MessageBoxOptions = { type: 'error', title: 'Legends Tracker', message, detail }
    void (this.main && !this.main.isDestroyed() ? dialog.showMessageBox(this.main, opts) : dialog.showMessageBox(opts))
  }

  /** Writes where the main window is, for a quit. */
  flush(): Promise<void> {
    this.rememberPlace()
    return this.place.flush().catch((e) => log.warn('Could not save the window position', e))
  }
}

/** The main window's background before its page paints: the theme's --bg. */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#0d1115' : '#e8ebee'
}

/** The caption buttons' colours: the title bar's background and its quieter text, in the theme in use. */
function titleBarColours(): { color: string; symbolColor: string; height: number } {
  return nativeTheme.shouldUseDarkColors ? { color: '#0d1115', symbolColor: '#a9b4bf', height: 38 } : { color: '#e8ebee', symbolColor: '#3c4751', height: 38 }
}

/**
 * The tray icon drawn from the large app icon at each scale Windows may ask for, so it is sharp at
 * 125 to 200% rather than a 16-pixel picture blown up.
 */
function trayImage(path: string) {
  const source = nativeImage.createFromPath(path)
  const image = nativeImage.createEmpty()
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor)
    image.addRepresentation({ scaleFactor, width: size, height: size, buffer: source.resize({ width: size, height: size, quality: 'best' }).toPNG() })
  }
  return image
}
