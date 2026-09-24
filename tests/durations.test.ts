import { describe, expect, it } from 'vitest'
import { computeDuration, formulaTicks } from '../src/core/durations'
import { fixtureBook } from './helpers'
import { DEFAULT_TIER_DURATION_PCT } from '../src/shared/types'

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

  it('gives Slugs Healing V 9 ticks with the ring on, as the log shows (~55s)', () => {
    // Level 42 is under the ring's cap of 44, so it gets the full 15%: 50 + 15 = 65%.
    expect(dur('Slugs Healing V', 65).steps).toContain('Spell window: 0:24 (0:54)')
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
  })
})
