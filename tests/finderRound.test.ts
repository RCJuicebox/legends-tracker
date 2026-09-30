import { describe, expect, it } from 'vitest'
import { candidatePiece, inTheRound, ownedInTheRound, planTotal } from '../src/core/finderRound'
import { optimizeGear, ownedPieces } from '../src/core/gearOptimizer'
import { itemKey, mergeLevel, parseInventory, parseStatsBlock, scaledStats } from '../src/core/inventory'
import { findUpgrades, isLore, restrictions, type Weights } from '../src/core/upgrades'
import { parseItemPage } from '../src/core/wikiItem'
import { PRESETS } from './helpers'

const page = (name: string, block: string, focus = '') =>
  `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 600\n|statsblock  = \n${block}\n${focus ? `|focus_effect = ${focus}\n` : ''}|dropsfrom = \n\n[[Nagafen's Lair]]\n\n}}</onlyinclude>`
const item = (name: string, block: string, focus = '') => parseItemPage(name, page(name, block, focus))!

describe('a candidate judged in the round', () => {
  // Worn: a weak belt that carries the focus wanted, and one Any slot free. The candidate belt has
  // far better stats but no focus. Slot by slot it loses the focus and is no upgrade; in the round
  // the focus belt moves to the free Any slot and nothing is lost.
  const catalog = [
    item('Focus Belt', 'Slot: WAIST<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>', 'Extended Enhancement III'),
    item('Tiny Charm', 'Slot: CHARM<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Big Belt', 'Slot: WAIST<br>\nAC: 30<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const inv = parseInventory(['Location\tName\tID\tCount\tSlots', 'Waist\tFocus Belt\t1\t1\t10', 'Any Slot\tTiny Charm\t2\t1\t10'].join('\n'))
  const acOnly: Weights = {
    ...PRESETS.Balanced,
    ac: 1,
    hp: 0,
    mana: 0,
    end: 0,
    str: 0,
    sta: 0,
    agi: 0,
    dex: 0,
    wis: 0,
    int: 0,
    cha: 0,
    resists: 0,
    haste: 0,
    attack: 0,
    hpRegen: 0,
    manaRegen: 0,
    endRegen: 0,
    ratio: 0
  }
  const focusValue = (names: string[]) => (names.includes('Extended Enhancement III') ? 450 : 0)
  const wearer = { classes: ['shm'], race: '', level: 50 }
  const pieces = ownedPieces(inv, (it) => {
    const c = byName.get(it.name)
    return c ? { r: restrictions(c.statsblock), stats: parseStatsBlock(c.statsblock), foci: c.focus ? [c.focus] : [], lore: isLore(c.statsblock) } : null
  })
  const opts = { pieces, wearer, weights: acOnly, twoHanders: false, focusValue }

  it('is rejected slot by slot, since replacing the focus belt loses the focus', () => {
    const waist = findUpgrades({
      worn: inv.worn,
      statsOf: (it) => parseStatsBlock(byName.get(it.name)!.statsblock),
      catalog,
      wearer,
      weights: acOnly,
      compare: 'drop',
      hiddenEras: [],
      owned: new Set(),
      focus: { worn: (it) => [byName.get(it.name)?.focus].filter((f): f is string => !!f), value: focusValue }
    }).find((s) => s.slot === 'Waist')!
    expect(waist.current?.focusLoss).toBe(450)
    expect(waist.candidates.map((c) => c.item.title)).not.toContain('Big Belt')
    // Asked to keep them, the finder hands the stat winners over for judging in the round.
    const kept = findUpgrades({
      worn: inv.worn,
      statsOf: (it) => parseStatsBlock(byName.get(it.name)!.statsblock),
      catalog,
      wearer,
      weights: acOnly,
      compare: 'drop',
      hiddenEras: [],
      owned: new Set(),
      keepStatWinners: true,
      focus: { worn: (it) => [byName.get(it.name)?.focus].filter((f): f is string => !!f), value: focusValue }
    }).find((s) => s.slot === 'Waist')!
    expect(kept.candidates.map((c) => c.item.title)).toContain('Big Belt')
    expect(kept.candidates.find((c) => c.item.title === 'Big Belt')!.delta).toBe(25 - 450)
  })

  it('gains the whole 30 AC in the free Any slot, the focus belt kept where it is', () => {
    const baseline = optimizeGear(opts)
    // Nothing to gain by moving what is owned: the baseline is what is worn.
    expect(planTotal(baseline)).toBe(5 + 1 + 450)
    const big = candidatePiece(byName.get('Big Belt')!, parseStatsBlock(byName.get('Big Belt')!.statsblock))
    const r = inTheRound({ ...opts, candidate: big, baseline })
    // The focus belt's own 5 AC and its focus stay worn, so the set gains the belt's full 30. Wearing it
    // at the waist and moving the focus belt to the Any slot gains the same; the one move is kept.
    expect(r.delta).toBe(30)
    expect(r.placed).toBe('Any Slot')
    expect(r.moves.map((m) => [m.slot, m.out?.item.name ?? null, m.in?.item.name])).toEqual([['Any Slot', null, 'Big Belt']])
  })

  it('finds no place for a candidate that adds nothing', () => {
    const baseline = optimizeGear(opts)
    // Even the free Any slot gains nothing from a belt with no stats.
    const dud = candidatePiece(item('Dud Belt', 'Slot: WAIST<br>\nClass: ALL<br>\nRace: ALL<br>'), parseStatsBlock('Slot: WAIST<br>'))
    const r = inTheRound({ ...opts, candidate: dud, baseline })
    expect(r.delta).toBe(0)
    expect(r.placed).toBeNull()
    expect(r.moves).toEqual([])
  })
})

describe('an item the character owns, in the finder and the optimiser', () => {
  // Pauldrons +6 worn (16 AC), charms filling both Any slots. In the bank: Wraps +0 (12 AC, 19 at +6)
  // and a Mantle +0 (20 AC). The finder at "your merge level" used to judge the Wraps as a +6 copy and
  // call them an upgrade the optimiser never makes; now it judges the copy owned, as the optimiser does.
  const catalog = [
    item('Pauldrons', 'Slot: SHOULDERS<br>\nAC: 10<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Wraps', 'Slot: SHOULDERS<br>\nAC: 12<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Mantle', 'Slot: SHOULDERS<br>\nAC: 20<br>\nClass: ALL<br>\nRace: ALL<br>'),
    item('Big Charm', 'Slot: CHARM<br>\nAC: 50<br>\nClass: ALL<br>\nRace: ALL<br>')
  ]
  const byName = new Map(catalog.map((c) => [c.title, c]))
  const inv = parseInventory(
    [
      'Location\tName\tID\tCount\tSlots',
      'Shoulders\tPauldrons +6\t1\t1\t10',
      'Any Slot\tBig Charm\t4\t1\t10',
      'Any Slot\tBig Charm\t5\t1\t10',
      'Bank1\tWraps\t2\t1\t10',
      'Bank2\tMantle\t3\t1\t10'
    ].join('\n')
  )
  const statsOf = (name: string) => scaledStats(parseStatsBlock(byName.get(name.replace(/ \+\d+$/, ''))!.statsblock), mergeLevel(name))
  const pieces = ownedPieces(inv, (it) => {
    const c = byName.get(it.name.replace(/ \+\d+$/, ''))!
    return { r: restrictions(c.statsblock), stats: statsOf(it.name), foci: [], lore: isLore(c.statsblock) }
  })
  const acOnly: Weights = {
    ...PRESETS.Balanced,
    ac: 1,
    hp: 0,
    mana: 0,
    end: 0,
    str: 0,
    sta: 0,
    agi: 0,
    dex: 0,
    wis: 0,
    int: 0,
    cha: 0,
    resists: 0,
    haste: 0,
    attack: 0,
    hpRegen: 0,
    manaRegen: 0,
    endRegen: 0,
    ratio: 0
  }
  const wearer = { classes: ['shm'], race: '', level: 50 }
  const opts = { pieces, wearer, weights: acOnly, twoHanders: false, focusValue: () => 0 }
  const owned = new Set(['wraps', 'mantle'])
  const shoulders = (ownedStats?: (key: string) => ReturnType<typeof statsOf> | null) =>
    findUpgrades({ worn: inv.worn, statsOf: (it) => statsOf(it.name), catalog, wearer, weights: acOnly, compare: 'level', hiddenEras: [], owned, ownedStats })
      .find((s) => s.slot === 'Shoulders')!
      .candidates.map((c) => c.item.title)

  it('judges an owned candidate as the copy owned, not at the worn merge level', () => {
    expect(shoulders()).toEqual(['Mantle', 'Wraps'])
    expect(shoulders((key) => (key === 'wraps' ? statsOf('Wraps') : key === 'mantle' ? statsOf('Mantle') : null))).toEqual(['Mantle'])
  })

  it('in the round, gives an owned item what the optimiser gains from it, and nothing when it leaves it off', () => {
    const baseline = optimizeGear(opts)
    expect(baseline.after[baseline.slots.indexOf('Shoulders')]?.item.name).toBe('Mantle')
    // The mantle is worth what the optimizer's set loses without it: 20 AC over the Pauldrons' 16.
    const mantle = ownedInTheRound({ ...opts, key: itemKey('Mantle'), baseline })
    expect(mantle.placed).toBe('Shoulders')
    expect(mantle.delta).toBe(4)
    expect(mantle.moves.map((m) => [m.slot, m.out?.item.name, m.in?.item.name])).toEqual([['Shoulders', 'Pauldrons +6', 'Mantle']])
    // The optimiser leaves the Wraps in the bank, so they gain nothing.
    expect(ownedInTheRound({ ...opts, key: itemKey('Wraps'), baseline })).toEqual({ delta: 0, moves: [], placed: null })
  })
})
