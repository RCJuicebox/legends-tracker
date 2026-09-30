import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The Allakhazam reader (allaSource.ts) with the site stood in for: fetch is replaced and the clock
// is faked, so the twenty seconds between pages pass at once.
const dir = mkdtempSync(join(tmpdir(), 'lt-alla-'))
process.env['EQL_USER_DATA'] = dir
vi.mock('electron', () => ({ app: { getPath: () => dir, getVersion: () => 'test' } }))

const { FactionAlla } = await import('../src/features/factions/allaSource')
const { factionKey } = await import('../src/features/factions/planner')

const PAGE = readFileSync(join(__dirname, 'fixtures', 'alla-faction-66.html'), 'utf8')
const file = join(dir, 'local', 'faction-alla.json')
const NAMES = Array.from({ length: 14 }, (_, i) => `Faction ${String.fromCharCode(65 + i)}`)

let fetched: number[] = []
let onFetch: (id: number) => void = () => {}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
  mkdirSync(join(dir, 'local'), { recursive: true })
  // The site's list of factions is already kept: only faction pages are read.
  const ids = Object.fromEntries(NAMES.map((n, i) => [factionKey(n), i + 1]))
  writeFileSync(file, JSON.stringify({ version: 1, index: { fetchedAt: Date.now(), ids }, pages: {} }))
  fetched = []
  onFetch = () => {}
  vi.stubGlobal('fetch', async (url: string) => {
    const id = Number(/faction=(\d+)/.exec(url)?.[1])
    fetched.push(id)
    onFetch(id)
    return new Response(PAGE, { status: 200 })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/**
 * Lets the faked clock run on, five seconds at a time, until `cond` holds. The disk is real, and slow
 * while other test files run: each step waits for it (event-loop turns, up to four real seconds in all).
 */
async function until(cond: () => boolean): Promise<void> {
  const give = performance.now() + 4_000
  while (!cond() && performance.now() < give) {
    await vi.advanceTimersByTimeAsync(5_000)
    for (let j = 0; j < 20 && !cond(); j++) await new Promise<void>((r) => setImmediate(r))
  }
  expect(cond()).toBe(true)
}

const kept = () => (existsSync(file) ? Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { pages: object }).pages).length : 0)

describe('Allakhazam pages', () => {
  it("reads the latest caller's factions first, as the pages go", async () => {
    const alla = new FactionAlla()
    await alla.factions(['Faction A', 'Faction B'])
    // A second character picked while the first page is read: theirs go next.
    await alla.factions(['Faction C', 'Faction D'])
    await until(() => fetched.length === 4)
    expect(fetched).toEqual([1, 3, 4, 2])
    // Written once reading stops.
    await until(() => kept() === 4)
  })

  it('writes the pages read every ten, and the rest when reading stops', async () => {
    const onDisk: number[] = []
    onFetch = () => onDisk.push(kept())
    const alla = new FactionAlla()
    await alla.factions(NAMES.slice(0, 12))
    await until(() => alla.status().read === 12)
    // Nothing written before the tenth page; the ten when the eleventh is asked for.
    expect(onDisk.slice(0, 10)).toEqual(Array(10).fill(0))
    expect(onDisk[10]).toBe(10)
    await until(() => kept() === 12)
  })
})
