import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/main/storeCore'
import { keepUnchanged } from '../../src/renderer/src/keepUnchanged'

// Settings pushed from main are a fresh copy of the whole file; the parts that read the same keep the
// copy the window had, so a page picking one part is not drawn again for a change to another (LT-404).

describe('settings pushed from main', () => {
  it('keep the window’s copy of every part that reads the same', () => {
    const before = defaultSettings()
    const pushed = { ...structuredClone(before), audio: { ...before.audio, muted: !before.audio.muted } }
    const kept = keepUnchanged(before, pushed)
    expect(kept).toEqual(pushed)
    expect(kept.audio).toBe(pushed.audio)
    expect(kept.overlays).toBe(before.overlays)
    expect(kept.tracking).toBe(before.tracking)
  })

  it('are the window’s own settings when nothing changed', () => {
    const before = defaultSettings()
    expect(keepUnchanged(before, structuredClone(before))).toBe(before)
  })

  it('see a part dropped or added', () => {
    const before = { a: 1, b: [1, 2] }
    expect(keepUnchanged<{ a: number; b?: number[] }>(before, { a: 1 })).toEqual({ a: 1 })
    expect(keepUnchanged<{ a: number; b: number[] }>(before, { a: 1, b: [1, 2, 3] }).b).toEqual([1, 2, 3])
  })
})
