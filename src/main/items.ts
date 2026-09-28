import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { baseName, itemKey } from '../core/inventory'
import { parseItemUse, statsblockOf } from '../core/wikiItem'
import { wiki, type WikiPage } from './sources/wiki'
import type { ItemInfo } from '../shared/types'
import { log } from './log'
import { sources } from './sources/registry'

// Item stats come from eqlwiki.com, the community wiki for EverQuest Legends: each item page carries
// the in-game stats block. Only the items the player asks about are looked up, a batch at a time,
// and kept in the app's data so each is fetched once a week at most.
const FRESH_MS = 7 * 24 * 3600_000

interface Cached extends ItemInfo {
  fetchedAt: number
}

export class ItemCatalog {
  private cache: Record<string, Cached> | null = null
  private saving: Promise<void> | null = null

  /** `cacheDir`: the app's cache folder (main/paths.ts cacheDir()), where item-cache.json is kept. */
  constructor(private readonly cacheDir: string) {}

  private get path(): string {
    return join(this.cacheDir, 'item-cache.json')
  }

  private async load(): Promise<Record<string, Cached>> {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.readFile(this.path, 'utf8')) as Record<string, Cached>
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('The item cache could not be read; starting it afresh', e)
      this.cache = {}
    }
    return this.cache
  }

  private async save(): Promise<void> {
    await this.saving
    this.saving = fs.writeFile(this.path + '.tmp', JSON.stringify(this.cache), 'utf8').then(() => fs.rename(this.path + '.tmp', this.path))
    await this.saving
  }

  /**
   * What the wiki has for each name, keyed by itemKey(). Names not cached, or cached over a week ago,
   * are fetched; `force` refetches all of them. A name with no page comes back with found: false.
   */
  async lookup(names: string[], force = false): Promise<Record<string, ItemInfo>> {
    const cache = await this.load()
    const wanted = new Map<string, string>()
    for (const n of Array.isArray(names) ? names : []) if (n && typeof n === 'string') wanted.set(itemKey(n), baseName(n))
    // Entries cached before icons, or before what an item is for, were kept have no such field; fetch those again once.
    const stale = [...wanted].filter(
      ([k]) =>
        force ||
        !cache[k] ||
        Date.now() - cache[k].fetchedAt > FRESH_MS ||
        (cache[k].found && (cache[k].icon === undefined || cache[k].use === undefined || cache[k].use.vendors === undefined || cache[k].use.sources === undefined))
    )
    if (stale.length) {
      try {
        await this.fetchInto(cache, stale)
        await this.save()
        sources.ok('items', `${Object.keys(cache).length} items looked up and kept`)
      } catch (e) {
        // Offline or the wiki is down: what is cached still serves, however old.
        sources.fail('items', e, `${stale.length} item(s) could not be looked up; the ones kept serve meanwhile`)
      }
    }
    const out: Record<string, ItemInfo> = {}
    for (const k of wanted.keys()) if (cache[k]) out[k] = strip(cache[k])
    return out
  }

  /**
   * Pages read for another reason (a catalog download): any item already cached is brought up to
   * date from them, so it is not fetched again on its own.
   */
  async refreshFrom(pages: WikiPage[]): Promise<void> {
    const cache = await this.load()
    const now = Date.now()
    let changed = false
    for (const [key, info] of this.parse(new Map(pages.map((p) => [p.title, p])))) {
      if (!cache[key]) continue
      cache[key] = { ...info, fetchedAt: now }
      changed = true
    }
    if (changed) await this.save().catch((e) => log.warn('Could not save the item cache', e))
  }

  private async fetchInto(cache: Record<string, Cached>, items: [string, string][]): Promise<void> {
    const now = Date.now()
    const misses: [string, string][] = []
    const pages = this.parse(await wiki.pages(items.map(([, title]) => title)))
    for (const [key, title] of items) {
      const page = pages.get(itemKey(title))
      if (page) cache[key] = { ...page, fetchedAt: now }
      else misses.push([key, title])
    }
    // Names that are not exact page titles (a page titled "Shiverback-hide Boots" for the game's
    // "Shiverback-Hide Boots"): search, and take a result that is the same name once case and
    // punctuation are ignored.
    for (const [key, title] of misses.slice(0, 40)) {
      // A slow wiki gets a minute of searching; the rest are tried at the next lookup.
      if (Date.now() - now > 60_000) break
      const hit = (await wiki.search(title).catch((e) => (log.warn(`eqlwiki search for ${title} failed`, e), []))).find((t) => itemKey(t) === key)
      const page = hit ? this.parse(await wiki.pages([hit])).get(itemKey(hit)) : undefined
      cache[key] = page ? { ...page, fetchedAt: now } : { title, found: false, statsblock: '', fetchedAt: now }
    }
  }

  /** What each page says of its item, keyed by itemKey() of every title it answers for. */
  private parse(pages: Map<string, WikiPage>): Map<string, ItemInfo> {
    const out = new Map<string, ItemInfo>()
    for (const [asked, p] of pages) {
      const statsblock = statsblockOf(p.content)
      const use = parseItemUse(p.content)
      // A page with no stats block is still the item's page when it says what the item is for.
      if (!statsblock && !use.notes && !use.quests.length && !use.recipes.length) continue
      const icon = Number(/\|\s*lucy_img_ID\s*=\s*(\d+)/.exec(p.content)?.[1] ?? 0)
      const info: ItemInfo = { title: p.title, found: true, statsblock, icon, use }
      out.set(itemKey(asked), info)
      out.set(itemKey(p.title), info)
    }
    return out
  }
}

function strip(c: Cached): ItemInfo {
  return { title: c.title, found: c.found, statsblock: c.statsblock, icon: c.icon, fetchedAt: c.fetchedAt, ...(c.use ? { use: c.use } : {}) }
}
