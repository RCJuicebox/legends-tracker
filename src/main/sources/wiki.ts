import { app } from 'electron'
import { log } from '../log'
import { throwIfCancelled } from './jobs'

// The one way the app talks to eqlwiki.com, a volunteer-run MediaWiki: an identifiable agent, one
// request at a time with a breath between, maxlag so a busy database is left alone, and backing off
// when the wiki says so (Retry-After, 429, 5xx, maxlag). The workspace's Python client
// (eql_common.wiki_get) behaves the same way.

export const WIKI_API = 'https://eqlwiki.com/api.php'
/** Who is asking, with the version, read when first needed (tests load this without Electron). */
let agent = ''
const userAgent = () => (agent ||= `LegendsTracker/${app?.getVersion?.() ?? 'dev'} (https://github.com/RCJuicebox/legends-tracker)`)
/** A stalled wiki must not hold a page for ever. */
const TIMEOUT_MS = 20_000
const ATTEMPTS = 6
/** Between one request and the next. */
const PACE_MS = 200

export class WikiError extends Error {}

/** How soon a request is wanted: a page waiting on it goes ahead of a background download. */
export type Urgency = 'now' | 'background'

export interface WikiPage {
  title: string
  content: string
  /** The revision the content is from. */
  revid?: number
}

interface QueryPages {
  query?: {
    pages?: { title: string; missing?: boolean; lastrevid?: number; revisions?: { revid?: number; slots: { main: { content: string } } }[] }[]
    redirects?: { from: string; to: string }[]
    normalized?: { from: string; to: string }[]
  }
  continue?: Record<string, string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Seconds from a Retry-After header, else `fallback` (ms). */
function retryAfter(res: Response | null, fallback: number): number {
  const v = Number(res?.headers.get('retry-after'))
  return Number.isFinite(v) && v > 0 ? Math.min(300, Math.max(1, v)) * 1000 : fallback
}

export class WikiClient {
  private readonly waiting: { urgency: Urgency; run: () => void }[] = []
  private busy = false
  private lastAt = 0

  /** Runs `job` when its turn comes: one request at a time, a page's before a download's. */
  private turn<T>(urgency: Urgency, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.busy = true
        const wait = Math.max(0, this.lastAt + PACE_MS - Date.now())
        void sleep(wait)
          .then(job)
          .then(resolve, reject)
          .finally(() => {
            this.lastAt = Date.now()
            this.busy = false
            this.next()
          })
      }
      if (urgency === 'now') {
        const at = this.waiting.findIndex((w) => w.urgency !== 'now')
        this.waiting.splice(at < 0 ? this.waiting.length : at, 0, { urgency, run })
      } else this.waiting.push({ urgency, run })
      if (!this.busy) this.next()
    })
  }

  private next(): void {
    if (this.busy) return
    this.waiting.shift()?.run()
  }

  /** One API call. Retries network trouble, 5xx, 429 and maxlag; any other 4xx or API error fails at once. */
  get<T = unknown>(params: Record<string, string>, urgency: Urgency = 'now'): Promise<T> {
    const q = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params })
    const url = `${WIKI_API}?${q}`
    return this.turn(urgency, async () => {
      let last: unknown = null
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        let wait = 2000 * (attempt + 1)
        let res: Response | null = null
        try {
          res = await fetch(url, { headers: { 'User-Agent': userAgent(), 'Api-User-Agent': userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) })
          if (res.ok) {
            const body = (await res.json()) as { error?: { code: string; info?: string } }
            if (body.error?.code === 'maxlag') {
              last = new WikiError(`eqlwiki is busy: ${body.error.info ?? ''}`)
              wait = retryAfter(res, 5000 * (attempt + 1))
            } else if (body.error) {
              throw new WikiError(`${body.error.code}: ${body.error.info ?? ''}`)
            } else return body as T
          } else if (res.status === 429 || res.status >= 500) {
            last = new WikiError(`eqlwiki answered ${res.status}`)
            wait = retryAfter(res, wait)
          } else throw new WikiError(`eqlwiki answered ${res.status}`)
        } catch (e) {
          if (e instanceof WikiError) throw e
          last = e // network trouble, a timeout, or a garbled body
        }
        if (attempt + 1 < ATTEMPTS) await sleep(wait)
      }
      log.warn(`eqlwiki: gave up after ${ATTEMPTS} attempts`, last)
      throw last instanceof Error ? last : new WikiError('eqlwiki could not be reached')
    })
  }

  /**
   * Pages by title, fifty a request, following redirects. The answer maps both the title asked and
   * the page's own title to the page; a title with no page is absent.
   */
  async pages(titles: string[], urgency: Urgency = 'now', signal?: AbortSignal): Promise<Map<string, WikiPage>> {
    const out = new Map<string, WikiPage>()
    for (let i = 0; i < titles.length; i += 50) {
      throwIfCancelled(signal)
      const body = await this.get<QueryPages>(
        { action: 'query', redirects: '1', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: titles.slice(i, i + 50).join('|') },
        urgency
      )
      for (const p of body.query?.pages ?? []) {
        const content = p.revisions?.[0]?.slots.main.content
        if (!p.missing && content !== undefined) out.set(p.title, { title: p.title, content, revid: p.revisions?.[0]?.revid })
      }
      // A redirect or normalised title answers for the name that was asked, through up to three hops.
      const to = new Map([...(body.query?.normalized ?? []), ...(body.query?.redirects ?? [])].map((r) => [r.from, r.to]))
      for (const from of to.keys()) {
        let t = from
        for (let hops = 0; hops < 3 && to.has(t); hops++) t = to.get(t)!
        const page = out.get(t)
        if (page) out.set(from, page)
      }
    }
    return out
  }

  /** Every page in a category with its content, fifty a request, handed over a batch at a time. */
  async category(name: string, onBatch: (pages: WikiPage[]) => void, urgency: Urgency = 'background', signal?: AbortSignal): Promise<void> {
    let cont: Record<string, string> = {}
    for (;;) {
      throwIfCancelled(signal)
      const body = await this.get<QueryPages>(
        {
          action: 'query',
          generator: 'categorymembers',
          gcmtitle: `Category:${name}`,
          gcmlimit: '50',
          gcmnamespace: '0',
          prop: 'revisions',
          rvprop: 'content|ids',
          rvslots: 'main',
          ...cont
        },
        urgency
      )
      onBatch((body.query?.pages ?? []).flatMap((p) => (p.revisions?.[0] ? [{ title: p.title, content: p.revisions[0].slots.main.content, revid: p.revisions[0].revid }] : [])))
      if (!body.continue) return
      cont = body.continue
    }
  }

  /**
   * Every page in a category with its latest revision id and no content, five hundred a request: a
   * cheap way to see what changed since a download.
   */
  async revisions(name: string, urgency: Urgency = 'background'): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    let cont: Record<string, string> = {}
    for (;;) {
      const body = await this.get<QueryPages>(
        { action: 'query', generator: 'categorymembers', gcmtitle: `Category:${name}`, gcmlimit: '500', gcmnamespace: '0', prop: 'info', ...cont },
        urgency
      )
      for (const p of body.query?.pages ?? []) if (p.lastrevid) out.set(p.title, p.lastrevid)
      if (!body.continue) return out
      cont = body.continue
    }
  }

  /** How many pages a category holds. */
  async categorySize(name: string, urgency: Urgency = 'background'): Promise<number | null> {
    const body = await this.get<{ query?: { pages?: { categoryinfo?: { pages: number } }[] } }>({ action: 'query', prop: 'categoryinfo', titles: `Category:${name}` }, urgency)
    return body.query?.pages?.[0]?.categoryinfo?.pages ?? null
  }

  /** A page's wikitext, following redirects; null when there is no such page. */
  async wikitext(title: string, urgency: Urgency = 'now'): Promise<string | null> {
    try {
      const body = await this.get<{ parse?: { wikitext?: string } }>({ action: 'parse', redirects: '1', prop: 'wikitext', page: title.replace(/ /g, '_') }, urgency)
      return body.parse?.wikitext ?? null
    } catch (e) {
      if (e instanceof WikiError && e.message.startsWith('missingtitle')) return null
      throw e
    }
  }

  /** Titles matching a search, best first. */
  async search(text: string, limit = 10, urgency: Urgency = 'now'): Promise<string[]> {
    const body = await this.get<{ query?: { search?: { title: string }[] } }>({ action: 'query', list: 'search', srlimit: String(limit), srsearch: text }, urgency)
    return body.query?.search?.map((s) => s.title) ?? []
  }
}

/** The app's one wiki client. */
export const wiki = new WikiClient()
