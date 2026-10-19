import { describe, expect, it, vi } from 'vitest'

// The preload tells main which live views the main window's page listens to (LT-556): once when the
// first listener of a channel comes and once when the last goes, nothing for other channels, and a
// forget-all before any of a fresh page's listeners.

const h = vi.hoisted(() => ({ sent: [] as unknown[][], api: null as null | { on: (c: string, fn: () => void) => () => void } }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: never) => void (h.api = api) },
  ipcRenderer: { send: (...args: unknown[]) => void h.sent.push(args), on: () => {}, removeListener: () => {} }
}))
;(globalThis as { location?: { pathname: string } }).location = { pathname: '/E:/app/out/renderer/index.html' }
await import('../../src/preload/index')

describe('the preload counting listeners', () => {
  it('says when a page starts and stops listening to a live view, and only then', () => {
    expect(h.sent).toEqual([['views:watch', '', false]])
    h.sent.length = 0
    const a = h.api!.on('state:respawns', () => {})
    const b = h.api!.on('state:respawns', () => {})
    h.api!.on('state:timers', () => {})
    expect(h.sent).toEqual([['views:watch', 'state:respawns', true]])
    a()
    a()
    expect(h.sent).toHaveLength(1)
    b()
    expect(h.sent.at(-1)).toEqual(['views:watch', 'state:respawns', false])
    expect(h.sent).toHaveLength(2)
  })
})
