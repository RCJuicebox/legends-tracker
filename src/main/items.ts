import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { baseName, itemKey } from '../core/inventory'
import type { ItemInfo } from '../shared/types'

// Item stats come from eqlwiki.com, the community wiki for EverQuest Legends: each item page carries
// the in-game stats block. Only the items the player asks about are looked up, a batch at a time,
// and kept in the app's data so each is fetched once a week at most.
const API = 'https://eqlwiki.com/api.php'
const AGENT = 'LegendsTracker (https://github.com/RCJuicebox/legends-tracker)'
const FRESH_MS = 7 * 24 * 3600_000

interface Cached extends ItemInfo {
  fetchedAt: number
}

export class ItemCatalog {
  private cache: Record<string, Cached> | null = null
  private saving: Promise<void> | null = null

  private get path(): string {
    return join(app.getPath('userData'), 'item-cache.json')
  }

  private async load(): Promise<Record<string, Cached>> {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.readFile(this.path, 'utf8')) as Record<string, Cached>
    } catch {
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
    for (const n of names) if (n) wanted.set(itemKey(n), baseName(n))
    // Entries cached before icons were kept have no icon field; fetch those again once.
    const stale = [...wanted].filter(([k]) => force || !cache[k] || Date.now() - cache[k].fetchedAt > FRESH_MS || (cache[k].found && cache[k].icon === undefined))
    if (stale.length) {
      try {
        await this.fetchInto(cache, stale)
        await this.save()
      } catch {
        // Offline or the wiki is down: what is cached still serves, however old.
      }
    }
    const out: Record<string, ItemInfo> = {}
    for (const k of wanted.keys()) if (cache[k]) out[k] = strip(cache[k])
    return out
  }

  private async fetchInto(cache: Record<string, Cached>, items: [string, string][]): Promise<void> {
    const now = Date.now()
    const misses: [string, string][] = []
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50)
      const pages = await this.pages(batch.map(([, title]) => title))
      for (const [key, title] of batch) {
        const page = pages.get(itemKey(title))
        if (page) cache[key] = { ...page, fetchedAt: now }
        else misses.push([key, title])
      }
    }
    // Names that are not exact page titles (a page titled "Shiverback-hide Boots" for the game's
    // "Shiverback-Hide Boots"): search, and take a result that is the same name once case and
    // punctuation are ignored.
    for (const [key, title] of misses.slice(0, 40)) {
      const hit = await this.search(title, key)
      const page = hit ? (await this.pages([hit])).get(itemKey(hit)) : undefined
      cache[key] = page ? { ...page, fetchedAt: now } : { title, found: false, statsblock: '', fetchedAt: now }
    }
  }

  /** Pages by title, keyed by itemKey() of both the asked title and the page's own. */
  private async pages(titles: string[]): Promise<Map<string, ItemInfo>> {
    const url = `${API}?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}`
    const res = await fetch(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT } })
    if (!res.ok) throw new Error(`eqlwiki answered ${res.status}`)
    const body = (await res.json()) as {
      query?: {
        pages?: { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] }[]
        redirects?: { from: string; to: string }[]
        normalized?: { from: string; to: string }[]
      }
    }
    const out = new Map<string, ItemInfo>()
    for (const p of body.query?.pages ?? []) {
      if (p.missing || !p.revisions?.length) continue
      const content = p.revisions[0].slots.main.content
      const statsblock = /\|\s*statsblock\s*=([\s\S]*?)(?:\n\|\s*\w+\s*=|\n?\}\}\s*<\/onlyinclude>|\n\}\})/.exec(content)?.[1].trim() ?? ''
      if (!statsblock) continue
      const icon = Number(/\|\s*lucy_img_ID\s*=\s*(\d+)/.exec(content)?.[1] ?? 0)
      out.set(itemKey(p.title), { title: p.title, found: true, statsblock, icon })
    }
    // A redirect or normalised title answers for the name that was asked.
    for (const r of [...(body.query?.normalized ?? []), ...(body.query?.redirects ?? [])]) {
      const hit = out.get(itemKey(r.to))
      if (hit) out.set(itemKey(r.from), hit)
    }
    return out
  }

  private async search(title: string, key: string): Promise<string | null> {
    const url = `${API}?action=query&format=json&formatversion=2&list=search&srlimit=10&srsearch=${encodeURIComponent(title)}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': AGENT, 'Api-User-Agent': AGENT } })
      const body = (await res.json()) as { query?: { search?: { title: string }[] } }
      return body.query?.search?.find((s) => itemKey(s.title) === key)?.title ?? null
    } catch {
      return null
    }
  }
}

function strip(c: Cached): ItemInfo {
  return { title: c.title, found: c.found, statsblock: c.statsblock, icon: c.icon }
}
