import { describe, expect, it } from 'vitest'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { IconSource, characterSkin } from '../../src/main/icons'
import { tempDir } from '../tempDir'

// Spell icons come from the character's skin folder when it has the sheet, else uifiles\default.

/** A 256×256 32-bit sheet of one colour (BGR). */
function sheet(b: number, g: number, r: number): Buffer {
  const head = Buffer.alloc(18)
  head[2] = 2
  head.writeUInt16LE(256, 12)
  head.writeUInt16LE(256, 14)
  head[16] = 32
  const px = Buffer.alloc(256 * 256 * 4)
  for (let i = 0; i < px.length; i += 4) px.set([b, g, r, 255], i)
  return Buffer.concat([head, px])
}

/** The first pixel of a PNG the icon source made (RGB). */
function firstPixel(png: Buffer): number[] {
  let at = 8
  const idat: Buffer[] = []
  while (at < png.length) {
    const len = png.readUInt32BE(at)
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  return [...raw.subarray(1, 4)] // after the row's filter byte
}

function gameFolder(skins: Record<string, Buffer>): string {
  const dir = tempDir('lt-icons-')
  for (const [skin, data] of Object.entries(skins)) {
    mkdirSync(join(dir, 'uifiles', skin), { recursive: true })
    writeFileSync(join(dir, 'uifiles', skin, 'Spells01.tga'), data)
  }
  return dir
}

describe('IconSource', () => {
  it("reads the skin's sheet first, and the game's where the skin has none", async () => {
    const dir = gameFolder({ default: sheet(0, 0, 200), Mine: sheet(200, 0, 0) })
    mkdirSync(join(dir, 'uifiles', 'Bare'))
    const icons = new IconSource(() => dir)
    expect(firstPixel((await icons.png(0))!)).toEqual([200, 0, 0])
    expect(icons.setSkin('Mine')).toBe(true)
    expect(firstPixel((await icons.png(0))!)).toEqual([0, 0, 200])
    expect(icons.setSkin('Mine')).toBe(false)
    icons.setSkin('Bare')
    expect(firstPixel((await icons.png(0))!)).toEqual([200, 0, 0])
  })
})

describe('characterSkin', () => {
  it("reads the skin from the character's newest UI file", async () => {
    const dir = tempDir('lt-ui-')
    writeFileSync(join(dir, 'UI_Kelwyn_test_LO1.ini'), '[Main]\nUISkin=Old\n')
    writeFileSync(join(dir, 'UI_Kelwyn_test_LO2.ini'), '[Main]\nUISkin=Mine\n')
    writeFileSync(join(dir, 'UI_Other_test_LO1.ini'), '[Main]\nUISkin=Theirs\n')
    utimesSync(join(dir, 'UI_Kelwyn_test_LO1.ini'), 1000, 1000)
    expect(await characterSkin(dir, 'Kelwyn_test')).toBe('Mine')
  })

  it('is null with no UI file, no character or no game folder', async () => {
    const dir = tempDir('lt-ui-')
    expect(await characterSkin(dir, 'Kelwyn_test')).toBeNull()
    expect(await characterSkin(dir, '')).toBeNull()
    expect(await characterSkin(join(dir, 'missing'), 'Kelwyn_test')).toBeNull()
  })
})
