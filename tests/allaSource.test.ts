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
const { factionKey } = await import('../src/features/factions/core')
const { ALLA_INDEX_URL, allaPageUrl } = await import('../src/features/factions/allakhazam')

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
 * while other test files run: each step waits for it (event-loop turns, up to eight real seconds in all).
 */
async function until(cond: () => boolean): Promise<void> {
  const give = performance.now() + 8_000
  while (!cond() && performance.now() < give) {
    await vi.advanceTimersByTimeAsync(5_000)
    for (let j = 0; j < 20 && !cond(); j++) await new Promise<void>((r) => setImmediate(r))
  }
  expect(cond()).toBe(true)
}

const kept = () => (existsSync(file) ? Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { pages: object }).pages).length : 0)
/**
 * Whether the reader has stopped, its pages written. The file is read only then: read while the
 * reader writes it, Windows refuses the rename that replaces it.
 */
const idle = (alla: object) => (alla as { running: Promise<void> | null }).running === null
const DAY = 24 * 3600_000

/** The site stood in for by what `answer` says for each address; each address asked is kept in `asked`. */
function site(answer: (url: string) => { status?: number; body: string }): { asked: string[]; agents: string[] } {
  const asked: string[] = []
  const agents: string[] = []
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    asked.push(url)
    agents.push(init?.headers?.['User-Agent'] ?? '')
    const { status = 200, body } = answer(url)
    return new Response(body, { status })
  })
  return { asked, agents }
}
const listing = (ids: Record<string, number>) =>
  Object.entries(ids)
    .map(([name, id]) => `<a href="/db/faction.html?faction=${id}">${name}</a>`)
    .join('\n')

describe('Allakhazam pages', () => {
  it("reads the latest caller's factions first, as the pages go", async () => {
    const alla = new FactionAlla()
    await alla.factions(['Faction A', 'Faction B'])
    // A second character picked while the first page is read: theirs go next.
    await alla.factions(['Faction C', 'Faction D'])
    await until(() => fetched.length === 4)
    expect(fetched).toEqual([1, 3, 4, 2])
    // Written once reading stops.
    await until(() => idle(alla))
    expect(kept()).toBe(4)
  }, 20_000)

  it('writes the pages read every ten, and the rest when reading stops', async () => {
    const onDisk: number[] = []
    onFetch = () => onDisk.push(kept())
    const alla = new FactionAlla()
    await alla.factions(NAMES.slice(0, 12))
    await until(() => alla.status().read === 12)
    // Nothing written before the tenth page; the ten when the eleventh is asked for.
    expect(onDisk.slice(0, 10)).toEqual(Array(10).fill(0))
    expect(onDisk[10]).toBe(10)
    await until(() => idle(alla))
    expect(kept()).toBe(12)
  }, 20_000)

  it("reads the site's list of factions first when none is kept, or what is kept is from another version or broken", async () => {
    const fresh = { fetchedAt: Date.now(), ids: { [factionKey('Faction A')]: 1 } }
    for (const start of [JSON.stringify({ version: 1, index: null, pages: {} }), JSON.stringify({ version: 0, index: fresh, pages: {} }), '{ not json']) {
      writeFileSync(file, start)
      const { asked, agents } = site((url) => ({ body: url === ALLA_INDEX_URL ? listing({ 'Faction A': 7 }) : PAGE }))
      const alla = new FactionAlla()
      await alla.factions(['Faction A'])
      await until(() => asked.length === 2 && idle(alla))
      expect(asked).toEqual([ALLA_INDEX_URL, allaPageUrl(7)])
      expect(kept()).toBe(1)
      // As itself, as the site's robots.txt is read.
      expect(agents.every((a) => a.startsWith('LegendsTracker/test '))).toBe(true)
      expect((JSON.parse(readFileSync(file, 'utf8')) as { index: { ids: object } }).index.ids).toEqual({ [factionKey('Faction A')]: 7 })
      expect(alla.status()).toEqual({ read: 1, wanted: 1, error: '' })
      expect(await alla.factions(['Faction A'])).toHaveLength(1)
    }
  }, 20_000)

  it('stops when the site cannot be read, says why, and tries again ten minutes later', async () => {
    writeFileSync(file, JSON.stringify({ version: 1, index: null, pages: {} }))
    let list = '<html>Down for maintenance</html>'
    const { asked } = site((url) => ({ body: url === ALLA_INDEX_URL ? list : PAGE }))
    const alla = new FactionAlla()
    await alla.factions(['Faction A', 'Faction B'])
    await until(() => idle(alla))
    expect(alla.status().error).toBe("Allakhazam's list of factions held none: the page may have changed")
    // Asked again within the ten minutes: nothing is read.
    await vi.advanceTimersByTimeAsync(9 * 60_000)
    await alla.factions(['Faction A'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toEqual([ALLA_INDEX_URL])
    list = listing({ 'Faction A': 1, 'Faction B': 2 })
    await vi.advanceTimersByTimeAsync(60_000)
    await alla.factions(['Faction A'])
    await until(() => asked.length === 4 && idle(alla))
    expect(asked).toEqual([ALLA_INDEX_URL, ALLA_INDEX_URL, allaPageUrl(1), allaPageUrl(2)])
    expect(alla.status().error).toBe('')
    expect(kept()).toBe(2)
  }, 20_000)

  it('says what the site answered for a page it would not give', async () => {
    const { asked } = site(() => ({ status: 503, body: '' }))
    const alla = new FactionAlla()
    await alla.factions(['Faction A', 'Faction B'])
    await until(() => idle(alla))
    expect(alla.status().error).toBe(`Allakhazam answered 503 for ${allaPageUrl(1)}`)
    expect(asked).toEqual([allaPageUrl(1)])
    expect(kept()).toBe(0)
  }, 20_000)

  it('does not keep a page laid out as it does not know, and asks for it again only the next day', async () => {
    // Titled as the site titles a faction, with none of the headings the reader looks for.
    let odd = true
    const changed = (name: string) => `<html><title>${name} :: Allakhazam</title><body>A new look</body></html>`
    const { asked } = site((url) => {
      const id = Number(/faction=(\d+)/.exec(url)?.[1])
      return { body: odd && id <= 4 ? changed(NAMES[id - 1]) : PAGE }
    })
    const alla = new FactionAlla()
    await alla.factions(NAMES.slice(0, 5))
    await until(() => asked.length === 5 && idle(alla))
    expect(alla.status().error).toBe("4 pages (Faction A, Faction B, Faction C, …) did not look like Allakhazam's faction pages: the site may have changed")
    expect(alla.status()).toMatchObject({ read: 1, wanted: 5 })
    expect(kept()).toBe(1)
    // Asked again the same day: the odd pages are not read again, and still named.
    await alla.factions(['Faction A'])
    await until(() => idle(alla))
    expect(asked).toHaveLength(5)
    expect(alla.status().error).toMatch(/^4 pages /)
    odd = false
    vi.setSystemTime(Date.now() + DAY)
    await alla.factions(['Faction A'])
    await until(() => alla.status().read === 5 && idle(alla))
    expect(asked.slice(5)).toEqual([1, 2, 3, 4].map(allaPageUrl))
    expect(alla.status().error).toBe('')
    expect(kept()).toBe(5)
  }, 20_000)
})
