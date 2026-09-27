import { app, BrowserWindow, dialog, Menu, nativeImage, screen, Tray, type Rectangle } from 'electron'
import { join } from 'node:path'
import { JsonFile, readJsonFile } from './storeCore'
import { push } from './push'
import { log } from './log'
import type { AudioSettings } from '../shared/types'
import type { AudioCommand, PushChannel, Pushes } from '../shared/ipc'

// The main window, the hidden audio window and the tray icon: creating them, remembering where the
// main window was, and sending them things.

export type Page = 'index' | 'overlay' | 'audio'

/** Loads one of the app's pages into a window: from the dev server in development, the built file otherwise. */
export function loadPage(win: BrowserWindow, page: Page, query: Record<string, string> = {}): void {
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
}

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

  constructor(
    private readonly opts: { preload: string; icon: string; audioSettings: () => AudioSettings }
  ) {
    const path = join(app.getPath('userData'), 'window.json')
    const r = readJsonFile(path)
    this.place = new JsonFile<WindowPlace | null>(path, r.state === 'ok' ? (r.value as WindowPlace) : null)
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
    this.place.set({ bounds: w.getNormalBounds(), maximized: w.isMaximized() })
  }

  createMain(): void {
    const place = this.savedPlace()
    const w = new BrowserWindow({
      width: 1320,
      height: 860,
      ...(place?.bounds ?? {}),
      minWidth: 980,
      minHeight: 640,
      show: false,
      backgroundColor: '#0f1117',
      title: 'Legends Tracker',
      icon: this.opts.icon,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0f1117', symbolColor: '#9aa3b2', height: 38 },
      webPreferences: { preload: this.opts.preload, sandbox: true }
    })
    this.main = w
    w.on('ready-to-show', () => {
      if (place?.maximized) w.maximize()
      w.show()
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
      }
    })
    loadPage(w, 'index')
  }

  createAudio(): void {
    this.audio = new BrowserWindow({
      show: false,
      webPreferences: { preload: this.opts.preload, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
    })
    this.audio.webContents.on('did-finish-load', () => this.audioConfig())
    loadPage(this.audio, 'audio')
  }

  /** The tray icon: click to open, right-click for the menu. */
  createTray(actions: TrayActions): void {
    this.tray = new Tray(nativeImage.createFromPath(this.opts.icon).resize({ width: 16, height: 16 }))
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

  private setMainHidden(hidden: boolean): void {
    this.mainHidden = hidden
    const w = this.main
    if (hidden || !w || w.isDestroyed()) return
    for (const send of this.held.values()) send()
    for (const args of this.heldFeed) push(w.webContents, 'state:feed', ...args)
    this.held.clear()
    this.heldFeed.length = 0
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
