import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseInventory, type Inventory } from '../core/inventory'
import type { ItemCatalog } from './items'
import type { CharacterSheet, InventoryView } from '../shared/types'

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

  constructor(
    private readonly gameDir: () => string,
    private readonly catalog: ItemCatalog,
    private readonly send: (view: InventoryView) => void
  ) {}

  exportPath(character: string): string {
    return join(this.gameDir(), `${character}-Inventory.txt`)
  }

  async load(character: string, refresh = false): Promise<InventoryView> {
    this.watched = character
    if (!this.timer) this.timer = setInterval(() => void this.poll(), 4000)
    const base: InventoryView = { character, file: `${character}-Inventory.txt`, modified: 0, inventory: null, items: {}, error: '' }
    if (!character) return { ...base, error: 'No character chosen.' }
    let inventory: Inventory
    try {
      const path = this.exportPath(character)
      const [text, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      this.watchedMtime = st.mtimeMs
      inventory = parseInventory(text)
      base.modified = st.mtimeMs
    } catch (e) {
      const err = e as NodeJS.ErrnoException
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
    if (!this.watched || !this.gameDir()) return
    try {
      const st = await fs.stat(this.exportPath(this.watched))
      if (st.mtimeMs !== this.watchedMtime && Date.now() - st.mtimeMs > 1500) this.send(await this.load(this.watched))
    } catch {
      // No export yet.
    }
  }

  private sheetPath(character: string): string {
    return join(app.getPath('userData'), 'characters', `${character}.json`)
  }

  async sheet(character: string): Promise<CharacterSheet> {
    try {
      const s = JSON.parse(await fs.readFile(this.sheetPath(character), 'utf8')) as Partial<CharacterSheet>
      return { ...EMPTY_SHEET, ...s, acOverrides: s.acOverrides ?? {}, stats: s.stats ?? {} }
    } catch {
      return { ...EMPTY_SHEET, acOverrides: {}, stats: {} }
    }
  }

  async saveSheet(character: string, sheet: CharacterSheet): Promise<void> {
    if (!character) return
    const path = this.sheetPath(character)
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path + '.tmp', JSON.stringify(sheet, null, 2), 'utf8')
    await fs.rename(path + '.tmp', path)
  }
}
