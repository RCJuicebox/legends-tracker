import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../tempDir'
import type { CatalogItem } from '../../src/core/wikiItem'

// The second item source: eqlegendstools.com's pages for gear the wiki's catalog lacks, read once a
// week, kept on disk, and added to the catalog with the wiki's own pages winning.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir, getVersion: () => 'test' } }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => h.dir, dataDir: () => h.dir }))

const { ToolsCatalog } = await import('../../src/main/toolsCatalog')

const sitemap = (slugs: string[]) => `<urlset>${slugs.map((s) => `<url><loc>https://eqlegendstools.com/items/${s}/</loc></url>`).join('')}</urlset>`
const page = (title: string, slot: string) =>
  `<h1>${title}</h1><p class="tooltip-flags">No Trade</p><ul class="tooltip-lines"><li>Slot: ${slot}</li><li>AC: 10</li><li>Drops From: Nektropos Castle: Alexa Everling</li></ul>`
const wikiItem = (title: string): CatalogItem => ({ title, statsblock: 'Slot: CHEST<br>', icon: 600, focus: '', era: 'Classic', zones: [], mobs: [], quest: false, crafted: false })

describe('gear from eqlegendstools.com', () => {
  it("reads only the pages of items the wiki lacks, keeps them, and adds them to the wiki's catalog", async () => {
    h.dir = tempDir('lt-tools-catalog-')
    const asked: string[] = []
    let changes = 0
    const pages: Record<string, string> = {
      'https://eqlegendstools.com/sitemap.xml': sitemap(['pyrosilk-robe', 'cloak-of-flames', 'nektropos-private-chamber-key']),
      'https://eqlegendstools.com/items/pyrosilk-robe/': page('Pyrosilk Robe', 'CHEST'),
      'https://eqlegendstools.com/items/nektropos-private-chamber-key/': '<h1>Nektropos Private Chamber Key</h1><ul class="tooltip-lines"><li>WT: 0.1</li></ul>'
    }
    const fetchText = async (url: string) => {
      asked.push(url)
      if (!(url in pages)) throw new Error(`not asked for: ${url}`)
      return pages[url]
    }
    const wiki = [wikiItem('Cloak of Flames')]
    const tools = new ToolsCatalog(() => changes++, fetchText)
    expect(await tools.stamp()).toBe(0)
    expect(await tools.refresh(wiki)).toBe(true)
    // The wiki has the cloak: its page is not read.
    expect(asked).toEqual([
      'https://eqlegendstools.com/sitemap.xml',
      'https://eqlegendstools.com/items/pyrosilk-robe/',
      'https://eqlegendstools.com/items/nektropos-private-chamber-key/'
    ])
    expect(changes).toBe(1)
    expect((await tools.withWiki(wiki)).map((it) => it.title)).toEqual(['Cloak of Flames', 'Pyrosilk Robe'])
    expect(await tools.stamp()).toBeGreaterThan(0)
    // Fresh for a week: not read again.
    expect(await tools.refreshIfDue(async () => wiki)).toBe(false)

    // A later run reads what was kept from disk; once the wiki has the robe, the wiki's page wins.
    const again = new ToolsCatalog(() => {}, fetchText)
    expect((await again.items()).map((it) => it.title)).toEqual(['Pyrosilk Robe'])
    expect((await again.withWiki([...wiki, wikiItem('Pyrosilk Robe')])).filter((it) => it.title === 'Pyrosilk Robe')[0].icon).toBe(600)
  }, 20_000)

  it('reads nothing without the wiki catalog, and keeps what it had when the site fails', async () => {
    h.dir = tempDir('lt-tools-catalog-')
    const asked: string[] = []
    const tools = new ToolsCatalog(
      () => {},
      async (url) => {
        asked.push(url)
        throw new Error('offline')
      }
    )
    expect(await tools.refresh([])).toBe(false)
    expect(asked).toEqual([])
    expect(await tools.refresh([wikiItem('Cloak of Flames')])).toBe(false)
    expect(asked).toEqual(['https://eqlegendstools.com/sitemap.xml'])
    expect(await tools.items()).toEqual([])
    // A failure is not tried again at once.
    expect(await tools.refreshIfDue(async () => [wikiItem('Cloak of Flames')])).toBe(false)
  })
})
