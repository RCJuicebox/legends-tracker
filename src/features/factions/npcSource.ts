import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import { sources } from '../../main/sources/registry'
import { wiki } from '../../main/sources/wiki'
import { writeFileAtomic } from '../../main/storeCore'
import { bareNpc, npcTitles, parseNpcPage, type NpcInfo } from './npcPages'

// eqlwiki's pages for the named NPCs the plan's kill camps would send the player to (what they hold:
// npcPages.ts): asked for in the background, fifty titles a request, and kept, a page found for a
// month and one not found for a week, as a wiki page may be written meanwhile. A plan waits a little
// for the first answers; what comes later counts from the plan after.

const FOUND_FRESH_MS = 30 * 24 * 3600_000
const MISSING_FRESH_MS = 7 * 24 * 3600_000
/** After the wiki could not be reached, a while before asking again. */
const FAIL_WAIT_MS = 10 * 60_000
/** Bumped when what is kept of a page changes, so pages read by an older build are read again. */
const VERSION = 1

interface NpcFile {
  version: number
  /** By lower-cased name, Allakhazam's telling apart taken off: what the page says, and when it was asked. */
  npcs: Record<string, NpcInfo & { at: number }>
}

const keyOf = (name: string) => bareNpc(name).toLowerCase()

export class FactionNpcs {
  private loading: Promise<NpcFile> | null = null
  private asking: Promise<void> = Promise.resolve()
  private failedAt = 0

  private get path(): string {
    return join(cacheDir(), 'faction-npcs.json')
  }

  private load(): Promise<NpcFile> {
    this.loading ??= (async () => {
      try {
        const f = JSON.parse(await fs.readFile(this.path, 'utf8')) as NpcFile
        if (f.version === VERSION && f.npcs && typeof f.npcs === 'object') return f
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read faction-npcs.json; asking eqlwiki again', e)
      }
      return { version: VERSION, npcs: {} }
    })()
    return this.loading
  }

  /**
   * What eqlwiki says of each name, by lower-cased name: the ones it has been asked about. Names not
   * asked yet, or long ago, are asked in the background; this waits up to `waitMs` for that before
   * answering with what is known.
   */
  async lookup(names: string[], waitMs: number): Promise<Record<string, NpcInfo>> {
    const file = await this.load()
    const now = Date.now()
    const want = new Map<string, string>()
    for (const n of names) {
      const k = keyOf(n)
      const e = file.npcs[k]
      if (!want.has(k) && (!e || now - e.at > (e.found ? FOUND_FRESH_MS : MISSING_FRESH_MS))) want.set(k, bareNpc(n))
    }
    if (want.size && now - this.failedAt >= FAIL_WAIT_MS) {
      const run = this.asking.then(() => this.ask(file, want))
      this.asking = run
      await Promise.race([run, new Promise((r) => setTimeout(r, waitMs).unref?.())])
    }
    const out: Record<string, NpcInfo> = {}
    for (const n of names) {
      const e = file.npcs[keyOf(n)]
      if (e) out[keyOf(n)] = { found: e.found, ...(e.hp ? { hp: e.hp } : {}), ...(e.respawnSec ? { respawnSec: e.respawnSec } : {}), ...(e.hits ? { hits: e.hits } : {}) }
    }
    return out
  }

  /**
   * Asks eqlwiki for these names' pages, under every title one may have, a request at a time, each
   * request's answers known as they come (a plan waiting meanwhile sees them); kept when all are in,
   * or as far as they got.
   */
  private async ask(file: NpcFile, want: Map<string, string>): Promise<void> {
    sources.reading('factionNpcs', `Asking eqlwiki about ${want.size} NPC${want.size === 1 ? '' : 's'}`)
    const batches: { names: string[]; titles: string[] }[] = []
    for (const n of want.values()) {
      const ts = npcTitles(n)
      const last = batches.at(-1)
      if (last && last.titles.length + ts.length <= 50) {
        last.names.push(n)
        last.titles.push(...ts)
      } else batches.push({ names: [n], titles: [...ts] })
    }
    try {
      for (const b of batches) {
        const pages = await wiki.pages(b.titles, 'background')
        const at = Date.now()
        for (const n of b.names) {
          const page = npcTitles(n)
            .map((t) => pages.get(t))
            .find((p) => p !== undefined)
          file.npcs[keyOf(n)] = page ? { found: true, ...parseNpcPage(page.content), at } : { found: false, at }
        }
      }
      const all = Object.values(file.npcs)
      sources.ok('factionNpcs', `${all.filter((e) => e.found).length} NPC pages kept; ${all.filter((e) => !e.found).length} names eqlwiki has no page for`)
    } catch (e) {
      this.failedAt = Date.now()
      sources.fail('factionNpcs', e, 'Could not ask eqlwiki about NPCs; the ones kept serve meanwhile')
    }
    await writeFileAtomic(this.path, JSON.stringify(file)).catch((e) => log.warn('Could not save faction-npcs.json', e))
  }
}
