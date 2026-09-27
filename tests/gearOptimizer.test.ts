import { describe, expect, it } from 'vitest'
import { planTotal } from '../src/core/finderRound'
import { optimizeGear, ownedPieces } from '../src/core/gearOptimizer'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { isLore, PRESETS, restrictions, weightsForSlot, type Weights } from '../src/core/upgrades'
import { parseItemPage } from '../src/core/wikiItem'

const page = (name: string, block: string) =>
  `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 600\n|statsblock  = \n${block}\n|dropsfrom = \n\n[[Nagafen's Lair]]\n\n}}</onlyinclude>`
const item = (name: string, block: string) => parseItemPage(name, page(name, block))!

describe('the optimizer and haste', () => {
  // Worn: haste gloves with little else, a plain belt, and a charm in each Any slot. In the bags: far
  // better gloves, and a haste belt as quick as the gloves. Only one haste item counts, so the best set
  // is the haste belt at the waist and the big gloves on the hands. One move at a time never gets
  // there: the haste belt alone costs the plain belt's AC, and the big gloves alone cost the haste.
  const catalog = [
    item('Haste Gloves', 'Slot: HANDS<br>\nAC: 1<br>\nHaste: +30%<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Big Gloves', 'Slot: HANDS<br>\nAC: 20<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Plain Belt', 'Slot: WAIST<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Haste Belt', 'Slot: WAIST<br>\nAC: 1<br>\nHaste: +30%<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Red Charm', 'Slot: CHARM<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Blue Charm', 'Slot: CHARM<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      'Hands\tHaste Gloves\t1\t1\t10',
      'Waist\tPlain Belt\t2\t1\t10',
      'Any Slot\tRed Charm\t3\t1\t10',
      'Any Slot\tBlue Charm\t4\t1\t10',
      'General 1-Slot1\tBig Gloves\t5\t1\t10',
      'General 1-Slot2\tHaste Belt\t6\t1\t10'
    ].join('\n')
  )
  const pieces = ownedPieces(inv, (it) => {
    const c = byName.get(it.name)
    return c ? { r: restrictions(c.statsblock), stats: parseStatsBlock(c.statsblock), foci: [], lore: isLore(c.statsblock) } : null
  })
  const weights: Weights = { ...PRESETS.Balanced, ac: 1, hp: 0, mana: 0, end: 0, str: 0, sta: 0, agi: 0, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 1, attack: 0, hpRegen: 0, manaRegen: 0, endRegen: 0, ratio: 0 }
  const opts = { pieces, wearer: { classes: ['war'], race: '', level: 50 }, weights, twoHanders: false, focusValue: () => 0 }

  it('wears one haste item, in whichever slot leaves the best set', () => {
    const plan = optimizeGear(opts)
    const worn = plan.after.map((p) => p?.item.name).filter(Boolean)
    expect(worn.filter((n) => n!.startsWith('Haste'))).toEqual(['Haste Belt'])
    expect(plan.after[plan.slots.indexOf('Hands')]?.item.name).toBe('Big Gloves')
    // Big gloves 20, haste belt 1, both charms 20, and the haste once: 30.
    expect(planTotal(plan)).toBe(20 + 1 + 10 + 10 + 30)
    expect(plan.hasteAfter).toBe(30)
  })

  it('counts a second haste item for nothing', () => {
    const plan = optimizeGear(opts)
    expect(plan.hasteBefore).toBe(30)
    expect(plan.slotScoreBefore.reduce((a, b) => a + b, 0)).toBe(1 + 5 + 10 + 10)
  })
})

describe('the optimizer and weapon ratio', () => {
  // A melee with two good one-handers, a fast bow and a range-slot item with stats. Weapon ratio is
  // the hands': it picks the blades for Primary and Secondary and says nothing about the Range slot,
  // which goes to stats unless ranged ratio is weighted too.
  const catalog = [
    item('Fine Blade', 'Slot: PRIMARY SECONDARY<br>\nSkill: 1H Slashing Atk Delay: 20<br>\nDMG: 16<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Keen Blade', 'Slot: PRIMARY SECONDARY<br>\nSkill: 1H Slashing Atk Delay: 20<br>\nDMG: 14<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Dull Club', 'Slot: PRIMARY SECONDARY<br>\nSkill: 1H Blunt Atk Delay: 40<br>\nDMG: 10<br>\nAC: 2<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Swift Bow', 'Slot: RANGE<br>\nSkill: Archery Atk Delay: 20<br>\nDMG: 20<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Stout Idol', 'Slot: RANGE<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      'Primary\tDull Club\t1\t1\t10',
      'Range\tSwift Bow\t2\t1\t10',
      'General 1-Slot1\tFine Blade\t3\t1\t10',
      'General 1-Slot2\tKeen Blade\t4\t1\t10',
      'General 1-Slot3\tStout Idol\t5\t1\t10'
    ].join('\n')
  )
  const pieces = ownedPieces(inv, (it) => {
    const c = byName.get(it.name)
    return c ? { r: restrictions(c.statsblock), stats: parseStatsBlock(c.statsblock), foci: [], lore: isLore(c.statsblock) } : null
  })
  const melee: Weights = { ...PRESETS.Melee, ac: 1, hp: 0, str: 0, sta: 0, agi: 0, dex: 0, haste: 0, attack: 0, ratio: 40 }
  const opts = { pieces, wearer: { classes: ['war'], race: '', level: 50 }, weights: melee, twoHanders: false, focusValue: () => 0 }
  const at = (plan: ReturnType<typeof optimizeGear>, slot: string) => plan.after[plan.slots.indexOf(slot)]?.item.name

  it('puts the best ratio in the hands and stats in the Range slot', () => {
    const plan = optimizeGear(opts)
    expect([at(plan, 'Primary'), at(plan, 'Secondary')].sort()).toEqual(['Fine Blade', 'Keen Blade'])
    expect(at(plan, 'Range')).toBe('Stout Idol')
  })

  it('keeps the bow when ranged ratio is weighted', () => {
    const plan = optimizeGear({ ...opts, weights: { ...melee, rangedRatio: 40 } })
    expect(at(plan, 'Range')).toBe('Swift Bow')
  })

  it('reads weapon ratio in the hands only, ranged ratio in the Range slot only', () => {
    const w = { ...melee, rangedRatio: 7 }
    expect([weightsForSlot(w, 'Primary').ratio, weightsForSlot(w, 'Secondary').ratio, weightsForSlot(w, 'Range').ratio]).toEqual([40, 40, 0])
    expect([weightsForSlot(w, 'Primary').rangedRatio, weightsForSlot(w, 'Range').rangedRatio, weightsForSlot(w, 'Any Slot').ratio]).toEqual([0, 7, 0])
  })
})
