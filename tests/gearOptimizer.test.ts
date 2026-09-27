import { describe, expect, it } from 'vitest'
import { planTotal } from '../src/core/finderRound'
import { optimizeGear, ownedPieces, pieceName } from '../src/core/gearOptimizer'
import { mergeLevel, parseInventory, parseStatsBlock, scaledStats } from '../src/core/inventory'
import { rawWeights, ROLE_PRESETS, type Conversions } from '../src/core/statValue'
import { handWeights, isLore, PRESETS, restrictions, weightsForSlot, type Weights } from '../src/core/upgrades'
import { doubleAttackChance, dualWieldChance, handSwings, swingsPerRound, tripleAttackChance } from '../src/core/combatModel'
import { parseItemPage } from '../src/core/wikiItem'

const page = (name: string, block: string) =>
  `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 600\n|statsblock  = \n${block}\n|dropsfrom = \n\n[[Nagafen's Lair]]\n\n}}</onlyinclude>`
const item = (name: string, block: string) => parseItemPage(name, page(name, block))!
const catalogItem = item

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
    expect([weightsForSlot(w, 'Primary').ratio, weightsForSlot(w, 'Secondary').ratio, weightsForSlot(w, 'Range').ratio]).toEqual([4000, 4000, 0])
    expect([weightsForSlot(w, 'Primary').rangedRatio, weightsForSlot(w, 'Range').rangedRatio, weightsForSlot(w, 'Any Slot').ratio]).toEqual([0, 700, 0])
  })
})

describe('weapon ratio against stats', () => {
  // Kelwyn, 2026-09-26: Wu's Fist of Mastery +10 in Primary (32 dmg / 22 delay, ratio 1.45), +6 in
  // Secondary (25 / 22, 1.14), and a spare Bloodmoon +4 (25 / 28, ratio 0.89, +14 STR), which only
  // goes in Primary. Wearing it would move the +10 fist to the off hand for 0.25 less ratio in all:
  // about a quarter less damage from a hand, worth far more than 14 STR to a melee.
  const catalog = [
    item("Wu's Fist of Mastery", 'Slot: PRIMARY SECONDARY<br>\nSkill: Hand to Hand  Atk Delay: 22<br>\nDMG: 16 <br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Bloodmoon', 'Slot: PRIMARY<br>\nSkill: 1H Slashing  Atk Delay: 28<br>\nDMG: 18 <br>\nSTR: +10<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const inv = parseInventory(
    ['Location\tName\tID\tCount\tSlots', "Primary\tWu's Fist of Mastery +10\t1\t1\t10", "Secondary\tWu's Fist of Mastery +6\t1\t1\t10", 'General 1-Slot1\tBloodmoon +4\t2\t1\t10'].join('\n')
  )
  const pieces = ownedPieces(inv, (it) => {
    const c = byName.get(it.name.replace(/ \+\d+$/, ''))!
    return { r: restrictions(c.statsblock), stats: scaledStats(parseStatsBlock(c.statsblock), mergeLevel(it.name)), foci: [], lore: false }
  })
  // A melee's conversions, STR on the generous side: ⅔ Offense and 10 endurance a point.
  const conv: Conversions = {
    hpPerSta: 10, manaPerWis: 0, manaPerInt: 0, endPer: { STR: 10, STA: 10, AGI: 10, DEX: 10 },
    offensePerStr: 2 / 3, avoidancePerAgi: 0.22, acPerAgi: 0.04, notes: []
  }
  const wearer = { classes: ['war'], race: '', level: 50 }

  it('keeps the better ratio in the hands over a weapon with more STR', () => {
    const plan = optimizeGear({ pieces, wearer, weights: rawWeights(ROLE_PRESETS.Melee, conv), twoHanders: false, focusValue: () => 0 })
    expect(plan.after[plan.slots.indexOf('Primary')]?.item.name).toBe("Wu's Fist of Mastery +10")
    expect(plan.after[plan.slots.indexOf('Secondary')]?.item.name).toBe("Wu's Fist of Mastery +6")
  })

  it('weighs a point of ratio as 100 of the per-1% weight', () => {
    const w = rawWeights(ROLE_PRESETS.Melee, conv)
    expect(weightsForSlot(w, 'Primary').ratio).toBe(ROLE_PRESETS.Melee.ratio * 100)
  })
})

describe('gear in Storage', () => {
  // The export lists the game's Storage window as its key ring. Gear in Storage › Equipment can be
  // taken out and worn, so the optimizer weighs it; the Exaltations and Activated Items tabs are not gear.
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      'Shoulders\tPauldrons of Power +6\t1542\t1\t10',
      'KeyRing\tName\tID\t',
      'Augmentation\tBloodmoon (Exaltation)\t11558\t1\t0',
      'Activated\tRefugee Shroud +4\t1\t1\t0',
      'Equipment\tSode of Empowerment +4\t2\t1\t0'
    ].join('\n')
  )
  const pieces = ownedPieces(inv, () => ({ r: restrictions('Slot: SHOULDERS<br>\nClass: ALL<br>\nRace: ALL<br>'), stats: null, foci: [], lore: true }))

  it('weighs Storage › Equipment and nothing else in Storage', () => {
    expect(pieces.map((p) => [p.item.name, p.from])).toEqual([
      ['Pauldrons of Power +6', 'worn'],
      ['Sode of Empowerment +4', 'storage']
    ])
  })
})

describe('gear on the pet and exaltations in Storage', () => {
  const catalog = [
    item('Plain Ring', 'Slot: FINGER<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Other Ring', 'Slot: FINGER<br>\nAC: 4<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Cloth Tunic', 'Slot: CHEST<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Indicolite Breastplate', 'Slot: CHEST<br>\nAC: 40<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Moonstone Ring', 'Slot: FINGER<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Mithril-Runed Tunic', 'Slot: CHEST<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const focusOf: Record<string, string> = { 'Moonstone Ring': 'Extended Range II', 'Mithril-Runed Tunic': 'Spell Haste II' }
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      'Fingers\tPlain Ring\t1\t1\t10',
      'Fingers\tOther Ring\t2\t1\t10',
      'Chest\tCloth Tunic\t3\t1\t10',
      'KeyRing\tName\tID\t',
      'Augmentation\tMoonstone Ring (Exaltation)\t10150\t1\t0',
      'Augmentation\tMithril-Runed Tunic (Exaltation)\t2405\t1\t0'
    ].join('\n')
  )
  const base = (name: string) => byName.get(name.replace(/ \(Exaltation\)$/, '').replace(/ \+\d+$/, ''))!
  const pet = [{ location: 'Pet', name: 'Indicolite Breastplate +6', id: 0, count: 1, augs: [] }]
  const pieces = ownedPieces(
    inv,
    (it) => {
      const c = base(it.name)
      return { r: restrictions(c.statsblock), stats: scaledStats(parseStatsBlock(c.statsblock), mergeLevel(it.name)), foci: [], lore: false }
    },
    pet
  )
  const exaltations = inv.keyRing.map((k) => ({
    item: { location: 'Storage', name: k.name, id: k.id, count: 1, augs: [] },
    from: 'storage' as const,
    focus: focusOf[k.name.replace(/ \(Exaltation\)$/, '')],
    r: restrictions(base(k.name).statsblock)
  }))
  const weights: Weights = { ...PRESETS.Balanced, ac: 1, hp: 0, mana: 0, end: 0, str: 0, sta: 0, agi: 0, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 0, attack: 0, hpRegen: 0, manaRegen: 0, endRegen: 0, ratio: 0 }
  // Spell Haste II is worth 100, Extended Range II 30; they add.
  const focusValue = (names: string[]) => (names.includes('Spell Haste II') ? 100 : 0) + (names.includes('Extended Range II') ? 30 : 0)
  const opts = { pieces, wearer: { classes: ['shm'], race: '', level: 50 }, weights, twoHanders: false, focusValue, exaltations }
  const at = (plan: ReturnType<typeof optimizeGear>, slot: string) => plan.after.filter((_, i) => plan.slots[i] === slot).map((p) => (p ? pieceName(p) : null))

  it("takes the pet's breastplate for the character when it is an upgrade", () => {
    const plan = optimizeGear({ ...opts, exaltations: [] })
    expect(at(plan, 'Chest')).toEqual(['Indicolite Breastplate +6'])
    expect(plan.after[plan.slots.indexOf('Chest')]?.from).toBe('pet')
  })

  it('puts each stored exaltation in the focus slot of a piece of its own kind, once', () => {
    const plan = optimizeGear(opts)
    // The tunic's exaltation goes in the chest, the ring's in one ring only.
    expect(at(plan, 'Chest')).toEqual(['Indicolite Breastplate +6 with Mithril-Runed Tunic (Exaltation)'])
    expect(at(plan, 'Fingers').filter((n) => n?.includes('Moonstone Ring (Exaltation)'))).toHaveLength(1)
    expect(plan.focusAfter).toBe(130)
    // No piece is worn twice, as it is and exalted.
    const hosts = plan.after.filter(Boolean).map((p) => p!.host ?? p)
    expect(new Set(hosts).size).toBe(hosts.length)
  })

  it("does not use an exaltation the character's classes may not", () => {
    // Rokyls Channelling Crystal: a secondary for BRD NEC WIZ MAG ENC, its exaltation Extended Enhancement III.
    const rokyl = catalogItem('Rokyls Channelling Crystal', 'Slot: SECONDARY<br>\nClass: BRD NEC WIZ MAG ENC<br>\nRace: ALL<br>')
    const crystal = { item: { location: 'Storage', name: 'Rokyls Channelling Crystal (Exaltation)', id: 1, count: 1, augs: [] }, from: 'storage' as const, focus: 'Spell Haste II', r: restrictions(rokyl.statsblock) }
    const orb = catalogItem('Plain Orb', 'Slot: SECONDARY<br>\nAC: 3<br>\nClass: ALL<br>\nRace: ALL<br>')
    const orbPiece = { item: { location: 'Secondary', name: 'Plain Orb', id: 2, count: 1, augs: [] }, from: 'worn' as const, key: 'plain orb', r: restrictions(orb.statsblock), stats: parseStatsBlock(orb.statsblock), foci: [], lore: false }
    const plan = optimizeGear({ ...opts, pieces: [orbPiece], exaltations: [crystal] })
    expect(plan.after.some((p) => p?.exalt)).toBe(false)
    // A class that may use it does take it.
    const mage = optimizeGear({ ...opts, wearer: { classes: ['mag'], race: '', level: 50 }, pieces: [orbPiece], exaltations: [crystal] })
    expect(mage.after.find((p) => p?.exalt)?.exalt?.item.name).toBe('Rokyls Channelling Crystal (Exaltation)')
  })

  it('does not put an exaltation in a piece of another kind', () => {
    const ringOnly = optimizeGear({ ...opts, exaltations: exaltations.filter((e) => e.focus === 'Extended Range II') })
    expect(ringOnly.after.some((p) => p?.exalt && !p.r!.slots.includes('FINGER'))).toBe(false)
  })
})

describe('each hand counted by how often it swings', () => {
  // Kelwyn at level 50: Dual Wield 252, Double Attack 240, Triple Attack 100, no Ambidexterity.
  const double = doubleAttackChance(240, 50)
  const triple = tripleAttackChance(100)
  const dual = dualWieldChance(252, 50)
  const swings = handSwings({ double, triple, dual, doubleSkill: 240 })

  it('splits a round into main-hand and offhand swings, as the Stats page counts them', () => {
    expect(double).toBeCloseTo(0.58, 6)
    expect(triple).toBe(0.11)
    expect(dual).toBeCloseTo(302 / 375, 6)
    expect(swings.main).toBeCloseTo(1 + 0.58 + 0.58 * 0.11, 6)
    expect(swings.off).toBeCloseTo((302 / 375) * 1.58, 6)
    expect(swings.main + swings.off).toBeCloseTo(swingsPerRound({ double, triple, dual, doubleSkill: 240 }), 9)
  })

  it('weighs weapon ratio in each hand by its swings, the two averaging 1', () => {
    const hands = handWeights(swings)
    expect((hands.main + hands.off) / 2).toBeCloseTo(1, 9)
    expect(hands.main).toBeGreaterThan(1)
    expect(weightsForSlot({ ...PRESETS.Melee, ratio: 12 }, 'Primary', hands).ratio).toBeCloseTo(1200 * hands.main, 6)
    expect(weightsForSlot({ ...PRESETS.Melee, ratio: 12 }, 'Secondary', hands).ratio).toBeCloseTo(1200 * hands.off, 6)
    // No one to dual wield: the offhand weapon counts for nothing.
    expect(handWeights({ main: 1.5, off: 0 })).toEqual({ main: 2, off: 0 })
  })

  it('puts the better weapon in the hand that swings more', () => {
    const fist = (name: string, dmg: number, where: string) =>
      ({
        item: { location: where, name, id: 0, count: 1, augs: [] }, from: 'worn' as const, key: name.toLowerCase(),
        r: restrictions(`Slot: PRIMARY SECONDARY<br>\nSkill: Hand to Hand Atk Delay: 22<br>\nDMG: ${dmg}<br>\nClass: ALL<br>\nRace: ALL<br>`),
        stats: parseStatsBlock(`Skill: Hand to Hand Atk Delay: 22<br>\nDMG: ${dmg}<br>`), foci: [], lore: false
      })
    // Worn the wrong way round: the weaker fist in the main hand.
    const pieces = [fist('Weak Fist', 25, 'Primary'), fist('Strong Fist', 32, 'Secondary')]
    const w = { ...PRESETS.Melee, ac: 0, hp: 0, str: 0, sta: 0, agi: 0, dex: 0, haste: 0, attack: 0, end: 0, endRegen: 0, hpRegen: 0, resists: 0, ratio: 12 }
    const plan = optimizeGear({ pieces, wearer: { classes: ['mnk'], race: '', level: 50 }, weights: w, twoHanders: false, focusValue: () => 0, hands: handWeights(swings) })
    expect(plan.after[plan.slots.indexOf('Primary')]?.item.name).toBe('Strong Fist')
    // Counted alike, there is nothing to gain by swapping them.
    const alike = optimizeGear({ pieces, wearer: { classes: ['mnk'], race: '', level: 50 }, weights: w, twoHanders: false, focusValue: () => 0 })
    expect(alike.after[alike.slots.indexOf('Primary')]?.item.name).toBe('Weak Fist')
  })
})

describe('weapons by ratio first', () => {
  // A fist with the better ratio and no stats, a hammer with a worse ratio and a lot of STR, and
  // weights that value STR highly: the hammer wins on the weights alone, the fist with ratio first.
  const piece = (name: string, block: string, where: string) => ({
    item: { location: where, name, id: 0, count: 1, augs: [] }, from: where === 'Bag' ? ('bags' as const) : ('worn' as const), key: name.toLowerCase(),
    r: restrictions(block), stats: parseStatsBlock(block), foci: [], lore: false
  })
  const fist = piece('Fist', 'Slot: PRIMARY<br>\nSkill: Hand to Hand Atk Delay: 22<br>\nDMG: 32<br>\nClass: ALL<br>\nRace: ALL<br>', 'Primary')
  const hammer = piece('Hammer', 'Slot: PRIMARY<br>\nSkill: 1H Blunt Atk Delay: 30<br>\nDMG: 20<br>\nSTR: +100<br>\nClass: ALL<br>\nRace: ALL<br>', 'Bag')
  // Both Any slots hold something better, so the hammer's STR counts only in the hand.
  const charm = (n: string) => piece(n, 'Slot: CHARM<br>\nSTR: +200<br>\nClass: ALL<br>\nRace: ALL<br>', 'Any Slot')
  const w = { ...PRESETS.Melee, str: 20, ratio: 12 }
  const opts = { pieces: [fist, hammer, charm('Red Charm'), charm('Blue Charm')], wearer: { classes: ['mnk'], race: '', level: 50 }, weights: w, twoHanders: false, focusValue: () => 0 }
  const main = (plan: ReturnType<typeof optimizeGear>) => plan.after[plan.slots.indexOf('Primary')]?.item.name

  it('lets the weights pick the weapon when ratio is one weight among many', () => {
    expect(main(optimizeGear(opts))).toBe('Hammer')
  })

  it('keeps the better-ratio weapon in hand when weapon ratio counts first', () => {
    expect(main(optimizeGear({ ...opts, hands: { main: 100, off: 100 } }))).toBe('Fist')
  })
})
