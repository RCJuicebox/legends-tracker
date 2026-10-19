import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Engine, type EngineEnv, type EngineStore } from '../../src/main/engine'
import { scanMoteHistory } from '../../src/main/moteHistory'
import { defaultSettings } from '../../src/main/storeCore'
import type { MoteState } from '../../src/core/motes'
import type { FeedItem, MoteStock } from '../../src/shared/types'
import { tempDir } from '../tempDir'
import { sleep, waitFor } from '../helpers'

// Another PC's log, followed while this PC's game is closed: the Live page, the timers and the meter
// follow what is played there, and this PC's log is followed again once it is written.

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
let engines: Engine[] = []
beforeEach(() => {
  dir = tempDir('lt-remote-')
  engines = []
})
afterEach(async () => {
  for (const e of engines) e.shutdown()
  await sleep(50)
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const stamp = (t: Date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const p = (n: number) => String(n).padStart(2, '0')
  return `[${days[t.getDay()]} ${months[t.getMonth()]} ${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} ${t.getFullYear()}]`
}

describe("following another PC's log", () => {
  it('follows a log being written on another PC while this one is quiet, counts none of its motes again, and comes back when this log is written', async () => {
    const game = join(dir, 'game')
    const logs = join(game, 'Logs')
    const other = join(dir, 'otherpc')
    await fs.mkdir(logs, { recursive: true })
    await fs.mkdir(other, { recursive: true })
    const mainLog = join(logs, 'eqlog_Kelwyn_neriak.txt')
    const remoteLog = join(other, 'eqlog_Kelwyn_neriak.txt')
    // This PC's log last written two minutes ago; the other PC's just now.
    await fs.writeFile(mainLog, `${stamp(new Date(Date.now() - 120_000))} You have entered Neriak - Commons.\r\n`)
    const old = new Date(Date.now() - 120_000)
    await fs.utimes(mainLog, old, old)
    await fs.writeFile(remoteLog, `${stamp(new Date())} You have entered Befallen.\r\n`)
    const feed: FeedItem[] = []
    const store = {
      settings: cell({ ...defaultSettings(), installDir: game, logFile: mainLog, logFolders: [other] }),
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
      scanMotes: (job, progress) => ({ done: scanMoteHistory(job, progress), stop: () => {} }),
      pollMs: 10,
      logFolders: { lookAll: async () => [{ dir: other, reachable: true, logs: [{ path: remoteLog, modified: Date.now(), character: 'Kelwyn_neriak' }] }] }
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
        push: noop
      },
      env
    )
    engines.push(engine)
    await engine.startWatching()
    const follow = () => (engine as unknown as { followOtherPc(now?: number): Promise<void> }).followOtherPc()
    await follow()
    expect(engine.status.remote).toEqual({ path: remoteLog, character: 'Kelwyn', folder: other })
    expect(engine.status.logFile).toBe(remoteLog)
    expect(feed.some((f) => f.text.startsWith("Following Kelwyn's log on"))).toBe(true)
    // A mote looted there is the other PC's reader's to count, not this live one's.
    await waitFor(() => ((engine as unknown as { follower: { tail?: { tailer: { stats: { polls: number } } } } }).follower.tail?.tailer.stats.polls ?? 0) > 0)
    await fs.appendFile(remoteLog, `${stamp(new Date())} You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency.\r\n`)
    await waitFor(() => (engine.tailerStats?.lines ?? 0) > 0)
    expect(engine.motes.state.daily).toEqual({})
    // This PC's log is written: back to it.
    await fs.appendFile(mainLog, `${stamp(new Date())} You have entered Neriak - Commons.\r\n`)
    await follow()
    expect(engine.status.remote).toBeNull()
    expect(engine.status.logFile).toBe(mainLog)
  })
})
