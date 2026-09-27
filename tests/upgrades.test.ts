import { describe, expect, it } from 'vitest'
import { parseItemPage, withRaceFix, type CatalogItem } from '../src/core/wikiItem'
import { canWear, findUpgrades, restrictions } from '../src/core/upgrades'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { PRESETS } from './helpers'

const page = (name: string, era: string, block: string, drops = '') =>
  `{{${era} Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 616\n|statsblock  = \n${block}\n|dropsfrom = \n\n${drops}\n\n}}</onlyinclude>\n[[Category:Fingers]]`

describe('reading a wiki item page', () => {
  it('keeps the stats block, icon, era and where it drops', () => {
    const item = parseItemPage(
      "Engineer's Ring",
      page("Engineer's Ring", 'Classic', 'Slot: FINGER<br>\nAC: 20<br>\nClass: WAR SHD<br>\nRace: ALL<br>', '[[Plane of Hate]]\n\n* [[Innoruuk_(God)|Innoruuk]]')
    )!
    expect(item).toMatchObject({ icon: 616, era: 'Classic', zones: ['Plane of Hate'], mobs: ['Innoruuk'], quest: false })
    expect(item.statsblock).toContain('AC: 20')
  })

  it('skips pages that are not equipment', () => {
    expect(parseItemPage('Bone Chips', page('Bone Chips', 'Classic', 'WT: 0.1  Size: TINY<br>'))).toBeNull()
  })
})

describe('who can wear what', () => {
  const r = restrictions('Slot: PRIMARY SECONDARY<br>\nClass: MNK BST<br>\nRace: HUM IKS<br>\nRequired level of 45<br>')
  it('checks slot, class, race and level', () => {
    const monk = { classes: ['shd', 'mnk'], race: 'IKS', level: 50 }
    expect(canWear(r, monk, 'Primary')).toBe(true)
    expect(canWear(r, monk, 'Head')).toBe(false)
    expect(canWear(r, { ...monk, classes: ['war'] }, 'Primary')).toBe(false)
    expect(canWear(r, { ...monk, race: 'OGR' }, 'Primary')).toBe(false)
    expect(canWear(r, { ...monk, level: 40 }, 'Primary')).toBe(false)
    expect(canWear(r, { ...monk, race: '' }, 'Primary')).toBe(true)
  })
})

describe('finding upgrades', () => {
  const inv = parseInventory(['Location\tName\tID\tCount\tSlots', 'Fingers\tPlain Ring +2\t1\t1\t10', 'Fingers\tGood Ring\t2\t1\t10', 'Bank1\tBetter Ring\t3\t1\t10'].join('\n'))
  const wornStats: Record<string, string> = { 'Plain Ring +2': 'Slot: FINGER<br>\nAC: 2<br>', 'Good Ring': 'Slot: FINGER<br>\nAC: 30<br>' }
  const item = (title: string, era: string, block: string) => parseItemPage(title, page(title, era, block))!
  const catalog = [
    item('Better Ring', 'Classic', 'Slot: FINGER<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Velious Ring', 'Velious', 'Slot: FINGER<br>\nAC: 50<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Summoned: Ring', 'Classic', 'Slot: FINGER<br>\nAC: 90<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Warrior Ring', 'Classic', 'Slot: FINGER<br>\nAC: 40<br>\nClass: WAR<br>\nRace: ALL<br>')
  ]
  const run = (notLive: boolean) =>
    findUpgrades({
      worn: inv.worn,
      statsOf: (it) => parseStatsBlock(wornStats[it.name]),
      catalog,
      wearer: { classes: ['shd'], race: 'IKS', level: 50 },
      weights: PRESETS.Tank,
      compare: 'drop',
      hiddenEras: notLive ? [] : ['Kunark', 'Velious', 'Luclin', 'Other OOE'],
      owned: new Set(['better ring'])
    }).find((s) => s.slot === 'Fingers')!

  it('measures against the weaker of a pair, and leaves out summoned, unusable and not-live items', () => {
    const fingers = run(false)
    expect(fingers.current!.item.name).toBe('Plain Ring +2')
    expect(fingers.candidates.map((c) => c.item.title)).toEqual(['Better Ring'])
    expect(fingers.candidates[0]).toMatchObject({ owned: true, delta: 8 * PRESETS.Tank.ac })
    expect(run(true).candidates.map((c) => c.item.title)).toEqual(['Velious Ring', 'Better Ring'])
  })
})

describe('eras', () => {
  it("groups tags the way the wiki's in/out list says", async () => {
    const { normalizeEra, parseEraStatus } = await import('../src/core/upgrades')
    const one = (t: string) => normalizeEra(t)
    expect(['Classic', 'Fear', 'Hate', 'Hole', 'Temple', 'Sky', 'Paineel', 'Warrens', 'Stonebrunt'].map(one)).toEqual(Array(9).fill('Classic'))
    expect(['Epics', 'EpicQuests', 'Chardok', 'kunark'].map(one)).toEqual(Array(4).fill('Kunark'))
    expect(['Velious', 'Chardok Revamp', 'Luclin', ''].map(one)).toEqual(['Velious', 'Velious', 'Luclin', ''])
    expect(['FearHateRevamp', 'HoleVP', 'WarrensFearHateRevamp', 'Unknown', 'Something New'].map(one)).toEqual(Array(5).fill('Other OOE'))
    // The live list wins: a tag the wiki moves in era counts as Classic.
    const status = parseEraStatus('{{#ifeq:{{#switch:{{{1}}}\n| classic = in\n| kunark = in\n| #default = out\n}}|in|x|y}}')
    expect(status).toEqual({ classic: 'in', kunark: 'in' })
    expect(normalizeEra('Kunark', status)).toBe('Classic')
  })
})

describe('haste in the finder', () => {
  const page = (name: string, block: string) => `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|statsblock  = \n${block}\n|dropsfrom = \n\n}}</onlyinclude>`
  const blocks: Record<string, string> = {
    'Haste Cloak': 'Slot: BACK<br>\nHaste: +41%<br>\nClass: ALL<br>\nRace: ALL<br>',
    'Plain Belt': 'Slot: WAIST<br>\nAC: 2<br>\nClass: ALL<br>\nRace: ALL<br>',
    'Haste Belt': 'Slot: WAIST<br>\nHaste: +46%<br>\nClass: ALL<br>\nRace: ALL<br>'
  }
  it('counts only what a second haste item adds over the best worn', () => {
    expect(parseStatsBlock(blocks['Haste Belt']).haste).toBe(46)
    const inv = parseInventory(['Location\tName\tID\tCount\tSlots', 'Back\tHaste Cloak\t1\t1\t10', 'Waist\tPlain Belt\t2\t1\t10'].join('\n'))
    const weights = { ...PRESETS.Tank, ac: 1, haste: 10 }
    const waist = findUpgrades({
      worn: inv.worn,
      statsOf: (it) => parseStatsBlock(blocks[it.name]),
      catalog: [parseItemPage('Haste Belt', page('Haste Belt', blocks['Haste Belt']))!],
      wearer: { classes: ['shd'], race: '', level: 50 },
      weights,
      compare: 'drop',
      hiddenEras: [],
      owned: new Set()
    }).find((s) => s.slot === 'Waist')!
    // 5 more haste than the cloak's, at 10 a point, less the plain belt's 2 AC.
    expect(waist.candidates[0].delta).toBe(5 * 10 - 2)
    expect(waist.candidates[0].diffs.find((d) => d.key === 'haste')?.delta).toBe(5)
  })
})

describe('race lines the wiki has wrong', () => {
  // eqlwiki gives every dwarven cultural plate piece "Race: ALL"; they are for the small races.
  const greaves: CatalogItem = {
    title: 'Enchanted Dwarven Plate Greaves',
    icon: 540,
    focus: '',
    era: '',
    zones: [],
    mobs: [],
    quest: false,
    crafted: true,
    statsblock: 'MAGIC ITEM<br>\nSlot: LEGS<br>\nAC: 20<br>\nClass: WAR CLR PAL SHD<br>\nRace: ALL<br>'
  }
  const who = (race: string) => ({ classes: ['shd'], race, level: 50 })

  it('puts the dwarven plate right: dwarves, halflings, gnomes and frogloks, not iksar', () => {
    const r = restrictions(withRaceFix(greaves).statsblock)
    expect(r.races).toEqual(['DWF', 'HFL', 'GNM', 'FRG'])
    expect(canWear(r, who('IKS'), 'Legs')).toBe(false)
    expect(canWear(r, who('DWF'), 'Legs')).toBe(true)
    expect(canWear(restrictions(greaves.statsblock), who('IKS'), 'Legs')).toBe(true)
  })

  it('leaves every other item as its page has it', () => {
    const other = { ...greaves, title: 'Dwarven Ale Mug' }
    expect(withRaceFix(other)).toBe(other)
    for (const t of ['Imbued Dwarven Breastplate', 'Dwarven Plate Visor (Enchanted Imbued)', 'Dwarven Plate Boots'])
      expect(restrictions(withRaceFix({ ...greaves, title: t }).statsblock).races).toEqual(['DWF', 'HFL', 'GNM', 'FRG'])
  })
})
