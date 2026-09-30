import { afterAll, beforeAll, describe, it } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type EngineEnv, type EngineStore } from '../../src/main/engine'
import type { EngineFeature } from '../../src/main/engine/feature'
import { scanMoteHistory } from '../../src/main/moteHistory'
import { defaultSettings } from '../../src/main/storeCore'
import { LogClock, type LogLine } from '../../src/core/logLine'
import type { MoteState } from '../../src/core/motes'
import type { MoteStock } from '../../src/shared/types'

// What each part of the engine costs a line, on the twenty minutes of real play the golden test reads
// (9,757 lines of a group in the Plane of Hate). `npm run bench` prints each feature's µs a line, the
// median of twenty runs over every line, and the whole engine's as "all". Not part of `npm test`.
//
// The Engine is built as the golden test builds it, on a scratch game folder with the fixture as the
// log, with the fixture's spell file and the default triggers; the lines are then handed to the
// features straight.

const text = readFileSync(join(__dirname, '..', 'fixtures', 'golden-session.txt'), 'utf8')
const clock = new LogClock()
const lines: LogLine[] = text
  .trimEnd()
  .split(/\r?\n/)
  .flatMap((raw) => {
    const l = clock.parse(raw)
    return l ? [l] : []
  })

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

let dir = ''
let engine: Engine
let features: EngineFeature[] = []

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-bench-'))
  await fs.mkdir(join(dir, 'game', 'Logs'), { recursive: true })
  const logFile = join(dir, 'game', 'Logs', 'eqlog_Kelwyn_neriak.txt')
  await fs.writeFile(logFile, '', 'latin1')
  // The spell tracker needs the spell file: the fixture's cut-down one.
  await fs.copyFile(join(__dirname, '..', 'fixtures', 'spells_us.txt'), join(dir, 'game', 'spells_us.txt'))
  await fs.copyFile(join(__dirname, '..', 'fixtures', 'spells_us_str.txt'), join(dir, 'game', 'spells_us_str.txt'))
  const settings = defaultSettings()
  const store = {
    settings: cell({ ...settings, installDir: join(dir, 'game'), logFile, combat: { ...settings.combat, historyMinutes: 0 } }),
    // The triggers a new install starts with.
    triggers: cell(JSON.parse(readFileSync(join(__dirname, '..', '..', 'defaults', 'triggers.json'), 'utf8'))),
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
  const out = {
    timers: noop,
    alert: noop,
    audio: noop,
    status: noop,
    feed: noop,
    archive: noop,
    motes: noop,
    moteScan: noop,
    stock: noop,
    combat: noop,
    loot: noop,
    respawns: noop,
    pet: noop,
    push: noop
  }
  engine = new Engine(store, { synthesize: async () => Buffer.alloc(0) }, out, env)
  await engine.loadSpells()
  await engine.startWatching()
  // The engine's own list, in its order (a private field: this is a measurement, not a use).
  features = (engine as unknown as { features: EngineFeature[] }).features.filter((f) => f.line)
})

afterAll(async () => {
  engine?.stopWatching()
  await fs.rm(dir, { recursive: true, force: true })
})

/** The median µs a line of twenty runs of every line through `fs`, after two to warm up. */
function perLine(fs: EngineFeature[]): number {
  const runs: number[] = []
  for (let r = 0; r < 22; r++) {
    const t = performance.now()
    for (const line of lines) for (const f of fs) f.line!(line)
    if (r >= 2) runs.push(performance.now() - t)
  }
  runs.sort((a, b) => a - b)
  return (runs[runs.length >> 1] * 1000) / lines.length
}

describe('the engine, a line at a time', () => {
  it(`costs this much a line (${lines.length} lines a run)`, () => {
    const rows = [['all', perLine(features)] as const, ...features.map((f) => [f.id, perLine([f])] as const)]
    console.log(rows.map(([id, us]) => `${id.padEnd(12)} ${us.toFixed(2).padStart(7)} µs/line`).join('\n'))
  }, 120_000)
})
