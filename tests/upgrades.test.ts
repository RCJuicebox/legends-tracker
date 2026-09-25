import { describe, expect, it } from 'vitest'
import { parseItemPage } from '../src/core/wikiItem'
import { canWear, findUpgrades, PRESETS, restrictions } from '../src/core/upgrades'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'

const page = (name: string, era: string, block: string, drops = '') =>
  `{{${era} Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 616\n|statsblock  = \n${block}\n|dropsfrom = \n\n${drops}\n\n}}</onlyinclude>\n[[Category:Fingers]]`

describe('reading a wiki item page', () => {
  it('keeps the stats block, icon, era and where it drops', () => {
    const item = parseItemPage("Engineer's Ring", page("Engineer's Ring", 'Classic', 'Slot: FINGER<br>\nAC: 20<br>\nClass: WAR SHD<br>\nRace: ALL<br>', '[[Plane of Hate]]\n\n* [[Innoruuk_(God)|Innoruuk]]'))!
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
