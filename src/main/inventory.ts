import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseInventory, type Inventory } from '../core/inventory'
import type { ItemCatalog } from './items'
import type { CharacterSheet, InventoryView } from '../shared/types'
import { log } from './log'
import { isCharacterKey } from './validate'

const EMPTY_SHEET: CharacterSheet = { acOverrides: {}, shield: null, stats: {} }

/**
 * Reads a character's inventory export from the game folder and looks up what its worn items (and
 * their augments) are, and keeps the character sheet: what the player typed in that no file records.
 * Typing /outputfile inventory in game rewrites the export; a short poll notices and sends it again.
 */
export class InventoryFiles {
  private watched = ''
  private watchedMtime = 0
  private timer: NodeJS.Timeout | null = null
  /** The load under way, per character and refresh: a stalled wiki must not pile up calls from the poll. */
  private readonly loading = new Map<string, Promise<InventoryView>>()
  private polling = false

  constructor(
    private readonly gameDir: () => string,
    private readonly catalog: ItemCatalog,
    private readonly send: (view: InventoryView) => void
  ) {}

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
      this.watched = ''
      const named = typeof character === 'string' ? character : ''
      return { character: named, file: '', modified: 0, inventory: null, items: {}, error: named ? 'Not a character name.' : 'No character chosen.' }
    }
    this.watched = character
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 4000)
    const base: InventoryView = { character, file: `${character}-Inventory.txt`, modified: 0, inventory: null, items: {}, error: '' }
    let inventory: Inventory
    try {
      const path = this.exportPath(character)
      const [text, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      this.watchedMtime = st.mtimeMs
      inventory = parseInventory(text)
      base.modified = st.mtimeMs
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') log.warn(`Could not read ${base.file}`, e)
      return { ...base, error: err.code === 'ENOENT' ? 'missing' : err.message }
    }
    const names = inventory.worn.flatMap((it) => [it.name, ...it.augs.map((a) => a.name)])
    return { ...base, inventory, items: await this.catalog.lookup(names, refresh) }
  }

  /** Looks up more items on demand (an item in a bag, opened to see what it is). */
  lookup(names: string[]) {
    return this.catalog.lookup(names)
  }

  private async poll(): Promise<void> {
    if (!this.watched || !this.gameDir() || this.polling) return
    this.polling = true
    try {
      const st = await fs.stat(this.exportPath(this.watched))
      if (st.mtimeMs !== this.watchedMtime && Date.now() - st.mtimeMs > 1500) this.send(await this.load(this.watched))
    } catch (e) {
      // No export yet.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Inventory poll failed', e)
    } finally {
      this.polling = false
    }
  }

  private sheetPath(character: string): string {
    return join(app.getPath('userData'), 'characters', `${character}.json`)
  }

  async sheet(character: string): Promise<CharacterSheet> {
    const empty = { ...EMPTY_SHEET, acOverrides: {}, stats: {} }
    if (!isCharacterKey(character)) return empty
    try {
      const s = JSON.parse(await fs.readFile(this.sheetPath(character), 'utf8')) as Partial<CharacterSheet>
      return { ...EMPTY_SHEET, ...s, acOverrides: s.acOverrides ?? {}, stats: s.stats ?? {} }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read the character sheet for ${character}`, e)
      return empty
    }
  }

  async saveSheet(character: string, sheet: CharacterSheet): Promise<void> {
    if (!isCharacterKey(character)) return
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) throw new Error('The character sheet is not in the expected form.')
    const path = this.sheetPath(character)
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path + '.tmp', JSON.stringify(sheet, null, 2), 'utf8')
    await fs.rename(path + '.tmp', path)
  }
}
