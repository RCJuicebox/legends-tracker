import { handle } from './handle'
import { log } from '../log'
import { checkGameFolder } from '../game'
import { readAasFromLog } from '../stats'
import { readMotesFromScreen, readStatsFromScreen } from '../screenRead'
import { castableSpells, focusReport, focusSpec } from '../../core/itemFocus'
import { meleeProfile } from '../../core/meleeTally'
import { craftEras } from '../../core/tradeskills'
import { petSpells, petSummonName } from '../../core/pets'
import { emptyProgress, progressionView } from '../../core/progression'
import type { EffectSpell } from '../../core/itemEffects'
import { isCharacterKey, sanitizeSheet } from '../../core/validate'
import { logFileFor, logStem } from '../storeCore'
import type { AppContext } from '../context'
import type { CatalogFile } from '../../shared/ipc'

// A character's files and what is looked up for them: achievements, factions, progression, inventory, the sheet,
// gear (catalog, focus, worn effects), the pet, tradeskills and the Stats page's tables and screen reads.

export function registerCharacterIpc(ctx: AppContext): void {
  const { store, engine } = ctx
  /** A character's log, with its archives: where cast and melee history are read from. */
  const history = (character: string) => ({ logPath: logFileFor(ctx.installDir(), character), archiveDir: engine.archiveDir(), stem: logStem(character) })

  handle('achievements:characters', async () => ({ current: ctx.characterKey(), available: (await checkGameFolder(ctx.installDir())).achievements }))
  handle('achievements:load', (character) => ctx.achievementFiles.load(character))
  handle('achievements:marks', (character, marks) => ctx.achievementFiles.saveMarks(character, marks))

  // Faction changes, over the character's log and its archives.
  handle('factions:get', async (character) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (!ctx.installDir()) return { factions: [] }
    return ctx.factions.view(history(character))
  })

  // Levels, skill-ups, AA points and purchases, and the sessions of play, over the character's log and its archives.
  handle('progression:get', async (character) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (!ctx.installDir()) return progressionView(emptyProgress(), Date.now())
    return ctx.progression.view(history(character))
  })

  // Which characters have a given export, and which one is being played.
  handle('character:exports', async () => {
    const check = await checkGameFolder(ctx.installDir())
    return { current: ctx.characterKey(), achievements: check.achievements, inventory: check.inventory }
  })
  handle('inventory:load', (character, refresh) => ctx.inventoryFiles.load(character, !!refresh))
  handle('inventory:lookup', (names) => ctx.inventoryFiles.lookup(Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []))
  handle('character:sheet', (character) => ctx.inventoryFiles.sheet(character))
  handle('character:saveSheet', (character, input) => {
    const sheet = sanitizeSheet(input)
    if (!sheet) throw new Error('The character sheet is not in the expected form.')
    return ctx.inventoryFiles.saveSheet(character, sheet)
  })

  // The upgrade finder's catalog: what is stored, and a download when asked (or when none is stored).
  // The page needs the items, not the revision table kept for the next refresh.
  const catalogState = (file: CatalogFile | null) => ({ file: file && { ...file, revs: undefined }, stale: ctx.wikiCatalog.isStale(file), progress: ctx.wikiCatalog.progress })
  handle('gear:catalog', async () => catalogState(await ctx.wikiCatalog.stored()))
  handle('gear:catalogRefresh', async () => catalogState(await ctx.wikiCatalog.refresh()))

  // Focus effects on gear, read from the game's spell file: each one's line and strength for these
  // classes at this level, and which of their spells each line improves. Judged on what the character
  // casts: their casts over the last `days` days of play, from the log and its archives.
  handle('gear:foci', async (names, classes, level, character, days) => {
    const book = engine.book
    if (!book) return null
    const specs = [...new Set(names)].map((n) => book.named(n)).flatMap((s) => (s ? [focusSpec(s)] : [])).filter((f) => f !== null)
    const recent = isCharacterKey(character) ? await ctx.castHistory.recent({ ...history(character), days }).catch(() => null) : null
    // "Envenomed Bolt X" is Envenomed Bolt at rank X: one spell, whatever the rank.
    const casts: Record<string, number> = {}
    for (const [name, n] of Object.entries(recent?.counts ?? {})) {
      const spell = book.resolve(name)?.spell.name
      if (spell) casts[spell] = (casts[spell] ?? 0) + n
    }
    const report = focusReport(specs, castableSpells(book.all(), classes, level), classes, level, casts)
    return { ...report, window: recent ? { total: recent.total, from: recent.from, to: recent.to } : null }
  })

  // Worn effects and procs: what their spells do, and the character's melee over the last `days` days
  // of play (0 for all of it) to weigh them against.
  handle('gear:effects', async (names, character, days) => {
    const book = engine.book
    const list = Array.isArray(names) ? [...new Set(names.filter((n): n is string => typeof n === 'string'))] : []
    const spells: Record<string, EffectSpell> = {}
    for (const n of list) {
      const s = book?.named(n)
      if (s) spells[n] = { name: s.name, effects: s.effects, formula: s.formula, cap: s.cap, beneficial: s.beneficial, targetType: s.targetType }
    }
    if (!isCharacterKey(character)) return { spells, profile: null, loaded: !!book }
    const recent = await ctx.meleeHistory.recent({ ...history(character), days: typeof days === 'number' ? days : 14 }).catch((e) => {
      log.warn('Could not read the melee history:', e)
      return null
    })
    return { spells, profile: recent ? meleeProfile(recent.counts, recent) : null, loaded: !!book }
  })

  handle('stats:caps', async (classes, level) => ({
    skills: await ctx.gameTables.skillCaps(classes, level),
    ac: await ctx.gameTables.acCaps(classes, level),
    factors: await ctx.gameTables.classFactors(classes, level)
  }))
  handle('stats:readAAs', () => readAasFromLog(store.settings.get().logFile))
  handle('stats:readScreen', () => readStatsFromScreen(ctx.windows))
  handle('stock:readScreen', () => readMotesFromScreen(ctx.windows))

  // Tradeskills: the wiki's recipes, what the character paid for things, and the favourites.
  handle('trade:recipes', async () => {
    const file = await ctx.recipeBook.stored()
    return { file, stale: ctx.recipeBook.isStale(file), progress: ctx.recipeBook.progress }
  })
  // Crafted items' eras for the Gear page: the era tags each untagged product's ingredients need. A
  // stale recipe book is fetched again in the background; the page asks again when it has been.
  handle('trade:craftEras', async () => {
    const file = await ctx.recipeBook.stored()
    if (ctx.recipeBook.isStale(file) && !ctx.recipeBook.progress.busy) void ctx.recipeBook.refresh().catch((e) => log.warn('Could not refresh the recipes', e))
    return file?.eras ? craftEras(file.recipes, file.eras) : {}
  })
  handle('trade:refresh', async () => {
    const file = await ctx.recipeBook.refresh()
    return { file, stale: ctx.recipeBook.isStale(file), progress: ctx.recipeBook.progress }
  })
  handle('trade:purchases', async (character) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (!ctx.installDir()) return {}
    return ctx.purchases.latest(history(character))
  })
  handle('trade:favorites', () => ctx.tradeFavorites.get())
  handle('trade:saveFavorites', (input) => ctx.tradeFavorites.set(input))

  // The pet: what it wears and which one it is, from the log (read back once a session per
  // character, then followed live), and every pet the character's classes can summon.
  handle('pet:state', async (character, classes, level) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    const ids = Array.isArray(classes) ? classes.filter((c): c is string => typeof c === 'string') : []
    const lvl = typeof level === 'number' ? level : 50
    const book = engine.book
    if (!ctx.petScanned.has(character) && book) {
      ctx.petScanned.add(character)
      // The watched log is the character's own; another character's is in the game's Logs folder.
      const path = ctx.characterKey() === character ? store.settings.get().logFile : logFileFor(ctx.installDir(), character)
      await ctx.petStore.scan(character, path, (name) => petSummonName(book, name))
    }
    return { character, ...(await ctx.petStore.get(character)), spells: book ? petSpells(book, ids, lvl) : [], spellsLoaded: !!book }
  })
  handle('pet:profile', (spell, force) => {
    if (typeof spell !== 'string' || !spell.trim()) throw new Error('Not a spell.')
    return ctx.petWiki.profile(spell.trim(), force === true).then((profile) => ({ spell: spell.trim(), profile }))
  })
}
