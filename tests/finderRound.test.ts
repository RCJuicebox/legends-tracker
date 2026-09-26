import { describe, expect, it } from 'vitest'
import { candidatePiece, inTheRound, planTotal } from '../src/core/finderRound'
import { optimizeGear, ownedPieces } from '../src/core/gearOptimizer'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { findUpgrades, isLore, PRESETS, restrictions, type Weights } from '../src/core/upgrades'
import { parseItemPage } from '../src/core/wikiItem'

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
  const acOnly: Weights = { ...PRESETS.Balanced, ac: 1, hp: 0, mana: 0, end: 0, str: 0, sta: 0, agi: 0, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 0, attack: 0, hpRegen: 0, manaRegen: 0, endRegen: 0, ratio: 0 }
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

  it('gains the whole 30 AC once the focus belt moves to the free Any slot and keeps its focus', () => {
    const baseline = optimizeGear(opts)
    // Nothing to gain by moving what is owned: the baseline is what is worn.
    expect(planTotal(baseline)).toBe(5 + 1 + 450)
    const big = candidatePiece(byName.get('Big Belt')!, parseStatsBlock(byName.get('Big Belt')!.statsblock))
    const r = inTheRound({ ...opts, candidate: big, baseline })
    // The focus belt's own 5 AC stays worn too, in the Any slot, so the set gains the belt's full 30.
    expect(r.delta).toBe(30)
    expect(r.placed).toBe('Waist')
    const where = (name: string) => r.moves.find((m) => m.in?.item.name === name)?.slot
    expect(where('Big Belt')).toBe('Waist')
    expect(where('Focus Belt')).toBe('Any Slot')
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
