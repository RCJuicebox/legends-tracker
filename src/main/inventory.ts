import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { parseInventory, type Inventory } from '../core/inventory'
import { LootSinceTally, type LootedSince } from '../core/loot'
import type { ItemCatalog } from './items'
import type { CharacterSheet, InventoryView } from '../shared/types'
import { log } from './log'
import { assertCharacterKey, isCharacterKey, sanitizeSheet } from '../core/validate'
import { sources } from './sources/registry'
import { ExportWatch } from './exportWatch'
import { SettledReads } from './exportFiles'
import { sinceStart } from './sources/sinceExport'
import { readForward } from './sources/logHistory'
import { logStem } from './storeCore'

const EMPTY_SHEET: CharacterSheet = { acOverrides: {}, shield: null, stats: {} }

/**
 * Reads a character's inventory export from the game folder and looks up what its worn items (and
 * their augments) are, and keeps the character sheet: what the player typed in that no file records.
 * Typing /outputfile inventory in game rewrites the export; a short poll notices and sends it again.
 */
export class InventoryFiles {
  /** Told each export read with a new time, for the merge planner to follow its levels (LT-740); the context sets it. */
  onExport: (character: string, inventory: Inventory, modified: number) => void = () => {}
  private readonly exportSeen = new Map<string, number>()
  /** A character's live log; the context sets it to the one being watched for the character played. */
  logFile: (character: string) => string = (c) => join(this.gameDir(), 'Logs', `${logStem(c)}.txt`)
  /** Each character's log as read on from its export: where the read got to, and what it saw looted. */
  private readonly since = new Map<string, { after: number; id: string; readTo: number; tally: LootSinceTally }>()
  /** The read of each character's log under way: one at a time, or two would count the same lines. */
  private readonly sinceReads = new Map<string, Promise<boolean>>()

  private exportRead(character: string, inventory: Inventory, modified: number): void {
    if (this.exportSeen.get(character) === modified) return
    this.exportSeen.set(character, modified)
    this.onExport(character, inventory, modified)
  }

  private readonly watch: ExportWatch
  /** The load under way, per character and refresh: a stalled wiki must not pile up calls from the poll. */
  private readonly loading = new Map<string, Promise<InventoryView>>()

  constructor(
    /** The app's data folder (userData): character sheets go in its characters folder. */
    private readonly dataDir: string,
    private readonly gameDir: () => string,
    private readonly catalog: ItemCatalog,
    send: (view: InventoryView) => void,
    /** Whether a page could be showing the export: the main window is open. Hidden, the file is not looked at. */
    shown: () => boolean = () => true
  ) {
    this.watch = new ExportWatch(
      'Inventory',
      (c) => this.exportPath(c),
      gameDir,
      shown,
      async (c) => send(await this.load(c)),
      // Loot lands in the log, not the export: a look at the log's new lines too.
      (c) => this.readSince(c)
    )
  }

  exportPath(character: string): string {
    return join(this.gameDir(), `${character}-Inventory.txt`)
  }

  load(character: string, refresh = false): Promise<InventoryView> {
    const key = `${refresh ? 1 : 0}|${character}`
    let p = this.loading.get(key)
    if (!p) {
      p = this.read(character, refresh).finally(() => this.loading.delete(key))
      this.loading.set(key, p)
    }
    return p
  }

  /** The exports read, once a write and once settled, as the achievements and factions exports are (LT-633). */
  private readonly exports = new SettledReads(parseInventory)

  private async read(character: string, refresh: boolean): Promise<InventoryView> {
    if (!isCharacterKey(character)) {
      this.watch.follow('')
      const named = typeof character === 'string' ? character : ''
      return { character: named, file: '', modified: 0, inventory: null, items: {}, error: named ? 'Not a character name.' : 'No character chosen.' }
    }
    this.watch.follow(character)
    const base: InventoryView = { character, file: `${character}-Inventory.txt`, modified: 0, inventory: null, items: {}, error: '' }
    let inventory: Inventory
    try {
      const read = await this.exports.read(this.exportPath(character))
      this.watch.seen(read.modified)
      inventory = read.value
      this.exportRead(character, inventory, read.modified)
      base.modified = read.modified
      sources.ok('exports', `${base.file}, written ${new Date(read.modified).toLocaleString()}`)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') sources.fail('exports', e, base.file)
      else sources.missing('exports', `No ${base.file} yet: type /outputfile inventory in game.`)
      return { ...base, error: err.code === 'ENOENT' ? 'missing' : err.message }
    }
    const names = inventory.worn.flatMap((it) => [it.name, ...it.augs.map((a) => a.name)])
    const looted = await this.lootedSince(character, base.modified)
    return { ...base, inventory, items: await this.catalog.lookup(names, refresh), ...(looted ? { looted } : {}) }
  }

  /** What the character's log saw looted after the export written at `after`; undefined without a log. */
  private async lootedSince(character: string, after: number): Promise<LootedSince | undefined> {
    await this.readSince(character, after).catch((e) => log.warn(`Could not read ${character}'s log for loot since the inventory export`, e))
    const kept = this.since.get(character)
    return kept?.after === after ? kept.tally.view() : undefined
  }

  /**
   * Reads the character's log on from where the last read got to (from the line before the export at
   * first, or when the log was replaced): whether it saw anything looted. `after` is the export's time;
   * without one, the export last read for the character.
   */
  private readSince(character: string, after = this.since.get(character)?.after): Promise<boolean> {
    if (after === undefined) return Promise.resolve(false)
    const run = (this.sinceReads.get(character) ?? Promise.resolve(false)).catch(() => false).then(() => this.readOn(character, after))
    this.sinceReads.set(character, run)
    return run
  }

  private async readOn(character: string, after: number): Promise<boolean> {
    const path = this.logFile(character)
    let s = this.since.get(character)
    const start = await sinceStart(path, s && s.after === after ? { id: s.id, readTo: s.readTo } : null, after)
    if (!start) return false
    let changed = false
    if (!s || s.after !== after || start.fresh) {
      s = { after, id: start.id, readTo: start.from, tally: new LootSinceTally(after) }
      this.since.set(character, s)
      changed = true
    }
    if (start.size > s.readTo) {
      const tally = s.tally
      s.readTo += await readForward(
        path,
        s.readTo,
        start.size,
        (line) => {
          if (tally.add(line)) changed = true
        },
        { flushLast: false }
      )
    }
    return changed
  }

  /**
   * The export alone, as last written: no wiki look-ups, and the watch left on the character it follows
   * (Plan › Plane of Sky counts its items from it). Null without one, or when it cannot be read.
   */
  async exported(character: string): Promise<{ file: string; modified: number; inventory: Inventory } | null> {
    if (!isCharacterKey(character)) return null
    try {
      const read = await this.exports.read(this.exportPath(character))
      this.exportRead(character, read.value, read.modified)
      return { file: `${character}-Inventory.txt`, modified: read.modified, inventory: read.value }
    } catch {
      return null
    }
  }

  /** Looks up more items on demand (an item in a bag, opened to see what it is). */
  lookup(names: string[], force = false) {
    return this.catalog.lookup(names, force)
  }

  private sheetPath(character: string): string {
    return join(this.dataDir, 'characters', `${character}.json`)
  }

  async sheet(character: string): Promise<CharacterSheet> {
    const empty = { ...EMPTY_SHEET, acOverrides: {}, stats: {} }
    if (!isCharacterKey(character)) return empty
    try {
      // Checked as a save from the page is (LT-433): a hand-edited sheet of the wrong shape is an empty one.
      const s = sanitizeSheet(JSON.parse(await fs.readFile(this.sheetPath(character), 'utf8')))
      if (!s) log.warn(`The character sheet for ${character} is not in the expected form; starting it afresh`)
      return s ? { ...EMPTY_SHEET, ...s } : empty
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read the character sheet for ${character}`, e)
      return empty
    }
  }

  async saveSheet(character: string, sheet: CharacterSheet): Promise<void> {
    // Said, not passed over: a page must not believe it saved (LT-434).
    assertCharacterKey(character)
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new Error('The character sheet is not in the expected form.')
    const path = this.sheetPath(character)
    await fs.mkdir(join(path, '..'), { recursive: true })
    await writeFileAtomic(path, JSON.stringify(sheet, null, 2))
  }

  stop(): void {
    this.watch.stop()
  }
}
