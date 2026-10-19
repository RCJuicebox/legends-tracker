import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CombatSnapshot } from '../../src/shared/types'

// What the main window is sent and what is held for it: everything waits while it is hidden, and the
// live views wait too while no page there listens to them (LT-556), going out when one starts to.
// The window is stood in; what it is sent is recorded.

const h = vi.hoisted(() => ({ dir: '', sent: [] as { channel: string; args: unknown[] }[], window: null as null | { emit: (e: string) => void } }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class BrowserWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: (channel: string, ...args: unknown[]) => void h.sent.push({ channel, args }), setZoomFactor: () => {} })
    constructor() {
      super()
      h.window = this
    }
    isDestroyed() {
      return false
    }
    async loadFile() {}
    async loadURL() {}
    show() {}
    focus() {}
    maximize() {}
    hide() {}
    setTitleBarOverlay() {}
    setBackgroundColor() {}
    getBounds() {
      return { x: 0, y: 0, width: 1320, height: 860 }
    }
    isMaximized() {
      return false
    }
  }
  return {
    app: { getPath: () => h.dir, isPackaged: false },
    BrowserWindow,
    Menu: { setApplicationMenu: () => {} },
    nativeTheme: { on: () => {}, off: () => {}, shouldUseDarkColors: false },
    nativeImage: {},
    Notification: class {},
    Tray: class {},
    dialog: {},
    screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) }
  }
})

const { Windows } = await import('../../src/main/windows')

h.dir = mkdtempSync(join(tmpdir(), 'lt-main-pushes-'))
afterAll(() => rmSync(h.dir, { recursive: true, force: true }))

function setup() {
  h.sent.length = 0
  const windows = new Windows({ preload: '', icon: '', audioSettings: () => ({}) as never, uiScale: () => 1 })
  windows.createMain()
  const channels = () => h.sent.map((s) => s.channel)
  return { windows, channels, win: h.window! }
}

const snap = (open: boolean[]): CombatSnapshot => ({ fights: open.map((o, i) => ({ id: i, open: o })), sessions: [] }) as unknown as CombatSnapshot

beforeEach(() => {
  h.sent.length = 0
})

describe('pushes to the main window', () => {
  it('sends the rest at once, and holds a live view no page listens to until one does', () => {
    const { windows, channels } = setup()
    windows.toMain('state:timers', [])
    windows.toMain('state:respawns', { zone: 'a', rows: [] })
    windows.toMain('state:respawns', { zone: 'b', rows: [] })
    expect(channels()).toEqual(['state:timers'])
    // A page starts listening: the newest held goes, once.
    windows.watch('state:respawns', true)
    expect(h.sent.at(-1)).toEqual({ channel: 'state:respawns', args: [{ zone: 'b', rows: [] }] })
    windows.watch('state:respawns', true)
    expect(channels()).toEqual(['state:timers', 'state:respawns'])
    windows.toMain('state:respawns', { zone: 'c', rows: [] })
    expect(channels()).toHaveLength(3)
    // It stops: held again.
    windows.watch('state:respawns', false)
    windows.toMain('state:respawns', { zone: 'd', rows: [] })
    expect(channels()).toHaveLength(3)
    expect(windows.mainWatches('state:respawns')).toBe(false)
    expect(windows.mainWatches('state:timers')).toBe(true)
  })

  it('holds everything while hidden, and on showing sends only what a page listens to', () => {
    const { windows, channels, win } = setup()
    windows.watch('state:buffs', true)
    win.emit('hide')
    windows.toMain('state:buffs', { offers: [] } as never)
    windows.toMain('state:stock', {} as never)
    windows.toMain('state:status', {} as never)
    expect(channels()).toEqual([])
    win.emit('show')
    expect(channels().sort()).toEqual(['state:buffs', 'state:status'])
    windows.watch('state:stock', true)
    expect(channels()).toContain('state:stock')
  })

  it('forgets what was listened to when the page loads afresh, and ignores channels that are not live views', () => {
    const { windows, channels } = setup()
    windows.watch('state:motes', true)
    windows.watch('state:timers', true)
    windows.watch('', false)
    windows.toMain('state:motes', {} as never)
    expect(channels()).toEqual([])
    expect(windows.mainWatches('state:timers')).toBe(true)
  })

  it('sends the meter whole while no page listens, then only the open fights while the closed ones are unchanged', () => {
    const { windows } = setup()
    windows.combatToMain(snap([false, true]))
    windows.watch('state:combat', true)
    // What was held is whole.
    expect((h.sent.at(-1)!.args[0] as CombatSnapshot).fights).toHaveLength(2)
    windows.combatToMain(snap([false, true]))
    expect((h.sent.at(-1)!.args[0] as CombatSnapshot).fights).toHaveLength(2)
    windows.combatToMain(snap([false, true]))
    expect(h.sent.at(-1)!.args[0]).toMatchObject({ openOnly: true, fights: [{ id: 1, open: true }] })
    windows.watch('state:combat', false)
    windows.combatToMain(snap([false, true]))
    windows.watch('state:combat', true)
    expect((h.sent.at(-1)!.args[0] as CombatSnapshot & { openOnly?: true }).openOnly).toBeUndefined()
  })
})
