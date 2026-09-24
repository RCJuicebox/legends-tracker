import { describe, expect, it } from 'vitest'
import { focusFor, focusFromSpell, isDurationFocus, spellLevel } from '../src/core/focus'
import { casterLevel, computeDuration } from '../src/core/durations'
import { fixtureBook, exampleShaman, SPELL_CASTING_REINFORCEMENT } from './helpers'
import { DEFAULT_TIER_DURATION_PCT, type CharacterSettings } from '../src/shared/types'

const book = fixtureBook()
const spell = (name: string) => book.named(name)!

describe('focusFromSpell', () => {
  it('reads Extended Enhancement II the way the game defines it', () => {
    const f = focusFromSpell(spell('Extended Enhancement II'), 'item', "Engineer's Ring")
    expect(f).toMatchObject({ pct: 15, maxLevel: 44, decayPct: 5, appliesTo: 'beneficial', minTicks: 4, excludeSpas: [101, 40, 86] })
    expect(isDurationFocus(spell('Extended Enhancement II'))).toBe(true)
    // Burning Affliction is a damage focus, not a duration one.
    expect(isDurationFocus(spell('Burning Affliction III'))).toBe(false)
  })
})

describe('focusFor', () => {
  const c = exampleShaman(book)

  it('decays an item focus by 5% of itself per spell level over its cap and adds the AA', () => {
    // Spirit of the Puma is SHM(50): six levels over Extended Enhancement II's cap of 44.
    expect(spellLevel(spell('Spirit of the Puma'), c)).toBe(50)
    const r = focusFor(spell('Spirit of the Puma'), c, 50)
    expect(r.pct).toBe(60.5)
    expect(r.steps).toContain('Extended Enhancement II: 15% × 70% (level 50 spell, 6 over its cap of 44) = +10.5%')
  })

  it('gives a spell under the cap the full focus', () => {
    // Slugs Healing is SHM(42).
    expect(focusFor(spell('Slugs Healing'), c, 50).pct).toBe(65)
  })

  it('gives detrimental spells none of a beneficial focus', () => {
    expect(focusFor(spell('Envenomed Bolt'), c, 50).pct).toBe(0)
  })

  it('makes Spirit of the Puma X read 1:00 (3:12), as the Spell window does', () => {
    const puma = spell('Spirit of the Puma')
    const f = focusFor(puma, c, casterLevel(puma, c))
    const d = computeDuration({ spell: puma, rank: 10, level: 50, tierPct: DEFAULT_TIER_DURATION_PCT, focusPct: f.pct, focusSteps: f.steps })
    expect(d.steps).toContain('Spell window: 1:00 (3:12)')
  })

  it('skips a source that is switched off', () => {
    const off: CharacterSettings = { ...c, focusSources: c.focusSources.map((f) => (f.kind === 'item' ? { ...f, enabled: false } : f)) }
    expect(focusFor(spell('Spirit of the Puma'), off, 50).pct).toBe(50)
  })

  it('uses only the best item focus, and drops a focus with no decay once past its cap', () => {
    const ee2 = focusFromSpell(spell('Extended Enhancement II'), 'item', 'ring')
    const ee3 = focusFromSpell(spell('Extended Enhancement III'), 'item', 'earring')
    const both: CharacterSettings = { level: 50, classLevels: {}, focusSources: [ee2, ee3] }
    // Rank III's cap is 60, so it keeps its full 15% on a level-50 spell and wins.
    expect(focusFor(spell('Spirit of the Puma'), both, 50).pct).toBe(15)
    const noDecay: CharacterSettings = { level: 50, classLevels: {}, focusSources: [{ ...ee2, decayPct: 0 }, SPELL_CASTING_REINFORCEMENT] }
    expect(focusFor(spell('Spirit of the Puma'), noDecay, 50).pct).toBe(50)
  })
})
