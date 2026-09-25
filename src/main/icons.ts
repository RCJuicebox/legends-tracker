import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

// Spell icons come straight from the client: uifiles\default\SpellsNN.tga, 256×256 sheets of
// 40×40 icons, six by six, numbered by the spell file's icon field. Item icons sit the same way in
// dragitemNN.dds (DXT5), numbered from 500: the icon number an item's wiki page gives as lucy_img_ID.
const ICON = 40
const PER_ROW = 6
const PER_SHEET = 36

interface Sheet {
  width: number
  height: number
  bpp: number
  topDown: boolean
  pixels: Buffer
}

export class IconSource {
  private readonly sheets = new Map<number, Promise<Sheet | null>>()
  private readonly pngs = new Map<number, Buffer>()
  private readonly itemSheets = new Map<number, Promise<Sheet | null>>()
  private readonly itemPngs = new Map<number, Buffer>()

  constructor(private readonly installDir: () => string) {}

  async png(index: number): Promise<Buffer | null> {
    const hit = this.pngs.get(index)
    if (hit) return hit
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
    this.pngs.set(index, png)
    return png
  }

  /** An item icon by its icon number (500 and up). */
  async itemPng(icon: number): Promise<Buffer | null> {
    const hit = this.itemPngs.get(icon)
    if (hit) return hit
    const index = icon - 500
    if (index < 0) return null
    const sheetNo = Math.floor(index / PER_SHEET) + 1
    let p = this.itemSheets.get(sheetNo)
    if (!p) {
      p = fs
        .readFile(join(this.installDir(), 'uifiles', 'default', `dragitem${sheetNo}.dds`))
        .then(decodeDds)
        .catch(() => null)
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
    this.itemPngs.set(icon, png)
    return png
  }

  private sheet(n: number): Promise<Sheet | null> {
    let p = this.sheets.get(n)
    if (!p) {
      p = this.loadSheet(n).catch(() => null)
      this.sheets.set(n, p)
    }
    return p
  }

  private async loadSheet(n: number): Promise<Sheet | null> {
    const file = join(this.installDir(), 'uifiles', 'default', `Spells${String(n).padStart(2, '0')}.tga`)
    return decodeTga(await fs.readFile(file))
  }
}

/** A DXT5 (BC3) DDS, top-down RGBA. The game's item icon sheets are all this format. */
export function decodeDds(d: Buffer): Sheet | null {
  if (d.toString('latin1', 0, 4) !== 'DDS ' || d.toString('latin1', 84, 88) !== 'DXT5') return null
  const height = d.readUInt32LE(12)
  const width = d.readUInt32LE(16)
  const pixels = Buffer.alloc(width * height * 4)
  let p = 128
  const rgb565 = (c: number) => [((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31]
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      // Alpha: two endpoints and 16 three-bit indices.
      const a0 = d[p]
      const a1 = d[p + 1]
      const alphas = [a0, a1]
      if (a0 > a1) for (let i = 1; i < 7; i++) alphas.push(Math.round(((7 - i) * a0 + i * a1) / 7))
      else {
        for (let i = 1; i < 5; i++) alphas.push(Math.round(((5 - i) * a0 + i * a1) / 5))
        alphas.push(0, 255)
      }
      let abits = 0n
      for (let i = 0; i < 6; i++) abits |= BigInt(d[p + 2 + i]) << BigInt(8 * i)
      // Colour: two 5:6:5 endpoints, always the four-colour mode in DXT5.
      const c0 = rgb565(d.readUInt16LE(p + 8))
      const c1 = rgb565(d.readUInt16LE(p + 10))
      const colours = [c0, c1, c0.map((v, i) => (2 * v + c1[i]) / 3), c0.map((v, i) => (v + 2 * c1[i]) / 3)]
      const cbits = d.readUInt32LE(p + 12)
      for (let i = 0; i < 16; i++) {
        const x = bx + (i % 4)
        const y = by + Math.floor(i / 4)
        if (x >= width || y >= height) continue
        const c = colours[(cbits >>> (2 * i)) & 3]
        const o = (y * width + x) * 4
        pixels[o] = Math.round(c[0])
        pixels[o + 1] = Math.round(c[1])
        pixels[o + 2] = Math.round(c[2])
        pixels[o + 3] = alphas[Number((abits >> BigInt(3 * i)) & 7n)]
      }
      p += 16
    }
  }
  return { width, height, bpp: 4, topDown: true, pixels }
}

/** Uncompressed (type 2) and run-length (type 10) true-colour TGA. */
export function decodeTga(d: Buffer): Sheet | null {
  const idLength = d[0]
  const type = d[2]
  const width = d.readUInt16LE(12)
  const height = d.readUInt16LE(14)
  const bpp = d[16] / 8
  const topDown = (d[17] & 0x20) !== 0
  if ((type !== 2 && type !== 10) || (bpp !== 3 && bpp !== 4)) return null
  let p = 18 + idLength
  const total = width * height * bpp
  let pixels: Buffer
  if (type === 2) pixels = d.subarray(p, p + total)
  else {
    pixels = Buffer.alloc(total)
    let o = 0
    while (o < total && p < d.length) {
      const c = d[p++]
      const count = (c & 0x7f) + 1
      if (c & 0x80) {
        for (let i = 0; i < count; i++) {
          d.copy(pixels, o, p, p + bpp)
          o += bpp
        }
        p += bpp
      } else {
        d.copy(pixels, o, p, p + count * bpp)
        o += count * bpp
        p += count * bpp
      }
    }
  }
  return { width, height, bpp, topDown, pixels }
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
