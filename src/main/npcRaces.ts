import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { wikiRace, wikiTitles } from '../core/slayer'
import { wiki } from './sources/wiki'
import { cacheDir } from './paths'
import { log } from './log'

// The race eqlwiki's page for a mob gives ("A Forsaken Revenant": Elf Vampire), for the Slayer counts
// of mobs whose names do not say what they are. Asked only for those, fifty a request in the
// background, and kept: a race does not change, and a name with no page is asked again after a day.

const MISS_RETRY_MS = 24 * 3600_000
/** After the wiki could not be reached, a while before asking again. */
const FAIL_WAIT_MS = 10 * 60_000

interface RaceFile {
  version: 2
  /** By lower-cased mob name: the race, or null for no page (or none on it), and when it was asked. */
  races: Record<string, { race: string | null; at: number }>
}

export class NpcRaces {
  private file: RaceFile | null = null
  private loading: Promise<RaceFile> | null = null
  private asking: Promise<boolean> = Promise.resolve(false)
  private failedAt = 0

  private get path(): string {
    return join(cacheDir(), 'npc-races.json')
  }

  private load(): Promise<RaceFile> {
    this.loading ??= (async () => {
      try {
        const f = JSON.parse(await fs.readFile(this.path, 'utf8')) as { version: number; races: RaceFile['races'] }
        if (f.version === 2 && f.races && typeof f.races === 'object') return (this.file = f as RaceFile)
        // Version 1 asked one capitalisation only ("Lesser blade fiend", where the page is "Lesser Blade Fiend"): its misses are asked again.
        if (f.version === 1 && f.races && typeof f.races === 'object')
          return (this.file = { version: 2, races: Object.fromEntries(Object.entries(f.races).filter(([, e]) => e.race !== null)) })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read npc-races.json; asking eqlwiki again', e)
      }
      return (this.file = { version: 2, races: {} })
    })()
    return this.loading
  }

  /** A mob's race: a race, null when the wiki has none, undefined when not asked yet. */
  race(mob: string): string | null | undefined {
    const e = this.file?.races[mob.toLowerCase()]
    return e ? e.race : undefined
  }

  /**
   * Asks eqlwiki for the mobs not asked yet (and those with no page a day ago), one lookup at a
   * time. True when it learned anything.
   */
  lookUp(mobs: string[]): Promise<boolean> {
    this.asking = this.asking.then(async () => {
      const file = await this.load()
      const now = Date.now()
      if (now - this.failedAt < FAIL_WAIT_MS) return false
      const want = [...new Set(mobs.map((m) => m.toLowerCase()))].filter((k) => {
        const e = file.races[k]
        return !e || (e.race === null && now - e.at > MISS_RETRY_MS)
      })
      if (!want.length) return false
      const byKey = new Map(mobs.map((m) => [m.toLowerCase(), m]))
      const titles = new Map(want.map((k) => [k, wikiTitles(byKey.get(k) ?? k)]))
      try {
        const pages = await wiki.pages([...new Set([...titles.values()].flat())], 'background')
        for (const k of want) {
          // The first of its titles whose page gives a race.
          const race = (titles.get(k) ?? []).map((t) => pages.get(t)).reduce<string | null>((r, page) => r ?? (page ? wikiRace(page.content) : null), null)
          file.races[k] = { race, at: now }
        }
        await writeFileAtomic(this.path, JSON.stringify(file))
        return true
      } catch (e) {
        this.failedAt = now
        log.warn("Could not ask eqlwiki for mobs' races (Slayer counts):", e)
        return false
      }
    })
    return this.asking
  }

  /** Reads what was kept, so races are known from the first count. */
  ready(): Promise<unknown> {
    return this.load()
  }
}
