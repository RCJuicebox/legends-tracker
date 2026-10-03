import { describe, expect, it } from 'vitest'
import { bestInTheRound, judgeInTheRound, planTotal } from '../../src/core/finderRound'
import { optimizeGear, ownedPieces, pieceName, SLOT_LAYOUT } from '../../src/core/gearOptimizer'
import { decodePlan, encodePlan, judgeRound, optionsOf, type GearInput, type RoundAsk } from '../../src/core/gearWork'
import { focusValue, type FocusInfo, type FocusWorth } from '../../src/core/itemFocus'
import { isLore, restrictions, type Weights } from '../../src/core/gearFinder'
import { parseInventory, parseStatsBlock } from '../../src/core/inventory'
import { parseItemPage } from '../../src/core/wikiItem'
import { PRESETS } from '../helpers'

const page = (name: string, block: string) =>
  `{{Classic Era}}\n<onlyinclude>{{Itempage\n|itemname    = ${name}\n|lucy_img_ID = 600\n|statsblock  = \n${block}\n|dropsfrom = \n\n[[Nagafen's Lair]]\n\n}}</onlyinclude>`
const item = (name: string, block: string) => parseItemPage(name, page(name, block))!

// Two rings and a tunic worn, a breastplate in the bags, and two exaltations in Storage: the work as
// the gear worker gets it (cloned, as a message is) must come back as the page's own pieces.
const catalog = [
  item('Plain Ring', 'Slot: FINGER<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Other Ring', 'Slot: FINGER<br>\nAC: 4<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Cloth Tunic', 'Slot: CHEST<br>\nAC: 5<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Indicolite Breastplate', 'Slot: CHEST<br>\nAC: 40<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Moonstone Ring', 'Slot: FINGER<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Mithril-Runed Tunic', 'Slot: CHEST<br>\nAC: 1<br>\nClass: ALL<br>\nRace: ALL<br>'),
  item('Big Ring', 'Slot: FINGER<br>\nAC: 50<br>\nClass: ALL<br>\nRace: ALL<br>')
]
const byName = new Map(catalog.map((c) => [c.title, c]))
const inv = parseInventory(
  [
    'Location\tName\tID\tCount\tSlots',
    'Fingers\tPlain Ring\t1\t1\t10',
    'Fingers\tOther Ring\t2\t1\t10',
    'Chest\tCloth Tunic\t3\t1\t10',
    'General 1-Slot1\tIndicolite Breastplate\t4\t1\t10',
    'KeyRing\tName\tID\t',
    'Augmentation\tMoonstone Ring (Exaltation)\t10150\t1\t0',
    'Augmentation\tMithril-Runed Tunic (Exaltation)\t2405\t1\t0'
  ].join('\n')
)
const base = (name: string) => byName.get(name.replace(/ \(Exaltation\)$/, ''))!
const pieces = ownedPieces(inv, (it) => {
  const c = base(it.name)
  return { r: restrictions(c.statsblock), stats: parseStatsBlock(c.statsblock), foci: [], lore: isLore(c.statsblock) }
})
const focusOf: Record<string, string> = { 'Moonstone Ring': 'Extended Range II', 'Mithril-Runed Tunic': 'Spell Haste II' }
const exaltations = inv.keyRing.map((k) => ({
  item: { location: 'Storage', name: k.name, id: k.id, count: 1, augs: [] },
  from: 'storage' as const,
  focus: focusOf[k.name.replace(/ \(Exaltation\)$/, '')],
  r: restrictions(base(k.name).statsblock)
}))
const focus = (name: string, line: string, kind: FocusInfo['kind']): FocusInfo => ({ name, line, kind, pct: 10, maxLevel: 65, decayPct: 0, eff: 10, on: { Heal: 10 } })
const worth: FocusWorth = {
  points: 100,
  wanted: new Set(['Spell Haste', 'Extended Range']),
  foci: { 'Spell Haste II': focus('Spell Haste II', 'Spell Haste', 'haste'), 'Extended Range II': focus('Extended Range II', 'Extended Range', 'range') },
  shares: { Heal: 1 }
}
const weights: Weights = { ...PRESETS.Balanced, ac: 1, hp: 0, mana: 0, end: 0, str: 0, sta: 0, agi: 0, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 0, attack: 0, ratio: 0 }
const input: GearInput = { pieces, exaltations, wearer: { classes: ['shm'], race: '', level: 50 }, weights, twoHanders: false, hands: null, worth, effects: null }

/** What the worker does with a message: works on a clone, and answers with places. */
const throughWorker = (i: GearInput) => {
  const copy = structuredClone(i)
  return decodePlan(structuredClone(encodePlan(optimizeGear(optionsOf(copy)), copy.pieces, copy.exaltations)), i.pieces, i.exaltations)
}

describe('the gear worker’s plans', () => {
  it('come back as the page’s own pieces, exalted copies included', () => {
    const onPage = optimizeGear({ ...optionsOf(input) })
    const fromWorker = throughWorker(input)
    // The same objects, not lookalikes: the page finds pieces in a plan by identity.
    expect(fromWorker.after).toEqual(onPage.after)
    fromWorker.after.forEach((p, i) => expect(p).toBe(onPage.after[i]))
    fromWorker.before.forEach((p, i) => expect(p).toBe(onPage.before[i]))
    expect(planTotal(fromWorker)).toBeCloseTo(planTotal(onPage), 6)
    const names = fromWorker.after.flatMap((p) => (p ? [pieceName(p)] : []))
    expect(names).toContain('Indicolite Breastplate with Mithril-Runed Tunic (Exaltation)')
  })

  it('build the focus worth from the data, as the page does', () => {
    expect(optionsOf(input).focusValue(['Spell Haste II'])).toBe(focusValue(worth, ['Spell Haste II']))
    expect(optionsOf({ ...input, worth: null }).focusValue(['Spell Haste II'])).toBe(0)
  })

  it('keep locks by their place in the list', () => {
    const tunic = pieces.findIndex((p) => p.item.name === 'Cloth Tunic')
    const chest = SLOT_LAYOUT.indexOf('Chest')
    const plan = throughWorker({ ...input, locks: [{ slot: chest, piece: tunic }] })
    expect(plan.locked).toEqual([chest])
    expect(plan.after[chest]?.host ?? plan.after[chest]).toBe(pieces[tunic])
  })
})

describe('judging in the round in the worker', () => {
  const big = catalog.find((c) => c.title === 'Big Ring')!
  const candidate = {
    item: big,
    stats: parseStatsBlock(big.statsblock),
    score: 50,
    delta: 46,
    diffs: [],
    owned: false,
    era: 'Classic',
    eraInferred: false,
    focus: null
  }
  const asks: RoundAsk[] = [{ slot: 'Fingers', candidates: [candidate] }]

  it('answers as judging each on the page would, with one search’s worth kept for the next', async () => {
    const answers = await judgeRound(input, asks, () => true)
    const opts = optionsOf(input)
    const baseline = optimizeGear({ ...opts, locks: undefined })
    const expected = bestInTheRound([judgeInTheRound(candidate, 'Fingers', { ...opts, locks: undefined }, baseline)])
    expect(answers).toEqual([expected.map((c) => ({ k: 0, round: c.round }))])
    expect(answers![0][0].round.delta).toBeGreaterThan(0)
  })

  it('stops when a newer ask overtakes it', async () => {
    expect(await judgeRound(input, asks, () => false)).toBeNull()
  })
})
