import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import { sources } from '../../main/sources/registry'
import { expired } from '../../main/sources/freshness'
import { JsonFile } from '../../main/storeCore'
import { ALLA_INDEX_URL, ALLA_READY, allaFactionLaidOut, allaPageUrl, parseAllaFaction, parseAllaIndex, type AllaFaction } from './allakhazam'
import { factionKey } from './core'

// Allakhazam's faction pages, read for the plan (what they hold: allakhazam.ts). The site's
// robots.txt asks every crawler to wait twenty seconds between pages, so the tracker reads one page
// at a time, twenty seconds apart, in the background, as itself: first the factions whose
// achievements a plan is for, then the character's others. Each page is kept a month, and the list
// of the site's factions (its numbers differ from the game's) as long.

const GAP_MS = 20_000
const FRESH_MS = 30 * 24 * 3600_000
/** After a failed read, how long before trying the site again. */
const RETRY_MS = 10 * 60_000
/** A page not laid out as the reader knows is not kept, and not asked for again for this long. */
const ODD_PAGE_MS = 24 * 3600_000
/** Pages read are written to disk every so many, or this long after the first unsaved one, and when reading stops. */
const SAVE_EVERY = 10
const SAVE_AFTER_MS = 5 * 60_000
/** Bumped when what is kept of a page changes, so pages read by an older build are read again. */
const VERSION = 1

interface AllaFile {
  version: number
  /** Allakhazam's number for each faction, by factionKey of its name. */
  index: { fetchedAt: number; ids: Record<string, number> } | null
  /** Each faction page read, by Allakhazam's number; null when the page held no faction. */
  pages: Record<string, { fetchedAt: number; faction: AllaFaction | null }>
}

const userAgent = () => `LegendsTracker/${app?.getVersion?.() ?? 'dev'} (https://github.com/RCJuicebox/legends-tracker)`

/** A page the site answered with an error status. */
class AllaStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export class FactionAlla {
  private file: AllaFile | null = null
  private disk: JsonFile<AllaFile> | null = null
  /** The factions wanted, by factionKey, in the order asked: the latest caller's plan first. */
  private wanted = new Map<string, string>()
  /** Pages read since the file was last written, and when the first of them was. */
  private unsaved = 0
  private unsavedSince = 0
  private running: Promise<void> | null = null
  private last = 0
  private failedAt = 0
  private error = ''
  /** Pages that came back in a shape the reader does not know, by the site's number: when. */
  private odd = new Map<number, number>()

  private get path(): string {
    return join(cacheDir(), 'faction-alla.json')
  }

  private async load(): Promise<AllaFile> {
    if (this.file) return this.file
    try {
      const f = JSON.parse(await fs.readFile(this.path, 'utf8')) as AllaFile
      if (f.version === VERSION && f.pages) this.file = f
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read faction-alla.json; reading Allakhazam again', e)
    }
    this.file ??= { version: VERSION, index: null, pages: {} }
    // Written as the settings are: through a .tmp file, tried again while another program holds it.
    this.disk = new JsonFile(this.path, this.file, { pretty: false })
    return this.file
  }

  private async save(): Promise<void> {
    this.unsaved = 0
    this.disk?.markDirty()
    await this.disk?.flush()
  }

  /** A page read: written with the next few, not each on its own (the file is the whole cache). */
  private async pageRead(): Promise<void> {
    if (!this.unsaved++) this.unsavedSince = Date.now()
    if (this.unsaved >= SAVE_EVERY || Date.now() - this.unsavedSince >= SAVE_AFTER_MS) await this.save()
  }

  /** Writes pages read and not yet saved; at quit. */
  async flush(): Promise<void> {
    if (this.unsaved && this.file) await this.save()
  }

  /** The first faction wanted that is neither kept nor lately found odd; odd ones on the way are named in `odd`. */
  private next(f: AllaFile, odd: string[]): { id: number; name: string } | null {
    for (const [key, name] of this.wanted) {
      const id = f.index?.ids[key]
      if (id === undefined || this.fresh(f.pages[id]?.fetchedAt)) continue
      if (Date.now() - (this.odd.get(id) ?? -Infinity) < ODD_PAGE_MS) {
        if (!odd.includes(name)) odd.push(name)
        continue
      }
      return { id, name }
    }
    return null
  }

  /** One page, twenty seconds after the one before. */
  private async fetchPage(url: string): Promise<string> {
    const wait = this.last + GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new AllaStatusError(res.status, `Allakhazam answered ${res.status} for ${url}`)
    return res.text()
  }

  private fresh = (at: number | undefined) => !expired(at, FRESH_MS)

  /** Reads what is wanted and not kept, one page at a time; stops when done or when the site cannot be reached. */
  private async pump(): Promise<void> {
    const f = await this.load()
    try {
      if (!this.fresh(f.index?.fetchedAt)) {
        sources.reading('allakhazam', "Reading Allakhazam's list of factions")
        const ids = parseAllaIndex(await this.fetchPage(ALLA_INDEX_URL))
        if (!Object.keys(ids).length) throw new Error("Allakhazam's list of factions held none: the page may have changed")
        f.index = { fetchedAt: Date.now(), ids }
        await this.save()
      }
      const oddNames: string[] = []
      // The next page is picked afresh each time, so a character picked while reading goes first.
      for (let n = this.next(f, oddNames); n; n = this.next(f, oddNames)) {
        const { id, name } = n
        sources.reading('allakhazam', `Reading ${name} (${this.status().read + 1} of ${this.wanted.size}), a page every ${GAP_MS / 1000} seconds as the site asks`)
        let html: string
        try {
          html = await this.fetchPage(allaPageUrl(id))
        } catch (e) {
          // One page the site will not give (gone, moved): that page waits a day, the rest go on. Only
          // the site out of reach, busy or asking us to slow down pauses everything (LT-413).
          if (!(e instanceof AllaStatusError) || e.status === 429 || e.status >= 500) throw e
          log.warn(`Allakhazam would not give ${name}'s page (${e.status}); trying it again tomorrow`)
          this.odd.set(id, Date.now())
          continue
        }
        const faction = parseAllaFaction(id, html)
        // Titled but not laid out as known: the site changed, and an empty page kept a month would hide it.
        if (faction && !allaFactionLaidOut(html)) {
          log.warn(`Allakhazam's page for ${name} (${allaPageUrl(id)}) is not laid out as expected; not kept`)
          this.odd.set(id, Date.now())
          continue
        }
        f.pages[id] = { fetchedAt: Date.now(), faction }
        await this.pageRead()
      }
      const s = this.status()
      if (oddNames.length) {
        this.error = `${oddNames.length === 1 ? 'A page' : `${oddNames.length} pages`} (${oddNames.slice(0, 3).join(', ')}${oddNames.length > 3 ? ', …' : ''}) did not look like Allakhazam's faction pages: the site may have changed`
        sources.fail('allakhazam', new Error(this.error), `${s.read} of ${s.wanted} factions read; the others are tried again tomorrow`)
      } else {
        this.error = ''
        sources.ok('allakhazam', `${s.read} of ${s.wanted} factions read`)
      }
    } catch (e) {
      this.failedAt = Date.now()
      this.error = e instanceof Error ? e.message : String(e)
      sources.fail('allakhazam', e, 'Tried again in ten minutes')
    } finally {
      await this.flush()
    }
  }

  /** How far the reading has got for the factions wanted. */
  status(): { read: number; wanted: number; error: string } {
    const f = this.file
    let read = 0
    for (const key of this.wanted.keys()) {
      const id = f?.index?.ids[key]
      if (id === undefined || f?.pages[id]) read++
    }
    return { read, wanted: this.wanted.size, error: this.error }
  }

  /**
   * What the site's pages say of these factions, as far as they are read; the rest are read in the
   * background, the first named first. A faction the site does not list counts as read.
   */
  async factions(names: string[]): Promise<AllaFaction[]> {
    if (!ALLA_READY) return []
    const f = await this.load()
    // The latest caller's factions first: a second character picked would otherwise wait hours
    // behind the first's, at a page every twenty seconds.
    const wanted = new Map(names.map((n) => [factionKey(n), n]))
    for (const [k, n] of this.wanted) if (!wanted.has(k)) wanted.set(k, n)
    this.wanted = wanted
    const retry = !this.failedAt || Date.now() - this.failedAt > RETRY_MS
    if (!this.running && retry) this.running = this.pump().finally(() => (this.running = null))
    const out: AllaFaction[] = []
    for (const n of names) {
      const id = f.index?.ids[factionKey(n)]
      const page = id === undefined ? undefined : f.pages[id]?.faction
      if (page) out.push(page)
    }
    return out
  }
}
