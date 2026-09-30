import { crc32, deflateSync } from 'node:zlib'

// The client's icon sheets as pixels, and pixels as a PNG a page can show: spell icons in
// uifiles\default\SpellsNN.tga, item icons in dragitemNN.dds.

/** A decoded sheet: its size, bytes a pixel, row order, and the pixels. */
export interface Sheet {
  width: number
  height: number
  bpp: number
  topDown: boolean
  pixels: Buffer
}

/** A DXT5 (BC3) DDS, top-down RGBA. The game's item icon sheets are all this format. */
export function decodeDds(d: Buffer): Sheet | null {
  if (d.toString('latin1', 0, 4) !== 'DDS ' || d.toString('latin1', 84, 88) !== 'DXT5') return null
  const height = d.readUInt32LE(12)
  const width = d.readUInt32LE(16)
  const pixels = Buffer.alloc(width * height * 4)
  let p = 128
  const rgb565 = (c: number) => [(((c >> 11) & 31) * 255) / 31, (((c >> 5) & 63) * 255) / 63, ((c & 31) * 255) / 31]
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

/** An 8-bit RGBA PNG. */
export function encodePng(w: number, h: number, rgba: Buffer): Buffer {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
