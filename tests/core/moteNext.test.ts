import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextRanking, spellShares } from '../../src/core/moteNext'
import { WEIGHT_LABELS, type WeightKey, type Weights } from '../../src/core/gearFinder'
import { parseStatsBlock } from '../../src/core/inventory'
import { castRows } from '../../src/core/spellMotes'
import { SpellBook } from '../../src/core/spells'
import { fixtureBook } from '../helpers'
import type { MergeOption } from '../../src/core/mergeValue'
import type { SpellUpgradeOption } from '../../src/core/spellMotes'

describe('Motes › Best upgrade: merges and spell ranks in one list (FEAT-033)', () => {
  const item = (name: string, level: number, gain: number, cost: number) =>
    ({ item: { location: 'Back', name: `${name} +${level}`, id: 1, count: 1, augs: [] }, level, next: level + 1, gain, cost, affordable: true }) as unknown as MergeOption
  const spell = (name: string, category: string, power: number, worth: number, short = 0) =>
    ({
      row: { name, category },
      rank: 8,
      next: 9,
      parts: power ? [{ key: 'power', pct: power, points: power, label: '' }] : [],
      worth,
      spend: { worth: 256, short },
      affordable: !short,
      maxed: false
    }) as unknown as SpellUpgradeOption

  it('puts a share of your damage on what it can, the most per mote first, and the rest after by their own worth', () => {
    const rows = nextRanking(
      [item('Cloak of Flames', 5, 24, 64), item('Wu Fist', 9, 120, 512)],
      [spell('Envenomed Bolt', 'dot', 6, 900), spell('Slugs Healing', 'hot', 6, 500), spell('Odium', 'dot', 6, 300, 40)],
      { ratioWeight: 12, damageShare: (n) => (n === 'Envenomed Bolt' ? 0.3 : n === 'Odium' ? 0.1 : null) }
    )
    expect(rows.map((r) => [r.name, r.step, r.cost, r.gainPct === null ? null : Math.round(r.gainPct * 100) / 100])).toEqual([
      ['Cloak of Flames', '+5 → +6', 64, 2],
      ['Wu Fist', '+9 → +10', 512, 10],
      ['Envenomed Bolt', 'VIII → IX', 256, 1.8],
      ['Odium', 'VIII → IX', null, 0.6],
      ['Slugs Healing', 'VIII → IX', 256, null]
    ])
    // What the columns sort by: the level it starts from, and the gain for each 1,000 motes.
    expect(rows.map((r) => [r.level, r.perK === null ? null : Math.round(r.perK * 100) / 100])).toEqual([
      [5, 31.25],
      [9, 19.53],
      [8, 7.03],
      [8, null],
      [8, null]
    ])
  })

  it("prices a buff's next rank by your weights, and a proc buff's by its proc's share of your damage", () => {
    const weights = { ...(Object.fromEntries(Object.keys(WEIGHT_LABELS).map((k) => [k, 0])) as Record<WeightKey, number>), str: 1, hp: 0.5, ratio: 10, shieldAc: 99 } as Weights
    // Strength II → III: 2% of 67 STR is 1.34 STR; Harnessing: 10% of 251 HP and 2% of its STR and DEX.
    const strength = parseStatsBlock('')
    strength.stats.STR = 1.34
    const harnessing = parseStatsBlock('')
    harnessing.stats.STR = 1.34
    harnessing.pools.HP = 25.1
    const buff = (name: string, rankStats: unknown, procSpell: string | null = null) =>
      ({ ...spell(name, 'buff', 2, 50), row: { name, category: 'buff', rankStats, procSpell } }) as unknown as SpellUpgradeOption
    const rows = nextRanking(
      [],
      [buff('Strength', strength), buff('Harnessing of Spirit', harnessing), buff('Vampiric Embrace', null, 'Vampiric Embrace'), buff('Spirit of Wolf', null)],
      {
        ratioWeight: 10,
        damageShare: (n) => (n === 'Vampiric Embrace' ? 0.05 : null),
        weights
      }
    )
    expect(rows.map((r) => [r.name, r.gainPct === null ? null : Math.round(r.gainPct * 1000) / 1000, r.note])).toEqual([
      ['Harnessing of Spirit', 1.389, '13.9 points by your weights'],
      ['Vampiric Embrace', 0.15, 'Vampiric Embrace 5.0% of your damage'],
      ['Strength', 0.134, '1.3 points by your weights'],
      // Movement does not grow: nothing to price, so it keeps its points.
      ['Spirit of Wolf', null, '50 points over your casts']
    ])
  })

  it("reads a buff row's rank stats and proc from the spell file", () => {
    const character = { level: 50, classLevels: {}, focusSources: [] }
    const stacking = SpellBook.parse(
      readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us.txt'), 'latin1'),
      readFileSync(join(__dirname, '..', 'fixtures', 'stacking_spells_us_str.txt'), 'latin1')
    )
    // Harnessing at level 50: 251 max HP, 67 STR, 50 DEX; its one-time heal is not a stat.
    const [harnessing] = castRows(stacking, { 'Harnessing of Spirit I': 1 }, character).rows
    expect(harnessing.procSpell).toBeNull()
    expect(harnessing.rankStats?.pools.HP).toBeCloseTo(25.1)
    expect(harnessing.rankStats?.stats).toEqual({ STR: expect.closeTo(1.34), DEX: expect.closeTo(1) })
    // Spirit of the Puma is all proc: no stats. Its proc spell is not in this fixture, so it names none.
    const [puma] = castRows(fixtureBook(), { 'Spirit of the Puma IX': 1 }, character).rows
    expect(puma).toMatchObject({ rankStats: null, procSpell: null })
  })

  it('gives each spell its share of your damage in a meter segment, its ticks with its hits', () => {
    const shares = spellShares(
      {
        punch: { name: 'punch', total: 600, how: 'melee' },
        'Envenomed Bolt X': { name: 'Envenomed Bolt X', total: 200, how: 'spell' },
        'dot:Envenomed Bolt X': { name: 'Envenomed Bolt X', total: 200, how: 'dot' }
      },
      (n) => n.replace(/ [IVX]+$/, '').toLowerCase()
    )
    expect(shares.get('envenomed bolt')).toBeCloseTo(0.4)
  })
})
