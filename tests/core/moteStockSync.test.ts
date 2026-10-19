import { describe, expect, it } from 'vitest'
import { MoteStockKeeper } from '../../src/core/moteStock'
import { mergeBill, wornAfterMerges } from '../../src/core/mergeValue'
import type { MoteStock } from '../../src/shared/types'

// LT-740: the merge planner and Best merge follow what the game says was merged.

const keeper = (item: MoteStock['item']) => {
  let stock: MoteStock = { counts: {}, item, autoAdd: true }
  const said: string[] = []
  const k = new MoteStockKeeper(
    { get: () => stock, set: (v) => void (stock = v) },
    () => {},
    (_, text) => said.push(text)
  )
  return { k, said, stock: () => stock }
}

describe('the merge planner follows the game (LT-740)', () => {
  it('moves the planned item to the +N a merge line or an export gives, and keeps the merges', () => {
    const t = keeper({ name: 'Cloak of Flames +5', lvl: 5, xp: 3, to: 7 })
    t.k.observed(['Cloak of Flames +7'], 100, 'merge')
    expect(t.stock().item).toMatchObject({ name: 'Cloak of Flames +7', lvl: 7, xp: 0 })
    expect(t.stock().merges).toEqual([{ name: 'Cloak of Flames +7', at: 100 }])
    expect(t.said).toEqual(['Merge planner: Cloak of Flames +7 is +7 by your log.'])
    // An export listing it lower than the log's merge since: the export is older news, but it is the export's word.
    t.k.observed(['Rusty Dagger', 'Cloak of Flames +8', 'Cloak of Flames +2'], 200, 'export')
    expect(t.stock().item.lvl).toBe(8)
    // Nothing of the item's: nothing changes, and an export keeps no merges.
    t.k.observed(['Rusty Dagger'], 300, 'export')
    expect(t.stock().item.lvl).toBe(8)
    expect(t.stock().merges).toHaveLength(1)
  })

  it('shows a worn item at the +N it was merged to after the export, and not one merged before it', () => {
    const worn = [{ location: 'Back', name: 'Cloak of Flames +5', id: 1, count: 1, augs: [] }]
    expect(wornAfterMerges(worn, [{ name: 'Cloak of Flames +7', at: 200 }], 100)).toEqual({ worn: [{ ...worn[0], name: 'Cloak of Flames +7' }], moved: 1 })
    expect(wornAfterMerges(worn, [{ name: 'Cloak of Flames +7', at: 50 }], 100).moved).toBe(0)
    expect(wornAfterMerges(worn, [{ name: 'Cloak of Flames +4', at: 200 }], 100).moved).toBe(0)
  })
})

describe('what a +0 drop takes to reach your merge level (LT-742)', () => {
  it('adds up each level the mote it takes, and says how many of the top one your motes make', () => {
    expect(mergeBill(2, { minor: 1, infinitesimal: 4 })).toEqual({
      motes: [
        { mote: 1, count: 2 },
        { mote: 0, count: 1 }
      ],
      top: 1,
      canMake: 3
    })
    expect(mergeBill(0).motes).toEqual([])
    expect(mergeBill(7).motes[0]).toEqual({ mote: 6, count: Math.ceil(64 / 7) })
  })
})
