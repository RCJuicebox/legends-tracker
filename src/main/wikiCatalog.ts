import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { CATALOG_FORMAT, parseItemPage, type CatalogItem } from '../core/wikiItem'
import { parseEraStatus } from '../core/upgrades'
import { log } from './log'
import { wiki, type WikiPage } from './sources/wiki'
import type { CatalogFile, WikiProgress } from '../shared/ipc'
import { cacheDir } from './paths'
import { sources } from './sources/registry'
import { jobs, type Job } from './sources/jobs'

// Every piece of equipment on eqlwiki.com, for the upgrade finder. The first download reads the wiki's
// Items category fifty pages a request (about 225 requests); later ones list its revisions (about 22
// requests) and read only the pages edited since. Only equipment is kept, in the app's own data,
// refreshed at most once a week.
const FRESH_MS = 7 * 24 * 3600_000

/** Bumped when what a download keeps changes, so an older file is fetched again. */
const FORMAT = CATALOG_FORMAT

export type { CatalogFile }
export type CatalogProgress = WikiProgress

/** How long the parsed catalog stays in memory after it was last asked for. */
const KEEP_MS = 60_000

export class WikiCatalog {
  // The catalog (some 10 MB parsed) is wanted only by the Gear pages and a download, so it is read
  // from disk when asked for and let go a minute later; what the status needs is kept on its own.
  private file: CatalogFile | null = null
  private summary: (Pick<CatalogFile, 'fetchedAt' | 'format'> & { count: number }) | null = null
  private forget: NodeJS.Timeout | null = null
  private running: Promise<CatalogFile | null> | null = null
  progress: CatalogProgress = { busy: false, pages: 0, total: 0, error: '' }
  private job: Job | null = null

  /** `onPages` sees every page read, so what else keeps item pages (the Gear page's item cache) can use them. */
  constructor(
    private readonly onProgress: (p: CatalogProgress) => void,
    private readonly onPages?: (pages: WikiPage[]) => void
  ) {}

  private get path(): string {
    return join(cacheDir(), 'item-catalog.json')
  }

  /** The stored catalog, whatever its age; null before the first download. */
  async stored(): Promise<CatalogFile | null> {
    if (!this.file) {
      try {
        this.hold(JSON.parse(await fs.readFile(this.path, 'utf8')) as CatalogFile)
        this.report({})
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') sources.fail('catalog', e)
        else sources.missing('catalog', 'Not downloaded yet: the Gear page offers to.')
        this.file = null
      }
    }
    this.forgetLater()
    return this.file
  }

  private hold(file: CatalogFile): void {
    this.file = file
    this.summary = { fetchedAt: file.fetchedAt, format: file.format, count: file.items.length }
  }

  private forgetLater(): void {
    if (this.forget) clearTimeout(this.forget)
    this.forget = setTimeout(() => {
      this.forget = null
      if (!this.running) this.file = null
    }, KEEP_MS)
    this.forget.unref()
  }

  isStale(file: Pick<CatalogFile, 'fetchedAt' | 'format'> | null): boolean {
    return !file || (file.format ?? 1) < FORMAT || Date.now() - file.fetchedAt > FRESH_MS
  }

  /** Downloads the catalog again. One download at a time; a second call waits for the first. */
  refresh(): Promise<CatalogFile | null> {
    this.running ??= jobs.run('catalog', 'Downloading the item catalog from eqlwiki', (job) => this.download(job)).finally(() => (this.running = null))
    return this.running
  }

  private report(p: Partial<CatalogProgress>): void {
    this.progress = { ...this.progress, ...p }
    this.onProgress(this.progress)
    if (this.progress.busy)
      this.job?.progress(this.progress.total ? this.progress.pages / this.progress.total : null, `${this.progress.pages} of ${this.progress.total || '?'} pages`)
    const file = this.summary
    if (this.progress.busy) sources.reading('catalog', `${this.progress.pages} of ${this.progress.total || '?'} pages`)
    else if (this.progress.error) sources.fail('catalog', new Error(this.progress.error))
    else if (file) {
      const what = `${file.count.toLocaleString()} items, from ${new Date(file.fetchedAt).toLocaleDateString()}`
      if (this.isStale(file)) sources.stale('catalog', what)
      else sources.ok('catalog', what)
    }
  }

  private async download(job: Job): Promise<CatalogFile | null> {
    this.job = job
    this.report({ busy: true, pages: 0, total: 0, error: '' })
    try {
      const old = await this.stored()
      const file = (old?.revs && (old.format ?? 1) >= FORMAT ? await this.update(old, job.signal) : null) ?? (await this.whole(job.signal))
      file.eraStatus = (await this.eraStatus()) ?? old?.eraStatus
      await writeFileAtomic(this.path, JSON.stringify(file))
      this.hold(file)
      this.forgetLater()
      this.report({ busy: false })
      return file
    } catch (e) {
      // Cancelled: the catalog kept before stays, and nothing failed.
      if (job.signal.aborted) this.report({ busy: false, error: '' })
      else {
        log.warn('Item catalog download failed', e)
        this.report({ busy: false, error: (e as Error).message })
      }
      this.forgetLater()
      return this.file
    }
  }

  /** Every page of the category, fifty a request (about 225 requests). */
  private async whole(signal: AbortSignal): Promise<CatalogFile> {
    this.report({ total: (await wiki.categorySize('Items')) ?? 11000 })
    const items: CatalogItem[] = []
    const revs: Record<string, number> = {}
    let pages = 0
    await wiki.category(
      'Items',
      (batch) => {
        this.onPages?.(batch)
        for (const p of batch) {
          if (p.revid) revs[p.title] = p.revid
          const item = parseItemPage(p.title, p.content)
          if (item) items.push(item)
        }
        pages += batch.length
        this.report({ pages })
      },
      'background',
      signal
    )
    return { fetchedAt: Date.now(), items, revs, format: FORMAT }
  }

  /**
   * Only what changed since the last download: the category's revision ids, five hundred a request,
   * then the pages that are new or edited. Null when so much changed that a whole download is as quick.
   */
  private async update(old: CatalogFile, signal: AbortSignal): Promise<CatalogFile | null> {
    const now = await wiki.revisions('Items')
    const before = old.revs ?? {}
    const changed = [...now].filter(([title, rev]) => before[title] !== rev).map(([title]) => title)
    if (changed.length > 2000) return null
    this.report({ total: changed.length })
    const edited = new Set(changed)
    const keep = old.items.filter((it) => now.has(it.title) && !edited.has(it.title))
    const revs: Record<string, number> = Object.fromEntries([...now].filter(([t]) => !edited.has(t)))
    const fresh = await wiki.pages(changed, 'background', signal)
    this.onPages?.([...fresh.values()])
    const items = [...keep]
    for (const title of changed) {
      const p = fresh.get(title)
      if (!p) continue
      revs[title] = p.revid ?? now.get(title)!
      const item = parseItemPage(p.title, p.content)
      if (item) items.push(item)
    }
    this.report({ pages: changed.length })
    log.info(`Item catalog: ${changed.length} page${changed.length === 1 ? '' : 's'} changed since the last download`)
    return { fetchedAt: Date.now(), items, revs, format: FORMAT }
  }

  /** The wiki's own list of which eras are live on EverQuest Legends; null to keep the last one (or the built-in list). */
  private async eraStatus(): Promise<Record<string, 'in' | 'out'> | null> {
    try {
      const parsed = parseEraStatus((await wiki.pages(['Template:PageEra'], 'background')).get('Template:PageEra')?.content ?? '')
      return Object.keys(parsed).length ? parsed : null
    } catch (e) {
      log.warn('Could not read the era list from eqlwiki', e)
      return null
    }
  }
}
