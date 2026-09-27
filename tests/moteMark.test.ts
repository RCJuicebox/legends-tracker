import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MoteCatchUp } from '../src/main/engine/moteCatchUp'
import { Notifier } from '../src/main/engine/notifier'
import { Engine, type EngineEnv, type EngineStore } from '../src/main/engine'
import { scanMoteHistory } from '../src/main/moteHistory'
import { MoteStockKeeper } from '../src/core/moteStock'
import { defaultSettings } from '../src/main/storeCore'
import { log } from '../src/main/log'
import { MoteTracker, type MoteState } from '../src/core/motes'
import { parseLogLine, type LogLine } from '../src/core/logLine'
import type { FeedItem, MoteStock } from '../src/shared/types'

// Where mote tracking got to (catchup.json, written by saveMark on the way out) while the start-up
// catch-up holds live lines in its backlog, and what a tail reset in the middle of that backlog does.
// MoteCatchUp is driven with a stand-in for the live tailer, so each step lands exactly when wanted.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(10)
  }
}

const ZONE = '[Thu Sep 24 16:00:00 2026] You have entered Neriak.\r\n'
const LOOT = (stamp: string, n: number, rank = 'Major') => `[${stamp}] You looted ${n} Mote of ${rank} Potential from Reward Chest and stored it in your currency.\r\n`
const parsed = (raw: string): LogLine => parseLogLine(raw.trimEnd())!
const SEEN = parsed(ZONE).time

interface Mark {
  logFile: string
  id: string
  offset: number
  seenUntil: number
}

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
let logFile: string
let markFile: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt141c-mark-'))
  await fs.mkdir(join(dir, 'game', 'Logs'), { recursive: true })
  logFile = join(dir, 'game', 'Logs', 'eqlog_Kelwyn_neriak.txt')
  markFile = join(dir, 'catchup.json')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await sleep(50)
  await fs.rm(dir, { recursive: true, force: true })
})

function makeStore(logFile: string, motes: MoteState) {
  return {
    settings: cell({ ...defaultSettings(), installDir: join(dir, 'game'), logFile }),
    triggers: cell([]),
    rules: cell({}),
    casts: cell({}),
    motes: cell<MoteState>(motes),
    stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    respawns: cell({}),
    buffs: cell({ people: {}, wanted: {}, active: {} }),
    motesFresh: false,
    characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
  } satisfies EngineStore
}

const env = (): EngineEnv => ({
  moteWorkerPath: '',
  isGameRunning: async () => false,
  findInstall: async () => '',
  soundDirs: () => [],
  dataDir: dir,
  scanMotes: (job, progress) => ({ done: scanMoteHistory(job, progress), stop: () => {} })
})

/** Mote catch-up with the live tailer played by hand: `tail` is where it is and whether it has settled. */
function catchUpRig() {
  const store = makeStore(logFile, { active: null, sessions: [], daily: {}, seenUntil: SEEN })
  const feed: FeedItem[] = []
  const notifier = new Notifier(
    { synthesize: async () => Buffer.alloc(0) },
    { alert: () => {}, audio: () => {}, feed: (i) => feed.push(i) },
    () => store.settings.get(),
    () => []
  )
  const tracker = new MoteTracker(store.motes.get(), { onChange: () => {} })
  const stock = new MoteStockKeeper(
    store.stock,
    () => {},
    () => {}
  )
  const tail = { logFile: '', position: -1, settling: true, asked: false }
  const catchUp = new MoteCatchUp(store, env(), { moteScan: () => {}, motes: () => {} }, notifier, {
    motes: () => tracker,
    stock,
    tail: {
      logFile: () => tail.logFile,
      position: () => tail.position,
      settling: () => {
        tail.asked = true
        return tail.settling
      }
    },
    archiveDir: () => join(dir, 'game', 'Logs', 'archive'),
    gameRunning: () => false,
    changed: () => {}
  })
  const readMark = () => JSON.parse(readFileSync(markFile, 'utf8')) as Mark
  return { store, tracker, catchUp, tail, readMark }
}

describe('Saving where mote tracking got to, with a backlog', () => {
  it('writes no mark while the catch-up holds live lines, and removes the one it started from', async () => {
    await fs.writeFile(logFile, ZONE + LOOT('Thu Sep 24 16:10:00 2026', 4))
    await fs.writeFile(markFile, JSON.stringify({ logFile, id: 'stale', offset: 1, seenUntil: SEEN }))
    const r = catchUpRig()
    const running = r.catchUp.catchUp(logFile)
    expect(r.catchUp.backlog.active).toBe(true)
    // It waits for the tailer to say where it attached.
    await waitFor(() => r.tail.asked)
    expect(existsSync(markFile)).toBe(false)
    r.catchUp.live(parsed(LOOT('Thu Sep 24 16:30:00 2026', 1, 'Greater')))
    r.catchUp.linesRead(logFile, 99_999)
    r.catchUp.saveMark()
    // Mid-read, what is on disk is not caught up: the next start goes by times.
    expect(existsSync(markFile)).toBe(false)
    r.tail.settling = false
    await running
  })

  it('once the backlog is through, records the offset the tailer reached, counting every line once', async () => {
    const before = ZONE + LOOT('Thu Sep 24 16:10:00 2026', 4) + LOOT('Thu Sep 24 16:20:00 2026', 2)
    const live = LOOT('Thu Sep 24 16:30:00 2026', 1, 'Greater')
    await fs.writeFile(logFile, before + live)
    const r = catchUpRig()
    const running = r.catchUp.catchUp(logFile)
    await waitFor(() => r.tail.asked)
    // The tailer attaches where the catch-up must stop, then hands over the line after it.
    r.catchUp.attached(logFile, before.length)
    r.catchUp.live(parsed(live))
    Object.assign(r.tail, { logFile, position: before.length + live.length, settling: false })
    await running
    expect(r.catchUp.backlog.active).toBe(false)
    expect(r.tracker.state.daily['2026-09-24']).toEqual({ major: 6, greater: 1 })
    r.catchUp.saveMark()
    expect(r.readMark()).toMatchObject({ logFile, offset: before.length + live.length, seenUntil: parsed(live).time })
  })

  it('records where the tailer attached when it has given no line yet', async () => {
    const before = ZONE + LOOT('Thu Sep 24 16:10:00 2026', 4)
    await fs.writeFile(logFile, before)
    const r = catchUpRig()
    const running = r.catchUp.catchUp(logFile)
    await waitFor(() => r.tail.asked)
    r.catchUp.attached(logFile, before.length)
    Object.assign(r.tail, { logFile, position: before.length, settling: false })
    await running
    r.catchUp.saveMark()
    expect(r.readMark().offset).toBe(before.length)
  })

  it('writes nothing on the way out while the catch-up is still reading', async () => {
    await fs.writeFile(logFile, ZONE + LOOT('Thu Sep 24 16:10:00 2026', 4))
    const r = catchUpRig()
    const running = r.catchUp.catchUp(logFile)
    await waitFor(() => r.tail.asked)
    r.catchUp.shutdown()
    expect(existsSync(markFile)).toBe(false)
    r.tail.settling = false
    await running
  })
})

describe('A tail reset in the middle of the backlog', () => {
  const before = ZONE + LOOT('Thu Sep 24 16:10:00 2026', 4)
  const stopAt = before.length
  const after = LOOT('Thu Sep 24 16:20:00 2026', 2)
  /** The first line of the new log, which the tailer gives while the catch-up still reads. */
  const fresh = LOOT('Thu Sep 24 16:40:00 2026', 3, 'Minor')

  async function run(reset: 'truncated' | 'replaced' | null, resetLog = logFile) {
    await fs.writeFile(logFile, before + after)
    const r = catchUpRig()
    const running = r.catchUp.catchUp(logFile)
    await waitFor(() => r.tail.asked)
    // The tailer attached before `after`: the catch-up is to stop there.
    r.catchUp.attached(logFile, stopAt)
    if (reset) r.catchUp.tailReset(resetLog, reset)
    r.catchUp.live(parsed(fresh))
    Object.assign(r.tail, { logFile, position: fresh.length, settling: false })
    await running
    return r
  }

  it('without one, the catch-up stops where the tailer attached, leaving what follows to the tailer', async () => {
    const r = await run(null)
    expect(r.tracker.state.daily['2026-09-24']).toEqual({ major: 4, minor: 3 })
  })

  it('reads the old log to its end rather than stop at a place in it, then the held lines, and warns they may count twice', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const r = await run('truncated')
    // Nothing is dropped: the old log's lines past the stop are read, and the new log's line after them.
    expect(r.tracker.state.daily['2026-09-24']).toEqual({ major: 6, minor: 3 })
    expect(warn).toHaveBeenCalledWith('The log was truncated while mote history was being read; lines around the switch may be counted twice.')
  })

  it('does the same for a log replaced by a new file', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {})
    const r = await run('replaced')
    expect(r.tracker.state.daily['2026-09-24']).toEqual({ major: 6, minor: 3 })
  })

  it('ignores a reset of some other log', async () => {
    const r = await run('replaced', join(dir, 'game', 'Logs', 'eqlog_Aldric_neriak.txt'))
    expect(r.tracker.state.daily['2026-09-24']).toEqual({ major: 4, minor: 3 })
  })

  it('saves the mark in the new log, where the tailer is now', async () => {
    vi.spyOn(log, 'warn').mockImplementation(() => {})
    const r = await run('truncated')
    r.catchUp.saveMark()
    expect(r.readMark().offset).toBe(fresh.length)
  })
})

describe('The engine when the watched log is truncated', () => {
  it('reads the new log from the top, and saves its offset as the mark on the way out', async () => {
    const old = ZONE + '[Thu Sep 24 16:01:00 2026] You feel better.\r\n'.repeat(50)
    await fs.writeFile(logFile, old)
    const feed: FeedItem[] = []
    const noop = () => {}
    const engine = new Engine(
      makeStore(logFile, { active: null, sessions: [], daily: {} }),
      { synthesize: async () => Buffer.alloc(0) },
      {
        timers: noop,
        alert: noop,
        audio: noop,
        status: noop,
        feed: (i) => feed.push(i),
        archive: noop,
        motes: noop,
        moteScan: noop,
        stock: noop,
        combat: noop,
        loot: noop,
        respawns: noop,
        pet: noop,
        buffs: noop
      },
      env()
    )
    try {
      await engine.startWatching()
      await waitFor(() => engine.status.logSize === old.length)
      const fresh = LOOT('Thu Sep 24 17:00:00 2026', 3)
      await fs.writeFile(logFile, fresh)
      await waitFor(() => engine.motes.state.daily['2026-09-24']?.major === 3)
      expect(feed.some((f) => f.text === 'The log was truncated; reading from the top.')).toBe(true)
      engine.shutdown()
      expect(engine.status.watching).toBe(false)
      expect((JSON.parse(readFileSync(markFile, 'utf8')) as Mark).offset).toBe(fresh.length)
    } finally {
      engine.shutdown()
    }
  })
})
