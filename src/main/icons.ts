import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'

// Spell icons come straight from the client: uifiles\default\SpellsNN.tga, 256×256 sheets of
// 40×40 icons, six by six, numbered by the spell file's icon field.
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
