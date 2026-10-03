import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlayConfig } from '../../src/shared/types'

// onScreen is not exported: it is seen through OverlayManager.apply, which places each window with it
// (a host window covering one overlay while playing sits exactly where that overlay does).
// Electron's windows and screen are stand-ins that record where a window was put.
type Rect = { x: number; y: number; width: number; height: number }
const displays: { workArea: Rect }[] = []
const created: { opts: Rect; bounds: Rect[]; mouse: string[] }[] = []
const screenEvents = new Map<string, () => void>()
const cursor = { x: 0, y: 0 }

vi.mock('electron', () => {
  class BrowserWindow {
    private readonly record: { opts: Rect; bounds: Rect[]; mouse: string[] }
    webContents = { on: () => {}, send: () => {}, setBackgroundThrottling: () => {} }
    constructor(opts: Rect) {
      this.record = { opts: { x: opts.x, y: opts.y, width: opts.width, height: opts.height }, bounds: [], mouse: [] }
      created.push(this.record)
    }
    setBounds(b: Rect) {
      this.record.bounds.push(b)
    }
    setAlwaysOnTop() {}
    setIgnoreMouseEvents(ignore: boolean, o?: { forward?: boolean }) {
      this.record.mouse.push(!ignore ? 'mouse' : o?.forward ? 'moves' : 'through')
    }
    setMenu() {}
    setOpacity() {}
    setFocusable() {}
    setResizable() {}
    hide() {}
    showInactive() {}
    on() {}
    isDestroyed() {
      return false
    }
    destroy() {}
  }
  return {
    BrowserWindow,
    // One display id for all: while playing, the overlays of one display share a host window.
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[0],
      getDisplayMatching: () => ({ id: 1 }),
      getCursorScreenPoint: () => ({ ...cursor }),
      on: (event: string, fn: () => void) => void screenEvents.set(event, fn)
    }
  }
})

const { OverlayManager } = await import('../../src/main/overlays')

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 }

const overlay = (at: Partial<OverlayConfig>): OverlayConfig => ({
  id: 'o1',
  name: 'Tester timers',
  kind: 'timers',
  x: 100,
  y: 100,
  width: 300,
  height: 200,
  opacity: 1,
  fontSize: 14,
  visible: true,
  groupByTarget: false,
  ...at
})

let manager: InstanceType<typeof OverlayManager>
beforeEach(() => {
  displays.length = 0
  created.length = 0
  manager = new OverlayManager({ load: () => {}, preload: 'preload.js', onBoundsChanged: () => {} })
})
afterEach(() => manager.destroy())

/** Where an overlay at these bounds ends up, with these displays attached (the first is the primary). */
function placed(at: Partial<OverlayConfig>, ...areas: Rect[]): Rect {
  for (const workArea of areas) displays.push({ workArea })
  // A new id each time, so each call makes a window of its own.
  manager.apply([overlay({ id: `o${created.length + 1}`, ...at })])
  const w = created[created.length - 1]
  return w.bounds[w.bounds.length - 1] ?? w.opts
}

describe('overlay placement', () => {
  it('leaves an overlay on the primary display where it was, in whole pixels', () => {
    expect(placed({ x: 100.4, y: 200.6, width: 300.2, height: 150.5 }, PRIMARY)).toEqual({ x: 100, y: 201, width: 300, height: 151 })
  })

  it('leaves an overlay on a second display where it was', () => {
    expect(placed({ x: 3000, y: 500 }, PRIMARY, RIGHT)).toEqual({ x: 3000, y: 500, width: 300, height: 200 })
  })

  it('brings back an overlay saved on a display that is no longer attached', () => {
    // The right-hand display is gone: the overlay comes back to the primary's right edge, 100 down.
    expect(placed({ x: 3000, y: 500 }, PRIMARY)).toEqual({ x: 1620, y: 100, width: 300, height: 200 })
  })

  it('brings back an overlay left of every display to the primary display’s left edge', () => {
    expect(placed({ x: -2000, y: 300 }, PRIMARY)).toEqual({ x: 0, y: 100, width: 300, height: 200 })
  })

  it('keeps the column of an overlay that is only off the bottom or the top', () => {
    expect(placed({ x: 500, y: 5000 }, PRIMARY)).toEqual({ x: 500, y: 100, width: 300, height: 200 })
    expect(placed({ x: 500, y: -1000 })).toEqual({ x: 500, y: 100, width: 300, height: 200 })
  })

  it('counts an overlay with only a 40-pixel sliver on a display as off it', () => {
    // 30 px showing at the right edge of the only display.
    expect(placed({ x: 1890, y: 300 }, PRIMARY)).toEqual({ x: 1620, y: 100, width: 300, height: 200 })
  })

  it('places a rescued overlay inside a primary display that does not start at 0,0', () => {
    // Taskbar on the top and left: the work area starts at 60,40.
    const area = { x: 60, y: 40, width: 1860, height: 1040 }
    expect(placed({ x: -5000, y: -5000 }, area)).toEqual({ x: 60, y: 140, width: 300, height: 200 })
  })

  it('lines a rescued overlay wider than the primary display up with its left edge', () => {
    expect(placed({ x: 9000, y: 0, width: 2500 }, PRIMARY)).toEqual({ x: 0, y: 100, width: 2500, height: 200 })
  })

  it('does not move overlays while they are being arranged', () => {
    displays.push({ workArea: PRIMARY })
    manager.apply([overlay({ x: 100, y: 100 })])
    const w = created[0]
    const before = w.bounds.length
    manager.setArranging(true)
    manager.apply([overlay({ x: 9000, y: 9000 })])
    expect(w.bounds.length).toBe(before)
  })
})

describe('host windows', () => {
  it('draws the overlays of one display in one window over just their area', () => {
    displays.push({ workArea: PRIMARY })
    manager.apply([overlay({ id: 'a', x: 100, y: 100, width: 300, height: 200 }), overlay({ id: 'b', x: 900, y: 600, width: 200, height: 100 })])
    expect(created).toHaveLength(1)
    const w = created[0]
    expect(w.bounds[w.bounds.length - 1]).toEqual({ x: 100, y: 100, width: 1000, height: 600 })
  })

  it('gives each overlay a window of its own while arranging, and one host again after', () => {
    displays.push({ workArea: PRIMARY })
    manager.apply([overlay({ id: 'a' }), overlay({ id: 'b', x: 500 }), overlay({ id: 'c', visible: false })])
    expect(created).toHaveLength(1)
    manager.setArranging(true)
    expect(created).toHaveLength(3)
    manager.setArranging(false)
    expect(created).toHaveLength(4)
  })
})

describe('the mouse over a meter (LT-341)', () => {
  it('forwards the pointer moves only while it is over a meter, and gives the mouse while the page asks', async () => {
    vi.useFakeTimers()
    try {
      displays.push({ workArea: PRIMARY })
      cursor.x = 1500
      cursor.y = 900
      manager.apply([overlay({ id: 'm', kind: 'meter', x: 100, y: 100, width: 300, height: 200 }), overlay({ id: 't', x: 900, y: 600 })])
      const w = created[0]
      expect(w.mouse).toEqual(['through'])
      await vi.advanceTimersByTimeAsync(300)
      expect(w.mouse).toEqual(['through'])
      cursor.x = 200
      cursor.y = 150
      await vi.advanceTimersByTimeAsync(150)
      expect(w.mouse.at(-1)).toBe('moves')
      manager.setMouse('m', true)
      expect(w.mouse.at(-1)).toBe('mouse')
      // A timers overlay never asks.
      manager.setMouse('t', true)
      manager.setMouse('m', false)
      expect(w.mouse.at(-1)).toBe('moves')
      cursor.x = 800
      await vi.advanceTimersByTimeAsync(150)
      expect(w.mouse.at(-1)).toBe('through')
      expect(w.mouse).toEqual(['through', 'moves', 'mouse', 'moves', 'through'])
      // Hidden with the game, the pointer is not looked at.
      manager.setShown(false)
      cursor.x = 200
      await vi.advanceTimersByTimeAsync(500)
      expect(w.mouse.at(-1)).toBe('through')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not look at the pointer with no meter up', async () => {
    vi.useFakeTimers()
    try {
      displays.push({ workArea: PRIMARY })
      manager.apply([overlay({ id: 't' })])
      expect(vi.getTimerCount()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('monitors changing', () => {
  it('places the overlays again, once, when a monitor is unplugged', async () => {
    vi.useFakeTimers()
    try {
      displays.push({ workArea: PRIMARY }, { workArea: RIGHT })
      manager.followDisplays()
      manager.apply([overlay({ x: 2400, y: 300 })])
      expect(created).toHaveLength(1)
      expect(created[0].bounds.at(-1)).toMatchObject({ x: 2400, y: 300 })
      // The right-hand monitor goes; Windows reports it more than once.
      displays.splice(1, 1)
      screenEvents.get('display-removed')!()
      screenEvents.get('display-metrics-changed')!()
      await vi.advanceTimersByTimeAsync(1000)
      // A new host window, brought onto the primary monitor.
      expect(created).toHaveLength(2)
      const b = created[1].bounds.at(-1)!
      expect(b.x + b.width).toBeLessThanOrEqual(PRIMARY.width)
    } finally {
      vi.useRealTimers()
    }
  })
})
