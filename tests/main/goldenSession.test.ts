import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { promises as fs, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, type EngineEnv, type EngineStore } from '../../src/main/engine'
import { scanMoteHistory } from '../../src/main/moteHistory'
import { defaultSettings } from '../../src/main/storeCore'
import type { MoteState } from '../../src/core/motes'
import type { FeedItem, MoteStock } from '../../src/shared/types'

// Twenty minutes of real play (a Plane of Hate instance with a group, the test character's log of
// 25 September, chat taken out and every player renamed) read by the whole Engine as it reads a log
// when watching starts. What the meter, loot, respawns and motes make of it is compared with the
// snapshot beside this file: a change to any of them shows up here as a diff to look at.
// If a change is meant, update the snapshot with `npx vitest run tests/main/goldenSession.test.ts -u`.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(25)
  }
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const two = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`

/** The fixture with its stamps moved so its last line was a minute ago: the read goes back from now. */
function shifted(): string {
  const lines = readFileSync(join(__dirname, '..', 'fixtures', 'golden-session.txt'), 'utf8')
    .trimEnd()
    .split(/\r?\n/)
  const at = (l: string) => {
    const m = /^\[\w{3} (\w{3}) +(\d+) (\d\d):(\d\d):(\d\d) (\d{4})\]/.exec(l)!
    return new Date(+m[6], MONTHS.indexOf(m[1]), +m[2], +m[3], +m[4], +m[5]).getTime()
  }
  const shift = Date.now() - 60_000 - at(lines[lines.length - 1])
  return lines.map((l) => `[${stamp(new Date(at(l) + shift))}]${l.slice(l.indexOf(']') + 1)}\r\n`).join('')
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
let engine: Engine

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-golden-'))
  const logs = join(dir, 'game', 'Logs')
  await fs.mkdir(logs, { recursive: true })
  const logFile = join(logs, 'eqlog_Kelwyn_neriak.txt')
  await fs.writeFile(logFile, shifted(), 'latin1')
  // The test spell files, so the spell tracker knows the spells cast.
  for (const f of ['spells_us.txt', 'spells_us_str.txt']) await fs.copyFile(join(__dirname, '..', 'fixtures', f), join(dir, 'game', f))
  const settings = defaultSettings()
  const store = {
    settings: cell({ ...settings, installDir: join(dir, 'game'), logFile, combat: { ...settings.combat, historyMinutes: 30 } }),
    triggers: cell([]),
    rules: cell({}),
    casts: cell({}),
    motes: cell<MoteState>({ active: null, sessions: [], daily: {} }),
    stock: cell<MoteStock>({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true }),
    respawns: cell({}),
    buffs: cell({ people: {}, wanted: {}, active: {} }),
    motesFresh: true,
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
  const feed: FeedItem[] = []
  engine = new Engine(
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
  await engine.loadSpells()
  await engine.startWatching()
  await waitFor(() => engine.meter.reading === '')
  await engine.rebuildMoteHistory()
}, 60_000)

afterAll(async () => {
  engine?.shutdown()
  await sleep(50)
  await fs.rm(dir, { recursive: true, force: true })
})

describe('twenty minutes of real play, read by the Engine', () => {
  it('the damage meter: each fight, its kills and who did the damage', () => {
    const fights = engine.meter.fights.map((f) => ({
      name: f.name,
      zone: f.zone,
      kills: f.kills,
      deaths: f.deaths,
      seconds: Math.round((f.endedAt - f.startedAt) / 1000),
      damage: Object.values(f.entities)
        .filter((e) => e.out.total > 0)
        .sort((a, b) => b.out.total - a.out.total || a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((e) => `${e.name} (${e.kind}) ${e.out.total} in ${e.out.hits} hits, ${e.out.crits} crits`)
    }))
    expect(fights).toMatchSnapshot()
  })

  it('loot: what was looted, from what, and where it went', () => {
    const loot = engine.loot.entries.map((l) => `${l.looter}: ${l.count} × ${l.item} from ${l.source} -> ${l.outcome}`)
    expect(loot).toMatchSnapshot()
  })

  it('respawns: the mobs killed, and the gaps seen', () => {
    const rows = engine.combat.respawnView().rows.map((r) => `${r.zone} / ${r.name}: ${r.kills} kills, gaps ${r.gaps.join(' ') || '-'}${r.shared ? ', shared name' : ''}`)
    expect(rows.sort()).toMatchSnapshot()
  })

  it('spell timers: what the tracker made of the twenty minutes, timer by timer', () => {
    const before = engine.feed.length
    engine.simulate(readFileSync(join(__dirname, '..', 'fixtures', 'golden-session.txt'), 'utf8'))
    // Each timer started (with its window), faded, overwritten or resisted, counted.
    const said = new Map<string, number>()
    for (const f of engine.feed.slice(before))
      if (f.kind === 'timer' || f.kind === 'fade' || f.kind === 'warn') said.set(`${f.kind}: ${f.text}`, (said.get(`${f.kind}: ${f.text}`) ?? 0) + 1)
    expect([...said].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).sort()).toMatchSnapshot()
  })

  it('motes: the run and what it gave', () => {
    const view = engine.moteView()
    const runs = [...view.sessions, ...(view.active ? [view.active] : [])].map((s) => ({ kind: s.kind, name: s.name, outcome: s.outcome, motes: s.motes }))
    expect({ runs, days: Object.values(view.daily) }).toMatchSnapshot()
  })
})
