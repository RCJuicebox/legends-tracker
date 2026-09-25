import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_OVERLAYS, JsonFile, characterKey, characterName, defaultSettings, mergeDefaults, readJsonFile } from '../src/main/storeCore'

describe('merging saved settings over the defaults', () => {
  it('fills fields an older build did not save, and keeps what was saved', () => {
    const merged = mergeDefaults(defaultSettings(), { autoStart: false, audio: { masterVolume: 0.3 } })
    expect(merged.autoStart).toBe(false)
    expect(merged.audio.masterVolume).toBe(0.3)
    expect(merged.audio.speechVolume).toBe(1)
    expect(merged.tracking.buffWarnSec).toBe(12)
  })

  it('keeps fields the defaults do not know', () => {
    expect(mergeDefaults({ a: 1 }, { a: 2, b: 3 })).toEqual({ a: 2, b: 3 })
  })

  it('takes a saved list of plain values whole', () => {
    expect(mergeDefaults({ list: [1, 2, 3] }, { list: [4] })).toEqual({ list: [4] })
    expect(mergeDefaults({ list: [1, 2] }, { list: 'nope' })).toEqual({ list: [1, 2] })
  })

  it('merges a list of things with ids item by item, so saved overlays gain new fields', () => {
    const base = [{ id: 'a', x: 1, extra: 'new' }, { id: 'b', x: 2, extra: 'new' }]
    const saved = [{ id: 'b', x: 20 }, { id: 'a', x: 10 }, { id: 'mine', x: 5 }]
    expect(mergeDefaults(base, saved)).toEqual([
      { id: 'b', x: 20, extra: 'new' },
      { id: 'a', x: 10, extra: 'new' },
      { id: 'mine', x: 5 }
    ])
  })

  it('does not bring back a default the player deleted', () => {
    const merged = mergeDefaults(defaultSettings(), { overlays: [{ ...DEFAULT_OVERLAYS[0], x: 5 }] }, (id) => !['buffs', 'targets', 'alerts', 'meter', 'respawns'].includes(id))
    expect(merged.overlays.map((o) => o.id)).toEqual(['buffs'])
    expect(merged.overlays[0].x).toBe(5)
  })

  it('adds a default overlay this install has never had', () => {
    const base = { overlays: [{ id: 'buffs', x: 1 }, { id: 'brand-new', x: 2 }] }
    const merged = mergeDefaults(base, { overlays: [{ id: 'buffs', x: 9 }] }, (id) => id === 'brand-new')
    expect(merged.overlays).toEqual([{ id: 'buffs', x: 9 }, { id: 'brand-new', x: 2 }])
  })

  it('keeps an empty saved list empty', () => {
    expect(mergeDefaults(defaultSettings(), { overlays: [] }).overlays).toEqual([])
  })
})

describe('character names from a log file', () => {
  it('reads Name_server from the log name', () => {
    expect(characterKey('C:\\EQL\\Logs\\eqlog_Kelwyn_neriak.txt')).toBe('Kelwyn_neriak')
    expect(characterName('C:\\EQL\\Logs\\eqlog_Kelwyn_neriak.txt')).toBe('Kelwyn')
  })

  it('gives nothing for a file that is not a character log', () => {
    expect(characterKey('C:\\EQL\\Logs\\dbg.txt')).toBe('')
    expect(characterName('')).toBe('')
  })
})

describe('the settings files on disk', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lt-store-'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it('tells a missing file from a readable one', () => {
    expect(readJsonFile(join(dir, 'none.json'))).toEqual({ state: 'missing' })
    writeFileSync(join(dir, 'ok.json'), '{"a":1}')
    expect(readJsonFile(join(dir, 'ok.json'))).toEqual({ state: 'ok', value: { a: 1 } })
  })

  it('moves an unreadable file aside rather than letting defaults overwrite it', () => {
    const path = join(dir, 'settings.json')
    writeFileSync(path, '{"installDir": "C:\\\\EQ", trunc')
    const r = readJsonFile(path, { now: new Date('2026-09-25T10:11:12.345Z') })
    expect(r).toEqual({ state: 'corrupt', movedTo: join(dir, 'settings.corrupt-2026-09-25T10-11-12-345Z.json') })
    expect(existsSync(path)).toBe(false)
    expect(readFileSync(join(dir, 'settings.corrupt-2026-09-25T10-11-12-345Z.json'), 'utf8')).toContain('trunc')
  })

  it('leaves a file the app ships where it is', () => {
    const path = join(dir, 'triggers.json')
    writeFileSync(path, 'not json')
    expect(readJsonFile(path, { setAside: false }).state).toBe('corrupt')
    expect(existsSync(path)).toBe(true)
  })

  it('writes on flush, and only when something changed', async () => {
    const path = join(dir, 'x.json')
    const f = new JsonFile(path, { n: 1 })
    await f.flush()
    expect(existsSync(path)).toBe(false)
    f.set({ n: 2 })
    await f.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 2 })
    rmSync(path)
    await f.flush()
    expect(existsSync(path)).toBe(false)
    f.markDirty()
    await f.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 2 })
    expect(readdirSync(dir)).toEqual(['x.json'])
  })

  it('does not reject when the file cannot be written, and tries again at the next flush', async () => {
    const path = join(dir, 'missing-folder', 'x.json')
    const f = new JsonFile(path, { n: 1 })
    f.set({ n: 2 })
    await expect(f.flush()).resolves.toBeUndefined()
    expect(existsSync(path)).toBe(false)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'missing-folder'))
    await f.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 2 })
  })
})
