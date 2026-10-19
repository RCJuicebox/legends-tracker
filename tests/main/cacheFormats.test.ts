import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../tempDir'

// The cache files' formats and their migrations, each round-tripped through a temp folder (LT-628):
// an older format read, brought forward, saved and read again.

const h = vi.hoisted(() => ({ dir: '', wikiCalls: 0 }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => h.dir, dataDir: () => h.dir }))
vi.mock('../../src/main/sources/wiki', () => ({
  wiki: {
    pages: async () => {
      h.wikiCalls++
      return new Map()
    },
    search: async () => [],
    // A whole catalog download that brings back a page with no item on it.
    categorySize: async () => 1,
    category: async (_name: string, onBatch: (pages: { title: string; content: string; revid: number }[]) => void) => {
      h.wikiCalls++
      onBatch([{ title: 'Not An Item', content: '', revid: 1 }])
    }
  }
}))

const { ItemCatalog } = await import('../../src/main/items')
const { RecipeBook } = await import('../../src/main/recipes')
const { WikiCatalog } = await import('../../src/main/wikiCatalog')
const { TradeFavorites } = await import('../../src/main/tradeFavorites')
const { InventoryFiles } = await import('../../src/main/inventory')
const { CATALOG_FORMAT } = await import('../../src/core/wikiItem')

beforeEach(async () => {
  h.dir = tempDir('lt-cache-')
  h.wikiCalls = 0
})
afterEach(async () => {
  // A timed write can still land as the folder goes (ENOTEMPTY under a full run): tried again.
  await fs.rm(h.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const DAY = 86_400_000
const full = (title: string, fetchedAt: number) => ({
  title,
  found: true,
  statsblock: 'AC: 10',
  icon: 500,
  fetchedAt,
  use: { notes: '', quests: [], recipes: [], value: '', vendors: [], sources: {} }
})

describe('item-cache.json', () => {
  it('reads format 2 as kept, serves it without the wiki, and evicts what nobody asked for in ninety days at the next save', async () => {
    const now = Date.now()
    await fs.writeFile(
      join(h.dir, 'item-cache.json'),
      JSON.stringify({ format: 2, items: { 'fine steel dagger': full('Fine Steel Dagger', now), 'old thing': full('Old Thing', now - 100 * DAY) } })
    )
    const c = new ItemCatalog(h.dir)
    const got = await c.lookup(['Fine Steel Dagger'])
    expect(got['fine steel dagger']).toMatchObject({ title: 'Fine Steel Dagger', found: true, icon: 500 })
    expect(h.wikiCalls).toBe(0)
    // The old entry is asked for: stale, the wiki has no page, so it is kept as not found and the file is saved in the current format.
    await c.lookup(['Old Thing'])
    expect(h.wikiCalls).toBe(1)
    const saved = JSON.parse(await fs.readFile(join(h.dir, 'item-cache.json'), 'utf8'))
    expect(saved.format).toBe(2)
    expect(Object.keys(saved.items)).toEqual(['fine steel dagger', 'old thing'])
    expect(saved.items['old thing']).toMatchObject({ found: false })
  })

  it('reads a bare record from before the format was written as format 1, and keeps its entries', async () => {
    const now = Date.now()
    await fs.writeFile(join(h.dir, 'item-cache.json'), JSON.stringify({ 'fine steel dagger': full('Fine Steel Dagger', now) }))
    const c = new ItemCatalog(h.dir)
    expect((await c.lookup(['Fine Steel Dagger']))['fine steel dagger']).toMatchObject({ found: true })
    expect(h.wikiCalls).toBe(0)
  })

  it('starts afresh from a file that will not read', async () => {
    await fs.writeFile(join(h.dir, 'item-cache.json'), 'not json')
    const c = new ItemCatalog(h.dir)
    expect(await c.lookup([])).toEqual({})
  })
})

describe('tradeskill-recipes.json', () => {
  it('is stale in an older format or a week on, and current as written', async () => {
    const book = new RecipeBook(() => {})
    expect(await book.stored()).toBeNull()
    const now = Date.now()
    await fs.writeFile(join(h.dir, 'tradeskill-recipes.json'), JSON.stringify({ fetchedAt: now, format: 2, recipes: [], eras: {} }))
    const old = await new RecipeBook(() => {}).stored()
    expect(old).not.toBeNull()
    expect(book.isStale(old)).toBe(true)
    expect(book.isStale({ fetchedAt: now, format: 3, recipes: [], eras: {} })).toBe(false)
    expect(book.isStale({ fetchedAt: now - 8 * DAY, format: 3, recipes: [], eras: {} })).toBe(true)
  })
})

describe('item-catalog.json and its meta file', () => {
  it('writes the meta file for a catalog kept before it existed, and the next start reads the meta alone', async () => {
    const now = Date.now()
    await fs.writeFile(join(h.dir, 'item-catalog.json'), JSON.stringify({ fetchedAt: now, format: CATALOG_FORMAT, items: [{ name: 'x' }], revs: {} }))
    const c = new WikiCatalog(() => {})
    expect(await c.stamp()).toMatchObject({ fetchedAt: now, format: CATALOG_FORMAT })
    // The meta file is written in the background: a moment later it is there.
    for (let i = 0; i < 100 && !existsSync(join(h.dir, 'item-catalog.meta.json')); i++) await new Promise((r) => setTimeout(r, 10))
    expect(existsSync(join(h.dir, 'item-catalog.meta.json'))).toBe(true)
    // The catalog file gone: the meta still answers, and the stored catalog is null.
    await fs.rm(join(h.dir, 'item-catalog.json'))
    const next = new WikiCatalog(() => {})
    expect(await next.stamp()).toEqual({ fetchedAt: now, format: CATALOG_FORMAT, count: 1 })
    expect(next.isStale(await next.stamp())).toBe(false)
    expect(next.isStale({ fetchedAt: now, format: CATALOG_FORMAT - 1 })).toBe(true)
  })
})

describe('an item catalog download that comes back far smaller', () => {
  it('keeps the catalog it has and says why (LT-621)', async () => {
    const kept = {
      fetchedAt: Date.now() - 30 * DAY,
      format: CATALOG_FORMAT - 1,
      items: Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}`, title: `Item ${i}` })),
      revs: {}
    }
    await fs.writeFile(join(h.dir, 'item-catalog.json'), JSON.stringify(kept))
    const c = new WikiCatalog(() => {})
    const file = await c.refresh()
    expect(h.wikiCalls).toBe(1)
    expect(file?.items).toHaveLength(10)
    expect(c.progress.error).toMatch(/had 0 items where 10 are kept/)
    expect(JSON.parse(await fs.readFile(join(h.dir, 'item-catalog.json'), 'utf8')).items).toHaveLength(10)
  })
})

describe('tradeskills.json', () => {
  it('round-trips, reads a file with a byte-order mark, and starts empty from one of the wrong shape', async () => {
    const path = join(h.dir, 'tradeskills.json')
    const t = new TradeFavorites(path)
    expect(await t.get()).toEqual({ favorites: [], prices: {} })
    const tonic = { key: 'tumpy tonic|Tumpy Tonic', product: 'Tumpy Tonic', combines: 3 }
    await t.set({ favorites: [tonic], prices: { 'small vial': 12 } })
    expect(await new TradeFavorites(path).get()).toEqual({ favorites: [tonic], prices: { 'small vial': 12 } })
    await fs.writeFile(path, '﻿{"favorites":[{"key":"a|A","product":"A"}],"prices":{}}', 'utf8')
    expect(await new TradeFavorites(path).get()).toEqual({ favorites: [{ key: 'a|A', product: 'A', combines: 1 }], prices: {} })
    await fs.writeFile(path, '[1,2,3]')
    expect(await new TradeFavorites(path).get()).toEqual({ favorites: [], prices: {} })
    // An object with neither field is an empty save; a list is not a save at all.
    expect(await t.set({ nonsense: true })).toEqual({ favorites: [], prices: {} })
    await expect(t.set([1, 2, 3])).rejects.toThrow(/not in the expected form/)
  })
})

describe('a character sheet', () => {
  it('reads what was saved, fills what an older sheet lacks, and starts afresh from the wrong shape', async () => {
    const files = new InventoryFiles(
      h.dir,
      () => h.dir,
      new ItemCatalog(h.dir),
      () => {},
      () => false
    )
    expect(await files.sheet('Kelwyn_neriak')).toEqual({ acOverrides: {}, shield: null, stats: {} })
    await files.saveSheet('Kelwyn_neriak', { acOverrides: { 'fine steel dagger': 12 }, shield: null, stats: { ac: 900 } })
    expect(await files.sheet('Kelwyn_neriak')).toMatchObject({ acOverrides: { 'fine steel dagger': 12 }, stats: { ac: 900 } })
    await fs.writeFile(join(h.dir, 'characters', 'Kelwyn_neriak.json'), '{"acOverrides": {"x": 5}}')
    expect(await files.sheet('Kelwyn_neriak')).toMatchObject({ acOverrides: { x: 5 }, shield: null, stats: {} })
    await fs.writeFile(join(h.dir, 'characters', 'Kelwyn_neriak.json'), '"a string"')
    expect(await files.sheet('Kelwyn_neriak')).toEqual({ acOverrides: {}, shield: null, stats: {} })
  })
})
