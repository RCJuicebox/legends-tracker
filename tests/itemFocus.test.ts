import { describe, expect, it } from 'vitest'
import type { Spell, SpellEffect } from '../src/core/spells'
import { castableSpells, effectivePct, familyName, focusApplies, focusReport, focusSpec, focusValue, type FocusSpec } from '../src/core/itemFocus'
import { parseItemPage } from '../src/core/wikiItem'
import { findUpgrades, PRESETS, type Weights } from '../src/core/upgrades'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { optimizeGear, ownedPieces } from '../src/core/gearOptimizer'
import { restrictions, isLore } from '../src/core/upgrades'

const fx = (spa: number, base: number, base2 = 0): SpellEffect => ({ spa, base, base2 })

/** A spell row as the game's spell file has it; classLevels by classic class number - 1 (4 = SK, 9 = SHM). */
function spell(id: number, name: string, o: Partial<Spell> = {}): Spell {
  return {
    id, name, castMs: 3000, recastMs: 0, formula: 0, cap: 0, beneficial: false, classLevels: Array(16).fill(255), targetType: 5, skill: 24, icon: 0,
    effects: [], category: 'nuke', landSelf: '', landOther: '', fade: '', ...o
  }
}
const at = (levels: Record<number, number>) => Array.from({ length: 16 }, (_, i) => levels[i] ?? 255)

// Real rows from the EQL client (2026-09): Extended Enhancement II and III, Tavee's Greater Diuturnity, Improved Damage II.
const EE = (id: number, name: string, cap: number) =>
  spell(id, name, { beneficial: true, effects: [fx(128, 15), fx(134, cap, 5), fx(138, 1), fx(137, -101), fx(137, -40), fx(140, 4), fx(137, -86), fx(311, 0)] })
const ee2 = focusSpec(EE(2334, 'Extended Enhancement II', 44))!
const ee3 = focusSpec(EE(2335, 'Extended Enhancement III', 60))!
const tavee = focusSpec(EE(2219, "Tavee's Greater Diuturnity", 60))!
const dmg2 = focusSpec(
  spell(2337, 'Improved Damage II', { effects: [fx(124, 1, 20), fx(134, 44, 5), fx(137, 0), fx(141, 1), fx(138, 0), fx(136, -2), fx(136, -4), fx(311, 0)] })
)!

// The character's spells: a level-50 SHM buff that lasts, a level-49 SK nuke, a level-10 SHM buff too short for the focus.
const puma = spell(1, 'Spirit of the Puma', { beneficial: true, formula: 3, cap: 360, targetType: 6, classLevels: at({ 9: 50 }), effects: [fx(0, 10)] })
const spear = spell(2, 'Spear of Pain', { classLevels: at({ 4: 49 }), effects: [fx(0, -300)] })
const quick = spell(3, 'Short Buff', { beneficial: true, formula: 5, cap: 2, classLevels: at({ 9: 10 }), effects: [fx(0, 1)] })
const wizOnly = spell(4, 'Wizard Nuke', { classLevels: at({ 11: 20 }), effects: [fx(0, -100)] })

describe('reading focus spells', () => {
  it('puts ranks that differ only by level cap in one line, whatever their names', () => {
    expect(ee2.line).toBe(ee3.line)
    expect(tavee.line).toBe(ee3.line)
    expect(dmg2.line).not.toBe(ee3.line)
    expect(familyName("Tavee's Charm of Diuturnity")).toBe("Tavee's Diuturnity")
    expect(familyName('Improved Damage III')).toBe('Improved Damage')
  })

  it('fades past the level cap by its decay', () => {
    expect(effectivePct(ee2, 50)).toBeCloseTo(10.5)
    expect(effectivePct(ee3, 50)).toBe(15)
    expect(effectivePct(dmg2, 49)).toBe(15)
  })

  it('touches only the spells its limits allow', () => {
    const bits = 0
    const cast = (s: Spell, level: number) => ({ spell: s, level })
    expect(focusApplies(ee3, cast(puma, 50), 50, bits)).toBe(true)
    expect(focusApplies(ee3, cast(spear, 49), 50, bits)).toBe(false)
    expect(focusApplies(ee3, cast(quick, 10), 50, bits)).toBe(false)
    expect(focusApplies(dmg2, cast(spear, 49), 50, bits)).toBe(true)
    expect(focusApplies(dmg2, cast(puma, 50), 50, bits)).toBe(false)
  })

  it('reports each line for the classes the character plays', () => {
    const spells = castableSpells([puma, spear, quick, wizOnly], ['shd', 'mnk', 'shm'], 50)
    expect(spells.map((s) => s.spell.name).sort()).toEqual(['Short Buff', 'Spear of Pain', 'Spirit of the Puma'])
    const r = focusReport([ee2, ee3, tavee, dmg2], spells, ['shd', 'mnk', 'shm'], 50)
    const duration = r.lines.find((l) => l.kind === 'duration')!
    expect(duration).toMatchObject({ spells: 1, topLevel: 50, families: ['Extended Enhancement', "Tavee's Diuturnity"] })
    expect(r.foci['Extended Enhancement II'].eff).toBeCloseTo(10.5)
    expect(r.lines.find((l) => l.kind === 'damage')).toMatchObject({ spells: 1, topLevel: 49 })
  })
})

describe('what worn foci are worth', () => {
  const spells = castableSpells([puma, spear], ['shd', 'shm'], 50)
  const r = focusReport([ee2, ee3, dmg2], spells, ['shd', 'shm'], 50)
  const line = (f: FocusSpec) => r.foci[f.name].line
  const worth = { points: 300, wanted: new Set([line(ee3), line(dmg2)]), best: new Map([[line(ee3), 15], [line(dmg2), 20]]), foci: r.foci }

  it('counts the best rank worn in each wanted line, in proportion to the best there is', () => {
    expect(focusValue(worth, ['Extended Enhancement III'])).toBe(300)
    expect(focusValue(worth, ['Extended Enhancement II'])).toBeCloseTo(210)
    expect(focusValue(worth, ['Extended Enhancement II', 'Extended Enhancement III'])).toBe(300)
    expect(focusValue(worth, ['Extended Enhancement III', 'Improved Damage II'])).toBe(300 + 225)
    expect(focusValue({ ...worth, wanted: new Set([line(dmg2)]) }, ['Extended Enhancement III'])).toBe(0)
  })
})

describe('Any slots and focus effects in the finder and the optimizer', () => {
  const page = (name: string, block: string, focus = '') =>
    `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 600\n|statsblock  = \n${block}\n${focus ? `|focus_effect = ${focus}\n` : ''}|dropsfrom = \n\n[[Nagafen's Lair]]\n\n}}</onlyinclude>`
  const item = (name: string, block: string, focus = '') => parseItemPage(name, page(name, block, focus))!
  const catalog = [
    item('Plain Belt', 'MAGIC ITEM  LORE ITEM<br>\nSlot: WAIST<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Drakescale Belt', 'Slot: WAIST<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>', 'Extended Enhancement III'),
    item('Big Shield', 'LORE ITEM<br>\nSlot: SECONDARY<br>\nAC: 25<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Tiny Charm', 'Slot: CHARM<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  it('keeps the focus effect a page names', () => {
    expect(catalog[1].focus).toBe('Extended Enhancement III')
    expect(catalog[0].focus).toBe('')
  })

  const acOnly: Weights = { ...PRESETS.Tank, ac: 1, hp: 0, sta: 0 }
  const foci = focusReport([ee3], castableSpells([puma], ['shm'], 50), ['shm'], 50).foci
  const worth = { points: 300, wanted: new Set([foci['Extended Enhancement III'].line]), best: new Map([[foci['Extended Enhancement III'].line, 15]]), foci }
  const byTitle = new Map(catalog.map((c) => [c.title.toLowerCase(), c]))
  const fociOf = (name: string) => byTitle.get(name.toLowerCase())?.focus || ''

  it('offers any piece of gear for an Any slot, a wanted focus counting toward its gain', () => {
    const inv = parseInventory(['Location\tName\tID\tCount\tSlots', 'Any Slot\tTiny Charm\t4\t1\t10', 'Waist\tPlain Belt\t1\t1\t10'].join('\n'))
    const any = findUpgrades({
      worn: inv.worn,
      statsOf: (it) => parseStatsBlock(byTitle.get(it.name.toLowerCase())!.statsblock),
      catalog,
      wearer: { classes: ['shm'], race: '', level: 50 },
      weights: acOnly,
      compare: 'drop',
      hiddenEras: [],
      owned: new Set(),
      focus: { worn: (it) => [fociOf(it.name)].filter(Boolean), value: (names) => focusValue(worth, names) }
    }).find((s) => s.slot === 'Any Slot')!
    const titles = any.candidates.map((c) => c.item.title)
    expect(titles[0]).toBe('Drakescale Belt')
    expect(any.candidates[0]).toMatchObject({ delta: 4 + 300, focus: { name: 'Extended Enhancement III', gain: 300 } })
    expect(titles).toContain('Big Shield')
    // A lore belt already worn at the waist cannot go on twice.
    expect(titles).not.toContain('Plain Belt')
  })

  it('moves owned pieces into the Any slots when the stats and foci are worth it', () => {
    const inv = parseInventory(
      ['Location\tName\tID\tCount\tSlots', 'Any Slot\tTiny Charm\t4\t1\t10', 'Waist\tPlain Belt\t1\t1\t10', 'Bank1\tDrakescale Belt\t2\t1\t10', 'Bank2\tBig Shield\t3\t1\t10'].join('\n')
    )
    const pieces = ownedPieces(inv, (it) => {
      const c = byTitle.get(it.name.toLowerCase())
      return c ? { r: restrictions(c.statsblock), stats: parseStatsBlock(c.statsblock), foci: [c.focus].filter(Boolean), lore: isLore(c.statsblock) } : null
    })
    const plan = optimizeGear({ pieces, wearer: { classes: ['shm'], race: '', level: 50 }, weights: acOnly, twoHanders: false, focusValue: (n) => focusValue(worth, n) })
    const worn = (slot: string) => plan.after.filter((_, i) => plan.slots[i] === slot).map((p) => p?.item.name ?? null)
    // The shield takes the empty Secondary; both belts and the charm share the waist and the Any slots.
    expect(worn('Secondary')).toEqual(['Big Shield'])
    expect([...worn('Waist'), ...worn('Any Slot')].sort()).toEqual(['Drakescale Belt', 'Plain Belt', 'Tiny Charm'])
    expect(plan.focusAfter - plan.focusBefore).toBe(300)
    expect(plan.slotScoreAfter.reduce((a, b) => a + b, 0)).toBe(25 + 10 + 5 + 1)
  })
})
