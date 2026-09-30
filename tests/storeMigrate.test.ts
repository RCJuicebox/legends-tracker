import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// This build ships no migrations yet, so the schema table is swapped for one where settings.json is
// at schema 2 with a migration that renames an old field. Everything else about the Store is real.
const profile = vi.hoisted(() => ({ dir: '' }))
const migrate = vi.hoisted(() => ({
  run: (v: unknown): unknown => {
    const { zoom, ...rest } = v as { zoom?: number }
    return { ...rest, uiScale: zoom }
  }
}))

vi.mock('electron', () => ({ app: { getPath: () => profile.dir } }))
vi.mock('../src/main/schema', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/main/schema')>()
  const SCHEMAS = { ...real.SCHEMAS, 'settings.json': 2 }
  const MIGRATIONS = [{ file: 'settings.json', to: 2, run: (v: unknown) => migrate.run(v) }]
  return { ...real, SCHEMAS, MIGRATIONS, upgrade: (path: string, value: unknown, from: number) => real.upgrade(path, value, from, SCHEMAS, MIGRATIONS) }
})

const { Store } = await import('../src/main/store')
const { SCHEMAS } = await import('../src/main/schema')
const { defaultSettings } = await import('../src/main/storeCore')

let defaultsDir = ''
let defaultTriggers = ''
const file = (f: string) => join(profile.dir, f)
const readJson = (f: string): unknown => JSON.parse(readFileSync(file(f), 'utf8'))

beforeEach(() => {
  profile.dir = mkdtempSync(join(tmpdir(), 'lt141b-migrate-'))
  defaultsDir = mkdtempSync(join(tmpdir(), 'lt141b-defaults-'))
  defaultTriggers = join(defaultsDir, 'triggers.json')
  writeFileSync(defaultTriggers, '[]')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(profile.dir, { recursive: true, force: true })
  rmSync(defaultsDir, { recursive: true, force: true })
})

describe('a profile saved at an older schema', () => {
  it('is brought forward as it is read, with a backup of the file as it was', () => {
    const old = JSON.stringify({ ...defaultSettings(), uiScale: undefined, zoom: 1.5 })
    writeFileSync(file('settings.json'), old)
    const store = new Store(defaultTriggers)
    expect(store.settings.get().uiScale).toBe(1.5)
    expect(readFileSync(file('settings.pre-2.json'), 'utf8')).toBe(old)
    expect(store.newer).toEqual([])
  })

  it('counts a profile with no schema record as schema 1', () => {
    writeFileSync(file('settings.json'), JSON.stringify({ zoom: 1.25 }))
    expect(new Store(defaultTriggers).settings.get().uiScale).toBe(1.25)
  })

  it('is written in the new shape at the next flush, and the new schema recorded', async () => {
    writeFileSync(file('settings.json'), JSON.stringify({ zoom: 1.5 }))
    writeFileSync(file('schema.json'), JSON.stringify({ 'settings.json': 1 }))
    const store = new Store(defaultTriggers)
    await store.flushAll()
    const written = readJson('settings.json') as Record<string, unknown>
    expect(written.uiScale).toBe(1.5)
    expect('zoom' in written).toBe(false)
    expect(readJson('schema.json')).toEqual(SCHEMAS)
    expect((readJson('schema.json') as Record<string, number>)['settings.json']).toBe(2)
  })

  it('is written at once, and schema.json after it, so a crash before quitting does not migrate it again', async () => {
    writeFileSync(file('settings.json'), JSON.stringify({ zoom: 1.5 }))
    writeFileSync(file('schema.json'), JSON.stringify({ 'settings.json': 1 }))
    const store = new Store(defaultTriggers)
    await vi.waitFor(() => expect((readJson('schema.json') as Record<string, number>)['settings.json']).toBe(2))
    expect((readJson('settings.json') as Record<string, unknown>).uiScale).toBe(1.5)
    expect(store.settings.pending).toBe(false)
  })

  it('is not migrated again once it is at the new schema', () => {
    const run = vi.spyOn(migrate, 'run')
    writeFileSync(file('settings.json'), JSON.stringify({ ...defaultSettings(), uiScale: 1.5 }))
    writeFileSync(file('schema.json'), JSON.stringify(SCHEMAS))
    const store = new Store(defaultTriggers)
    expect(run).not.toHaveBeenCalled()
    expect(store.settings.get().uiScale).toBe(1.5)
    expect(existsSync(file('settings.pre-2.json'))).toBe(false)
  })

  it("leaves files already at this build's schema without a backup", () => {
    writeFileSync(file('settings.json'), JSON.stringify({ zoom: 1.5 }))
    writeFileSync(file('triggers.json'), '[]')
    new Store(defaultTriggers)
    expect(existsSync(file('settings.pre-2.json'))).toBe(true)
    expect(existsSync(file('triggers.pre-1.json'))).toBe(false)
  })
})
