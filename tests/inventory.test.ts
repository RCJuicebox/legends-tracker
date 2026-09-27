import { describe, expect, it } from 'vitest'
import { baseName, itemFoci, itemKey, mergeLevel, parseInventory, parseStatsBlock, scalePrimary, scaledStats, scaleWeight, wornTotals } from '../src/core/inventory'

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
    const t = wornTotals(
      inv.worn,
      (it) => stats[it.name] ?? null,
      (it) => (it.name.startsWith('Bladestopper') ? 38 : undefined)
    )
    expect(t.ac).toBe(38 + 32 + 14)
    expect(t.haste).toBe(40)
    expect(t.unknown).toBe(0)
  })
})

describe('the focus effects an item carries', () => {
  // Kelwyn's export, 2026-09-26: the ring's own Spell Haste II is replaced by its focus exaltation's
  // Extended Range II (the game's item window shows only that); the chest has no focus of its own and
  // takes Spell Haste II from its focus exaltation. The ring's click exaltation brings no focus.
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      "Fingers\tDjarn's Amethyst Ring +4\t10366\t1\t10",
      'Fingers-Slot7\tMoonstone Ring (Exaltation)\t10150\t1\t10',
      'Fingers-Slot8\tVermilion Sky Ring (Exaltation)\t27730\t1\t10',
      'Fingers-Slot9\tEmpty\t0\t0\t0',
      'Chest\tLustrous Russet Breastplate +5\t4832\t1\t10',
      'Chest-Slot2\tEmpty\t0\t0\t0',
      'Chest-Slot7\tMithril-Runed Tunic (Exaltation)\t2405\t1\t10',
      'Hands\tPlain Gloves\t1\t1\t10',
      'Hands-Slot8\tFocused Charm (Exaltation)\t2\t1\t10',
      'Neck\tBare Choker\t3\t1\t10',
      'Neck-Slot7\tDull Charm (Exaltation)\t4\t1\t10'
    ].join('\n')
  )
  const focus: Record<string, string> = {
    'djarns amethyst ring': 'Spell Haste II',
    'moonstone ring': 'Extended Range II',
    'mithril runed tunic': 'Spell Haste II',
    'vermilion sky ring': 'Improved Damage II',
    'focused charm': 'Improved Healing II',
    'bare choker': 'Extended Enhancement II'
  }
  const foci = (slot: string) =>
    itemFoci(
      inv.worn.find((w) => w.location === slot)!,
      (n) => focus[itemKey(n)]
    )

  it("takes the focus exaltation's focus in place of the item's own", () => {
    expect(foci('Fingers')).toEqual([{ name: 'Extended Range II', via: 'Moonstone Ring (Exaltation)' }])
    expect(foci('Chest')).toEqual([{ name: 'Spell Haste II', via: 'Mithril-Runed Tunic (Exaltation)' }])
  })

  it('takes no focus from a click, worn or proc exaltation', () => {
    expect(foci('Hands')).toEqual([])
  })

  it("keeps the item's own focus when its focus exaltation has none known", () => {
    expect(foci('Neck')).toEqual([{ name: 'Extended Enhancement II', via: '' }])
  })
})
