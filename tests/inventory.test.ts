import { describe, expect, it } from 'vitest'
import { baseName, itemKey, mergeLevel, parseInventory, parseStatsBlock, scalePrimary, scaledStats, scaleWeight, wornTotals } from '../src/core/inventory'

const EXPORT = [
  'Location\tName\tID\tCount\tSlots',
  'Any Slot\tBladestopper +5\t11632\t1\t10',
  'Any Slot-Slot8\tBladestopper (Exaltation)\t11632\t1\t10',
  'Fingers\tEngineer`s Ring +6\t1545\t1\t10',
  'Fingers-Slot7\tClawed Knuckle-Ring (Exaltation)\t10403\t1\t10',
  'Fingers-Slot8\tEmpty\t0\t0\t0',
  'Back\tCloak of Flames +4\t11621\t1\t10',
  'Ammo\tFleeting Memory +7\t177944\t1\t10',
  'General 1\tSpacious Rucksack\t177751\t1\t24',
  'General 1-Slot1\tBatwing Crunchies\t13462\t148\t10',
  'General 1-Slot3\tSoldier`s Brooch of the Corrupt +4\t51680\t1\t10',
  'General 1-Slot3-Slot7\tIdol of the Underking (Exaltation)\t14762\t1\t10',
  'Bank1\tDarkwood Trunk\t1\t1\t10',
  'Bank1-Slot2\tPuppet Strings\t2\t1\t10',
  'KeyRing\tName\tID\t',
  'Equipment\tShield of the Stalwart Seas +4\t11552',
  ''
].join('\r\n')

describe('reading the inventory export', () => {
  const inv = parseInventory(EXPORT)

  it('puts worn gear, bags, bank and key ring apart, with augments inside their item', () => {
    expect(inv.worn.map((i) => i.name)).toEqual(['Bladestopper +5', 'Engineer`s Ring +6', 'Cloak of Flames +4', 'Fleeting Memory +7'])
    expect(inv.worn[1].augs.map((a) => a.name)).toEqual(['Clawed Knuckle-Ring (Exaltation)'])
    expect(inv.bags.map((i) => i.location)).toEqual(['General 1', 'General 1-Slot1', 'General 1-Slot3'])
    expect(inv.bags[1].count).toBe(148)
    expect(inv.bags[2].augs.map((a) => a.name)).toEqual(['Idol of the Underking (Exaltation)'])
    expect(inv.bank.map((i) => i.name)).toEqual(['Darkwood Trunk', 'Puppet Strings'])
    expect(inv.keyRing).toEqual([{ kind: 'Equipment', name: 'Shield of the Stalwart Seas +4', id: 11552 }])
  })

  it('matches names to wiki pages loosely', () => {
    expect(mergeLevel('Earring of Bashing +7')).toBe(7)
    expect(baseName('Engineer`s Ring +6')).toBe("Engineer's Ring")
    expect(itemKey('Barbarian Spiritist`s Hammer +5')).toBe(itemKey("Barbarian Spiritist's Hammer"))
    expect(itemKey('Shiverback-Hide Boots')).toBe(itemKey('Shiverback-hide Boots'))
    expect(itemKey('Bladestopper (Exaltation)')).toBe('bladestopper')
  })
})

describe('item stats', () => {
  const ring = parseStatsBlock(
    'MAGIC ITEM  LORE ITEM  NO DROP<br>\nSlot: FINGER<br>\nAC: 20<br>\nSTR: +5  DEX: +5  STA: +5  CHA: +5  WIS: +5  INT: +5  AGI: +5  HP: +5  MANA: +20 END: +20<br>\nWT: 0.1  Size: TINY<br>'
  )
  const cloak = parseStatsBlock('Slot: BACK<br>\nAC: 10<br>\nDEX: +9  AGI: +9  HP: +50<br>\nSV FIRE: +15<br>\nHaste: +36%  <br>\nWT: 0.1  Size: MEDIUM<br>')

  it('reads the stats block', () => {
    expect(ring).toMatchObject({ ac: 20, slots: 'FINGER', weight: 0.1, stats: { STR: 5, AGI: 5 }, pools: { HP: 5, MANA: 20, END: 20 } })
    expect(cloak).toMatchObject({ ac: 10, haste: 36, saves: { FIRE: 15 } })
  })

  it('scales for the merge level the way the wiki slider does', () => {
    // Small values gain a flat point a level; over 10 gains a tenth of base a level, rounded half away from zero.
    expect(scalePrimary(20, 6)).toBe(32)
    expect(scalePrimary(10, 4)).toBe(14)
    expect(scalePrimary(5, 4)).toBe(9)
    expect(scalePrimary(15, 5)).toBe(23) // 15 + round(7.5) = 23
    expect(scalePrimary(-5, 3)).toBe(-2)
    const c4 = scaledStats(cloak, 4)
    expect(c4).toMatchObject({ ac: 14, haste: 40, stats: { DEX: 13 }, pools: { HP: 70 }, saves: { FIRE: 21 } })
    expect(scaleWeight(4.5, 5)).toBe(2.5)
    expect(scaleWeight(0.1, 5)).toBe(0.1)
  })

  it('adds worn gear up, leaving ammo out of AC and taking the best haste', () => {
    const inv = parseInventory(EXPORT)
    const stats: Record<string, ReturnType<typeof parseStatsBlock>> = {
      'Engineer`s Ring +6': scaledStats(ring, 6),
      'Cloak of Flames +4': scaledStats(cloak, 4),
      'Fleeting Memory +7': { ...scaledStats(ring, 0), ac: 50 }
    }
    const t = wornTotals(inv.worn, (it) => stats[it.name] ?? null, (it) => (it.name.startsWith('Bladestopper') ? 38 : undefined))
    expect(t.ac).toBe(38 + 32 + 14)
    expect(t.haste).toBe(40)
    expect(t.unknown).toBe(0)
  })
})
