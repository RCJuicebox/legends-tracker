import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type EngineEnv, type EngineStore } from '../src/main/engine'
import { scanMoteHistory } from '../src/main/moteHistory'
import { defaultSettings } from '../src/main/storeCore'
import type { BoardTimer } from '../src/core/timers'
import type { MoteSession, MoteState } from '../src/core/motes'
import type { FeedItem, MoteStock } from '../src/shared/types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(20)
  }
}

const LOOT = (stamp: string, n = 4, rank = 'Major') => `[${stamp}] You looted ${n} Mote of ${rank} Potential from Reward Chest and stored it in your currency.\r\n`

function cell<T>(value: T) {
  return {
    value,
    get(): T {
      return this.value
    },
    set(v: T) {
      this.value = v
    }
  }
}

let dir: string
let game: string
let logs: string
let engines: Engine[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-engine-'))
  game = join(dir, 'game')
  logs = join(game, 'Logs')
  await fs.mkdir(logs, { recursive: true })
  engines = []
})

afterEach(async () => {
  for (const e of engines) e.shutdown()
  // Let tailers close their handles before the folder goes.
  await sleep(50)
  await fs.rm(dir, { recursive: true, force: true })
})

function makeEngine(o: { logFile: string; motes?: MoteState; stock?: MoteStock }) {
  const feed: FeedItem[] = []
  const store = {
    settings: cell({ ...defaultSettings(), installDir: game, logFile: o.logFile }),
    triggers: cell([]),
    rules: cell({}),
    casts: cell({}),
    motes: cell<MoteState>(o.motes ?? { active: null, sessions: [], daily: {} }),
    stock: cell<MoteStock>(o.stock ?? { counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    motesFresh: false,
    characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
  } satisfies EngineStore
  const env: EngineEnv = {
    moteWorkerPath: '',
    isGameRunning: async () => false,
    findInstall: async () => '',
    soundDirs: () => [],
    dataDir: dir,
    // In-process in place of the worker thread: the same scan, without a built worker script.
    scanMotes: (job, progress) => ({ done: scanMoteHistory(job, progress), stop: () => {} })
  }
  const noop = () => {}
  const engine = new Engine(
    store,
    { synthesize: async () => Buffer.alloc(0) },
    { timers: noop, alert: noop, audio: noop, status: noop, feed: (i) => feed.push(i), archive: noop, motes: noop, moteScan: noop, stock: noop, combat: noop },
    env
  )
  engines.push(engine)
  return { engine, store, feed }
}

function timer(key: string): BoardTimer {
  const now = Date.now()
  return {
    key, id: key, label: 'Envenomed Bolt', target: 'a ratman', source: 'spell', color: '#fff', overlay: 'targets',
    startedAt: now, endsAt: now + 60_000, exact: false, warnSec: 12, onWarn: [], onExpire: [], warned: false, graceMs: 0
  } as BoardTimer
}

describe('Engine', () => {
  it('two quick starts attach one tailer, so a loot line counts once', async () => {
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, '[Thu Sep 24 16:00:00 2026] You have entered The Plane of Fear 4 (Refined).\r\n')
    const { engine, feed } = makeEngine({ logFile })
    await Promise.all([engine.startWatching(), engine.startWatching()])
    await sleep(250)
    await fs.appendFile(logFile, LOOT('Thu Sep 24 16:23:16 2026'))
    await waitFor(() => engine.motes.state.daily['2026-09-24']?.major !== undefined)
    // A second tailer would count it again on its next poll.
    await sleep(400)
    expect(engine.motes.state.daily['2026-09-24']).toEqual({ major: 4 })
    expect(feed.filter((f) => f.text.startsWith('Watching')).length).toBe(1)
  })

  it('a stop during a start wins', async () => {
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, '')
    const { engine } = makeEngine({ logFile })
    const started = engine.startWatching()
    engine.stopWatching()
    await started
    expect(engine.status.watching).toBe(false)
  })

  it('pasted test lines leave mote history and stock alone', () => {
    const { engine, store } = makeEngine({ logFile: join(logs, 'eqlog_Kelwyn_neriak.txt') })
    const before = JSON.stringify(engine.motes.state)
    const stock = JSON.stringify(store.stock.get())
    engine.simulate(
      '[Thu Sep 24 16:00:00 2026] You have entered The Plane of Fear 4 (Refined).\n' + LOOT('Thu Sep 24 16:23:16 2026') + '[Thu Sep 24 16:24:00 2026] You have completed the Dungeon Crawl!'
    )
    expect(JSON.stringify(engine.motes.state)).toBe(before)
    expect(JSON.stringify(store.stock.get())).toBe(stock)
  })

  it('clears the timers when the log switches to another character, not when the same log restarts', async () => {
    const a = join(logs, 'eqlog_Kelwyn_neriak.txt')
    const b = join(logs, 'eqlog_Aldric_neriak.txt')
    await fs.writeFile(a, '')
    await fs.writeFile(b, '')
    const { engine, store } = makeEngine({ logFile: a })
    await engine.startWatching()
    engine.board.upsert(timer('dot'))
    await engine.startWatching()
    expect(engine.board.list().length).toBe(1)
    store.settings.set({ ...store.settings.get(), logFile: b })
    await engine.startWatching()
    expect(engine.board.list().length).toBe(0)
  })

  it('reports a vanished log instead of carrying on as if watching', async () => {
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, '')
    const { engine, feed } = makeEngine({ logFile })
    await engine.startWatching()
    await sleep(150)
    await fs.rm(logFile)
    await waitFor(() => !engine.status.watching)
    expect(feed.some((f) => f.kind === 'warn' && f.text.includes('is gone'))).toBe(true)
    await fs.writeFile(logFile, '')
    await waitFor(() => engine.status.watching)
  })

  it('refuses to archive or compress anything but a character log', async () => {
    const notes = join(dir, 'notes.txt')
    await fs.writeFile(notes, 'keep me')
    const { engine } = makeEngine({ logFile: join(logs, 'eqlog_Kelwyn_neriak.txt') })
    for (const r of [await engine.archiveNow(notes), await engine.archiveNow(join(dir, 'eqlog_Kelwyn_neriak.txt')), await engine.compressLoose(notes)]) {
      expect(r.status).toBe('failed')
    }
    // A character log, but not a loose one in the archive folder.
    expect((await engine.compressLoose(join(logs, 'eqlog_Kelwyn_neriak.txt'))).status).toBe('failed')
    expect(await fs.readFile(notes, 'utf8')).toBe('keep me')
  })

  it('catches up from where it stopped, including more loot in the same second', async () => {
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, '[Thu Sep 24 16:00:00 2026] You have entered Neriak.\r\n')
    const first = makeEngine({ logFile })
    await first.engine.startWatching()
    await sleep(250)
    await fs.appendFile(logFile, LOOT('Thu Sep 24 16:23:16 2026', 4) + LOOT('Thu Sep 24 16:23:16 2026', 2))
    await waitFor(() => first.engine.motes.state.daily['2026-09-24']?.major === 6)
    first.engine.shutdown()
    expect(existsSync(join(dir, 'catchup.json'))).toBe(true)

    // Logged while the app was closed: a third chest line in that same second, and one later.
    await fs.appendFile(logFile, LOOT('Thu Sep 24 16:23:16 2026', 3) + LOOT('Thu Sep 24 16:30:00 2026', 1, 'Greater'))
    const saved = JSON.parse(JSON.stringify(first.engine.motes.state)) as MoteState
    const second = makeEngine({ logFile, motes: saved, stock: first.store.stock.get() })
    await second.engine.catchUpMotes()
    expect(second.engine.motes.state.daily['2026-09-24']).toEqual({ major: 9, greater: 1 })
    expect(second.store.stock.get().counts).toEqual({ major: 9, greater: 1 })
  })

  it('catching up without a saved offset reads only what is newer than the last line seen', async () => {
    const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(logFile, LOOT('Thu Sep 24 16:00:00 2026', 4) + LOOT('Thu Sep 24 16:10:00 2026', 1, 'Greater'))
    const seen = new Date(2026, 8, 24, 16, 0, 0).getTime()
    const { engine } = makeEngine({ logFile, motes: { active: null, sessions: [], daily: { '2026-09-24': { major: 4 } }, seenUntil: seen } })
    await engine.catchUpMotes()
    expect(engine.motes.state.daily['2026-09-24']).toEqual({ major: 4, greater: 1 })
  })

  it('rebuilds history from every character log and archive, keeping what only the kept history has, the same every time', async () => {
    await fs.writeFile(
      join(logs, 'eqlog_Alpha_srv.txt'),
      [
        '[Thu Sep 24 10:00:00 2026] You have entered The Plane of Fear 4 (Refined).',
        LOOT('Thu Sep 24 10:05:00 2026', 1).trimEnd(),
        '[Thu Sep 24 10:10:00 2026] You have completed the Dungeon Crawl!',
        ''
      ].join('\r\n')
    )
    await fs.writeFile(
      join(logs, 'eqlog_Beta_srv.txt'),
      ["[Thu Sep 24 11:00:00 2026] You have entered Nagafen's Lair 3 (Refined).", LOOT('Thu Sep 24 11:05:00 2026', 1).trimEnd(), '[Thu Sep 24 11:10:00 2026] You have completed the Dungeon Crawl!'].join('\r\n')
    )
    await fs.mkdir(join(logs, 'archive'))
    await fs.writeFile(join(logs, 'archive', 'eqlog_Beta_srv_2026-09-02_to_2026-09-02.txt'), LOOT('Wed Sep  2 09:00:00 2026', 2, 'Minor'))

    const old: MoteSession = {
      id: 'crawl-1', kind: 'crawl', name: 'Old Zone 3 (Refined)', startedAt: new Date(2026, 8, 1, 9).getTime(), endedAt: new Date(2026, 8, 1, 10).getTime(),
      outcome: 'completed', motes: { minor: 3 }, outsideSince: null, outsideMs: 0
    }
    const manual: MoteSession = { ...old, id: 'manual-1', kind: 'manual', name: 'Manual session', startedAt: new Date(2026, 8, 24, 10, 1).getTime(), endedAt: new Date(2026, 8, 24, 10, 2).getTime(), outcome: 'stopped' }
    const current: MoteState = {
      active: null,
      sessions: [old, manual],
      daily: { '2026-09-01': { minor: 3 }, '2026-09-24': { major: 99 } },
      seenUntil: new Date(2026, 8, 24, 11, 10).getTime()
    }
    const { engine } = makeEngine({ logFile: join(logs, 'eqlog_Alpha_srv.txt'), motes: current })
    await engine.rebuildMoteHistory()
    const once = JSON.stringify(engine.motes.state)
    await engine.rebuildMoteHistory()
    expect(JSON.stringify(engine.motes.state)).toBe(once)

    const s = engine.motes.state
    expect(s.sessions.map((x) => x.name).sort()).toEqual(['Manual session', "Nagafen's Lair 3 (Refined)", 'Old Zone 3 (Refined)', 'The Plane of Fear 4 (Refined)'])
    expect(s.sessions.filter((x) => x.kind === 'crawl').length).toBe(3)
    expect(s.daily).toEqual({ '2026-09-01': { minor: 3 }, '2026-09-02': { minor: 2 }, '2026-09-24': { major: 2 } })
    expect(engine.moteScan).toBe('')
  })

  it('a rescan while watching counts what the tailer already gave once, and carries on live', async () => {
    const logFile = join(logs, 'eqlog_Alpha_srv.txt')
    await fs.writeFile(logFile, '[Thu Sep 24 09:00:00 2026] You have entered Neriak.\r\n')
    const { engine } = makeEngine({ logFile })
    await engine.startWatching()
    await sleep(250)
    await fs.appendFile(logFile, LOOT('Thu Sep 24 10:05:00 2026', 1))
    await waitFor(() => engine.motes.state.daily['2026-09-24']?.major === 1)
    await engine.rebuildMoteHistory()
    expect(engine.motes.state.daily['2026-09-24']).toEqual({ major: 1 })
    await fs.appendFile(logFile, LOOT('Thu Sep 24 10:05:00 2026', 2))
    await waitFor(() => engine.motes.state.daily['2026-09-24']?.major !== 1)
    await sleep(300)
    expect(engine.motes.state.daily['2026-09-24']).toEqual({ major: 3 })
  })

  it('says so when a rescan is asked for while one runs', async () => {
    await fs.writeFile(join(logs, 'eqlog_Alpha_srv.txt'), LOOT('Thu Sep 24 10:05:00 2026', 1))
    const { engine, feed } = makeEngine({ logFile: join(logs, 'eqlog_Alpha_srv.txt') })
    const first = engine.rebuildMoteHistory()
    await engine.rebuildMoteHistory()
    await first
    expect(feed.some((f) => f.text === 'Already reading your logs.')).toBe(true)
  })
})
