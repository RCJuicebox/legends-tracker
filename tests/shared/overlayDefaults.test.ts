import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAYS, defaultPlacement, minOpacity, newOverlaySpot, opacityStyle, overlayScale, type WorkArea } from '../../src/shared/overlays'

const inside = (r: WorkArea, a: WorkArea) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height
const overlap = (p: WorkArea, q: WorkArea) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height

describe('where the overlays go', () => {
  it('ships defaults that fit a 1080p screen, none over another', () => {
    const screen = { x: 0, y: 0, width: 1920, height: 1080 }
    for (const o of DEFAULT_OVERLAYS) expect(inside(o, screen), o.id).toBe(true)
    for (const p of DEFAULT_OVERLAYS) for (const q of DEFAULT_OVERLAYS) if (p !== q) expect(overlap(p, q), `${p.id} and ${q.id}`).toBe(false)
  })

  it('lays them out on any monitor from 1280 × 720 up, and on one left of the primary', () => {
    for (const a of [
      { x: 0, y: 0, width: 1280, height: 680 },
      { x: 0, y: 0, width: 2560, height: 1400 },
      { x: -1920, y: 0, width: 1920, height: 1040 },
      { x: 0, y: 0, width: 3440, height: 1400 }
    ]) {
      const place = Object.entries(defaultPlacement(a))
      for (const [id, r] of place) expect(inside(r, a), `${id} on ${a.width}×${a.height}`).toBe(true)
      for (const [p, r] of place) for (const [q, s] of place) if (p !== q) expect(overlap(r, s), `${p} and ${q} on ${a.width}×${a.height}`).toBe(false)
    }
  })

  it('starts them larger on a taller monitor, a quarter at a time, at most half again (LT-355)', () => {
    expect(overlayScale({ x: 0, y: 0, width: 1920, height: 1040 })).toBe(1)
    expect(overlayScale({ x: 0, y: 0, width: 1280, height: 680 })).toBe(1)
    expect(overlayScale({ x: 0, y: 0, width: 2560, height: 1400 })).toBe(1.25)
    expect(overlayScale({ x: 0, y: 0, width: 3840, height: 2120 })).toBe(1.5)
    const big = defaultPlacement({ x: 0, y: 0, width: 2560, height: 1400 })
    expect(big['meter'].width).toBe(475)
    // The shipped defaults are the 1080p layout.
    expect(DEFAULT_OVERLAYS.find((o) => o.id === 'meter')).toMatchObject(defaultPlacement({ x: 0, y: 0, width: 1920, height: 1040 })['meter'])
  })

  it('steps an added overlay past the ones already where it would go', () => {
    expect(newOverlaySpot({ x: 440, y: 560 }, [])).toEqual({ x: 440, y: 560 })
    expect(newOverlaySpot({ x: 440, y: 560 }, [{ x: 440, y: 560 }])).toEqual({ x: 472, y: 592 })
    expect(
      newOverlaySpot({ x: 440, y: 560 }, [
        { x: 440, y: 560 },
        { x: 472, y: 592 },
        { x: 900, y: 100 }
      ])
    ).toEqual({ x: 504, y: 624 })
  })
})

describe('what an overlay’s opacity fades', () => {
  it('fades the alerts’ text, and only the panel behind every other overlay', () => {
    expect(opacityStyle({ kind: 'alerts', opacity: 0.5 })).toEqual({ opacity: 0.5 })
    expect(opacityStyle({ kind: 'timers', opacity: 0 })).toEqual({ '--ov-panel': 0 })
    expect(opacityStyle({ kind: 'meter', opacity: 0.4 })).toEqual({ '--ov-panel': 0.4 })
    expect(minOpacity('alerts')).toBeGreaterThan(0)
    expect(minOpacity('achievements')).toBe(0)
  })
})
