import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { baseName, itemKey } from '../core/inventory'
import { parseItemUse, statsblockOf } from '../core/wikiItem'
import { wiki, type WikiPage } from './sources/wiki'
import type { ItemInfo } from '../shared/types'
import { log } from './log'
import { sources } from './sources/registry'
import { expired } from './sources/freshness'

// Item stats come from eqlwiki.com, the community wiki for EverQuest Legends: each item page carries
// the in-game stats block. Only the items the player asks about are looked up, a batch at a time,
// and kept in the app's data so each is fetched once a week at most.

interface Cached extends ItemInfo {
  fetchedAt: number
}

/**
 * item-cache.json's shape, written as `{ format, items }` (LT-415): a change to what an entry keeps
 * bumps it, and an older file's entries are fetched again as they are asked for. A file from before
 * the format was written is the bare record, and counts as 1.
 */
const ITEM_FORMAT = 2
/** An entry not asked for in this long (its last fetch is older, as any asked for is fetched weekly) goes at the next save. */
const UNUSED_MS = 90 * 86_400_000
/** A name the wiki could not be asked about is not asked about again for this long (LT-412). */
const RETRY_MS = 10 * 60_000
/** Pages from a catalog download are written once it has gone quiet this long, not per batch (LT-414). */
const QUIET_SAVE_MS = 15_000

export class ItemCatalog {
  private cache: Record<string, Cached> | null = null
  /** Writes one after another, so two never share the .tmp file (LT-420). */
  private saving: Promise<void> = Promise.resolve()
  /** Lookups under way, by itemKey: a name asked for again meanwhile waits for the same one (LT-412). */
  private readonly fetching = new Map<string, Promise<void>>()
  /** When a name last could not be looked up. */
  private readonly failedAt = new Map<string, number>()
  private quietSave: NodeJS.Timeout | null = null

  /** `cacheDir`: the app's cache folder (main/paths.ts cacheDir()), where item-cache.json is kept. */
  constructor(private readonly cacheDir: string) {}

  private get path(): string {
    return join(this.cacheDir, 'item-cache.json')
  }

  private async load(): Promise<Record<string, Cached>> {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(await fs.readFile(this.path, 'utf8')) as { format?: unknown; items?: unknown } & Record<string, Cached>
      const shaped = typeof raw.format === 'number' && raw.items && typeof raw.items === 'object'
      const items = (shaped ? raw.items : raw) as Record<string, Cached>
      const format = shaped ? (raw.format as number) : 1
      // Entries kept in an older shape count as never fetched: each is fetched again as it is asked for.
      this.cache = format >= ITEM_FORMAT || format === 1 ? items : Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { ...v, fetchedAt: 0 }]))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('The item cache could not be read; starting it afresh', e)
      this.cache = {}
    }
    return this.cache
  }

  private save(): Promise<void> {
    const run = this.saving.then(() => {
      const cache = this.cache ?? {}
      const old = Date.now() - UNUSED_MS
      for (const [k, v] of Object.entries(cache)) if (v.fetchedAt < old) delete cache[k]
      return writeFileAtomic(this.path, JSON.stringify({ format: ITEM_FORMAT, items: cache }))
    })
    this.saving = run.catch(() => undefined)
    return run
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
        expired(cache[k].fetchedAt) ||
        (cache[k].found && (cache[k].icon === undefined || cache[k].use === undefined || cache[k].use.vendors === undefined || cache[k].use.sources === undefined))
    )
    // Names being looked up already are waited for, not asked again; names that failed lately are
    // left for now, and what is cached serves.
    const now = Date.now()
    const busy = stale.filter(([k]) => this.fetching.has(k)).map(([k]) => this.fetching.get(k)!)
    const ask = stale.filter(([k]) => !this.fetching.has(k) && (force || now - (this.failedAt.get(k) ?? 0) >= RETRY_MS))
    if (ask.length) {
      const run = (async () => {
        try {
          await this.fetchInto(cache, ask)
          for (const [k] of ask) this.failedAt.delete(k)
          await this.save()
          sources.ok('items', `${Object.keys(cache).length} items looked up and kept`)
        } catch (e) {
          // Offline or the wiki is down: what is cached still serves, however old.
          for (const [k] of ask) this.failedAt.set(k, Date.now())
          sources.fail('items', e, `${ask.length} item(s) could not be looked up; the ones kept serve meanwhile`)
        }
      })()
      for (const [k] of ask) this.fetching.set(k, run)
      void run.finally(() => {
        for (const [k] of ask) if (this.fetching.get(k) === run) this.fetching.delete(k)
      })
      busy.push(run)
    }
    await Promise.all(busy)
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
    if (!changed) return
    if (this.quietSave) clearTimeout(this.quietSave)
    this.quietSave = setTimeout(() => {
      this.quietSave = null
      void this.save().catch((e) => log.warn('Could not save the item cache', e))
    }, QUIET_SAVE_MS)
    this.quietSave.unref?.()
  }

  /** Writes what a catalog download brought, if it is still waiting to be. */
  async flush(): Promise<void> {
    if (!this.quietSave) return
    clearTimeout(this.quietSave)
    this.quietSave = null
    await this.save().catch((e) => log.warn('Could not save the item cache', e))
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
