import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  addFactionLine,
  conBasis,
  conOf,
  EXPORT_LINE_MS,
  FACTION_ACH_BASE,
  FACTION_ACHIEVEMENT_LIST,
  FACTION_MODIFIERS,
  FACTIONS_FILE,
  withCons,
  factionView,
  joinFactions,
  leftOutIsDone,
  parseFactionPageFull,
  parseFactionsExport,
  progressionStatus,
  SinceExports,
  type ExportMark,
  type FactionAchievements,
  type FactionExport,
  type FactionPageData,
  type FactionTallies,
  type FactionView,
  type SinceView
} from './core'
import { emptySources, joinSources, shareSources, sourceReader, type FactionSourceTallies } from './attribution'
import { parseQuestPage, type QuestPage } from './questPages'
import { classSwapName, classSwapOf, factionNamer, unmatchedNames } from './names'
import { buildCatalog, craftMaterials, guessesFrom, itemsToLookUp, npcsToLookUp, type CatalogInput } from './catalog'
import { planFor, type FactionPlanData } from './planner'
import { RACE_UNLOCK_DEFS, raceUnlocks, unlockedRaces, type RaceUnlockDef } from './unlocks'
import { lookUp, moversOf, sourcesOf } from './lookup'
import { sanitizeFollowedPlan } from './tracker'
import { FactionAlla } from './allaSource'
import { FactionNpcs } from './npcSource'
import { listLogs } from '../../main/game'
import type { Purchases } from '../../shared/ipc'
import type { AchSection } from '../../core/achievements'
import { PLAYABLE_RACES, playableRace } from '../../shared/game/races'
import { CLASS_NAMES } from '../../shared/game/classes'
import { itemKey, parseInventory } from '../../core/inventory'
import { unitPrice } from '../../core/tradeskills'
import { handle } from '../../main/ipc/handle'
import { JsonFile, writeFileAtomic } from '../../main/storeCore'
import { assertCharacterKey } from '../../core/validate'
import { sources } from '../../main/sources/registry'
import { expired } from '../../main/sources/freshness'
import { wiki } from '../../main/sources/wiki'
import { cacheDir } from '../../main/paths'
import { log } from '../../main/log'
import { identityOf, offsetBefore, readForward, type HistoryConsumer, type HistoryWhere, type LogHistory } from '../../main/sources/logHistory'
import { sameFile } from '../../core/fileIdentity'
import type { AppContext } from '../../main/context'
import type { AppFeature } from '../../main/appFeature'

// A character's faction changes, from "Your faction standing with X has been adjusted by N." and
// the cap lines, over the log and its archives, for the Factions page. The reading is LogHistory's.
// Where each faction stands comes from the factions export in the game folder, when there is one;
// which have an achievement from the client's achievement list and the achievements export; what
// raises one from its eqlwiki page, fetched when asked for and kept a week.
//
// The plan for the achievements still to do (planner.ts) is worked out in the page, from the catalog
// of ways this builds (catalog.ts) out of what it gathers: what each kill and hand-in in the log did
// (attribution.ts), every eqlwiki faction page and the quest pages they name (kept a week), what the
// character has bought and holds, and what the wiki says of the items hand-ins want.

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
  /** The log file's identity, so another file at the same path starts afresh. */
  id: string
  readTo: number
  /** Whether the log reaches back past the factions export; else an archive holds some of the changes since. */
  whole: boolean
  tally: SinceExports
}

/** A SinceRead as kept in faction-since.json. */
interface KeptSince {
  key: string
  id: string
  readTo: number
  whole: boolean
  tally: unknown
}

/** faction-since.json, or nothing for a file missing or not shaped as one (it is only a head start). */
function readKept(path: string): Record<string, KeptSince> {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, KeptSince>) : {}
  } catch {
    return {}
  }
}

export class FactionHistory {
  /** Per live log: what it saw after the exports, read on from where it ended the time before. */
  private readonly since = new Map<string, SinceRead>()
  private readonly reading = new Map<string, Promise<unknown>>()
  /**
   * The same, kept on disk: without it every start read the log again from the export's line, some
   * seconds of a large log with an old export (LT-371).
   */
  private readonly kept: JsonFile<Record<string, KeptSince>> | null

  constructor(
    private readonly history: LogHistory,
    private readonly key: string,
    keptFile?: string
  ) {
    this.kept = keptFile ? new JsonFile(keptFile, readKept(keptFile), { delayMs: 10_000, pretty: false }) : null
  }

  /** Writes what is waiting. */
  flush(): Promise<void> {
    return this.kept?.flush() ?? Promise.resolve()
  }

  /** A read kept from an earlier run, for these exports, made whole again. */
  private recall(logPath: string, key: string, factions: ExportMark | null, achievements: ExportMark | null): SinceRead | null {
    const k = this.kept?.get()[logPath.toLowerCase()]
    if (!k || k.key !== key || typeof k.readTo !== 'number' || typeof k.id !== 'string') return null
    const tally = SinceExports.from(k.tally, factions, achievements)
    return tally ? { key, id: k.id, readTo: k.readTo, whole: k.whole === true, tally } : null
  }

  private keep(logPath: string, s: SinceRead): void {
    if (!this.kept) return
    const all = this.kept.get()
    all[logPath.toLowerCase()] = { key: s.key, id: s.id, readTo: s.readTo, whole: s.whole, tally: s.tally.toJSON() }
    this.kept.set(all)
  }

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
    const st = await fs.stat(logPath, { bigint: true }).catch(() => null)
    const size = Number(st?.size ?? 0)
    if (!st || !size) return null
    const id = identityOf(st)
    const key = [factions, achievements].map((m) => (m ? `${m.file}@${m.modified}` : '')).join('|')
    let s = this.since.get(logPath) ?? this.recall(logPath, key, factions, achievements) ?? undefined
    // New exports, or a log started afresh (another file at the path, or this one cut short even if it
    // has since grown past where the last read ended): read again from the line before the earlier export.
    if (!s || s.key !== key || !sameFile({ id: s.id, size: s.readTo }, { id, size })) {
      const readTo = await offsetBefore(logPath, Math.min(factions?.modified ?? Infinity, achievements?.modified ?? Infinity), { slackMs: EXPORT_LINE_MS })
      const whole = !factions || readTo > 0 || (await firstStamp(logPath, size)) < factions.modified - EXPORT_LINE_MS
      s = { key, id, readTo, whole, tally: new SinceExports(factions, achievements) }
      this.since.set(logPath, s)
    }
    this.since.set(logPath, s)
    if (size > s.readTo) {
      const tally = s.tally
      const read = await readForward(logPath, s.readTo, size, (line) => tally.add(line), { flushLast: false })
      s.readTo += read
      if (read > 0) this.keep(logPath, s)
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

/** What caused each faction change, kill or hand-in, as a LogHistory consumer. Version 2: a trade's items are counted together. */
const factionSourceConsumer: HistoryConsumer<FactionSourceTallies> = {
  version: 2,
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
 * The factions exports in the game folder by character (lower-cased), listed again only when the
 * folder's entries change: the folder holds some three thousand files, and the Factions page asks
 * every few seconds. A new export is a new entry; one written over keeps its name, and its own time
 * says so below.
 */
let exportNames: { dir: string; mtime: number; byWho: Map<string, string[]> } | null = null
/** Each export read, by path, kept while the file is unchanged. */
const exportsRead = new Map<string, { modified: number; standings: FactionExport['standings'] }>()

/**
 * A character's newest factions export in the game folder, read; null when there is none. The game
 * puts the class in the name (Kelwyn_neriak-MNK-Factions.txt), so a character can have one per class.
 */
export async function readFactionExport(dir: string, character: string): Promise<FactionExport | null> {
  let folder
  try {
    folder = await fs.stat(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  if (!exportNames || exportNames.dir !== dir || exportNames.mtime !== folder.mtimeMs) {
    const byWho = new Map<string, string[]>()
    for (const n of await fs.readdir(dir)) {
      const who = FACTIONS_FILE.exec(n)?.[1].toLowerCase()
      if (who) byWho.set(who, [...(byWho.get(who) ?? []), n])
    }
    exportNames = { dir, mtime: folder.mtimeMs, byWho }
  }
  const mine = exportNames.byWho.get(character.toLowerCase()) ?? []
  const dated = (await Promise.all(mine.map(async (file) => ({ file, modified: (await fs.stat(join(dir, file)).catch(() => null))?.mtimeMs })))).flatMap((d) =>
    d.modified === undefined ? [] : [{ file: d.file, modified: d.modified }]
  )
  if (!dated.length) return null
  const newest = dated.sort((a, b) => b.modified - a.modified)[0]
  const path = join(dir, newest.file)
  const kept = exportsRead.get(path)
  if (kept?.modified === newest.modified) return { ...newest, standings: kept.standings }
  const young = SETTLE_MS - (Date.now() - newest.modified)
  if (young > 0) await new Promise((r) => setTimeout(r, young))
  const standings = parseFactionsExport(await fs.readFile(path, 'utf8'))
  if (exportsRead.size > 20) exportsRead.clear()
  exportsRead.set(path, { modified: newest.modified, standings })
  return { ...newest, standings }
}

/**
 * The view with what each standing cons at for a character (its race's, its class's and its deity's
 * modifiers added), as the Standings tab shows it; `deity`, `race` and `classes` stand in for the record's.
 * Unchanged without a race, since then the con would be anyone's guess.
 */
async function withConsFor(
  ctx: AppContext,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  deity?: string,
  race?: string,
  classes?: string[]
): Promise<FactionView> {
  const rec = ctx.store.characterByKey(character)
  const c = conBasis(race ?? rec.race, classes ?? Object.keys(rec.classLevels ?? {}), exported?.file ?? null, deity ?? rec.deity)
  return c ? withCons(view, await ctx.gameTables.get(FACTION_MODIFIERS), c) : view
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
async function consFor(ctx: AppContext, character: string, exported: FactionExport | null, view: FactionView): Promise<Record<string, number>> {
  return consOf(await withConsFor(ctx, character, exported, view, 'Agnostic'))
}

/**
 * Its own race with one more class in the trio, for each class not in it: Loadouts has every class for
 * one that has done its Primary Class Unlocks. A con takes the best of the classes' modifiers, so the
 * trio with that class is as good as one where it stands in for a class the NPC likes no better.
 */
function classSwaps(classes: string[], race: string): { name: string; classes: string[] }[] {
  if (!classes.length) return []
  return CLASS_NAMES.filter((c) => !classes.includes(c)).map((c) => ({ name: classSwapName(race, c), classes: [...classes, c] }))
}

/**
 * The same for each other race the character can swap to in Loadouts (`races`, or every playable race
 * when no achievements export says), and each race with another class, still as an Agnostic: which of
 * them opens a quest its own race and trio cannot.
 */
async function swapConsFor(
  ctx: AppContext,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  races: string[] | null
): Promise<Record<string, Record<string, number>>> {
  const own = playableRace(ctx.store.characterByKey(character).race ?? '')
  const out: Record<string, Record<string, number>> = {}
  if (!own) return out
  for (const race of PLAYABLE_RACES) if (race !== own && (!races || races.includes(race))) out[race] = consOf(await withConsFor(ctx, character, exported, view, 'Agnostic', race))
  const trio = Object.keys(ctx.store.characterByKey(character).classLevels ?? {})
  for (const race of [own, ...Object.keys(out)])
    for (const s of classSwaps(trio, race)) out[s.name] = consOf(await withConsFor(ctx, character, exported, view, 'Agnostic', race, s.classes))
  return out
}

/** As many races and swaps as the plan can tell apart: it holds the ones a character can be as bits of a number. */
const RACE_ROOM = 31

/** A character's achievements export's sections; null without one. */
async function achievementSections(ctx: AppContext, character: string): Promise<AchSection[] | null> {
  return (await ctx.achievementFiles.exported(character))?.sections ?? null
}

/**
 * Whether a character has unlocked Agnostic to pick in Loadouts ("Deity Unlock - Agnostic" done); null
 * without an export. An export may list only what is still open, so one that leaves it out has it done.
 */
function agnosticOf(sections: AchSection[] | null): boolean | null {
  if (!sections || !leftOutIsDone(sections, (_s, a) => /^deity unlock - /i.test(a.n))) return null
  const a = sections.flatMap((s) => s.ach).find((x) => x.n.toLowerCase() === 'deity unlock - agnostic')
  return !a || a.d === true
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
 * an unlock (Drakkin has none yet) and its own; its own with another class in the trio, where that
 * class does better than the trio with a faction some quest's NPC wants (`gates`); and another race with
 * another class, where only the pair does that well (a Dwarf Rogue for Jeet, who wants Amiable with
 * Miners Guild 628: Dwarf +50 and Rogue +50, where a Dwarf or a Rogue alone cons 50 short), the best
 * pair for each such faction, as many as the plan has room for: first those that open a quest at the
 * standings now (`now`). Null without a race on its record.
 */
async function raceModsFor(
  ctx: AppContext,
  character: string,
  exported: FactionExport | null,
  view: FactionView,
  defs: RaceUnlockDef[],
  gates: Set<string>,
  now?: PairsNow
): Promise<FactionPlanData['raceMods']> {
  const rec = ctx.store.characterByKey(character)
  const own = playableRace(rec.race ?? '')
  if (!own) return null
  const table = await ctx.gameTables.get(FACTION_MODIFIERS)
  const ids = factionIds(view)
  const mods: Record<string, Record<string, number>> = {}
  const trio = Object.keys(rec.classLevels ?? {})
  const modsOf = (race: string, classes: string[]) => {
    const c = conBasis(race, classes, exported?.file ?? null, 'Agnostic')
    if (!c) return null
    const m: Record<string, number> = {}
    for (const [id, name] of ids) {
      const v = conOf(table, id, 0, c.keys).value
      if (v) m[name] = v
    }
    return m
  }
  for (const race of new Set([own, ...defs.map((d) => d.race)])) {
    const m = modsOf(race, trio)
    if (m) mods[race] = m
  }
  const mine = mods[own] ?? {}
  for (const s of classSwaps(trio, own)) {
    const m = modsOf(own, s.classes)
    if (m && [...gates].some((f) => (m[f] ?? 0) > (mine[f] ?? 0))) mods[s.name] = m
  }
  const pairs = Object.keys(mods)
    .filter((r) => r !== own && !classSwapOf(r))
    .flatMap((race) => classSwaps(trio, race).map((s) => ({ name: s.name, mods: modsOf(race, s.classes) ?? {} })))
  return { own, mods: { ...mods, ...bestPairs(mods, pairs, gates, RACE_ROOM - Object.keys(mods).length, now) } }
}

/** What quests' NPCs want (the least con each takes) and the standings now: for the pairs that open a quest today. */
export interface PairsNow {
  needs: { faction: string; min?: number }[]
  standings: Record<string, number>
}

/**
 * Of the race and class pairs, the ones that beat every race and swap in `single` with some faction of
 * `gates`: the best pair for each such faction, at most `room` of them. Those that open the most quests
 * at the standings `now` that no race or swap alone opens come first (a Dwarf Rogue at 0 with Miners
 * Guild 628, for Jeet), then those that gain the most.
 */
export function bestPairs(
  single: Record<string, Record<string, number>>,
  pairs: { name: string; mods: Record<string, number> }[],
  gates: Iterable<string>,
  room: number,
  now?: PairsNow
): Record<string, Record<string, number>> {
  const gain = new Map<string, number>()
  const opens = new Map<string, number>()
  const seen = new Set<string>()
  for (const f of gates) {
    const best = Math.max(...Object.values(single).map((m) => m[f] ?? 0))
    let top: { name: string; v: number } | null = null
    for (const p of pairs) if ((p.mods[f] ?? 0) > (top?.v ?? best)) top = { name: p.name, v: p.mods[f] ?? 0 }
    if (!top) continue
    gain.set(top.name, Math.max(gain.get(top.name) ?? 0, top.v - best))
    const raw = now?.standings[f] ?? 0
    for (const n of now?.needs ?? []) {
      const key = `${n.faction}|${n.min}`
      if (n.faction !== f || n.min === undefined || seen.has(key)) continue
      seen.add(key)
      if (raw + best < n.min && raw + top.v >= n.min) opens.set(top.name, (opens.get(top.name) ?? 0) + 1)
    }
  }
  const byName = new Map(pairs.map((p) => [p.name, p.mods]))
  const kept = [...gain].sort((a, b) => (opens.get(b[0]) ?? 0) - (opens.get(a[0]) ?? 0) || b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.max(0, room))
  return Object.fromEntries(kept.map(([name]) => [name, byName.get(name)!]))
}

/** The faction achievements, with what the character's achievements export says of them; null when the client lists none. */
async function factionAchievements(ctx: AppContext, character: string): Promise<FactionAchievements | null> {
  const list = await ctx.gameTables.get(FACTION_ACHIEVEMENT_LIST)
  if (!list.length) return null
  // Without an export, the standing says which are done.
  const exp = await ctx.achievementFiles.exported(character)
  return { list, status: progressionStatus(exp?.sections ?? null), exported: exp && { file: exp.file, modified: exp.modified } }
}

interface FactionBookFile {
  version: number
  fetchedAt: number
  pages: FactionPageData[]
  /** Quest pages by the title faction pages link them by; null for a link to no quest page. */
  quests: Record<string, QuestPage | null>
}

const bookDetail = (book: FactionBookFile) => `${book.pages.length} faction pages and ${Object.values(book.quests).filter(Boolean).length} quests with faction`

/** Bumped when what the book keeps of a page changes, so an older one is read again. 3: the hand-in reader's "Give [[Item]] to [[NPC]]" fix. 4: a page of several quests read quest by quest. */
const BOOK_VERSION = 4
/** Books from this version on have today's shape: an older one of them is read again, but serves while the wiki cannot be reached. */
const BOOK_SHAPE_SINCE = 2

/**
 * Every eqlwiki faction page, and every quest page one names as raising a faction, read into what
 * the planner needs and kept a week (kept on, however old, when the wiki cannot be reached). About
 * sixteen requests of fifty pages each.
 */
/** How long one build of the plan's data answers every page that asks for it. */
const PLAN_SHARED_MS = 5000

/** How long a plan waits for eqlwiki's word on its camps' named mobs, asked for the first time; what comes later counts from the next plan. */
const NPC_WAIT_MS = 20_000

/** After the wiki could not be read, the old book serves this long before it is tried again. */
const BOOK_RETRY_MS = 10 * 60_000

export class FactionBook {
  private book: FactionBookFile | null = null
  private reading: Promise<FactionBookFile> | null = null
  /** When a read last failed, and why: the plan asks every minute, and must not read sixteen requests' worth each time (LT-411). */
  private failed: { at: number; error: string } | null = null

  private get path(): string {
    return join(cacheDir(), 'faction-book.json')
  }

  private async load(): Promise<FactionBookFile | null> {
    if (this.book) return this.book
    try {
      const b = JSON.parse(await fs.readFile(this.path, 'utf8')) as FactionBookFile
      if (b.version >= BOOK_SHAPE_SINCE && b.version <= BOOK_VERSION && Array.isArray(b.pages) && b.quests) this.book = b.version === BOOK_VERSION ? b : { ...b, fetchedAt: 0 }
      // Kept from an earlier read is as good as fetched, for the Data Sources row.
      if (this.book?.fetchedAt) sources.ok('factionWiki', bookDetail(this.book))
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
    if (had && !refresh && !expired(had.fetchedAt)) return { book: had, error: '' }
    // Stale, but the last read failed lately: the old book serves until it is time to try again.
    if (had && !refresh && this.failed && Date.now() - this.failed.at < BOOK_RETRY_MS) return { book: had, error: this.failed.error }
    try {
      this.reading ??= this.read().finally(() => (this.reading = null))
      const book = await this.reading
      this.book = book
      await writeFileAtomic(this.path, JSON.stringify(book))
      sources.ok('factionWiki', bookDetail(book))
      this.failed = null
      return { book, error: '' }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      this.failed = { at: Date.now(), error }
      sources.fail(
        'factionWiki',
        e,
        `Could not read eqlwiki's faction and quest pages; the copy kept serves, and it is tried again from ${new Date(Date.now() + BOOK_RETRY_MS).toLocaleTimeString()}`
      )
      if (had) return { book: had, error }
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
  const achievements = await factionAchievements(ctx, character)
  const view = await ctx.factions.history.view(where, exported, achievements)
  const { targets, maxed, achievementsExport, standings } = planFor(view)
  const [tallies, book, purchases, held, others] = await Promise.all([
    ctx.factions.causes.view(where),
    ctx.factions.book.get(refresh),
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
  for (const p of [purchases, ...others.map((o) => o.purchases)])
    for (const [k, v] of Object.entries(p)) bought[k] ??= { merchant: v.merchant, each: unitPrice(v), ...(v.zone ? { zone: v.zone } : {}) }
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
    alla: await ctx.factions.alla.factions([...new Set([...targets.map((t) => t.faction), ...view.factions.map((r) => r.name)])]),
    cons: await consFor(ctx, character, exported, view)
  }
  // What the wiki says of the items hand-ins want: a merchant, a drop, a recipe. Kept a week, like the Gear page's.
  const items = await ctx.inventoryFiles.lookup(itemsToLookUp(input))
  // And of what goes into the crafted ones: one made from what merchants sell is quick to come by (Tumpy Tonic).
  const mats = craftMaterials(items).filter((m) => !items[itemKey(m)])
  if (mats.length) Object.assign(items, await ctx.inventoryFiles.lookup(mats))
  // Which of the camps' named mobs Legends has, and how tough they are and how soon back (Allakhazam lists live EverQuest's).
  const npcs = await ctx.factions.npcs.lookup(npcsToLookUp(input), NPC_WAIT_MS)
  // The race unlocks, done or not, part by part; the races done are the ones to swap to.
  const [sections, defs] = await Promise.all([achievementSections(ctx, character), ctx.gameTables.get(RACE_UNLOCK_DEFS)])
  const ids = factionIds(view)
  const named = factionNamer(input.factions)
  const unlocks = raceUnlocks(
    defs,
    sections,
    (id, name) => ids.get(id) ?? named(name),
    (f) => standings[f] ?? null
  )
  const races = unlockedRaces(unlocks)
  const catalog = buildCatalog({ ...input, items, npcs, swapCons: await swapConsFor(ctx, character, exported, view, races) })
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
    wiki: {
      fetchedAt: book.book.fetchedAt,
      pages: book.book.pages.length,
      quests: Object.values(book.book.quests).filter(Boolean).length,
      error: book.error,
      unmatched: unmatchedNames(
        book.book.pages.map((p) => p.page),
        input.factions
      )
    },
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
    alla: ctx.factions.alla.status(),
    agnostic: agnosticOf(sections),
    races,
    unlocks,
    raceMods: await raceModsFor(ctx, character, exported, view, defs, new Set(catalog.activities.flatMap((a) => a.gate?.map((n) => n.faction) ?? [])), {
      needs: catalog.activities.flatMap((a) => a.gate ?? []),
      standings
    }),
    ...(achievements ? {} : { noAchievementList: true })
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
  const view = await ctx.factions.history.view(ctx.historyOf(character), exported, await factionAchievements(ctx, character))
  const byAchievement: Record<string, { faction: string; standing: number | null }> = {}
  for (const r of view.factions) if (r.achievement) byAchievement[r.achievement.name.toLowerCase()] = { faction: r.name, standing: r.standing?.value ?? null }
  return { standings: planFor(view).standings, done: new Set(view.factions.filter((r) => r.achievement?.done === true).map((r) => r.name)), byAchievement }
}

/** A character's kills and hand-ins that moved a faction, with the player's other characters' added in (shareSources). */
async function sharedTallies(ctx: AppContext, character: string) {
  const [own, others] = await Promise.all([ctx.factions.causes.view(ctx.historyOf(character)), otherCharacters(ctx, character)])
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
      out.push({ character: c, tallies: await ctx.factions.causes.view(where), purchases: await ctx.purchases.latest(where) })
    } catch (e) {
      log.warn(`${c}'s log could not be read for the faction plan:`, e)
    }
  }
  return out
}

/** The keys its consumers' values go under in log-history.json. */
const HISTORY_KEY = 'factions'
const CAUSES_KEY = 'factionSources'

/**
 * The Factions page's side of the app, whole: what it counts over the logs, the pages it reads, its
 * Data Sources rows, its channels (following a plan's among them) and what it keeps.
 */
export class Factions implements AppFeature {
  readonly id = 'factions'
  /** What it counts over each character's log and archives, under these names in log-history.json. */
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [HISTORY_KEY]: factionConsumer, [CAUSES_KEY]: factionSourceConsumer }
  /** Faction changes over the character's log and archives, for the Factions page. */
  readonly history: FactionHistory
  /** What caused each faction change, kill or hand-in, for the plan. */
  readonly causes: FactionSourceHistory
  /** eqlwiki's faction pages and the quest pages they name, for the plan. */
  readonly book = new FactionBook()
  /** Allakhazam's faction pages, for the con a quest wants and the kills eqlwiki lacks. */
  readonly alla = new FactionAlla()
  /** eqlwiki's pages for the named mobs of the plan's kill camps: whether Legends has them, how tough, how soon back. */
  readonly npcs = new FactionNpcs()

  constructor(logHistory: LogHistory) {
    this.history = new FactionHistory(logHistory, HISTORY_KEY, join(cacheDir(), 'faction-since.json'))
    this.causes = new FactionSourceHistory(logHistory, CAUSES_KEY)
  }

  /** Writes the Allakhazam pages read since the last write. */
  flush(): Promise<void> {
    return Promise.all([this.alla.flush(), this.history.flush()]).then(() => undefined)
  }

  // The handlers reach the feature through the context, as every other channel does.
  register(ctx: AppContext): void {
    // The page is told when a standing moves or an export is written (a moment after, as the game
    // finishes the file), rather than asking every ten seconds (LT-399).
    let told: NodeJS.Timeout | null = null
    ctx.engine.use({
      id: 'factions',
      line: (line) => {
        if (!line.text.startsWith('Your faction standing with ') && !line.text.startsWith('Outputfile Complete:')) return
        if (told) clearTimeout(told)
        told = setTimeout(() => {
          told = null
          ctx.windows.toMain('state:factionsChanged')
        }, 2000)
      }
    })
    sources.add('factionWiki', {
      label: 'Faction pages',
      kind: 'wiki',
      what: "eqlwiki's faction pages and the quest pages they name, for what raises a faction and the Factions page's plan. Kept a week.",
      refresh: () => ctx.factions.book.get(true)
    })
    sources.add('factionNpcs', {
      label: 'NPC pages',
      kind: 'wiki',
      what: "eqlwiki's pages for the named mobs the plan's kill camps would hold: whether Legends has them at all, their health and respawn, and kill amounts. Kept a month."
    })
    sources.add('allakhazam', {
      label: 'Allakhazam',
      kind: 'wiki',
      what: "Allakhazam's faction pages, for the con a quest wants, kill amounts and mobs eqlwiki lacks: a page every twenty seconds, as the site asks, each kept a month."
    })
    // The export last reported to the Data sources page, so the half-minute reload does not report it again.
    let reported = ''
    // Faction changes, over the character's log and its archives, and the standings from its export.
    handle('factions:get', async (character) => {
      assertCharacterKey(character)
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
      const view = await ctx.factions.history.view(ctx.historyOf(character), exported, await factionAchievements(ctx, character))
      return { ...(await withConsFor(ctx, character, exported, view)), exportError }
    })
    // What raises a faction, from its page in the book of eqlwiki's faction pages the Plan tab reads.
    handle('factions:sources', async (faction) => {
      if (typeof faction !== 'string' || !faction.trim() || faction.length > 100) throw new Error('Not a faction.')
      return { sources: sourcesOf(faction.trim(), (await ctx.factions.book.get()).book.pages) }
    })
    // Everything the Plan tab needs to plan the achievements still to do; `refresh` reads eqlwiki again,
    // `wide` adds the ways to raise every other faction (the Most factions positive goal).
    // The Standings tab (a row opened) and the Plan tab each ask for this, the Plan tab every minute:
    // one answer serves both for a few seconds, and two asking at once share one build (LT-424).
    const plans = new Map<string, { at: number; data: ReturnType<typeof planData> }>()
    handle('factions:plan', async (character, refresh, wide) => {
      assertCharacterKey(character)
      if (!ctx.installDir()) throw new Error('Choose the game folder on the Settings page first.')
      const key = `${character}|${wide === true}`
      const had = plans.get(key)
      if (!refresh && had && Date.now() - had.at < PLAN_SHARED_MS) return had.data
      const data = planData(ctx, character, refresh === true, wide === true)
      plans.set(key, { at: Date.now(), data })
      data.catch(() => plans.get(key)?.data === data && plans.delete(key))
      return data
    })
    // What moved a faction in the player's logs: this character's and the others'.
    handle('factions:moved', async (character, faction) => {
      assertCharacterKey(character)
      if (typeof faction !== 'string' || !faction.trim() || faction.length > 100) throw new Error('Not a faction.')
      const shared = await sharedTallies(ctx, character)
      return { movers: moversOf(faction.trim(), shared.sources, shared.from) }
    })
    // What a mob or NPC does to the factions, from the logs and eqlwiki's faction pages.
    handle('factions:lookup', async (character, query) => {
      assertCharacterKey(character)
      if (typeof query !== 'string' || query.length > 80) throw new Error('Not a name to look up.')
      if (query.trim().length < 3) return { results: [] }
      const where = ctx.historyOf(character)
      const exported = await readFactionExport(ctx.installDir(), character).catch(() => null)
      const [shared, book, view] = await Promise.all([sharedTallies(ctx, character), ctx.factions.book.get(false), ctx.factions.history.view(where, exported)])
      const name = factionNamer(view.factions.map((r) => r.name))
      return { results: lookUp(query, shared.sources, shared.from, book.book.pages, name, guessesFrom(shared.sources)) }
    })
    // The plan the achievements overlay follows, and the step the player moved it to.
    handle('factions:follow', async (character, plan) => {
      assertCharacterKey(character)
      const clean = plan === null ? null : sanitizeFollowedPlan(plan)
      if (plan !== null && !clean) throw new Error('Not a plan.')
      await ctx.liveAchievements.follow(character, clean)
    })
    handle('factions:follow-step', async (character, index) => {
      assertCharacterKey(character)
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('Not a step.')
      await ctx.liveAchievements.followStep(character, index)
    })
  }
}
