import { describe, expect, it } from 'vitest'
import {
  castableByMine,
  castRows,
  DEFAULT_SPELL_WEIGHTS,
  isAbility,
  rankGain,
  sectionOf,
  spellUpgradeOptions,
  spendOnSpell,
  stockXp
} from '../src/core/spellMotes'
import { DEFAULT_TIER_DURATION_PCT } from '../src/shared/types'
import { fixtureBook } from './helpers'

const character = { level: 50, classLevels: {}, focusSources: [] }

describe('paying for a spell rank with motes', () => {
  it('counts every mote at its xp, whatever the rank', () => {
    expect(stockXp({ infinitesimal: 3, minor: 2, lesser: 1, superior: 2, infinite: 1 })).toBe(3 + 2 + 2 + 14 + 10)
  })

  it('spends the lowest ranks first, since their combine value is the cheapest xp', () => {
    // 8 xp: three Infinitesimal (3 xp, worth 3), then Lesser at 2 xp each: three of them cover the last 5 with 1 over.
    const p = spendOnSpell(8, { infinitesimal: 3, lesser: 4, major: 10 })
    expect(p).toEqual({
      motes: [
        { m: 0, n: 3 },
        { m: 2, n: 3 }
      ],
      xp: 9,
      over: 1,
      worth: 3 + 12,
      short: 0
    })
  })

  it('says how far short the stock is', () => {
    expect(spendOnSpell(16, { minor: 3 })).toEqual({ motes: [{ m: 1, n: 3 }], xp: 3, over: 0, worth: 6, short: 13 })
    expect(spendOnSpell(4, {})).toEqual({ motes: [], xp: 0, over: 0, worth: 0, short: 4 })
  })
})

describe('what a rank gives', () => {
  const book = fixtureBook()

  it('reads the guide table by category and leaves out what the spell cannot gain', () => {
    const { rows } = castRows(book, { 'Envenomed Bolt X': 100, 'Superior Healing': 40, 'Spirit of the Puma IX': 5 }, character)
    const dot = rows.find((r) => r.name === 'Envenomed Bolt')!
    expect(dot).toMatchObject({ rank: 10, casts: 100, category: 'dot', mana: 409, song: false, pet: false, resistable: true, ticks: 6 })
    // DoT: +3% per tick, +5% duration, −2% mana, −4% cast, −2% recovery and −2% reuse (its recast is set).
    expect(rankGain(dot, DEFAULT_TIER_DURATION_PCT, DEFAULT_SPELL_WEIGHTS).map((p) => [p.key, p.pct, p.points])).toEqual([
      ['power', 3, 3],
      ['duration', 5, 5],
      ['mana', 2, 1],
      ['cast', 4, 2],
      ['reuse', 4, 1]
    ])
    // An instant heal has no duration to lengthen.
    const heal = rows.find((r) => r.name === 'Superior Healing')!
    expect(heal.ticks).toBe(0)
    expect(rankGain(heal, DEFAULT_TIER_DURATION_PCT, DEFAULT_SPELL_WEIGHTS).map((p) => p.key)).toEqual(['power', 'mana', 'cast', 'reuse'])
    // A buff gains duration at the timers' own rate, and nothing on damage.
    const puma = rows.find((r) => r.name === 'Spirit of the Puma')!
    expect(puma).toMatchObject({ rank: 9, category: 'buff' })
    expect(rankGain(puma, DEFAULT_TIER_DURATION_PCT, DEFAULT_SPELL_WEIGHTS).map((p) => [p.key, p.pct])).toEqual([
      ['duration', 10],
      ['mana', 4],
      ['cast', 4],
      ['reuse', 4]
    ])
  })

  it('sums every rank of a spell into one row at its highest rank, and keeps clickies and unknown names apart', () => {
    // Elixir of Clarity VI is a potion (no class casts it); Harm Touch is not in the fixture file.
    const { rows, unknown } = castRows(book, { 'Odium IX': 3, 'Odium X': 7, Odium: 1, 'Elixir of Clarity VI': 2, 'Harm Touch': 1 }, character)
    expect(rows.map((r) => [r.name, r.rank, r.casts])).toEqual([['Odium', 10, 11]])
    expect(unknown).toEqual([
      { name: 'Elixir of Clarity VI', casts: 2 },
      { name: 'Harm Touch', casts: 1 }
    ])
  })

  it('tells an ability from a spell by its class levels', () => {
    const levels = (...set: [number, number][]) => Array.from({ length: 16 }, (_, i) => set.find(([c]) => c === i)?.[1] ?? 255)
    // Harm Touch X: Shadow Knight 254. Drain Spirit: Shadow Knight 49, Necromancer 39.
    expect(isAbility({ classLevels: levels([4, 254]) })).toBe(true)
    expect(isAbility({ classLevels: levels([4, 49], [10, 39]) })).toBe(false)
  })

  it('files pet summons, transport and heals that heal nothing under their own sections', () => {
    expect(sectionOf('heal', true)).toBe('pet')
    expect(sectionOf('mez', false)).toBe('cc')
    expect(sectionOf('nuke', false)).toBe('nuke')
    // Gate (SPA 26) and Bind Affinity (SPA 25) are beneficial instants in the file: heals, until their effects are read.
    expect(sectionOf('heal', false, [{ spa: 26, base: 1 }])).toBe('transport')
    expect(sectionOf('nuke', false, [{ spa: 25, base: 1 }])).toBe('transport')
    // Cure Disease (SPA 35, negative counters) heals nothing; Superior Healing (SPA 0, positive) does.
    expect(sectionOf('heal', false, [{ spa: 35, base: -2 }])).toBe('utility')
    expect(sectionOf('heal', false, [{ spa: 0, base: 583 }])).toBe('heal')
    const { rows } = castRows(book, { 'Superior Healing': 1 }, character)
    expect(rows[0]).toMatchObject({ section: 'heal', classLevels: { Cleric: 30, Paladin: 46, Druid: 44, Shaman: 45 } })
  })

  it('counts a spell as yours only when one of your classes has it at their level', () => {
    // Envenomed Bolt: Shaman 49, Necromancer 50 in the fixture (Drain Spirit is Necromancer 39, Shadow Knight 49 in the real file).
    const { rows } = castRows(book, { 'Envenomed Bolt X': 1 }, character)
    expect(rows[0].classLevels).toEqual({ Shaman: 49, Necromancer: 50 })
    expect(castableByMine(rows[0], [{ name: 'Shaman', level: 50 }])).toBe(true)
    expect(castableByMine(rows[0], [{ name: 'Shaman', level: 48 }])).toBe(false)
    expect(
      castableByMine(rows[0], [
        { name: 'Shadow Knight', level: 50 },
        { name: 'Monk', level: 50 }
      ])
    ).toBe(false)
    expect(castableByMine(rows[0], [])).toBe(false)
  })

  it('gives transport and utility spells only the cast and mana cuts', () => {
    const gate = { ...castRows(book, { 'Superior Healing': 10 }, character).rows[0], name: 'Gate', section: 'transport' as const }
    const [o] = spellUpgradeOptions({ rows: [gate], tierPct: DEFAULT_TIER_DURATION_PCT })
    expect(o.parts.map((p) => [p.key, p.pct])).toEqual([
      ['mana', 2],
      ['cast', 4],
      ['reuse', 4]
    ])
    expect(o.section).toBe('transport')
  })
})

describe('the best spell to upgrade next', () => {
  const book = fixtureBook()

  it('ranks by worth per xp, costs the step at 2^rank, and puts maxed spells last', () => {
    const { rows } = castRows(book, { 'Envenomed Bolt X': 100, 'Superior Healing III': 40, 'Spirit of the Puma': 5 }, character)
    const opts = spellUpgradeOptions({ rows, tierPct: DEFAULT_TIER_DURATION_PCT, stock: { infinitesimal: 2, lesser: 3 } })
    expect(opts.map((o) => o.row.name)).toEqual(['Spirit of the Puma', 'Superior Healing', 'Envenomed Bolt'])
    // Puma at rank 0: 1 xp; 5 casts × (10 + 2 + 2 + 1) points.
    expect(opts[0]).toMatchObject({ rank: 0, next: 1, need: 1, benefit: 15, worth: 75, rate: 75, affordable: true, maxed: false, section: 'buff' })
    expect(opts[0].spend.motes).toEqual([{ m: 0, n: 1 }])
    // Superior Healing at III: 8 xp; 40 casts × (3 + 1 + 2 + 1). The stock's 2 + 6 xp just covers it.
    expect(opts[1]).toMatchObject({ rank: 3, next: 4, need: 8, benefit: 7, worth: 280, rate: 35, affordable: true, section: 'heal' })
    expect(opts[1].spend).toMatchObject({
      motes: [
        { m: 0, n: 2 },
        { m: 2, n: 3 }
      ],
      xp: 8,
      over: 0,
      short: 0
    })
    // Rank X: nothing to plan.
    expect(opts[2]).toMatchObject({ maxed: true, need: 0, rate: 0, affordable: false })
    expect(opts[2].worth).toBeGreaterThan(0)
  })

  it('weighs gains the way the player chooses', () => {
    const { rows } = castRows(book, { 'Superior Healing': 10 }, character)
    const manaOnly = { power: 0, duration: 0, mana: 1, cast: 0, reuse: 0, level: 0 }
    const [o] = spellUpgradeOptions({ rows, tierPct: DEFAULT_TIER_DURATION_PCT, weights: manaOnly })
    expect(o.parts.filter((p) => p.points > 0).map((p) => p.key)).toEqual(['mana'])
    expect(o).toMatchObject({ benefit: 2, worth: 20 })
  })
})
