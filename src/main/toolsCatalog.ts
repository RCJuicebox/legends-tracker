import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { itemKey } from '../core/inventory'
import { parseToolsItemPage, TOOLS_SITEMAP_URL, toolsItemSlugs, toolsItemUrl, toolsSlugs } from '../core/toolsItem'
import type { CatalogItem } from '../core/wikiItem'
import { num } from '../core/format'
import { cacheDir } from './paths'
import { log } from './log'
import { JsonFile } from './storeCore'
import { sources } from './sources/registry'
import { expired } from './sources/freshness'
import { jobs, throwIfCancelled } from './sources/jobs'

// Gear eqlwiki has no page for yet (a new zone's drops), from eqlegendstools.com: its sitemap names
// every item page, and the pages for items the wiki's catalog lacks are read, one at a time, a moment
// apart, as the tracker. What they hold is kept a week; then the sitemap and those pages are read
// again (its sitemap dates every page by the site's last build, so it cannot say which changed).
// The catalog the Gear tools get is the wiki's with these added, the wiki's own page winning.

const GAP_MS = 1500
/** After a failed read, how long before trying the site again. */
const RETRY_MS = 30 * 60_000
/** Bumped when what is kept of a page changes, so pages read by an older build are read again. */
const CACHE_VERSION = 1

interface ToolsFile {
  version: number
  /** When the last whole pass (the sitemap, then every page wanted) ended; 0 before the first. */
  fetchedAt: number
  /** Each page read, by slug; null when it held no piece of equipment. */
  pages: Record<string, { fetchedAt: number; item: CatalogItem | null }>
}

const userAgent = () => `LegendsTracker/${app?.getVersion?.() ?? 'dev'} (https://github.com/RCJuicebox/legends-tracker)`

export class ToolsCatalog {
  private file: ToolsFile | null = null
  private disk: JsonFile<ToolsFile> | null = null
  private running: Promise<boolean> | null = null
  private failedAt = 0
  private last = 0

  /** `onChange`: what is kept changed, for the Gear tools to read the catalog again. */
  constructor(
    private readonly onChange: () => void,
    private readonly fetchText: (url: string) => Promise<string> = defaultFetch
  ) {}

  private get path(): string {
    return join(cacheDir(), 'tools-items.json')
  }

  private async load(): Promise<ToolsFile> {
    if (this.file) return this.file
    try {
      const f = JSON.parse(await fs.readFile(this.path, 'utf8')) as ToolsFile
      if (f.version === CACHE_VERSION && f.pages) this.file = f
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read tools-items.json; reading eqlegendstools.com again', e)
    }
    this.file ??= { version: CACHE_VERSION, fetchedAt: 0, pages: {} }
    this.disk = new JsonFile(this.path, this.file, { pretty: false })
    this.report()
    return this.file
  }

  /** When the last whole pass ended (0 before the first): the catalog the Gear tools hold is dated by it too. */
  async stamp(): Promise<number> {
    return (await this.load()).fetchedAt
  }

  /** The pieces of equipment kept. */
  async items(): Promise<CatalogItem[]> {
    const f = await this.load()
    return Object.values(f.pages).flatMap((p) => (p.item ? [p.item] : []))
  }

  /** The wiki's catalog with the kept pieces it has no page for added. */
  async withWiki(wiki: CatalogItem[]): Promise<CatalogItem[]> {
    const have = new Set(wiki.map((it) => itemKey(it.title)))
    const extra = (await this.items()).filter((it) => !have.has(itemKey(it.title)))
    return extra.length ? [...wiki, ...extra] : wiki
  }

  /** Reads the site again when what is kept is a week old (or none is), in the background; whether it is due. */
  async refreshIfDue(wiki: () => Promise<CatalogItem[] | null | undefined>): Promise<boolean> {
    const f = await this.load()
    if (!expired(f.fetchedAt || undefined) || this.running || Date.now() - this.failedAt < RETRY_MS) return false
    const items = await wiki()
    if (!items?.length) return false
    void this.refresh(items)
    return true
  }

  /** One pass: the sitemap, then the page of each item the wiki lacks. One pass at a time; whether anything kept changed. */
  refresh(wiki: CatalogItem[]): Promise<boolean> {
    this.running ??= jobs.run('toolsCatalog', 'Reading new gear from eqlegendstools.com', (job) => this.pass(wiki, job.signal, job.progress)).finally(() => (this.running = null))
    return this.running
  }

  private async pass(wiki: CatalogItem[], signal: AbortSignal, progress: (fraction: number | null, detail?: string) => void): Promise<boolean> {
    const f = await this.load()
    try {
      // Without the wiki's catalog every page would be wanted: a thousand reads for what the wiki mostly has.
      if (!wiki.length) throw new Error('The item catalog from eqlwiki is not downloaded yet: the Gear page offers to')
      sources.reading('toolsCatalog', 'Reading the sitemap')
      const onWiki = new Set(wiki.flatMap((it) => toolsSlugs(it.title)))
      const slugs = toolsItemSlugs(await this.fetchPage(TOOLS_SITEMAP_URL))
      if (!slugs.length) throw new Error('The sitemap of eqlegendstools.com listed no item pages: the site may have changed')
      const wanted = slugs.filter((s) => !onWiki.has(s))
      let changed = false
      // Pages no longer listed, or that the wiki now has, are let go.
      for (const slug of Object.keys(f.pages))
        if (!wanted.includes(slug)) {
          delete f.pages[slug]
          changed = true
        }
      let read = 0
      for (const slug of wanted) {
        throwIfCancelled(signal)
        progress(read / wanted.length, `${num(read)} of ${num(wanted.length)} pages`)
        sources.reading('toolsCatalog', `${num(read)} of ${num(wanted.length)} pages`)
        const item = parseToolsItemPage(await this.fetchPage(toolsItemUrl(slug)), slug)
        const had = f.pages[slug]?.item ?? null
        if (JSON.stringify(had) !== JSON.stringify(item)) changed = true
        f.pages[slug] = { fetchedAt: Date.now(), item }
        read++
      }
      f.fetchedAt = Date.now()
      this.disk?.markDirty()
      await this.disk?.flush()
      this.report()
      log.info(`eqlegendstools.com: ${wanted.length} item pages the wiki lacks read; ${(await this.items()).length} pieces of equipment kept`)
      if (changed) this.onChange()
      return changed
    } catch (e) {
      // What was read before stays; the pages read this time are kept for the next try.
      this.disk?.markDirty()
      await this.disk?.flush()
      if (signal.aborted) {
        this.report()
        return false
      }
      this.failedAt = Date.now()
      log.warn('Reading eqlegendstools.com failed', e)
      sources.fail('toolsCatalog', e)
      return false
    }
  }

  /** One page, a moment after the one before. */
  private async fetchPage(url: string): Promise<string> {
    const wait = this.last + GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last = Date.now()
    return this.fetchText(url)
  }

  private report(): void {
    const f = this.file
    if (!f) return
    if (!f.fetchedAt) return sources.missing('toolsCatalog', 'Not read yet: the Gear tools read it when they open.')
    const n = Object.values(f.pages).filter((p) => p.item).length
    const what = `${num(n)} item${n === 1 ? '' : 's'} eqlwiki lacks, from ${new Date(f.fetchedAt).toLocaleDateString()}`
    if (expired(f.fetchedAt)) sources.stale('toolsCatalog', what)
    else sources.ok('toolsCatalog', what)
  }
}

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`eqlegendstools.com answered ${res.status} for ${url}`)
  return res.text()
}
