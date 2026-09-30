import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  addFactionLine,
  conBasis,
  conOf,
  EXPORT_LINE_MS,
  FACTION_ACH_BASE,
  FACTIONS_FILE,
  parseFactionModifiers,
  withCons,
  factionView,
  joinFactions,
  parseFactionAchievements,
  parseFactionPage,
  parseFactionPageFull,
  parseFactionsExport,
  progressionStatus,
  SinceExports,
  type ExportMark,
  type FactionAchievement,
  type FactionAchievements,
  type FactionExport,
  type FactionPageData,
  type FactionSources,
  type FactionTallies,
  type FactionView,
  type SinceView
} from './core'
import { emptySources, joinSources, shareSources, sourceReader, type FactionSourceTallies } from './attribution'
import { parseQuestPage, type QuestPage } from './questPages'
import { buildCatalog, factionNamer, guessesFrom, itemsToLookUp, planFor, type CatalogInput, type FactionPlanData } from './planner'
import { parseRaceUnlocks, raceUnlocks, unlockedRaces, type RaceUnlockDef } from './unlocks'
import { lookUp, moversOf } from './lookup'
import { listLogs } from '../../main/game'
import type { Purchases } from '../../shared/ipc'
import { parseAchievements, type AchSection } from '../../core/achievements'
import { PLAYABLE_RACES, playableRace } from '../../shared/game/races'
import { itemKey, parseInventory } from '../../core/inventory'
import { unitPrice } from '../../core/tradeskills'
import { handle } from '../../main/ipc/handle'
import { isCharacterKey } from '../../core/validate'
import { sources } from '../../main/sources/registry'
import { wiki } from '../../main/sources/wiki'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import { offsetBefore, readForward, type HistoryConsumer, type HistoryWhere, type LogHistory } from '../../main/sources/logHistory'
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

/** A live log read after the exports, and how far. */
interface SinceRead {
  /** The exports it was read after. */
  key: string
  readTo: number
  /** Whether the log reaches back past the factions export; else an archive holds some of the changes since. */
  whole: boolean
  tally: SinceExports
}

export class FactionHistory {
  /** Per live log: what it saw after the exports, read on from where it ended the time before. */
  private readonly since = new Map<string, SinceRead>()
  private readonly reading = new Map<string, Promise<unknown>>()

  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Every faction the log saw change, over the live log and every archive of it, with the export's standings. */
  async view(where: HistoryWhere, exported: FactionExport | null = null, achievements: FactionAchievements | null = null): Promise<FactionView> {
    const slice = await this.history.get<FactionTallies>(this.key, where)
    const since = await this.sinceExports(where.logPath, exported, achievements?.exported ?? null).catch((e) => {
      log.warn('Could not read the log since the exports:', e)
      return null
    })
    // Archives oldest first, then the live log.
    return factionView(joinFactions([...slice.archives.map((a) => a.value), slice.live]), exported, achievements, since)
  }

  /** What the live log saw after the exports; one read at a time per log, since two at once would count its lines twice. */
  private sinceExports(logPath: string, factions: ExportMark | null, achievements: ExportMark | null): Promise<SinceView | null> {
    if (!factions && !achievements) return Promise.resolve(null)
    const run = (this.reading.get(logPath) ?? Promise.resolve()).then(() => this.readSince(logPath, factions, achievements))
    this.reading.set(
      logPath,
      run.catch(() => undefined)
    )
    return run
  }

  private async readSince(logPath: string, factions: ExportMark | null, achievements: ExportMark | null): Promise<SinceView | null> {
    const size = (await fs.stat(logPath).catch(() => null))?.size ?? 0
    if (!size) return null
    const key = [factions, achievements].map((m) => (m ? `${m.file}@${m.modified}` : '')).join('|')
    let s = this.since.get(logPath)
    // New exports, or a log started afresh: read again from the line before the earlier export.
    if (!s || s.key !== key || size < s.readTo) {
      const readTo = await offsetBefore(logPath, Math.min(factions?.modified ?? Infinity, achievements?.modified ?? Infinity), { slackMs: EXPORT_LINE_MS })
      const whole = !factions || readTo > 0 || (await firstStamp(logPath, size)) < factions.modified - EXPORT_LINE_MS
      s = { key, readTo, whole, tally: new SinceExports(factions, achievements) }
      this.since.set(logPath, s)
    }
    if (size > s.readTo) {
      const tally = s.tally
      s.readTo += await readForward(logPath, s.readTo, size, (line) => tally.add(line), { flushLast: false })
    }
    return { changes: s.whole ? s.tally.factionChanges : null, completed: s.tally.completed }
  }
}

/** When a log's first line was written; Infinity for a log without one near its start. */
async function firstStamp(logPath: string, size: number): Promise<number> {
  let first = Infinity
  await readForward(logPath, 0, Math.min(size, 64 << 10), (line) => {
    if (first === Infinity) first = line.time
  })
  return first
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

/** The client's faction modifiers, read again only when the file changes. */
let clientMods: { path: string; mtime: number; mods: Map<number, Map<number, number>> } | null = null

async function factionModifiers(dir: string): Promise<Map<number, Map<number, number>>> {
  const path = join(dir, 'Resources', 'Faction', 'FactionAssociations.txt')
  try {
    const st = await fs.stat(path)
    if (clientMods?.path !== path || clientMods.mtime !== st.mtimeMs) clientMods = { path, mtime: st.mtimeMs, mods: parseFactionModifiers(await fs.readFile(path, 'utf8')) }
    return clientMods.mods
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${path}:`, e)
    return new Map()
  }
}

/**
 * The view with what each standing cons at for a character (its race's, its class's and its deity's
 * modifiers added), as the Standings tab shows it; `deity` and `race` stand in for the record's.
 * Unchanged without a race, since then the con would be anyone's guess.
 */
async function withConsFor(
  ctx: AppContext,
  dir: string,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  deity?: string,
  race?: string
): Promise<FactionView> {
  const rec = ctx.store.characterByKey(character)
  const c = conBasis(race ?? rec.race, Object.keys(rec.classLevels ?? {}), exported?.file ?? null, deity ?? rec.deity)
  return c ? withCons(view, await factionModifiers(dir), c) : view
}

/** The cons of a view, by faction name. */
const consOf = (view: FactionView) => {
  const cons: Record<string, number> = {}
  for (const r of view.factions) if (r.standing?.con) cons[r.name] = r.standing.con.value
  return cons
}

/**
 * What each faction cons at for the plan, by name. The plan counts every character as Agnostic, which
 * has no modifiers: renouncing your faith is quick, and the first step for anyone planning factions.
 * Empty without a race on the character's record.
 */
async function consFor(ctx: AppContext, dir: string, character: string, exported: FactionExport | null, view: FactionView): Promise<Record<string, number>> {
  return consOf(await withConsFor(ctx, dir, character, exported, view, 'Agnostic'))
}

/**
 * The same for each other race the character can swap to in Loadouts (`races`, or every playable race
 * when no achievements export says), still as an Agnostic: which of them opens a quest its own race cannot.
 */
async function swapConsFor(
  ctx: AppContext,
  dir: string,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  races: string[] | null
): Promise<Record<string, Record<string, number>>> {
  const own = playableRace(ctx.store.characterByKey(character).race ?? '')
  const out: Record<string, Record<string, number>> = {}
  if (!own) return out
  for (const race of PLAYABLE_RACES)
    if (race !== own && (!races || races.includes(race))) out[race] = consOf(await withConsFor(ctx, dir, character, exported, view, 'Agnostic', race))
  return out
}

/** A character's achievements export, read; null without one. */
async function achievementSections(dir: string, character: string): Promise<AchSection[] | null> {
  try {
    return parseAchievements(await fs.readFile(join(dir, `${character}-Achievements.txt`), 'utf8')).sections
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${character}'s achievements export:`, e)
    return null
  }
}

/**
 * Whether a character has unlocked Agnostic to pick in Loadouts ("Deity Unlock - Agnostic" done); null
 * without an export. An export may list only what is still open, so one that leaves it out has it done.
 */
function agnosticOf(sections: AchSection[] | null): boolean | null {
  if (!sections) return null
  const a = sections.flatMap((s) => s.ach).find((x) => x.n.toLowerCase() === 'deity unlock - agnostic')
  return !a || a.d === true
}

/** The client's race unlocks, read again only when either file changes. */
let clientUnlocks: { key: string; defs: RaceUnlockDef[] } | null = null

async function raceUnlockDefs(dir: string): Promise<RaceUnlockDef[]> {
  const paths = ['AchievementsClient.txt', 'AchievementComponentsClient.txt'].map((f) => join(dir, 'Resources', 'Achievements', f))
  try {
    const key = (await Promise.all(paths.map((p) => fs.stat(p)))).map((st, i) => `${paths[i]}@${st.mtimeMs}`).join('|')
    if (clientUnlocks?.key !== key) {
      const [achievements, components] = await Promise.all(paths.map((p) => fs.readFile(p, 'utf8')))
      clientUnlocks = { key, defs: parseRaceUnlocks(achievements, components) }
    }
    return clientUnlocks.defs
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn("Could not read the client's race unlocks:", e)
    return []
  }
}

/** Each faction's name by its id, as the view has them: the factions export's, and the Progression achievements'. */
function factionIds(view: FactionView): Map<number, string> {
  const ids = new Map<number, string>()
  for (const r of view.factions) {
    if (r.achievement) ids.set(r.achievement.id - FACTION_ACH_BASE, r.name)
    if (r.standing) ids.set(r.standing.id, r.name)
  }
  return ids
}

/**
 * What each race a character could be adds to its cons, as an Agnostic of its classes, by the factions
 * whose id is known: for the plan to check what quests' NPCs want as the standings move. Every race with
 * an unlock (Drakkin has none yet) and its own; null without a race on its record.
 */
async function raceModsFor(
  ctx: AppContext,
  dir: string,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  defs: RaceUnlockDef[]
): Promise<FactionPlanData['raceMods']> {
  const rec = ctx.store.characterByKey(character)
  const own = playableRace(rec.race ?? '')
  if (!own) return null
  const table = await factionModifiers(dir)
  const ids = factionIds(view)
  const mods: Record<string, Record<string, number>> = {}
  for (const race of new Set([own, ...defs.map((d) => d.race)])) {
    const c = conBasis(race, Object.keys(rec.classLevels ?? {}), exported?.file ?? null, 'Agnostic')
    if (!c) continue
    const m: Record<string, number> = {}
    for (const [id, name] of ids) {
      const v = conOf(table, id, 0, c.keys).value
      if (v) m[name] = v
    }
    mods[race] = m
  }
  return { own, mods }
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
  const file = `${character}-Achievements.txt`
  let sections = null
  let exported: ExportMark | null = null
  try {
    const modified = (await fs.stat(join(dir, file))).mtimeMs
    sections = parseAchievements(await fs.readFile(join(dir, file), 'utf8')).sections
    exported = { file, modified }
  } catch (e) {
    // None yet is the usual case: then the standing says which are done.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read ${character}'s achievements export:`, e)
  }
  return { list, status: progressionStatus(sections), exported }
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
const BOOK_VERSION = 2

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
  const [tallies, book, purchases, held, others] = await Promise.all([
    ctx.factionSources.view(where),
    ctx.factionBook.get(refresh),
    ctx.purchases.latest(where),
    holdings(dir, character),
    otherCharacters(ctx, character)
  ])
  // What a kill or a hand-in does is the game's, whoever does it: the player's other characters' logs count too.
  const shared = shareSources(
    tallies,
    others.map((o) => ({ character: o.character, sources: o.tallies }))
  )
  const bought: CatalogInput['bought'] = {}
  // This character's own purchases first; an item only another character has bought is still bought somewhere.
  for (const p of [purchases, ...others.map((o) => o.purchases)]) for (const [k, v] of Object.entries(p)) bought[k] ??= { merchant: v.merchant, each: unitPrice(v) }
  const input = {
    factions: view.factions.map((r) => r.name),
    targets: targets.map((t) => t.faction),
    sources: shared.sources,
    shared: shared.from,
    pages: book.book.pages,
    quests: book.book.quests,
    bought,
    have: held.have,
    wide,
    // Allakhazam's pages, as far as they are read: the achievements' factions first, then the character's others.
    alla: await ctx.factionAlla.factions([...new Set([...targets.map((t) => t.faction), ...view.factions.map((r) => r.name)])]),
    cons: await consFor(ctx, dir, character, exported, view)
  }
  // What the wiki says of the items hand-ins want: a merchant, a drop, a recipe. Kept a week, like the Gear page's.
  const items = await ctx.inventoryFiles.lookup(itemsToLookUp(input))
  // The race unlocks, done or not, part by part; the races done are the ones to swap to.
  const [sections, defs] = await Promise.all([achievementSections(dir, character), raceUnlockDefs(dir)])
  const ids = factionIds(view)
  const named = factionNamer(input.factions)
  const unlocks = raceUnlocks(
    defs,
    sections,
    (id, name) => ids.get(id) ?? named(name),
    (f) => standings[f] ?? null
  )
  const races = unlockedRaces(unlocks)
  const catalog = buildCatalog({ ...input, items, swapCons: await swapConsFor(ctx, dir, character, exported, view, races) })
  const acts = Object.values(tallies.acts)
  const theirs = others.flatMap((o) => Object.values(o.tallies.acts))
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
    },
    shared: {
      characters: others.filter((o) => Object.keys(o.tallies.acts).length).map((o) => o.character),
      kills: theirs.filter((t) => t.kind === 'kill').reduce((n, t) => n + t.n, 0),
      handIns: theirs.filter((t) => t.kind === 'turnin').reduce((n, t) => n + t.n, 0)
    },
    alla: ctx.factionAlla.status(),
    agnostic: agnosticOf(sections),
    races,
    unlocks,
    raceMods: await raceModsFor(ctx, dir, character, exported, view, defs)
  }
}

/**
 * Where a character stands with each faction now, and the faction achievements it has done: the
 * Standings tab's view. `byAchievement` finds a faction by its achievement's name (lower-cased).
 */
export async function standingsNow(
  ctx: AppContext,
  character: string
): Promise<{ standings: Record<string, number>; done: Set<string>; byAchievement: Record<string, { faction: string; standing: number | null }> }> {
  const dir = ctx.installDir()
  const exported = await readFactionExport(dir, character).catch(() => null)
  const view = await ctx.factions.view(ctx.historyOf(character), exported, await factionAchievements(dir, character))
  const byAchievement: Record<string, { faction: string; standing: number | null }> = {}
  for (const r of view.factions) if (r.achievement) byAchievement[r.achievement.name.toLowerCase()] = { faction: r.name, standing: r.standing?.value ?? null }
  return { standings: planFor(view).standings, done: new Set(view.factions.filter((r) => r.achievement?.done === true).map((r) => r.name)), byAchievement }
}

/** A character's kills and hand-ins that moved a faction, with the player's other characters' added in (shareSources). */
async function sharedTallies(ctx: AppContext, character: string) {
  const [own, others] = await Promise.all([ctx.factionSources.view(ctx.historyOf(character)), otherCharacters(ctx, character)])
  return shareSources(
    own,
    others.map((o) => ({ character: o.character, sources: o.tallies }))
  )
}

/** The player's other characters with a log in the game folder: what their logs saw of factions, and what they bought. */
async function otherCharacters(ctx: AppContext, character: string): Promise<{ character: string; tallies: FactionSourceTallies; purchases: Purchases }[]> {
  const logs = await listLogs(ctx.installDir())
  const keys = [...new Set(logs.map((l) => l.character))].filter((c) => c.toLowerCase() !== character.toLowerCase())
  const out = []
  // One at a time: LogHistory reads one log at a time anyway, and a failed one is left out rather than failing the plan.
  for (const c of keys) {
    try {
      const where = ctx.historyOf(c)
      out.push({ character: c, tallies: await ctx.factionSources.view(where), purchases: await ctx.purchases.latest(where) })
    } catch (e) {
      log.warn(`${c}'s log could not be read for the faction plan:`, e)
    }
  }
  return out
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
    const view = await ctx.factions.view(ctx.historyOf(character), exported, await factionAchievements(dir, character))
    return { ...(await withConsFor(ctx, dir, character, exported, view)), exportError }
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
  // What moved a faction in the player's logs: this character's and the others'.
  handle('factions:moved', async (character, faction) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (typeof faction !== 'string' || !faction.trim() || faction.length > 100) throw new Error('Not a faction.')
    const shared = await sharedTallies(ctx, character)
    return { movers: moversOf(faction.trim(), shared.sources, shared.from) }
  })
  // What a mob or NPC does to the factions, from the logs and eqlwiki's faction pages.
  handle('factions:lookup', async (character, query) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (typeof query !== 'string' || query.length > 80) throw new Error('Not a name to look up.')
    if (query.trim().length < 3) return { results: [] }
    const where = ctx.historyOf(character)
    const exported = await readFactionExport(ctx.installDir(), character).catch(() => null)
    const [shared, book, view] = await Promise.all([sharedTallies(ctx, character), ctx.factionBook.get(false), ctx.factions.view(where, exported)])
    const name = factionNamer(view.factions.map((r) => r.name))
    return { results: lookUp(query, shared.sources, shared.from, book.book.pages, name, guessesFrom(shared.sources)) }
  })
}
