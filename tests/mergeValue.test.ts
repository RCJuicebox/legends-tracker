import { describe, expect, it } from 'vitest'
import { mergeOptions } from '../src/core/mergeValue'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { PRESETS } from '../src/core/upgrades'

describe('the best merge next', () => {
  const inv = parseInventory(
    ['Location\tName\tID\tCount\tSlots', 'Fingers\tPlain Ring +2\t1\t1\t10', 'Fingers\tGood Ring\t2\t1\t10', 'Ear\tDone Earring +10\t3\t1\t10', 'Neck\tUnknown Necklace\t4\t1\t10'].join('\n')
  )
  const blocks: Record<string, string> = {
    'Plain Ring +2': 'Slot: FINGER<br>\nAC: 2<br>',
    'Good Ring': 'Slot: FINGER<br>\nAC: 30<br>\nSTA: +5<br>',
    'Done Earring +10': 'Slot: EAR<br>\nAC: 30<br>'
  }
  const baseStatsOf = (item: { name: string }) => (blocks[item.name] ? parseStatsBlock(blocks[item.name]) : null)
  const weights = { ...PRESETS.Balanced, ac: 2, sta: 1 }

  it('ranks by stat gain per mote value, costing each step by the mote it takes', () => {
    const opts = mergeOptions({ worn: inv.worn, baseStatsOf, weights })
    // +10 has no next level; the wiki does not know the necklace.
    expect(opts.map((o) => o.item.name)).toEqual(['Good Ring', 'Plain Ring +2'])
    const [good, plain] = opts
    // +0 → +1 on a 30 AC ring: 33 AC (+10%), STA 5 → 6 (flat +1 under 10). One Infinitesimal mote, worth 1.
    expect(good).toMatchObject({ level: 0, next: 1, deltas: { ac: 3, sta: 1 }, gain: 7, need: 1, mote: 0, motes: 1, cost: 1, rate: 700 })
    // +2 → +3 on a 2 AC ring: 4 → 5 AC. 4 xp from Lesser motes (2 xp each, worth 4): 2 motes, cost 8.
    expect(plain).toMatchObject({ level: 2, next: 3, deltas: { ac: 1 }, gain: 2, need: 4, mote: 2, motes: 2, cost: 8, rate: 25 })
  })

  it('says what the stock can pay for, combining up from lower ranks', () => {
    const none = mergeOptions({ worn: inv.worn, baseStatsOf, weights, stock: { lesser: 1 } })
    expect(none.map((o) => [o.item.name, o.canMake, o.affordable])).toEqual([
      ['Good Ring', 0, false],
      ['Plain Ring +2', 1, false]
    ])
    // Four Minor make two Lesser.
    const some = mergeOptions({ worn: inv.worn, baseStatsOf, weights, stock: { minor: 4 } })
    expect(some.find((o) => o.item.name === 'Plain Ring +2')).toMatchObject({ canMake: 2, affordable: true })
  })

  it("counts xp already in the planned item's bar", () => {
    const opts = mergeOptions({ worn: inv.worn, baseStatsOf, weights, planned: { name: 'Plain Ring +2', lvl: 2, xp: 3 } })
    expect(opts.find((o) => o.item.name === 'Plain Ring +2')).toMatchObject({ need: 1, motes: 1, cost: 4 })
  })
})
