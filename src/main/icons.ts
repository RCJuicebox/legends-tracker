import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { decodeDds, decodeTga, encodePng, type Sheet } from '../core/imageCodecs'
import { parseUiSkin, uiFilesOf } from '../core/uiSkin'
import { sources } from './sources/registry'

// Spell icons come straight from the client: uifiles\default\SpellsNN.tga, 256×256 sheets of
// 40×40 icons, six by six, numbered by the spell file's icon field. Item icons sit the same way in
// dragitemNN.dds (DXT5), numbered from 500: the icon number an item's wiki page gives as lucy_img_ID.
// A skin can carry its own sheets (Live EverQuest's painted spell icons, say), so the character's
// skin folder is looked in first, as the game does (src/core/uiSkin.ts).
const ICON = 40
const PER_ROW = 6
const PER_SHEET = 36

export class IconSource {
  private readonly sheets = new Map<number, Promise<Sheet | null>>()
  private readonly pngs = new Map<number, Buffer>()
  private readonly itemSheets = new Map<number, Promise<Sheet | null>>()
  private readonly itemPngs = new Map<number, Buffer>()
  /** Sheets read since the last clear, for the Data Sources row. */
  private read = 0
  /** Counts clears, so an icon cut from a sheet read before one is not kept. */
  private generation = 0
  /** The skin folder looked in before uifiles\default, or null for the stock skin. */
  private skin: string | null = null

  constructor(private readonly installDir: () => string) {}

  /** Forgets every sheet read, so the next icon reads them again (a game patch). */
  clear(): void {
    this.sheets.clear()
    this.pngs.clear()
    this.itemSheets.clear()
    this.itemPngs.clear()
    this.read = 0
    this.generation++
  }

  /** The skin whose sheets come first; another one forgets every sheet read. Whether it changed. */
  setSkin(skin: string | null): boolean {
    if (skin === this.skin) return false
    this.skin = skin
    this.clear()
    return true
  }

  /** A sheet as decoded: counted and reported when it reads, reported when it is not a sheet at all. */
  private loaded(sheet: Sheet | null, file: string): Sheet | null {
    if (!sheet) {
      sources.fail('icons', new Error(`${file} is not in the format the game's icon sheets use`))
      return null
    }
    this.read++
    const where = this.skin ? `the ${this.skin} skin's folder, then the game's` : 'the game folder'
    sources.ok('icons', `${this.read} icon sheet${this.read === 1 ? '' : 's'} read from ${where}`)
    return sheet
  }

  async png(index: number): Promise<Buffer | null> {
    const hit = this.pngs.get(index)
    if (hit) return hit
    const generation = this.generation
    const sheetNo = Math.floor(index / PER_SHEET) + 1
    const sheet = await this.sheet(sheetNo)
    if (!sheet) return null
    const cell = index % PER_SHEET
    const x0 = (cell % PER_ROW) * ICON
    const y0 = Math.floor(cell / PER_ROW) * ICON
    const rgba = Buffer.alloc(ICON * ICON * 4)
    for (let y = 0; y < ICON; y++) {
      const sy = sheet.topDown ? y0 + y : sheet.height - 1 - (y0 + y)
      for (let x = 0; x < ICON; x++) {
        const o = (sy * sheet.width + x0 + x) * sheet.bpp
        const d = (y * ICON + x) * 4
        rgba[d] = sheet.pixels[o + 2]
        rgba[d + 1] = sheet.pixels[o + 1]
        rgba[d + 2] = sheet.pixels[o]
        rgba[d + 3] = 255
      }
    }
    const png = encodePng(ICON, ICON, rgba)
    if (generation === this.generation) this.pngs.set(index, png)
    return png
  }

  /** An item icon by its icon number (500 and up). */
  async itemPng(icon: number): Promise<Buffer | null> {
    const hit = this.itemPngs.get(icon)
    if (hit) return hit
    const index = icon - 500
    if (index < 0) return null
    const generation = this.generation
    const sheetNo = Math.floor(index / PER_SHEET) + 1
    let p = this.itemSheets.get(sheetNo)
    if (!p) {
      const file = `dragitem${sheetNo}.dds`
      p = this.readSheet(file)
        .then((d) => this.loaded(decodeDds(d), file))
        .catch(sheetFailed)
      this.itemSheets.set(sheetNo, p)
    }
    const sheet = await p
    if (!sheet) return null
    // Item sheets run down the columns, where spell sheets run along the rows.
    const cell = index % PER_SHEET
    const x0 = Math.floor(cell / PER_ROW) * ICON
    const y0 = (cell % PER_ROW) * ICON
    const rgba = Buffer.alloc(ICON * ICON * 4)
    for (let y = 0; y < ICON; y++) sheet.pixels.copy(rgba, y * ICON * 4, ((y0 + y) * sheet.width + x0) * 4, ((y0 + y) * sheet.width + x0 + ICON) * 4)
    const png = encodePng(ICON, ICON, rgba)
    if (generation === this.generation) this.itemPngs.set(icon, png)
    return png
  }

  private sheet(n: number): Promise<Sheet | null> {
    let p = this.sheets.get(n)
    if (!p) {
      p = this.loadSheet(n).catch(sheetFailed)
      this.sheets.set(n, p)
    }
    return p
  }

  private async loadSheet(n: number): Promise<Sheet | null> {
    const file = `Spells${String(n).padStart(2, '0')}.tga`
    return this.loaded(decodeTga(await this.readSheet(file)), file)
  }

  /** A sheet from the skin's folder when it has one, else from uifiles\default. */
  private async readSheet(file: string): Promise<Buffer> {
    const ui = join(this.installDir(), 'uifiles')
    if (this.skin) {
      try {
        return await fs.readFile(join(ui, this.skin, file))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    return fs.readFile(join(ui, 'default', file))
  }
}

/** The skin a character plays with: the one their newest UI file names, or null for the stock skin or none found. */
export async function characterSkin(installDir: string, character: string): Promise<string | null> {
  if (!installDir || !character) return null
  try {
    const files = uiFilesOf(character, await fs.readdir(installDir))
    const dated = await Promise.all(files.map(async (f) => ({ f, at: (await fs.stat(join(installDir, f))).mtimeMs })))
    const newest = dated.sort((a, b) => b.at - a.at)[0]
    return newest ? parseUiSkin(await fs.readFile(join(installDir, newest.f), 'utf8')) : null
  } catch {
    return null
  }
}

/** No game folder set, or no such sheet, is expected; anything else is reported. */
function sheetFailed(e: unknown): null {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') sources.fail('icons', e)
  return null
}
