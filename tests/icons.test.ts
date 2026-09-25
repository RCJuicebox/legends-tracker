import { describe, expect, it } from 'vitest'
import { crc32, inflateSync } from 'node:zlib'
import { decodeDds, decodeTga, encodePng } from '../src/main/icons'

function tgaHeader(type: number, width: number, height: number, bits: number, descriptor = 0): Buffer {
  const h = Buffer.alloc(18)
  h[2] = type
  h.writeUInt16LE(width, 12)
  h.writeUInt16LE(height, 14)
  h[16] = bits
  h[17] = descriptor
  return h
}

describe('reading the spell icon sheets (TGA)', () => {
  it('reads an uncompressed 2×2 true-colour image', () => {
    const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const sheet = decodeTga(Buffer.concat([tgaHeader(2, 2, 2, 24), pixels]))
    expect(sheet).toMatchObject({ width: 2, height: 2, bpp: 3, topDown: false })
    expect([...sheet!.pixels]).toEqual([...pixels])
  })

  it('reads the top-down flag and 32-bit pixels', () => {
    const sheet = decodeTga(Buffer.concat([tgaHeader(2, 1, 1, 32, 0x20), Buffer.from([9, 8, 7, 255])]))
    expect(sheet).toMatchObject({ width: 1, height: 1, bpp: 4, topDown: true })
  })

  it('unpacks run-length packets', () => {
    // A run of two of one pixel, then two raw pixels.
    const body = Buffer.from([0x81, 1, 2, 3, 0x01, 4, 5, 6, 7, 8, 9])
    const sheet = decodeTga(Buffer.concat([tgaHeader(10, 2, 2, 24), body]))
    expect([...sheet!.pixels]).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('skips the image id', () => {
    const h = tgaHeader(2, 1, 1, 24)
    h[0] = 3
    const sheet = decodeTga(Buffer.concat([h, Buffer.from([0xaa, 0xbb, 0xcc]), Buffer.from([1, 2, 3])]))
    expect([...sheet!.pixels]).toEqual([1, 2, 3])
  })

  it('declines colour-mapped and 16-bit images', () => {
    expect(decodeTga(Buffer.concat([tgaHeader(1, 1, 1, 24), Buffer.alloc(3)]))).toBeNull()
    expect(decodeTga(Buffer.concat([tgaHeader(2, 1, 1, 16), Buffer.alloc(2)]))).toBeNull()
  })
})

describe('reading the item icon sheets (DDS, DXT5)', () => {
  function dds(block: Buffer, width = 4, height = 4): Buffer {
    const h = Buffer.alloc(128)
    h.write('DDS ', 0, 'latin1')
    h.writeUInt32LE(height, 12)
    h.writeUInt32LE(width, 16)
    h.write('DXT5', 84, 'latin1')
    return Buffer.concat([h, block])
  }

  it('decodes a block: colour endpoints, and alpha by index', () => {
    const block = Buffer.alloc(16)
    block[0] = 255 // alpha 0
    block[1] = 0 // alpha 1
    block[2] = 0b001000 // pixel 1 takes alpha 1
    block.writeUInt16LE(0xf800, 8) // colour 0: red
    block.writeUInt16LE(0x001f, 10) // colour 1: blue
    block.writeUInt32LE(1 << 2, 12) // pixel 1 takes colour 1
    const sheet = decodeDds(dds(block))!
    expect(sheet).toMatchObject({ width: 4, height: 4, bpp: 4, topDown: true })
    expect([...sheet.pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...sheet.pixels.subarray(4, 8)]).toEqual([0, 0, 255, 0])
    expect([...sheet.pixels.subarray(8, 12)]).toEqual([255, 0, 0, 255])
  })

  it('declines anything but DXT5', () => {
    const d = dds(Buffer.alloc(16))
    d.write('DXT1', 84, 'latin1')
    expect(decodeDds(d)).toBeNull()
    expect(decodeDds(Buffer.from('not a dds file at all, just some text that is long enough to index into ok'.repeat(2)))).toBeNull()
  })
})

describe('writing PNG', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4])
  const png = encodePng(2, 2, rgba)

  it('starts with the signature and an 8-bit RGBA header', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(8)).toBe(13)
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(2)
    expect(png.readUInt32BE(20)).toBe(2)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(6)
    expect(png.readUInt32BE(29)).toBe(crc32(png.subarray(12, 29)) >>> 0)
  })

  it('carries the pixels row by row, unfiltered, and ends with IEND', () => {
    const idatLen = png.readUInt32BE(33)
    expect(png.toString('ascii', 37, 41)).toBe('IDAT')
    const raw = inflateSync(png.subarray(41, 41 + idatLen))
    expect([...raw]).toEqual([0, ...rgba.subarray(0, 8), 0, ...rgba.subarray(8, 16)])
    expect(png.toString('ascii', png.length - 8, png.length - 4)).toBe('IEND')
  })
})
