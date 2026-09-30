import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every invoke handler, registered as index.ts registers them, against a stand-in context in which
// every part answers anything with another stand-in. Each channel is then called with arguments a page
// should never send (paths out of the app's folders, keys of an object's own, wrong types, huge text):
// a handler may refuse them, but it must answer, and must not hang, crash or throw anything but an
// Error. And every channel the contract in shared/ipc.ts names must have a handler.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), dir: '' }))

/** Anything: callable, any property is another, and never a promise (so an await of it returns it). */
function stub(): unknown {
  const fn = function () {}
  return new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => '' : p === Symbol.iterator ? undefined : stub()),
    apply: () => stub()
  })
}

vi.mock('electron', () => {
  const any = stub()
  return {
    app: { getPath: () => h.dir, getVersion: () => 'test', isPackaged: false, quit: () => {}, relaunch: () => {}, exit: () => {}, on: () => {} },
    ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} },
    BrowserWindow: any,
    Menu: any,
    Notification: any,
    Tray: any,
    desktopCapturer: any,
    dialog: any,
    globalShortcut: any,
    nativeImage: any,
    nativeTheme: any,
    powerMonitor: any,
    protocol: any,
    safeStorage: any,
    screen: any,
    session: any,
    shell: any
  }
})

/** Set once push.ts is loaded: the main window, from the app's own renderer folder. */
let OWN = { senderFrame: { url: '' } }
const STRANGER = { senderFrame: { url: 'https://example.com/' } }

/** What a page should never send, a few of each kind (the same as ipcValidate.test.ts checks). */
const BAD_ARGS: unknown[][] = [
  [],
  ['..\\..\\x'],
  ['__proto__', { __proto__: { polluted: true } }],
  ['C:\\Windows\\win.ini', 1e12],
  [42, null, {}],
  ['x'.repeat(100_000), -1],
  [['a', 5], NaN]
]

/** Resolves with how the call ended, or 'hung' after `ms`. */
async function outcome(fn: () => unknown, ms = 2000): Promise<'ok' | 'error' | 'hung' | string> {
  let timer: NodeJS.Timeout | undefined
  try {
    const r = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(HUNG), ms)
      })
    ])
    return r === HUNG ? 'hung' : 'ok'
  } catch (e) {
    return e instanceof Error ? 'error' : `threw a ${typeof e}`
  } finally {
    clearTimeout(timer)
  }
}
const HUNG = Symbol('hung')

beforeAll(async () => {
  h.dir = mkdtempSync(join(tmpdir(), 'lt-ipc-'))
  process.env['EQL_USER_DATA'] = h.dir
  const { rendererUrl } = await import('../src/main/push')
  OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
  const ctx = stub()
  const modules = await Promise.all([
    import('../src/main/ipc/app'),
    import('../src/main/ipc/triggers'),
    import('../src/main/ipc/spells'),
    import('../src/main/ipc/logs'),
    import('../src/main/ipc/play'),
    import('../src/main/ipc/audio'),
    import('../src/main/ipc/character'),
    import('../src/features/factions/main'),
    import('../src/main/liveAchievements'),
    import('../src/main/demo')
  ])
  for (const m of modules) for (const [name, fn] of Object.entries(m)) if (/^register\w*Ipc$/.test(name)) (fn as (c: unknown) => void)(ctx)
}, 30_000)

describe('the invoke handlers', () => {
  it('every channel the contract names has a handler, and every handler a channel', async () => {
    const { invokeChannels, isInvokeChannel } = await import('../src/shared/ipc')
    const registered = [...h.handlers.keys()]
    expect(invokeChannels().filter((c) => !h.handlers.has(c))).toEqual([])
    expect(registered.length).toBeGreaterThan(100)
    expect(registered.filter((c) => !isInvokeChannel(c))).toEqual([])
  })

  it('refuses a call from a page that is not one of ours, and an overlay’s call on a channel for the main window', async () => {
    const [channel, fn] = [...h.handlers][0]
    await expect(Promise.resolve(fn(STRANGER))).rejects.toThrow('Not allowed.')
    expect(channel).toBeTruthy()
    const { rendererUrl } = await import('../src/main/push')
    const overlay = { senderFrame: { url: rendererUrl() + 'overlays.html?display=1' } }
    await expect(Promise.resolve(h.handlers.get('settings:save')!(overlay, {}))).rejects.toThrow('Not allowed.')
    await expect(Promise.resolve(h.handlers.get('update:install')!(overlay))).rejects.toThrow('Not allowed.')
    // What the overlays need, they get.
    await expect(Promise.resolve(h.handlers.get('combat:segment')!(overlay, 'live'))).resolves.toBeDefined()
  })

  it('knows its own pages from any other local file', async () => {
    const { pageOf, rendererUrl } = await import('../src/main/push')
    expect(pageOf(rendererUrl() + 'index.html')).toBe('index')
    expect(pageOf(rendererUrl().toUpperCase().replace('FILE:', 'file:') + 'overlay.html?id=meter')).toBe('overlay')
    expect(pageOf(rendererUrl() + 'evil.html')).toBeNull()
    expect(pageOf('file:///C:/Users/someone/Downloads/index.html')).toBeNull()
    expect(pageOf(rendererUrl() + '../elsewhere/index.html')).toBeNull()
    expect(pageOf('https://example.com/index.html')).toBeNull()
  })

  it('answers every channel, whatever it is sent: refusing is fine, hanging or crashing is not', async () => {
    const bad: string[] = []
    let refused = 0
    for (const [channel, fn] of h.handlers) {
      for (const args of BAD_ARGS) {
        const r = await outcome(() => fn(OWN, ...args))
        if (r === 'error') refused++
        if (r !== 'ok' && r !== 'error') bad.push(`${channel}(${args.map((a) => (typeof a === 'string' ? a.slice(0, 20) : String(a))).join(', ')}): ${r}`)
      }
    }
    expect(bad).toEqual([])
    // Most of it is refused: the checks are there, not just the stand-in context absorbing it all.
    expect(refused).toBeGreaterThan(h.handlers.size)
    // Nothing a page sent got onto every object.
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  }, 120_000)
})
