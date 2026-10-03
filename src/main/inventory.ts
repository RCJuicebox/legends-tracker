import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { parseInventory, type Inventory } from '../core/inventory'
import type { ItemCatalog } from './items'
import type { CharacterSheet, InventoryView } from '../shared/types'
import { log } from './log'
import { assertCharacterKey, isCharacterKey, sanitizeSheet } from '../core/validate'
import { sources } from './sources/registry'
import { ExportWatch } from './exportWatch'

const EMPTY_SHEET: CharacterSheet = { acOverrides: {}, shield: null, stats: {} }

/**
 * Reads a character's inventory export from the game folder and looks up what its worn items (and
 * their augments) are, and keeps the character sheet: what the player typed in that no file records.
 * Typing /outputfile inventory in game rewrites the export; a short poll notices and sends it again.
 */
export class InventoryFiles {
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
      async (c) => send(await this.load(c))
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
      const path = this.exportPath(character)
      const [text, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      this.watch.seen(st.mtimeMs)
      inventory = parseInventory(text)
      base.modified = st.mtimeMs
      sources.ok('exports', `${base.file}, written ${new Date(st.mtimeMs).toLocaleString()}`)
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') sources.fail('exports', e, base.file)
      else sources.missing('exports', `No ${base.file} yet: type /outputfile inventory in game.`)
      return { ...base, error: err.code === 'ENOENT' ? 'missing' : err.message }
    }
    const names = inventory.worn.flatMap((it) => [it.name, ...it.augs.map((a) => a.name)])
    return { ...base, inventory, items: await this.catalog.lookup(names, refresh) }
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
