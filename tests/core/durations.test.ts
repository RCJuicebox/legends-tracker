import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeDuration, focusForObserved, formulaTicks } from '../../src/core/durations'
import { SpellBook } from '../../src/core/spells'
import { fixtureBook } from '../helpers'
import { DEFAULT_TIER_DURATION_PCT } from '../../src/shared/types'

const book = fixtureBook()
const dur = (name: string, focusPct = 0) => {
  const r = book.resolve(name)!
  return computeDuration({ spell: r.spell, rank: r.rank, level: 50, tierPct: DEFAULT_TIER_DURATION_PCT, focusPct })
}

describe('formulaTicks', () => {
  it('matches the classic formulas and caps', () => {
    expect(formulaTicks(50, 1, 6)).toBe(6)
    expect(formulaTicks(8, 1, 6)).toBe(4)
    expect(formulaTicks(50, 3, 10)).toBe(10)
    expect(formulaTicks(50, 10, 13)).toBe(13)
    expect(formulaTicks(50, 50, 0)).toBe(-1)
    expect(formulaTicks(50, 3600, 3600)).toBe(3600)
  })
})

describe('categories', () => {
  it('reads the category from the spell effects', () => {
    expect(book.named('Envenomed Bolt')!.category).toBe('dot')
    expect(book.named('Plague')!.category).toBe('dot')
    expect(book.named('Odium')!.category).toBe('dot')
    expect(book.named('Spirit of the Puma')!.category).toBe('buff')
    expect(book.named('Slugs Healing')!.category).toBe('hot')
  })
})

// Kelwyn's in-game Spell windows, 2026-09-23. Puma X's 3:12 is also how long it really lasts in
// the log (32 whole ticks), so the focus total that reproduces it is +60.5%.
describe('computeDuration against the Spell window', () => {
  it.each([
    ['Envenomed Bolt X', 0, '0:36 (0:54)'],
    ['Odium X', 0, '0:30 (0:48)'],
    ['Plague X', 0, '1:18 (2:00)'],
    ['Spirit of the Puma X', 60.5, '1:00 (3:12)']
  ])('%s with %s%% focus reads %s', (name, focus, shown) => {
    const d = dur(name, focus)
    expect(d.steps).toContain(`Spell window: ${shown}`)
  })
})

// The same Spell windows with the Engineer's Ring (Extended Enhancement II) taken off, 2026-09-24:
// only Spell Casting Reinforcement's 50% remains.
describe('computeDuration against the Spell window, ring off', () => {
  it.each([
    ['Spirit of the Puma X', '1:00 (3:00)'],
    ['Slugs Healing V', '0:24 (0:48)']
  ])('%s reads %s', (name, shown) => {
    expect(dur(name, 50).steps).toContain(`Spell window: ${shown}`)
  })

  it('gives Slugs Healing V 8 ticks with the ring on, though the log says 9', () => {
    // Level 42 is under the ring's cap of 44, so it gets the full 15%: 50 + 15 = 65%. 4 × 1.65 = 6.6
    // drops to 6, the same as the ring off, so the model can't tell the two apart. The log disagrees:
    // most landings fade 55–58 s on (9 whole ticks). Every Spell window and tooltip read so far fits
    // focus-first, so this stays open until the ring-on Spell window is read.
    expect(dur('Slugs Healing V', 65).steps).toContain('Spell window: 0:24 (0:48)')
  })
})

// Spell tooltips, 2026-11-10: Dexterity IV (SHM 48) reads 1:03:00 (2:22:48), Stamina IV (SHM 43)
// 1:03:00 (2:25:30). Spell Casting Reinforcement's 50% plus Extended Enhancement II, 12% at level 48
// (15% × 80%) and the whole 15% at 43. Dexterity is the case that settles the order: focus first,
// fraction dropped (1020.6 → 1020), then the rank bonus (× 1.4 = 1428), not 1428.84 rounded to 1429.
describe('computeDuration against spell tooltips, focus before rank', () => {
  const stackBook = SpellBook.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us.txt'), 'latin1'),
    readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us_str.txt'), 'latin1')
  )
  it.each([
    ['Dexterity', 62, '1:03:00 (2:22:48)'],
    ['Stamina', 65, '1:03:00 (2:25:30)']
  ])('%s IV with %s%% focus reads %s', (name, focus, shown) => {
    const d = computeDuration({ spell: stackBook.named(name)!, rank: 4, level: 50, tierPct: DEFAULT_TIER_DURATION_PCT, focusPct: focus })
    expect(d.steps).toContain(`Spell window: ${shown}`)
  })

  it('inverts the model for the log check', () => {
    // Dexterity IV wearing off 8568–8574 s after landing: 1428 whole ticks, which 61.9%–62.0% focus gives.
    const [lo, hi] = focusForObserved(630, 1.4, 8570)!
    expect(lo).toBeLessThanOrEqual(62)
    expect(hi).toBeGreaterThanOrEqual(62)
    // 1430 whole ticks: no whole number of focused ticks × 1.4 rounds to it.
    expect(focusForObserved(630, 1.4, 8580)).toBeNull()
    expect(focusForObserved(630, 1.4, 8610)![0]).toBeGreaterThan(62)
  })
})

// Each expectation is the wear-off time the real log shows for that spell (median in the comment):
// the Spell window's ticks plus the partial tick the spell landed in.
describe('computeDuration against the log', () => {
  it.each([
    ['Envenomed Bolt', 7], // log median 38s → [36, 42]: an unranked spell gets no tier bonus
    ['Envenomed Bolt IV', 8], // 45s → [42, 48]
    ['Envenomed Bolt VI', 9], // 51s → [48, 54]
    ['Envenomed Bolt VII', 9], // 51s
    ['Envenomed Bolt X', 10], // 56s → [54, 60]
    ['Odium IV', 7], // 38s → [36, 42]
    ['Odium VI', 8], // 46s → [42, 48]
    ['Odium X', 9], // 51s → [48, 54]
    ['Plague', 14], // 82.5s → [78, 84]
    ['Plague VI', 18], // 106s → [102, 108]
    ['Plague VII', 19], // 112s → [108, 114]
    ['Plague X', 21] // 124s → [120, 126]
  ])('%s lasts %i ticks with no focus', (name, ticks) => {
    expect(dur(name).ticks).toBe(ticks)
  })

  it.each([
    ['Spirit of the Puma V', 25], // 146.5s → [144, 150]
    ['Spirit of the Puma VI', 27], // 160s → [156, 162]
    ['Spirit of the Puma X', 33] // 196s → [192, 198]
  ])('%s lasts %i ticks with a +60.5%% beneficial focus', (name, ticks) => {
    expect(dur(name, 60.5).ticks).toBe(ticks)
  })

  it('explains itself step by step', () => {
    const d = dur('Spirit of the Puma X', 60.5)
    expect(d.steps[0]).toBe('Formula 3 at level 50, capped at 10: 10 ticks (1:00)')
    expect(d.steps.at(-1)).toBe('Plus the partial tick it lands in: wears off 192–198s after landing')
    expect(d.spellWindowSec).toBe(192)
  })

  it('honours a fixed override', () => {
    const r = book.resolve('Odium X')!
    const d = computeDuration({ spell: r.spell, rank: 10, level: 50, tierPct: DEFAULT_TIER_DURATION_PCT, focusPct: 0, overrideSec: 42 })
    expect(d.seconds).toBe(42)
    // Seven whole ticks and the partial one, as the model counts: a DoT's first tick pins its end 42 s on (LT-515).
    expect([d.wholeTicks, d.ticks]).toEqual([7, 8])
  })
})

describe('whole ticks', () => {
  it('reports the whole ticks the Spell window shows beside the ticks counting the partial one', () => {
    // Envenomed Bolt X: the Spell window reads 0:36 (0:54), nine whole ticks.
    const d = dur('Envenomed Bolt X')
    expect(d.wholeTicks).toBe(9)
    expect(d.ticks).toBe(d.wholeTicks + 1)
    expect(d.spellWindowSec).toBe(d.wholeTicks * 6)
  })
})
