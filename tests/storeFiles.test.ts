import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, Trigger } from '../src/shared/types'
import type { BuffsFile } from '../src/core/buffs'
import type { RespawnRecords } from '../src/core/respawns'
import type { MoteState } from '../src/core/motes'

// The Store finds its folder from Electron's userData path: each test gets its own scratch folder.
const profile = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected path ${name}`)
      return profile.dir
    }
  }
}))

const { Store } = await import('../src/main/store')
const { DEFAULT_OVERLAYS, defaultSettings } = await import('../src/main/storeCore')
const { SCHEMAS } = await import('../src/main/schema')

const DEFAULT_TRIGGER: Trigger = {
  id: 'default-1', name: 'Incoming tell', folder: 'Chat', enabled: true, comment: '', cooldownSec: 0,
  phrases: [{ text: 'tells you', regex: false }], actions: [{ type: 'speak', text: 'tell', interrupt: false }]
}

let defaultsDir = ''
let defaultTriggers = ''
const file = (f: string) => join(profile.dir, f)
const readJson = (f: string): unknown => JSON.parse(readFileSync(file(f), 'utf8'))

beforeEach(() => {
  profile.dir = mkdtempSync(join(tmpdir(), 'lt141b-store-'))
  defaultsDir = mkdtempSync(join(tmpdir(), 'lt141b-defaults-'))
  defaultTriggers = join(defaultsDir, 'triggers.json')
  writeFileSync(defaultTriggers, JSON.stringify([DEFAULT_TRIGGER]))
  // Corrupt-file and save messages go to the console until the app log is set up.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(profile.dir, { recursive: true, force: true })
  rmSync(defaultsDir, { recursive: true, force: true })
})

describe('a first run on an empty profile', () => {
  it('starts from the defaults and says it is a first run', () => {
    const store = new Store(defaultTriggers)
    expect(store.dir).toBe(profile.dir)
    expect(store.settingsFresh).toBe(true)
    expect(store.motesFresh).toBe(true)
    expect(store.recovered).toEqual([])
    expect(store.newer).toEqual([])
    expect(store.settings.get()).toEqual(defaultSettings())
    expect(store.triggers.get()).toEqual([DEFAULT_TRIGGER])
    expect(store.rules.get()).toEqual({})
    expect(store.casts.get()).toEqual({})
    expect(store.motes.get()).toEqual({ active: null, sessions: [], daily: {} })
    expect(store.stock.get()).toEqual({ counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true })
    expect(store.respawns.get()).toEqual({})
    expect(store.buffs.get()).toEqual({ people: {}, wanted: {}, active: {} })
  })

  it('writes nothing until flushed, then only the default triggers and the schema record', async () => {
    const store = new Store(defaultTriggers)
    expect(readdirSync(profile.dir)).toEqual([])
    await store.flushAll()
    expect(readdirSync(profile.dir).sort()).toEqual(['schema.json', 'triggers.json'])
    expect(readJson('triggers.json')).toEqual([DEFAULT_TRIGGER])
    expect(readJson('schema.json')).toEqual(SCHEMAS)
  })

  it('starts with no triggers when the shipped defaults are missing', async () => {
    const store = new Store(join(defaultsDir, 'none.json'))
    expect(store.triggers.get()).toEqual([])
    await store.flushAll()
    expect(readJson('triggers.json')).toEqual([])
  })
})

describe('saving and starting again', () => {
  const settings = (): AppSettings => {
    const s = defaultSettings()
    return {
      ...s,
      installDir: 'C:\\Games\\EQL',
      logFile: 'C:\\Games\\EQL\\Logs\\eqlog_Tester_test.txt',
      autoStart: false,
      audio: { ...s.audio, masterVolume: 0.4, voice: 'Test voice' },
      uiScale: 1.25,
      characters: { Tester_test: { level: 60, classLevels: { Druid: 60, Cleric: 12 }, race: 'Iksar', focusSources: [] } }
    }
  }
  const triggers: Trigger[] = [
    { ...DEFAULT_TRIGGER, id: 'mine', name: 'Mez', phrases: [{ text: 'You have been mesmerized', regex: false }], cooldownSec: 5 }
  ]
  const motes: MoteState = { active: null, sessions: [], daily: { '2026-09-27': { major: 4 } }, seenUntil: 1_790_000_000_000 }
  const respawns: RespawnRecords = {
    'zone|a mob': { zone: 'zone', name: 'A mob', kills: 3, lastDeath: 1_790_000_000_000, pendingSince: 0, gaps: [400, 420], shared: false }
  }
  const buffs: BuffsFile = {
    people: { tester: { name: 'Tester', classes: ['druid'], level: 60, race: 'Iksar', at: 1_790_000_000_000 } },
    wanted: { Tester_test: ['Spirit of Wolf'] },
    active: { Tester_test: [{ spell: 'Spirit of Wolf', ranked: 'Spirit of Wolf', line: 'move', caster: 'You', landedAt: 1, endsAt: null }] }
  }

  it('reads back everything the last run saved', async () => {
    const first = new Store(defaultTriggers)
    first.settings.set(settings())
    first.triggers.set(triggers)
    first.rules.set({ 'Spirit of Wolf': { track: false, alias: 'SoW', warnSec: 20 } })
    first.casts.set({ 'spirit of wolf': { rankedName: 'Spirit of Wolf', lastCast: 1_790_000_000_000, count: 7 } })
    first.motes.set(motes)
    first.stock.set({ counts: { major: 60 }, item: { name: 'Test cloak', lvl: 3, xp: 12, to: 6 }, autoAdd: false })
    first.respawns.set(respawns)
    first.buffs.set(buffs)
    await first.flushAll()

    const second = new Store(defaultTriggers)
    expect(second.settingsFresh).toBe(false)
    expect(second.motesFresh).toBe(false)
    expect(second.recovered).toEqual([])
    expect(second.newer).toEqual([])
    expect(second.settings.get()).toEqual(settings())
    expect(second.triggers.get()).toEqual(triggers)
    expect(second.rules.get()).toEqual({ 'Spirit of Wolf': { track: false, alias: 'SoW', warnSec: 20 } })
    expect(second.casts.get()).toEqual({ 'spirit of wolf': { rankedName: 'Spirit of Wolf', lastCast: 1_790_000_000_000, count: 7 } })
    expect(second.motes.get()).toEqual(motes)
    expect(second.stock.get()).toEqual({ counts: { major: 60 }, item: { name: 'Test cloak', lvl: 3, xp: 12, to: 6 }, autoAdd: false })
    expect(second.respawns.get()).toEqual(respawns)
    expect(second.buffs.get()).toEqual(buffs)
  })

  it('writes settings for a person to read and the busy files compact', async () => {
    const store = new Store(defaultTriggers)
    store.settings.set(settings())
    store.casts.set({ x: { rankedName: 'X', lastCast: 1, count: 1 } })
    await store.flushAll()
    expect(readFileSync(file('settings.json'), 'utf8')).toContain('\n  "installDir"')
    expect(readFileSync(file('casts.json'), 'utf8')).toBe('{"x":{"rankedName":"X","lastCast":1,"count":1}}')
  })

  it('does not write anything when started again and quit with nothing changed', async () => {
    const first = new Store(defaultTriggers)
    first.settings.set(settings())
    await first.flushAll()
    // Marked by hand: a second copy of the app that starts and quits at once must leave these alone.
    writeFileSync(file('triggers.json'), '[]')
    const settingsText = readFileSync(file('settings.json'), 'utf8')
    const schemaText = readFileSync(file('schema.json'), 'utf8')

    const second = new Store(defaultTriggers)
    await second.flushAll()
    expect(readFileSync(file('triggers.json'), 'utf8')).toBe('[]')
    expect(readFileSync(file('settings.json'), 'utf8')).toBe(settingsText)
    expect(readFileSync(file('schema.json'), 'utf8')).toBe(schemaText)
  })

  it('writes a changed setting on its own shortly after, and leaves the busy files for later', async () => {
    const store = new Store(defaultTriggers)
    store.settings.set(settings())
    store.casts.set({ x: { rankedName: 'X', lastCast: 1, count: 1 } })
    await vi.waitFor(() => expect(existsSync(file('settings.json'))).toBe(true), { timeout: 3000 })
    expect(existsSync(file('casts.json'))).toBe(false)
    // Clears the casts timer so nothing is left running after the test.
    await store.flushAll()
    expect(existsSync(file('casts.json'))).toBe(true)
  })
})

describe('settings read back from disk', () => {
  it('are checked the way a save from a page is', () => {
    const s = defaultSettings()
    writeFileSync(file('settings.json'), JSON.stringify({ ...s, audio: { ...s.audio, masterVolume: 7 }, uiScale: 'big', autoStart: 'no', junk: { a: 1 } }))
    const store = new Store(defaultTriggers)
    const got = store.settings.get()
    expect(got.audio.masterVolume).toBe(1)
    expect(got.uiScale).toBe(s.uiScale)
    expect(got.autoStart).toBe(s.autoStart)
    expect('junk' in got).toBe(false)
  })

  it('gain fields an older build did not save', () => {
    writeFileSync(file('settings.json'), JSON.stringify({ installDir: 'C:\\Games\\EQL', audio: { masterVolume: 0.3 } }))
    const got = new Store(defaultTriggers).settings.get()
    expect(got.installDir).toBe('C:\\Games\\EQL')
    expect(got.audio.masterVolume).toBe(0.3)
    expect(got.audio.speechVolume).toBe(1)
    expect(got.combat).toEqual(defaultSettings().combat)
  })

  it('get back a built-in overlay an older build let the player remove, written at the next flush', async () => {
    const s = defaultSettings()
    const saved = { ...s, overlays: s.overlays.filter((o) => o.id !== 'meter') }
    const text = JSON.stringify(saved)
    writeFileSync(file('settings.json'), text)
    const store = new Store(defaultTriggers)
    expect(store.settings.get().overlays.map((o) => o.id).sort()).toEqual(DEFAULT_OVERLAYS.map((o) => o.id).sort())
    // Not on a timer: nothing is written until a flush.
    expect(readFileSync(file('settings.json'), 'utf8')).toBe(text)
    await store.flushAll()
    const written = readJson('settings.json') as AppSettings
    expect(written.overlays.map((o) => o.id)).toContain('meter')
  })

  it('keep an overlay the player added', () => {
    const s = defaultSettings()
    writeFileSync(file('settings.json'), JSON.stringify({ ...s, overlays: [...s.overlays, { id: 'mine', kind: 'alerts', name: 'Mine' }] }))
    const got = new Store(defaultTriggers).settings.get()
    expect(got.overlays.find((o) => o.id === 'mine')).toMatchObject({ kind: 'alerts', name: 'Mine', visible: true })
  })
})

describe('a character looked up in the store', () => {
  it('comes from its log file name, with the defaults filled in', () => {
    const s = defaultSettings()
    writeFileSync(file('settings.json'), JSON.stringify({ ...s, characters: { Tester_test: { level: 60, classLevels: { Druid: 60 } } } }))
    const store = new Store(defaultTriggers)
    expect(store.characterOf('C:\\Games\\EQL\\Logs\\eqlog_Tester_test.txt')).toEqual({ level: 60, classLevels: { Druid: 60 }, focusSources: [] })
    expect(store.characterByKey('Nobody_test')).toEqual({ level: 50, classLevels: {}, focusSources: [] })
  })

  it('carries an old flat focus figure over as a focus source', () => {
    const s = defaultSettings()
    writeFileSync(file('settings.json'), JSON.stringify({ ...s, characters: { Tester_test: { level: 60, classLevels: {}, focusSources: [], beneficialFocusPct: 25 } } }))
    const c = new Store(defaultTriggers).characterByKey('Tester_test')
    expect(c.focusSources).toHaveLength(1)
    expect(c.focusSources[0]).toMatchObject({ id: 'legacy-beneficial', pct: 25, appliesTo: 'beneficial', enabled: true })
    expect('beneficialFocusPct' in c).toBe(false)
    expect('detrimentalFocusPct' in c).toBe(false)
  })
})

describe('a file that will not parse', () => {
  it('is set aside, reported, and the defaults used in its place', () => {
    writeFileSync(file('settings.json'), '{"installDir": "C:\\\\EQ", trunc')
    const store = new Store(defaultTriggers)
    expect(store.recovered).toHaveLength(1)
    const moved = store.recovered[0]
    expect(moved).toMatch(/settings\.corrupt-.+\.json$/)
    expect(readFileSync(moved, 'utf8')).toContain('trunc')
    expect(existsSync(file('settings.json'))).toBe(false)
    expect(store.settings.get()).toEqual(defaultSettings())
    // An unreadable file is not a first run.
    expect(store.settingsFresh).toBe(false)
  })

  it('in mote history means the history is rebuilt from the logs', () => {
    writeFileSync(file('motes.json'), 'not json')
    const store = new Store(defaultTriggers)
    expect(store.motesFresh).toBe(true)
    expect(store.recovered.map((p) => p.startsWith(file('motes.corrupt-')))).toEqual([true])
    expect(store.motes.get()).toEqual({ active: null, sessions: [], daily: {} })
  })

  it('in the triggers is not a first run, so the defaults do not replace them', async () => {
    writeFileSync(file('triggers.json'), '[{"id": ')
    const store = new Store(defaultTriggers)
    expect(store.triggers.get()).toEqual([])
    expect(store.recovered).toHaveLength(1)
    await store.flushAll()
    // Not written back: the player's triggers stay in the set-aside copy until they choose.
    expect(existsSync(file('triggers.json'))).toBe(false)
  })

  it('is recorded for each file that failed', () => {
    for (const f of ['settings.json', 'casts.json', 'respawns.json']) writeFileSync(file(f), '{')
    const store = new Store(defaultTriggers)
    expect(store.recovered).toHaveLength(3)
    expect(store.casts.get()).toEqual({})
    expect(store.respawns.get()).toEqual({})
  })
})

describe('files read back through the sanitisers', () => {
  it('drop respawn records and buffs that make no sense', () => {
    writeFileSync(file('respawns.json'), JSON.stringify({ good: { zone: 'z', name: 'A mob', kills: -2, gaps: [5, -1, 'x'] }, bad: { zone: 'z' }, worse: 'x' }))
    writeFileSync(file('buffs.json'), JSON.stringify({ people: { Tester: { name: 'Tester', classes: ['druid', 3] } }, wanted: { '../x': ['a'] }, active: 'x' }))
    const store = new Store(defaultTriggers)
    expect(store.respawns.get()).toEqual({ good: { zone: 'z', name: 'A mob', kills: 0, lastDeath: 0, pendingSince: 0, gaps: [5], shared: false } })
    expect(store.buffs.get()).toEqual({ people: { tester: { name: 'Tester', classes: ['druid'], level: 1, race: '', at: 0 } }, wanted: {}, active: {} })
  })

  it('fill mote stock fields an older build did not save', () => {
    writeFileSync(file('mote-stock.json'), JSON.stringify({ counts: { minor: 2 } }))
    expect(new Store(defaultTriggers).stock.get()).toEqual({ counts: { minor: 2 }, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true })
  })
})

describe('a profile a newer build wrote', () => {
  it('is read, but the files it is newer for are never written', async () => {
    const s = defaultSettings()
    const text = JSON.stringify({ ...s, autoStart: false }, null, 2)
    writeFileSync(file('settings.json'), text)
    writeFileSync(file('schema.json'), JSON.stringify({ ...SCHEMAS, 'settings.json': 99 }))
    const store = new Store(defaultTriggers)
    expect(store.newer).toEqual(['settings.json'])
    expect(store.settings.get().autoStart).toBe(false)
    store.settings.set({ ...store.settings.get(), autoStart: true })
    await store.flushAll()
    expect(readFileSync(file('settings.json'), 'utf8')).toBe(text)
  })

  it('keeps its schema numbers, so the newer build still knows its files', async () => {
    writeFileSync(file('settings.json'), JSON.stringify(defaultSettings()))
    writeFileSync(file('schema.json'), JSON.stringify({ 'settings.json': 99 }))
    const store = new Store(defaultTriggers)
    store.rules.set({ x: { track: true } })
    await store.flushAll()
    expect(readJson('schema.json')).toEqual({ ...SCHEMAS, 'settings.json': 99 })
    // The other files are this build's to write.
    expect(readJson('spell-rules.json')).toEqual({ x: { track: true } })
  })

  it('does not count a missing file as newer', () => {
    writeFileSync(file('schema.json'), JSON.stringify({ ...SCHEMAS, 'motes.json': 99 }))
    const store = new Store(defaultTriggers)
    expect(store.newer).toEqual([])
    expect(store.motesFresh).toBe(true)
  })
})

describe('the schema record', () => {
  it('is left alone when it already matches this build', async () => {
    writeFileSync(file('schema.json'), JSON.stringify(SCHEMAS))
    writeFileSync(file('triggers.json'), '[]')
    const store = new Store(defaultTriggers)
    await store.flushAll()
    expect(readFileSync(file('schema.json'), 'utf8')).toBe(JSON.stringify(SCHEMAS))
  })

  it('is rewritten when it will not parse, without taking the other files with it', async () => {
    writeFileSync(file('schema.json'), 'nope')
    writeFileSync(file('settings.json'), JSON.stringify({ ...defaultSettings(), autoStart: false }))
    const store = new Store(defaultTriggers)
    expect(store.settings.get().autoStart).toBe(false)
    expect(store.newer).toEqual([])
    await store.flushAll()
    expect(readJson('schema.json')).toEqual(SCHEMAS)
  })
})
