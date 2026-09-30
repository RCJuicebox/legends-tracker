import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type EngineEnv, type EngineStore } from '../src/main/engine'
import { scanMoteHistory } from '../src/main/moteHistory'
import { defaultSettings } from '../src/main/storeCore'
import { jobs } from '../src/main/sources/jobs'
import type { MoteState } from '../src/core/motes'
import type { FeedItem, MoteStock } from '../src/shared/types'
import type { SelfWho } from '../src/core/selfWho'

// The meter's read of recent fights (Engine.seedCombat, and rebuildCombat as a cancellable job). The
// log is written with stamps relative to now, since the read goes back a number of minutes from now.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(20)
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (n: number) => String(n).padStart(2, '0')

/** A log line stamped `minutesAgo` before now, the game's way ("Thu Sep 24 16:00:00 2026"). */
function line(minutesAgo: number, text: string, plusSec = 0): string {
  const d = new Date(Date.now() - minutesAgo * 60_000 + plusSec * 1000)
  const stamp = `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`
  return `[${stamp}] ${text}\r\n`
}

/** A short fight with one mob, ended by its death. */
function fight(minutesAgo: number, mob: string): string {
  return (
    line(minutesAgo, `You punch ${mob} for 48 points of damage.`) + line(minutesAgo, `You kick ${mob} for 59 points of damage.`, 1) + line(minutesAgo, `You have slain ${mob}!`, 2)
  )
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
let logs: string
let logFile: string
let engines: Engine[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt141c-combat-'))
  logs = join(dir, 'game', 'Logs')
  await fs.mkdir(logs, { recursive: true })
  logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
  // An old fight half an hour ago and a recent one three minutes ago, over a megabyte apart, and the
  // zone entered before both: the read starts a few kilobytes before the window (offsetBefore), and the
  // zone line before it is looked for on its own.
  const filler = line(20, 'You feel better.').repeat(Math.ceil((1.2 * 1048576) / line(20, 'You feel better.').length))
  await fs.writeFile(logFile, line(40, 'You have entered Neriak.') + fight(30, 'an old ratman') + filler + fight(3, 'a young ratman') + line(1, 'You feel better.'))
  engines = []
})

afterEach(async () => {
  for (const e of engines) e.shutdown()
  await sleep(50)
  await fs.rm(dir, { recursive: true, force: true })
})

function makeEngine(historyMinutes: number) {
  const feed: FeedItem[] = []
  const seen: SelfWho[] = []
  const settings = defaultSettings()
  const store = {
    settings: cell({ ...settings, installDir: join(dir, 'game'), logFile, combat: { ...settings.combat, historyMinutes } }),
    triggers: cell([]),
    rules: cell({}),
    casts: cell({}),
    motes: cell<MoteState>({ active: null, sessions: [], daily: {} }),
    stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    respawns: cell({}),
    buffs: cell({ people: {}, wanted: {}, active: {} }),
    motesFresh: false,
    characterOf: () => ({ level: 50, classLevels: {}, focusSources: [] })
  } satisfies EngineStore
  const env: EngineEnv = {
    moteWorkerPath: '',
    isGameRunning: async () => false,
    findInstall: async () => '',
    soundDirs: () => [],
    dataDir: dir,
    scanMotes: (job, progress) => ({ done: scanMoteHistory(job, progress), stop: () => {} })
  }
  const noop = () => {}
  const engine = new Engine(
    store,
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
      buffs: noop,
      selfSeen: (who) => seen.push(who)
    },
    env
  )
  engines.push(engine)
  return { engine, feed, seen, store }
}

/** The fights on the meter, oldest first, by the mob fought (the meter capitalises the name). */
const fights = (engine: Engine) => engine.meter.fights.map((f) => f.name.toLowerCase())

/** Watching, with the start-up read of recent fights done. */
async function watching(historyMinutes: number) {
  const made = makeEngine(historyMinutes)
  await made.engine.startWatching()
  await waitFor(() => made.engine.meter.reading === '')
  return made
}

describe('Reading recent fights into the meter', () => {
  it('fills the meter from the last N minutes of the log when watching starts, and nothing older', async () => {
    const { engine } = await watching(10)
    expect(fights(engine)).toEqual(['a young ratman'])
    // The zone came a megabyte and more before the window, and still names the fight's zone.
    expect(engine.meter.fights[0].zone).toBe('Neriak')
  })

  it('fills it with every fight in the window when the window is wide enough', async () => {
    const { engine } = await watching(60)
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
  })

  it('says it is reading while it reads, and goes quiet once done', async () => {
    const { engine } = makeEngine(10)
    await engine.startWatching()
    expect(engine.meter.reading).toBe('Reading the last 10 minutes of the log…')
    await waitFor(() => engine.meter.reading === '')
    expect(engine.loot.reading).toBe('')
  })

  it('leaves out a fight older than the window in a log under a megabyte', async () => {
    await fs.writeFile(logFile, line(40, 'You have entered Neriak.') + fight(30, 'an old ratman') + fight(3, 'a young ratman'))
    const { engine } = await watching(10)
    expect(fights(engine)).toEqual(['a young ratman'])
  })

  it('reads nothing when history is set to zero minutes', async () => {
    const { engine } = makeEngine(0)
    await engine.startWatching()
    await sleep(200)
    expect(engine.meter.reading).toBe('')
    expect(fights(engine)).toEqual([])
  })
})

describe('Rebuilding the meter', () => {
  it('reads the minutes asked for, as a job the main window can show', async () => {
    const { engine } = await watching(10)
    const running = engine.rebuildCombat(60)
    expect(jobs.list()).toEqual([{ id: 'combat', label: 'Reading the last 60 minutes of the log into the meter', fraction: null, detail: '' }])
    await running
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
    expect(jobs.list()).toEqual([])
  })

  it('forgets the fights on record first, so a narrower rebuild drops what falls outside it', async () => {
    const { engine } = await watching(60)
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
    await engine.rebuildCombat(5)
    expect(fights(engine)).toEqual(['a young ratman'])
  })

  it('never counts a fight twice however often it is rebuilt', async () => {
    const { engine } = await watching(60)
    await engine.rebuildCombat(60)
    await engine.rebuildCombat(60)
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
  })

  it('does nothing when a second rebuild is asked for while one runs', async () => {
    const { engine } = await watching(10)
    const first = engine.rebuildCombat(60)
    // The second returns at once, while the first is still reading.
    await engine.rebuildCombat(5)
    expect(engine.meter.reading).not.toBe('')
    await first
    // Had the 5-minute one run, the old fight would be gone.
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
  })

  it('does nothing while the start-up read is still going', async () => {
    const { engine } = makeEngine(10)
    await engine.startWatching()
    expect(engine.meter.reading).not.toBe('')
    await engine.rebuildCombat(60)
    await waitFor(() => engine.meter.reading === '')
    expect(fights(engine)).toEqual(['a young ratman'])
  })

  it('stops when the job is cancelled, leaving the meter cleared rather than half read', async () => {
    const { engine } = await watching(60)
    const running = engine.rebuildCombat(60)
    jobs.cancel('combat')
    await running
    expect(fights(engine)).toEqual([])
    expect(engine.meter.reading).toBe('')
    expect(jobs.list()).toEqual([])
    // A cancelled rebuild does not stop the next one.
    await engine.rebuildCombat(60)
    expect(fights(engine)).toEqual(['an old ratman', 'a young ratman'])
  })

  it('only forgets the fights when nothing is being watched', async () => {
    const { engine } = await watching(60)
    engine.stopWatching()
    await engine.rebuildCombat(60)
    expect(fights(engine)).toEqual([])
  })
})

describe('Your race and classes from your own /who', () => {
  const who = (classes: string, race: string) => `[50 ${classes}] Kelwyn (${race}) <Test Guild> ZONE: Misty Thicket (misty)`

  it('takes them from a /who typed while watching, never from one read back at the start', async () => {
    await fs.appendFile(logFile, line(2, who('SHD/MNK/SHM', 'Iksar')))
    const { seen, store } = await watching(10)
    // The read-back saw the /who (Kelwyn is known), but it may be from before a race or class change.
    expect(store.buffs.get().people).toHaveProperty('kelwyn.race', 'Iksar')
    expect(seen).toEqual([])
    await fs.appendFile(logFile, line(0, who('MNK/BRD/ENC', 'Wood Elf')))
    await waitFor(() => seen.length > 0)
    expect(seen).toEqual([{ race: 'Wood Elf', classes: ['mnk', 'brd', 'enc'], level: 50 }])
  })
})
