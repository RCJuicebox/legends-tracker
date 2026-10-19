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

/** The DDS pixel-format flags: a four-character code names a compressed format; RGB with masks is uncompressed. */
const DDPF_ALPHAPIXELS = 0x1
const DDPF_FOURCC = 0x4
const DDPF_RGB = 0x40

/**
 * A DDS as the game's item icon sheets come, top-down RGBA: DXT5 (BC3), which 376 of the 379 sheets
 * are; DXT3 (BC2, dragitem323); or uncompressed 32- or 24-bit RGB by its channel masks (dragitem9's
 * A8R8G8B8, dragitem302's RGBA). Anything else is null (LT-600).
 */
export function decodeDds(d: Buffer): Sheet | null {
  if (d.toString('latin1', 0, 4) !== 'DDS ') return null
  const height = d.readUInt32LE(12)
  const width = d.readUInt32LE(16)
  const flags = d.readUInt32LE(80)
  const pixels = Buffer.alloc(width * height * 4)
  // The code names a compressed format (whatever the flags say; a sheet written without them still reads).
  const fourCC = d.toString('latin1', 84, 88)
  if (fourCC === 'DXT5') decodeBlocks(d, width, height, pixels, bc3Alphas)
  else if (fourCC === 'DXT3') decodeBlocks(d, width, height, pixels, bc2Alphas)
  else if (flags & DDPF_FOURCC) return null
  else if (flags & DDPF_RGB) {
    if (!decodeMasked(d, width, height, pixels, !!(flags & DDPF_ALPHAPIXELS))) return null
  } else return null
  return { width, height, bpp: 4, topDown: true, pixels }
}

/** DXT5's alpha block: two endpoints and sixteen three-bit indices into their interpolation. */
function bc3Alphas(d: Buffer, p: number): (i: number) => number {
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
  return (i) => alphas[Number((abits >> BigInt(3 * i)) & 7n)]
}

/** DXT3's alpha block: sixteen four-bit values as they are. */
function bc2Alphas(d: Buffer, p: number): (i: number) => number {
  return (i) => {
    const byte = d[p + (i >> 1)]
    return ((i & 1 ? byte >> 4 : byte & 15) * 255) / 15
  }
}

/** 4×4 blocks of eight alpha bytes then a four-colour block: two 5:6:5 endpoints and sixteen two-bit indices. */
function decodeBlocks(d: Buffer, width: number, height: number, pixels: Buffer, alphasOf: (d: Buffer, p: number) => (i: number) => number): void {
  let p = 128
  const rgb565 = (c: number) => [(((c >> 11) & 31) * 255) / 31, (((c >> 5) & 63) * 255) / 63, ((c & 31) * 255) / 31]
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const alpha = alphasOf(d, p)
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
        pixels[o + 3] = Math.round(alpha(i))
      }
      p += 16
    }
  }
}

/** Uncompressed pixels, 24 or 32 bits each, the channels where the header's masks put them; false for another depth. */
function decodeMasked(d: Buffer, width: number, height: number, pixels: Buffer, hasAlpha: boolean): boolean {
  const bits = d.readUInt32LE(88)
  if (bits !== 24 && bits !== 32) return false
  const masks = [d.readUInt32LE(92), d.readUInt32LE(96), d.readUInt32LE(100), hasAlpha ? d.readUInt32LE(104) : 0]
  const channel = (v: number, mask: number) => {
    if (!mask) return 255
    const shift = 31 - Math.clz32(mask & -mask)
    let n = 0
    for (let m = mask >>> 0; m; m >>>= 1) n += m & 1
    return Math.round((((v & mask) >>> shift) * 255) / ((1 << n) - 1))
  }
  const bytes = bits / 8
  let p = 128
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = bytes === 4 ? d.readUInt32LE(p) : d.readUIntLE(p, 3)
      const o = (y * width + x) * 4
      pixels[o] = channel(v, masks[0])
      pixels[o + 1] = channel(v, masks[1])
      pixels[o + 2] = channel(v, masks[2])
      pixels[o + 3] = channel(v, masks[3])
      p += bytes
    }
  return true
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
