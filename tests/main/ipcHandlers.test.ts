import { EventEmitter } from 'node:events'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { tempDir } from '../tempDir'

// Every invoke handler, registered as index.ts and the context's features register them, against a stand-in context in which
// every part answers anything with another stand-in. Each channel is then called with arguments a page
// should never send (paths out of the app's folders, keys of an object's own, wrong types, huge text):
// a handler may refuse them, but it must answer, and must not hang, crash or throw anything but an
// Error. And every channel the contract in shared/ipc.ts names must have a handler.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), sends: new Map<string, Handler>(), dir: '' }))

/** Anything: callable, any property is another, and never a promise (so an await of it returns it). */
function stub(): unknown {
  const fn = function () {}
  return new Proxy(fn, {
    get: (_t, p) => (p === 'then' ? undefined : p === Symbol.toPrimitive ? () => '' : p === Symbol.iterator ? undefined : stub()),
    apply: () => stub()
  })
}

vi.mock('../../src/main/groupHealthWorker?modulePath', () => ({ default: 'worker.js' }))
vi.mock('electron', () => {
  const any = stub()
  return {
    app: {
      getPath: () => h.dir,
      getVersion: () => 'test',
      isPackaged: false,
      quit: () => {},
      relaunch: () => {},
      exit: () => {},
      on: () => {},
      whenReady: () => Promise.resolve(),
      isReady: () => false
    },
    ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: (channel: string, fn: Handler) => void h.sends.set(channel, fn) },
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
const SCREEN_READS = new Set(['stats:readScreen', 'stock:readScreen', 'groupHealth:calibrate'])

beforeAll(async () => {
  h.dir = tempDir('lt-ipc-')
  process.env['EQL_USER_DATA'] = h.dir
  const { rendererUrl } = await import('../../src/main/push')
  OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
  // The features keep what they hold under the store's folder, so that one path is real.
  const store = new Proxy(stub() as object, { get: (t, p, r) => (p === 'dir' ? h.dir : Reflect.get(t, p, r)) })
  const ctx = new Proxy(stub() as object, { get: (t, p, r) => (p === 'store' ? store : Reflect.get(t, p, r)) })
  const modules = await Promise.all([
    import('../../src/main/ipc/app'),
    import('../../src/main/ipc/triggers'),
    import('../../src/main/ipc/spells'),
    import('../../src/main/ipc/logs'),
    import('../../src/main/ipc/play'),
    import('../../src/main/ipc/audio'),
    import('../../src/main/ipc/character'),
    import('../../src/main/demo')
  ])
  for (const m of modules) for (const [name, fn] of Object.entries(m)) if (/^register\w*Ipc$/.test(name)) (fn as (c: unknown) => void)(ctx)
  const { createFeatures } = await import('../../src/features/main')
  const { LiveAchievements } = await import('../../src/main/liveAchievements')
  const { GroupHealth } = await import('../../src/main/groupHealth')
  for (const f of [
    // Every feature module, as the context builds them (src/features/main.ts).
    ...Object.values(createFeatures({ logHistory: stub() as never, dir: h.dir })),
    new LiveAchievements({ store: { dir: h.dir } } as never),
    // Its worker is stood in by one that answers the ping: the self-test channel is what is registered.
    new GroupHealth(() => {
      const w = new EventEmitter() as EventEmitter & { postMessage(m: unknown): void; terminate(): void }
      w.postMessage = () => void setTimeout(() => w.emit('message', { kind: 'pong', koffi: true }), 0)
      w.terminate = () => {}
      return w as never
    })
  ])
    f.register(ctx as never)
}, 30_000)

describe('the invoke handlers', () => {
  it('every channel the contract names has a handler, and every handler a channel', async () => {
    const { invokeChannels, isInvokeChannel } = await import('../../src/shared/ipc')
    const registered = [...h.handlers.keys()]
    expect(invokeChannels().filter((c) => !h.handlers.has(c))).toEqual([])
    expect(registered.length).toBeGreaterThan(100)
    expect(registered.filter((c) => !isInvokeChannel(c))).toEqual([])
  })

  it('refuses a call from a page that is not one of ours, and an overlay’s call on a channel for the main window', async () => {
    const [channel, fn] = [...h.handlers][0]
    await expect(Promise.resolve(fn(STRANGER))).rejects.toThrow('Not allowed.')
    expect(channel).toBeTruthy()
    const { rendererUrl } = await import('../../src/main/push')
    const overlay = { senderFrame: { url: rendererUrl() + 'overlays.html?display=1' } }
    await expect(Promise.resolve(h.handlers.get('settings:save')!(overlay, {}))).rejects.toThrow('Not allowed.')
    await expect(Promise.resolve(h.handlers.get('update:install')!(overlay))).rejects.toThrow('Not allowed.')
    // What the overlays need, they get.
    await expect(Promise.resolve(h.handlers.get('combat:segment')!(overlay, 'live'))).resolves.toBeDefined()
  })

  it('knows its own pages from any other local file', async () => {
    const { pageOf, rendererUrl } = await import('../../src/main/push')
    expect(pageOf(rendererUrl() + 'index.html')).toBe('index')
    expect(pageOf(rendererUrl().toUpperCase().replace('FILE:', 'file:') + 'overlay.html?id=meter')).toBe('overlay')
    expect(pageOf(rendererUrl() + 'evil.html')).toBeNull()
    expect(pageOf('file:///C:/Users/someone/Downloads/index.html')).toBeNull()
    expect(pageOf(rendererUrl() + '../elsewhere/index.html')).toBeNull()
    expect(pageOf('https://example.com/index.html')).toBeNull()
  })

  it('answers every channel, whatever it is sent: refusing is fine, hanging or crashing is not', async () => {
    // Each refusal is logged with its stack; hundreds of them written out would be most of the time taken.
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})]
    const bad: string[] = []
    let refused = 0
    for (const [channel, fn] of h.handlers) {
      // These two read the screen with Windows OCR in a PowerShell of their own, and take no arguments.
      if (SCREEN_READS.has(channel)) continue
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
    quiet.forEach((q) => q.mockRestore())
  }, 120_000)
})

/** Values of each kind a channel's check takes, wrong in what they hold: past the checks, into the handler's own (LT-754). */
const OF_KIND: Record<string, unknown[]> = {
  string: ['..\\..\\x', 'x'.repeat(100_000), '__proto__', 'Tester_neriak'],
  number: [-1, 1e12, 0.5, 0],
  boolean: [true, false, true, false],
  strings: [['..\\x'], [], ['x'.repeat(10_000)], ['__proto__']],
  object: [{}, JSON.parse('{"__proto__":{"polluted":true}}'), { a: 1 }, { name: 'x'.repeat(10_000) }],
  list: [[], [{}], [null, 5], ['x']]
}
/** One argument of `kind`, the `i`-th try: an optional one left out and a nullable one null on the first. */
function ofKind(kind: string, i: number): unknown {
  if (kind.endsWith('?')) return i === 0 ? undefined : ofKind(kind.slice(0, -1), i)
  if (kind.endsWith('|null')) return i === 0 ? null : ofKind(kind.slice(0, -5), i)
  if (kind.startsWith('oneOf:')) {
    const values = kind.slice(6).split(',')
    return values[i % values.length]
  }
  return OF_KIND[kind][i % OF_KIND[kind].length]
}
/** Channels left out here: one runs a program from the skin's folder. */
const NOT_FUZZED = new Set([...SCREEN_READS, 'skins:build'])

describe('the invoke handlers, past the checks', () => {
  it('answers every channel sent the right kinds holding the wrong things: refusing is fine, hanging or crashing is not', async () => {
    const { CHECKS } = await import('../../src/main/ipc/checks')
    const quiet = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'log').mockImplementation(() => {})]
    const bad: string[] = []
    for (const [channel, fn] of h.handlers) {
      if (NOT_FUZZED.has(channel)) continue
      const kinds = CHECKS[channel as keyof typeof CHECKS].kinds
      for (let i = 0; i < 4; i++) {
        const args = kinds.map((k) => ofKind(k, i))
        const r = await outcome(() => fn(OWN, ...args))
        if (r !== 'ok' && r !== 'error') bad.push(`${channel}(${kinds.join(', ')}) try ${i}: ${r}`)
      }
    }
    expect(bad).toEqual([])
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    quiet.forEach((q) => q.mockRestore())
  }, 120_000)
})

describe('the send handlers', () => {
  it('every send channel has a listener, and each takes whatever it is sent without throwing', async () => {
    const { isSendChannel } = await import('../../src/shared/ipc')
    for (const c of ['views:watch', 'audio:problem', 'audio:devices', 'overlay:mouse', 'overlay:meter']) expect(h.sends.has(c), c).toBe(true)
    expect([...h.sends.keys()].filter((c) => !isSendChannel(c))).toEqual([])
    const good: unknown[][] = [
      ['state:respawns', true],
      ['', false],
      ['play', 'NotAllowedError: play() failed'],
      ['device', '']
    ]
    for (const [channel, fn] of h.sends) for (const args of [...BAD_ARGS, ...good]) expect(() => fn(OWN, ...args), channel).not.toThrow()
  })
})
