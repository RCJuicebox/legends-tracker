import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The screen capture for the mote and Stats reads: each monitor at its own size, never stretched to
// the largest one's.

const fake = vi.hoisted(() => ({
  dir: '',
  displays: [] as { id: number; size: { width: number; height: number }; scaleFactor: number }[],
  ids: {} as Record<string, string>,
  asked: [] as { width: number; height: number }[]
}))

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => fake.displays },
  desktopCapturer: {
    // Every screen fitted into the size asked for, as Electron does; the picture says what it was asked.
    getSources: async ({ thumbnailSize }: { thumbnailSize: { width: number; height: number } }) => {
      fake.asked.push(thumbnailSize)
      return fake.displays.map((d) => {
        const native = { width: d.size.width * d.scaleFactor, height: d.size.height * d.scaleFactor }
        const k = Math.min(thumbnailSize.width / native.width, thumbnailSize.height / native.height)
        const size = { width: Math.round(native.width * k), height: Math.round(native.height * k) }
        return {
          display_id: fake.ids[d.id] ?? String(d.id),
          thumbnail: { getSize: () => size, isEmpty: () => false, toPNG: () => Buffer.from(`${d.id} ${size.width}x${size.height}`) }
        }
      })
    }
  }
}))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => fake.dir }))

const { captureScreens } = await import('../../src/main/ocr')

beforeEach(() => {
  fake.dir = mkdtempSync(join(tmpdir(), 'lt-capture-'))
  fake.asked = []
  fake.ids = {}
})
afterEach(() => rmSync(fake.dir, { recursive: true, force: true }))

const pictures = (paths: string[]) => paths.map((p) => readFileSync(p, 'utf8')).sort()

describe('screen capture', () => {
  it('takes each monitor at its own size beside a larger, scaled one', async () => {
    // An ultrawide game screen, a 4K screen at 200% and a 1080p one.
    fake.displays = [
      { id: 1, size: { width: 3440, height: 1440 }, scaleFactor: 1 },
      { id: 2, size: { width: 1920, height: 1080 }, scaleFactor: 2 },
      { id: 3, size: { width: 1920, height: 1080 }, scaleFactor: 1 }
    ]
    expect(pictures(await captureScreens())).toEqual(['1 3440x1440', '2 3840x2160', '3 1920x1080'])
    expect(fake.asked).toHaveLength(3)
  })

  it('asks once when every monitor is the same size', async () => {
    fake.displays = [
      { id: 1, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
      { id: 2, size: { width: 1920, height: 1080 }, scaleFactor: 1 }
    ]
    expect(pictures(await captureScreens())).toEqual(['1 1920x1080', '2 1920x1080'])
    expect(fake.asked).toEqual([{ width: 1920, height: 1080 }])
  })

  it('goes by the picture size when a source names no monitor', async () => {
    fake.displays = [
      { id: 1, size: { width: 3440, height: 1440 }, scaleFactor: 1 },
      { id: 2, size: { width: 1920, height: 1080 }, scaleFactor: 1 }
    ]
    fake.ids = { 1: '', 2: '' }
    expect(pictures(await captureScreens())).toEqual(['1 3440x1440', '2 1920x1080'])
  })
})
