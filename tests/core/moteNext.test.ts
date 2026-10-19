import { describe, expect, it } from 'vitest'
import { nextRanking, spellShares } from '../../src/core/moteNext'
import type { MergeOption } from '../../src/core/mergeValue'
import type { SpellUpgradeOption } from '../../src/core/spellMotes'

describe('Motes › Next: merges and spell ranks in one list (FEAT-033)', () => {
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
