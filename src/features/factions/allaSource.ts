import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import { sources } from '../../main/sources/registry'
import { ALLA_INDEX_URL, ALLA_READY, allaPageUrl, parseAllaFaction, parseAllaIndex, type AllaFaction } from './allakhazam'
import { factionKey } from './planner'

// Allakhazam's faction pages, read for the plan (what they hold: allakhazam.ts). The site's
// robots.txt asks every crawler to wait twenty seconds between pages, so the tracker reads one page
// at a time, twenty seconds apart, in the background, as itself: first the factions whose
// achievements a plan is for, then the character's others. Each page is kept a month, and the list
// of the site's factions (its numbers differ from the game's) as long.

const GAP_MS = 20_000
const FRESH_MS = 30 * 24 * 3600_000
/** After a failed read, how long before trying the site again. */
const RETRY_MS = 10 * 60_000
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

export class FactionAlla {
  private file: AllaFile | null = null
  /** The factions wanted, by factionKey, in the order asked: the plan's first. */
  private wanted = new Map<string, string>()
  private running: Promise<void> | null = null
  private last = 0
  private failedAt = 0
  private error = ''

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
    return (this.file ??= { version: VERSION, index: null, pages: {} })
  }

  private async save(): Promise<void> {
    const tmp = this.path + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.file))
      await fs.rename(tmp, this.path)
    } catch (e) {
      log.warn('Could not save faction-alla.json:', e)
    }
  }

  /** One page, twenty seconds after the one before. */
  private async fetchPage(url: string): Promise<string> {
    const wait = this.last + GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last = Date.now()
    const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`Allakhazam answered ${res.status} for ${url}`)
    return res.text()
  }

  private fresh = (at: number | undefined) => at !== undefined && Date.now() - at < FRESH_MS

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
      for (const [key, name] of this.wanted) {
        const id = f.index?.ids[key]
        if (id === undefined || this.fresh(f.pages[id]?.fetchedAt)) continue
        sources.reading('allakhazam', `Reading ${name} (${this.status().read + 1} of ${this.wanted.size}), a page every ${GAP_MS / 1000} seconds as the site asks`)
        f.pages[id] = { fetchedAt: Date.now(), faction: parseAllaFaction(id, await this.fetchPage(allaPageUrl(id))) }
        await this.save()
      }
      this.error = ''
      const s = this.status()
      sources.ok('allakhazam', `${s.read} of ${s.wanted} factions read`)
    } catch (e) {
      this.failedAt = Date.now()
      this.error = e instanceof Error ? e.message : String(e)
      sources.fail('allakhazam', e, 'Tried again in ten minutes')
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
    for (const n of names) if (!this.wanted.has(factionKey(n))) this.wanted.set(factionKey(n), n)
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
