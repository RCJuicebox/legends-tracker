import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { CATALOG_FORMAT, parseItemPage, type CatalogItem } from '../core/wikiItem'
import { parseEraStatus } from '../core/upgrades'

// Every piece of equipment on eqlwiki.com, for the upgrade finder. The wiki's Items category is read
// fifty pages a request (about 225 requests for the whole of it), politely and one at a time; only
// equipment is kept, and it is stored in the app's own data, refreshed at most once a week.
const API = 'https://eqlwiki.com/api.php'
const AGENT = 'LegendsTracker (https://github.com/RCJuicebox/legends-tracker)'
const FRESH_MS = 7 * 24 * 3600_000

/** Bumped when what a download keeps changes, so an older file is fetched again. */
const FORMAT = CATALOG_FORMAT

export interface CatalogFile {
  fetchedAt: number
  items: CatalogItem[]
  /** The wiki's in/out era list (Template:PageEra), as it stood at the download. */
  eraStatus?: Record<string, 'in' | 'out'>
  format?: number
}

export interface CatalogProgress {
  busy: boolean
  pages: number
  total: number
  error: string
}

export class WikiCatalog {
  private file: CatalogFile | null = null
  private running: Promise<CatalogFile | null> | null = null
  progress: CatalogProgress = { busy: false, pages: 0, total: 0, error: '' }

  constructor(private readonly onProgress: (p: CatalogProgress) => void) {}

  private get path(): string {
    return join(app.getPath('userData'), 'item-catalog.json')
  }

  /** The stored catalog, whatever its age; null before the first download. */
  async stored(): Promise<CatalogFile | null> {
    if (this.file) return this.file
    try {
      this.file = JSON.parse(await fs.readFile(this.path, 'utf8')) as CatalogFile
    } catch {
      this.file = null
    }
    return this.file
  }

  isStale(file: CatalogFile | null): boolean {
    return !file || (file.format ?? 1) < FORMAT || Date.now() - file.fetchedAt > FRESH_MS
  }

  /** Downloads the catalog again. One download at a time; a second call waits for the first. */
  refresh(): Promise<CatalogFile | null> {
    this.running ??= this.download().finally(() => (this.running = null))
    return this.running
  }

  private report(p: Partial<CatalogProgress>): void {
    this.progress = { ...this.progress, ...p }
    this.onProgress(this.progress)
  }

  private async download(): Promise<CatalogFile | null> {
    this.report({ busy: true, pages: 0, total: 0, error: '' })
    try {
      const info = (await this.get(`${API}?action=query&format=json&formatversion=2&prop=categoryinfo&titles=Category:Items`)) as {
        query?: { pages?: { categoryinfo?: { pages: number } }[] }
      }
      this.report({ total: info.query?.pages?.[0]?.categoryinfo?.pages ?? 11000 })
      const items: CatalogItem[] = []
      let cont: Record<string, string> = {}
      let pages = 0
      for (;;) {
        const params = new URLSearchParams({
          action: 'query',
          format: 'json',
          formatversion: '2',
          generator: 'categorymembers',
          gcmtitle: 'Category:Items',
          gcmlimit: '50',
          gcmnamespace: '0',
          prop: 'revisions',
          rvprop: 'content',
          rvslots: 'main',
          ...cont
        })
        const body = (await this.get(`${API}?${params}`)) as {
          query?: { pages?: { title: string; revisions?: { slots: { main: { content: string } } }[] }[] }
          continue?: Record<string, string>
        }
        for (const p of body.query?.pages ?? []) {
          const content = p.revisions?.[0]?.slots.main.content
          if (!content) continue
          const item = parseItemPage(p.title, content)
          if (item) items.push(item)
        }
        pages += body.query?.pages?.length ?? 0
        this.report({ pages })
        if (!body.continue) break
        cont = body.continue
        // One request at a time, with a breath between: this is a volunteer-run wiki.
        await new Promise((r) => setTimeout(r, 150))
      }
      // The wiki's own list of which eras are live on EverQuest Legends.
      let eraStatus: Record<string, 'in' | 'out'> | undefined
      try {
        const t = (await this.get(`${API}?action=query&format=json&formatversion=2&prop=revisions&rvprop=content&rvslots=main&titles=Template:PageEra`)) as {
          query?: { pages?: { revisions?: { slots: { main: { content: string } } }[] }[] }
        }
        const parsed = parseEraStatus(t.query?.pages?.[0]?.revisions?.[0]?.slots.main.content ?? '')
        if (Object.keys(parsed).length) eraStatus = parsed
      } catch {
        // The built-in list serves.
      }
      const file: CatalogFile = { fetchedAt: Date.now(), items, eraStatus, format: FORMAT }
      await fs.writeFile(this.path + '.tmp', JSON.stringify(file), 'utf8')
      await fs.rename(this.path + '.tmp', this.path)
      this.file = file
      this.report({ busy: false })
      return file
    } catch (e) {
      this.report({ busy: false, error: (e as Error).message })
      return this.file
    }
  }

  private async get(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT } })
      if (res.ok) return res.json()
      // A busy wiki answers 429 or 503: wait and ask again, a few times.
      if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
        continue
      }
      throw new Error(`eqlwiki answered ${res.status}`)
    }
  }
}
