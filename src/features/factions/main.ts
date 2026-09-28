import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  addFactionLine,
  FACTIONS_FILE,
  factionView,
  joinFactions,
  parseFactionAchievements,
  parseFactionPage,
  parseFactionPageFull,
  parseFactionsExport,
  progressionStatus,
  type FactionAchievement,
  type FactionAchievements,
  type FactionExport,
  type FactionPageData,
  type FactionSources,
  type FactionTallies,
  type FactionView
} from './core'
import { emptySources, joinSources, sourceReader, type FactionSourceTallies } from './attribution'
import { parseQuestPage, type QuestPage } from './questPages'
import { buildCatalog, itemsToLookUp, planFor, type FactionPlanData } from './planner'
import { parseAchievements } from '../../core/achievements'
import { itemKey, parseInventory } from '../../core/inventory'
import { unitPrice } from '../../core/tradeskills'
import { handle } from '../../main/ipc/handle'
import { isCharacterKey } from '../../core/validate'
import { sources } from '../../main/sources/registry'
import { wiki } from '../../main/sources/wiki'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import type { HistoryConsumer, HistoryWhere, LogHistory } from '../../main/sources/logHistory'
import type { AppContext } from '../../main/context'

// A character's faction changes, from "Your faction standing with X has been adjusted by N." and
// the cap lines, over the log and its archives, for the Factions page. The reading is LogHistory's.
// Where each faction stands comes from the factions export in the game folder, when there is one;
// which have an achievement from the client's achievement list and the achievements export; what
// raises one from its eqlwiki page, fetched when asked for and kept a week.
//
// The plan for the achievements still to do (planner.ts) is worked out in the page, from what this
// gathers: what each kill and hand-in in the log did (attribution.ts), every eqlwiki faction page
// and the quest pages they name (kept a week), what the character has bought and holds, and what
// the wiki says of the items hand-ins want.

/** Each stretch of log's faction tallies, as a LogHistory consumer. */
export const factionConsumer: HistoryConsumer<FactionTallies> = {
  version: 1,
  empty: () => ({}),
  reader: () => (line, into) => addFactionLine(into, line)
}

export class FactionHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every faction the log saw change, over the live log and every archive of it, with the export's standings. */
  async view(where: HistoryWhere, exported: FactionExport | null = null, achievements: FactionAchievements | null = null): Promise<FactionView> {
    const slice = await this.history.get<FactionTallies>(this.key, where)
    // Archives oldest first, then the live log.
    return factionView(joinFactions([...slice.archives.map((a) => a.value), slice.live]), exported, achievements)
  }
}

/** What caused each faction change, kill or hand-in, as a LogHistory consumer. */
export const factionSourceConsumer: HistoryConsumer<FactionSourceTallies> = {
  version: 1,
  empty: emptySources,
  reader: sourceReader
}

export class FactionSourceHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every kill and hand-in that moved a faction, over the live log and every archive of it. */
  async view(where: HistoryWhere): Promise<FactionSourceTallies> {
    const slice = await this.history.get<FactionSourceTallies>(this.key, where)
    return joinSources([...slice.archives.map((a) => a.value), slice.live])
  }
}

/** How long a just-written export is left before it is read, so a read never catches the game mid-write. */
const SETTLE_MS = 1500

/**
 * A character's newest factions export in the game folder, read; null when there is none. The game
 * puts the class in the name (Kelwyn_neriak-MNK-Factions.txt), so a character can have one per class.
 */
export async function readFactionExport(dir: string, character: string): Promise<FactionExport | null> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  const who = character.toLowerCase()
  const mine = names.filter((n) => FACTIONS_FILE.exec(n)?.[1].toLowerCase() === who)
  if (!mine.length) return null
  const dated = await Promise.all(mine.map(async (file) => ({ file, modified: (await fs.stat(join(dir, file))).mtimeMs })))
  const newest = dated.sort((a, b) => b.modified - a.modified)[0]
  const young = SETTLE_MS - (Date.now() - newest.modified)
  if (young > 0) await new Promise((r) => setTimeout(r, young))
  const text = await fs.readFile(join(dir, newest.file), 'utf8')
  return { ...newest, standings: parseFactionsExport(text) }
}

/** The client's faction achievements, read again only when the file changes. */
let clientAch: { path: string; mtime: number; list: FactionAchievement[] } | null = null

async function factionAchievementList(dir: string): Promise<FactionAchievement[]> {
  const path = join(dir, 'Resources', 'Achievements', 'AchievementsClient.txt')
  try {
    const st = await fs.stat(path)
    if (clientAch?.path !== path || clientAch.mtime !== st.mtimeMs) clientAch = { path, mtime: st.mtimeMs, list: parseFactionAchievements(await fs.readFile(path, 'utf8')) }
    return clientAch.list
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${path}:`, e)
    return []
  }
}

/** The faction achievements, with what the character's achievements export says of them; null when the client lists none. */
async function factionAchievements(dir: string, character: string): Promise<FactionAchievements | null> {
  const list = await factionAchievementList(dir)
  if (!list.length) return null
  let sections = null
  try {
    sections = parseAchievements(await fs.readFile(join(dir, `${character}-Achievements.txt`), 'utf8')).sections
  } catch (e) {
    // None yet is the usual case: then the standing says which are done.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${character}'s achievements export:`, e)
  }
  return { list, status: progressionStatus(sections) }
}

const FRESH_MS = 7 * 24 * 3600_000

interface FactionWikiCache {
  pages: Record<string, { fetchedAt: number; sources: FactionSources | null }>
}

/** What raises each faction, from its eqlwiki page, kept a week and kept on when the wiki is down. */
export class FactionWiki {
  private cache: FactionWikiCache | null = null

  private get path(): string {
    return join(cacheDir(), 'faction-wiki.json')
  }

  private async load(): Promise<FactionWikiCache> {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.readFile(this.path, 'utf8')) as FactionWikiCache
      if (!this.cache.pages) this.cache.pages = {}
    } catch {
      this.cache = { pages: {} }
    }
    return this.cache
  }

  private async save(): Promise<void> {
    const tmp = this.path + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache))
      await fs.rename(tmp, this.path)
    } catch (e) {
      log.warn('Could not save faction-wiki.json:', e)
    }
  }

  /**
   * The first of the page names a faction can have that is a faction page. The wiki writes King
   * Ak'Anon where the game writes King Ak`Anon, and adds " (Faction)" where the name is taken, by a
   * zone (New Sebilis Expedition) or an NPC (Phinigel Autropos).
   */
  private async fetch(faction: string): Promise<FactionSources | null> {
    const names = [...new Set([faction, faction.replace(/`/g, "'")])]
    for (const title of [...names, ...names.map((n) => `${n} (Faction)`)]) {
      const text = await wiki.wikitext(title)
      const found = text && parseFactionPage(title, text)
      if (found) return found
    }
    return null
  }

  /** A faction's sources; null when the wiki has no faction page for it. */
  async sources(faction: string): Promise<FactionSources | null> {
    const c = await this.load()
    const key = faction.toLowerCase()
    const had = c.pages[key]
    if (had && Date.now() - had.fetchedAt < FRESH_MS) return had.sources
    try {
      c.pages[key] = { fetchedAt: Date.now(), sources: await this.fetch(faction) }
      await this.save()
      sources.ok('factionWiki', `${Object.keys(c.pages).length} faction page${Object.keys(c.pages).length === 1 ? '' : 's'} kept`)
    } catch (e) {
      sources.fail('factionWiki', e, `Could not fetch the page for ${faction}`)
      if (!had) throw e
    }
    return c.pages[key].sources
  }
}

interface FactionBookFile {
  version: number
  fetchedAt: number
  pages: FactionPageData[]
  /** Quest pages by the title faction pages link them by; null for a link to no quest page. */
  quests: Record<string, QuestPage | null>
}

/** Bumped when what the book keeps of a page changes, so an older one is read again. */
const BOOK_VERSION = 1

/**
 * Every eqlwiki faction page, and every quest page one names as raising a faction, read into what
 * the planner needs and kept a week (kept on, however old, when the wiki cannot be reached). About
 * sixteen requests of fifty pages each.
 */
export class FactionBook {
  private book: FactionBookFile | null = null
  private reading: Promise<FactionBookFile> | null = null

  private get path(): string {
    return join(cacheDir(), 'faction-book.json')
  }

  private async load(): Promise<FactionBookFile | null> {
    if (this.book) return this.book
    try {
      const b = JSON.parse(await fs.readFile(this.path, 'utf8')) as FactionBookFile
      if (b.version === BOOK_VERSION && Array.isArray(b.pages) && b.quests) this.book = b
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read faction-book.json; reading eqlwiki again', e)
    }
    return this.book
  }

  private async read(): Promise<FactionBookFile> {
    sources.reading('factionWiki', "Reading eqlwiki's faction and quest pages")
    const pages: FactionPageData[] = []
    await wiki.embeddedIn(
      'Template:Factionpage',
      (batch) => {
        for (const p of batch) {
          const f = parseFactionPageFull(p.title, p.content)
          if (f) pages.push(f)
        }
      },
      'now'
    )
    const titles = [...new Set(pages.flatMap((p) => p.raise.quests))]
    const got = await wiki.pages(titles, 'now')
    const quests: Record<string, QuestPage | null> = {}
    for (const t of titles) {
      const page = got.get(t)
      quests[t] = page ? parseQuestPage(page.title, page.content) : null
    }
    return { version: BOOK_VERSION, fetchedAt: Date.now(), pages, quests }
  }

  /** The book, read again when over a week old or when asked; `error` says why a refresh failed and the old one serves. */
  async get(refresh = false): Promise<{ book: FactionBookFile; error: string }> {
    const had = await this.load()
    if (had && !refresh && Date.now() - had.fetchedAt < FRESH_MS) return { book: had, error: '' }
    try {
      this.reading ??= this.read().finally(() => (this.reading = null))
      const book = await this.reading
      this.book = book
      const tmp = this.path + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(book))
      await fs.rename(tmp, this.path)
      sources.ok('factionWiki', `${book.pages.length} faction pages and ${Object.values(book.quests).filter(Boolean).length} quests with faction`)
      return { book, error: '' }
    } catch (e) {
      sources.fail('factionWiki', e, "Could not read eqlwiki's faction and quest pages")
      if (had) return { book: had, error: e instanceof Error ? e.message : String(e) }
      throw e
    }
  }
}

/** What the character holds, by itemKey: bags, bank, shared bank and depot, at the last inventory export. */
async function holdings(dir: string, character: string): Promise<{ have: Record<string, number>; file: { file: string; modified: number } | null }> {
  const file = `${character}-Inventory.txt`
  try {
    const path = join(dir, file)
    const [text, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
    const inv = parseInventory(text)
    const have: Record<string, number> = {}
    for (const it of [...inv.bags, ...inv.bank, ...inv.sharedBank, ...inv.depot]) have[itemKey(it.name)] = (have[itemKey(it.name)] ?? 0) + it.count
    return { have, file: { file, modified: st.mtimeMs } }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${file}:`, e)
    return { have: {}, file: null }
  }
}

/** Everything the Plan tab plans from, for one character. */
async function planData(ctx: AppContext, character: string, refresh: boolean, wide: boolean): Promise<FactionPlanData> {
  const dir = ctx.installDir()
  const where = ctx.historyOf(character)
  let exported: FactionExport | null = null
  try {
    exported = await readFactionExport(dir, character)
  } catch (e) {
    // The Standings tab says what is wrong with it; planning goes on from the log's changes alone.
    log.warn(`${character}'s factions export could not be read for the plan:`, e)
  }
  const view = await ctx.factions.view(where, exported, await factionAchievements(dir, character))
  const { targets, maxed, achievementsExport, standings } = planFor(view)
  const [tallies, book, purchases, held] = await Promise.all([ctx.factionSources.view(where), ctx.factionBook.get(refresh), ctx.purchases.latest(where), holdings(dir, character)])
  const bought = Object.fromEntries(Object.entries(purchases).map(([k, p]) => [k, { merchant: p.merchant, each: unitPrice(p) }]))
  const input = {
    factions: view.factions.map((r) => r.name),
    targets: targets.map((t) => t.faction),
    sources: tallies,
    pages: book.book.pages,
    quests: book.book.quests,
    bought,
    have: held.have,
    wide
  }
  // What the wiki says of the items hand-ins want: a merchant, a drop, a recipe. Kept a week, like the Gear page's.
  const items = await ctx.inventoryFiles.lookup(itemsToLookUp(input))
  const catalog = buildCatalog({ ...input, items })
  const acts = Object.values(tallies.acts)
  return {
    targets,
    maxed,
    achievementsExport,
    standings,
    catalog,
    export: exported ? { file: exported.file, modified: exported.modified } : null,
    inventory: held.file,
    wiki: { fetchedAt: book.book.fetchedAt, pages: book.book.pages.length, quests: Object.values(book.book.quests).filter(Boolean).length, error: book.error },
    log: {
      kills: acts.filter((t) => t.kind === 'kill').reduce((n, t) => n + t.n, 0),
      handIns: acts.filter((t) => t.kind === 'turnin').reduce((n, t) => n + t.n, 0),
      unexplained: tallies.unexplained
    }
  }
}

export function registerFactionIpc(ctx: AppContext): void {
  // The export last reported to the Data sources page, so the half-minute reload does not report it again.
  let reported = ''
  // Faction changes, over the character's log and its archives, and the standings from its export.
  handle('factions:get', async (character) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    const dir = ctx.installDir()
    if (!dir) return { factions: [], export: null, exportError: '' }
    let exported: FactionExport | null = null
    let exportError = ''
    try {
      exported = await readFactionExport(dir, character)
      const seen = exported ? `${exported.file}@${exported.modified}` : ''
      if (exported && seen !== reported) sources.ok('exports', `${exported.file}, written ${new Date(exported.modified).toLocaleString()}`)
      reported = seen
    } catch (e) {
      // A bad export should not hide the log's changes: say so on Data sources and show those.
      sources.fail('exports', e, `${character}'s factions export`)
      exportError = e instanceof Error ? e.message : String(e)
    }
    return { ...(await ctx.factions.view(ctx.historyOf(character), exported, await factionAchievements(dir, character))), exportError }
  })
  // What raises a faction, from eqlwiki.
  handle('factions:sources', async (faction) => {
    if (typeof faction !== 'string' || !faction.trim() || faction.length > 100) throw new Error('Not a faction.')
    return { sources: await ctx.factionWiki.sources(faction.trim()) }
  })
  // Everything the Plan tab needs to plan the achievements still to do; `refresh` reads eqlwiki again,
  // `wide` adds the ways to raise every other faction (the Most factions positive goal).
  handle('factions:plan', async (character, refresh, wide) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (!ctx.installDir()) throw new Error('Choose the game folder on the Settings page first.')
    return planData(ctx, character, refresh === true, wide === true)
  })
}
