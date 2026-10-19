import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { cacheDir } from '../paths'
import { log } from '../log'
import { sources } from './registry'
import { wiki, type WikiPage } from './wiki'
import { writeFileAtomic } from '../storeCore'
import { bareNpc, parseNpcPage, type NpcInfo } from '../../features/factions/npcPages'
import { wikiRace, wikiTitles } from '../../core/slayer'

// eqlwiki's page for a named mob ({{Namedmobpage}}), asked for once and kept, for two readers: the
// Slayer counts want the mob's race (a name says nothing of what a Forsaken Revenant is), the faction
// plan what the page says of a camp's named mob (whether Legends has it, its health and respawn, kill
// amounts). One cache, one set of titles tried, one Data Sources row (LT-624): before, each kept its
// own file and found pages the other missed. A page found is kept a month, a name with no page a week,
// as a page may be written meanwhile. Asked fifty titles a request, in the background; the faction
// plan waits a little for the first answers.

const FOUND_FRESH_MS = 30 * 24 * 3600_000
const MISSING_FRESH_MS = 7 * 24 * 3600_000
/** After the wiki could not be reached, a while before asking again. */
const FAIL_WAIT_MS = 10 * 60_000
const VERSION = 1

interface Entry {
  at: number
  /** eqlwiki has a page for the name. */
  found: boolean
  /** The race its page gives, null for none (or no page); absent while the page was read for the faction plan alone (an older file). */
  race?: string | null
  /** What the page says for the faction plan; absent while read for the race alone (an older file). */
  info?: Omit<NpcInfo, 'found'>
}

interface PageFile {
  version: number
  /** By lower-cased name, Allakhazam's telling apart and a leading * taken off. */
  npcs: Record<string, Entry>
}

/** A name as the cache keys it: "Corporal Lancot - North Qeynos" and "*Duggin Scumber" are their names, lower-cased. */
const keyOf = (name: string) => bareNpc(name.replace(/^\*+/, '')).toLowerCase()

export class NpcPages {
  private loading: Promise<PageFile> | null = null
  private file: PageFile | null = null
  private asking: Promise<unknown> = Promise.resolve()
  private failedAt = 0
  private readonly dir: string | undefined
  private readonly pages: (titles: string[]) => Promise<Map<string, WikiPage>>

  /** `dir` and `pages` stand in for the cache folder and the wiki in tests. */
  constructor(opts: { dir?: string; pages?: (titles: string[]) => Promise<Map<string, WikiPage>> } = {}) {
    this.dir = opts.dir
    this.pages = opts.pages ?? ((titles) => wiki.pages(titles, 'background'))
    sources.add('npcPages', {
      label: 'NPC pages',
      kind: 'wiki',
      what: "eqlwiki's page for each named mob the Slayer counts and the faction plan's kill camps ask about: its race, whether Legends has it, its health and respawn, and kill amounts. A page found is kept a month, a name without one a week."
    })
  }

  private get path(): string {
    return join(this.dir ?? cacheDir(), 'npc-pages.json')
  }

  private load(): Promise<PageFile> {
    this.loading ??= (async () => {
      try {
        const f = JSON.parse(await fs.readFile(this.path, 'utf8')) as PageFile
        if (f.version === VERSION && f.npcs && typeof f.npcs === 'object') return (this.file = f)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read npc-pages.json; asking eqlwiki again', e)
      }
      return (this.file = await this.migrated())
    })()
    return this.loading
  }

  /** The two files the readers kept before (npc-races.json, faction-npcs.json), as one; each side's entries lack the other's half until asked again. */
  private async migrated(): Promise<PageFile> {
    const file: PageFile = { version: VERSION, npcs: {} }
    const dir = this.dir ?? cacheDir()
    const old = [join(dir, 'npc-races.json'), join(dir, 'faction-npcs.json')]
    try {
      const races = JSON.parse(await fs.readFile(old[0], 'utf8')) as { version?: number; races?: Record<string, { race: string | null; at: number }> }
      if (races.races && typeof races.races === 'object')
        for (const [k, e] of Object.entries(races.races)) if (e && typeof e.at === 'number') file.npcs[keyOf(k)] = { at: e.at, found: e.race !== null, race: e.race ?? null }
    } catch {
      // none kept
    }
    try {
      const npcs = JSON.parse(await fs.readFile(old[1], 'utf8')) as { version?: number; npcs?: Record<string, NpcInfo & { at: number }> }
      if (npcs.version === 3 && npcs.npcs && typeof npcs.npcs === 'object')
        for (const [k, e] of Object.entries(npcs.npcs)) {
          if (!e || typeof e.at !== 'number') continue
          const { found, at, ...info } = e
          const had = file.npcs[keyOf(k)]
          file.npcs[keyOf(k)] = { ...had, at: Math.max(at, had?.at ?? 0), found: found || !!had?.found, info }
        }
    } catch {
      // none kept
    }
    if (Object.keys(file.npcs).length) {
      await writeFileAtomic(this.path, JSON.stringify(file)).catch((e) => log.warn('Could not save npc-pages.json', e))
      for (const f of old) await fs.rm(f, { force: true }).catch(() => undefined)
      log.info(`eqlwiki NPC pages: ${Object.keys(file.npcs).length} names brought over from the two files kept before`)
    }
    return file
  }

  /** Reads what was kept, so races are known from the first count. */
  ready(): Promise<unknown> {
    return this.load()
  }

  /** A mob's race as eqlwiki gives it: a race, null when the wiki has none, undefined when not asked yet. */
  race(mob: string): string | null | undefined {
    const e = this.file?.npcs[keyOf(mob)]
    return e && e.race !== undefined ? e.race : undefined
  }

  private stale(e: Entry, now: number): boolean {
    return now - e.at > (e.found ? FOUND_FRESH_MS : MISSING_FRESH_MS)
  }

  /**
   * Asks eqlwiki for the mobs whose race is not known yet (and names with no page a week ago), in the
   * background, one lookup at a time. True when it learned anything.
   */
  lookUp(mobs: string[]): Promise<boolean> {
    const run = this.asking.then(async () => {
      const file = await this.load()
      const now = Date.now()
      if (now - this.failedAt < FAIL_WAIT_MS) return false
      const want = new Map<string, string>()
      for (const m of mobs) {
        const k = keyOf(m)
        const e = file.npcs[k]
        if (!want.has(k) && (!e || e.race === undefined || (!e.found && this.stale(e, now)))) want.set(k, m.replace(/^\*+/, '').trim())
      }
      if (!want.size) return false
      return this.ask(file, want)
    })
    this.asking = run.catch(() => undefined)
    return run
  }

  /**
   * What eqlwiki says of each named NPC, by lower-cased name: the ones it has been asked about. Names
   * not asked yet, or long ago, are asked in the background; this waits up to `waitMs` for that before
   * answering with what is known.
   */
  async lookup(names: string[], waitMs: number): Promise<Record<string, NpcInfo>> {
    const file = await this.load()
    const now = Date.now()
    const want = new Map<string, string>()
    for (const n of names) {
      const k = keyOf(n)
      const e = file.npcs[k]
      if (!want.has(k) && (!e || e.info === undefined || this.stale(e, now))) want.set(k, bareNpc(n))
    }
    if (want.size && now - this.failedAt >= FAIL_WAIT_MS) {
      const run = this.asking.then(() => this.ask(file, want))
      this.asking = run.catch(() => undefined)
      await Promise.race([run, new Promise((r) => setTimeout(r, waitMs).unref?.())])
    }
    const out: Record<string, NpcInfo> = {}
    for (const n of names) {
      const e = file.npcs[keyOf(n)]
      if (e && e.info !== undefined) out[keyOf(n)] = { found: e.found, ...e.info }
    }
    return out
  }

  /**
   * Asks eqlwiki for these names' pages, under every title one may have, fifty titles a request, each
   * request's answers known as they come; kept when all are in, or as far as they got. True when any
   * page was read.
   */
  private async ask(file: PageFile, want: Map<string, string>): Promise<boolean> {
    sources.reading('npcPages', `Asking eqlwiki about ${want.size} NPC${want.size === 1 ? '' : 's'}`)
    const batches: { names: [string, string][]; titles: string[] }[] = []
    for (const [k, n] of want) {
      const ts = wikiTitles(n)
      const last = batches.at(-1)
      if (last && last.titles.length + ts.length <= 50) {
        last.names.push([k, n])
        last.titles.push(...ts)
      } else batches.push({ names: [[k, n]], titles: [...ts] })
    }
    let learned = false
    try {
      for (const b of batches) {
        const pages = await this.pages([...new Set(b.titles)])
        const at = Date.now()
        for (const [k, n] of b.names) {
          const page = wikiTitles(n)
            .map((t) => pages.get(t))
            .find((p) => p !== undefined)
          file.npcs[k] = page ? { at, found: true, race: wikiRace(page.content), info: parseNpcPage(page.content) } : { at, found: false, race: null, info: {} }
          learned = true
        }
      }
      const all = Object.values(file.npcs)
      sources.ok('npcPages', `${all.filter((e) => e.found).length} NPC pages kept; ${all.filter((e) => !e.found).length} names eqlwiki has no page for`)
    } catch (e) {
      this.failedAt = Date.now()
      sources.fail('npcPages', e, 'Could not ask eqlwiki about NPCs; the ones kept serve meanwhile')
    }
    if (learned) await writeFileAtomic(this.path, JSON.stringify(file)).catch((e) => log.warn('Could not save npc-pages.json', e))
    return learned
  }
}
