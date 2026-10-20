import { describe, expect, it } from 'vitest'
import { emptySkyCharacter, SKY_QUESTS, type SkyState } from '../../../src/features/sky/core'
import { ANY_MOB, classRows, cleanupRows, ELSEWHERE, held, NO_FILTER, passes, questView, skyFacets, sortViews, targets, turnInOf } from '../../../src/features/sky/views'

// What Plan › Plane of Sky draws from a character's state: the counts from either source, how a Test
// is known handed in, the filters and orders, and the Targets, Cleanup and Classes lists.

const state = (p: Partial<SkyState> = {}): SkyState => ({
  character: 'Kelwyn_neriak',
  ...emptySkyCharacter(),
  logged: {},
  last: {},
  runs: {},
  classes: ['Monk'],
  exported: null,
  achieved: null,
  respawns: {},
  ...p
})
const quest = (name: string) => SKY_QUESTS.find((q) => q.name === name)!
const FISTS = 'Monk Test of Fists'
const CLAW = 'Beastlord Test of Claw'
const exported = (counts: Record<string, number>) => ({ file: 'Kelwyn_neriak-Inventory.txt', modified: 1, counts })

describe('the counts', () => {
  it('come from the log, the inventory export, or the higher of the two; without an export, the log', () => {
    const s = state({ logged: { 'nebulous sapphire': 1, 'wind rune neza': 4 }, exported: exported({ 'nebulous sapphire': 3 }) })
    expect(['both', 'log', 'export'].map((f) => held(s, 'Nebulous Sapphire', f as 'both'))).toEqual([3, 1, 3])
    // The export lists no currency tab: the runes are the log's under "both".
    expect(['both', 'log', 'export'].map((f) => held(s, 'Wind Rune Neza', f as 'both'))).toEqual([4, 4, 0])
    expect(held(state({ logged: { 'nebulous sapphire': 1 } }), 'Nebulous Sapphire', 'export')).toBe(1)
  })
})

describe('a hand-in', () => {
  it('is known from the log, the player, the reward in the export or the achievements export', () => {
    const q = quest(FISTS)
    expect(turnInOf(q, state())).toMatchObject({ count: 0, any: false })
    expect(turnInOf(q, state({ runs: { [FISTS]: [1, 2] }, turnIns: { [FISTS]: -1 } }))).toMatchObject({ log: 2, hand: -1, count: 1, any: true })
    expect(turnInOf(q, state({ exported: exported({ 'wus fist of mastery': 1 }) }))).toMatchObject({ count: 0, reward: true, any: true })
    expect(turnInOf(q, state({ achieved: { modified: 1, obtained: [FISTS], unlocked: {}, granted: [] } }))).toMatchObject({ achievement: true, any: true })
  })
})

describe('the Tests tab', () => {
  const s = state({
    logged: { 'nebulous sapphire': 1 },
    last: { 'nebulous sapphire': 50, 'wind rune caza': 90 },
    favorites: [FISTS],
    ignored: ['Monk Test of Sight'],
    runs: { 'Monk Test of Speed': [1] }
  })
  const views = SKY_QUESTS.map((q) => questView(q, s, 'log'))
  const names = (f: Partial<typeof NO_FILTER>) => views.filter((v) => passes(v, { ...NO_FILTER, ...f }, s.classes)).map((v) => v.quest.name)

  it('filters by class, island, mob, words and the boxes, and never shows the ignored', () => {
    expect(names({ cls: 'mine' })).toEqual(['Monk Test of Strength', 'Monk Test of Speed', 'Monk Test of Tears', FISTS, 'Monk Test of Tranquility'])
    expect(names({ cls: 'Monk', island: 7 })).toEqual([FISTS])
    expect(names({ mob: 'Sister of the Spire', text: 'monk' })).toEqual([FISTS])
    expect(names({ cls: 'Monk', favoritesOnly: true })).toEqual([FISTS])
    expect(names({ cls: 'Monk', onlyTurnedIn: true })).toEqual(['Monk Test of Speed'])
    expect(names({ cls: 'Monk', hideTurnedIn: true })).not.toContain('Monk Test of Speed')
    // Brass Knuckles drops on island 8 too.
    expect(names({ text: 'island 8 monk' })).toEqual([FISTS, 'Monk Test of Tranquility'])
    // Show ignored lets the ignored through the filter, among the rest.
    expect(names({ cls: 'Monk' })).not.toContain('Monk Test of Sight')
    expect(views.filter((v) => passes(v, { ...NO_FILTER, cls: 'Monk' }, s.classes, true)).map((v) => v.quest.name)).toContain('Monk Test of Sight')
  })

  it('orders by what was looted last, by island, or as the wiki lists them', () => {
    const monk = views.filter((v) => v.quest.cls === 'Monk')
    expect([...monk].sort(sortViews('recent')).map((v) => v.quest.name)[0]).toBe('Monk Test of Strength')
    expect([...monk].sort(sortViews('island')).map((v) => v.quest.items[0].drops[0].island)).toEqual([3, 4, 5, 6, 7, 8])
    expect([...monk].sort(sortViews('class'))).toEqual(monk)
  })

  it('says what a Test shares with others, and lists the islands and mobs', () => {
    const claw = views.find((v) => v.quest.name === CLAW)!
    expect(claw.shared.map((x) => x.item)).toEqual(['Sphinx Claw', 'Mithril Bands', 'Brass Knuckles'])
    const facets = skyFacets()
    expect(facets.islands).toEqual([1.5, 2, 3, 4, 5, 6, 7, 8])
    expect(facets.mobs.map((m) => m.mob)).toContain('The Hand of Veeshan')
    expect(facets.mobs[0]).toEqual({ mob: 'Noble Dojorn', island: 1.5 })
  })
})

describe('the other tabs', () => {
  it('Targets: each item missing once, by mob, the runes first and what is from elsewhere last', () => {
    const s = state({ logged: { 'wind rune neza': 1 } })
    const t = targets([FISTS, CLAW].map((n) => questView(quest(n), s, 'log')))
    expect(t[0].mob).toBe(ANY_MOB)
    expect(t.some((x) => x.mob === ELSEWHERE)).toBe(false)
    // Brass Knuckles drops from three mobs: under each, with the others named.
    const under = t.filter((x) => x.items.some((i) => i.item.name === 'Brass Knuckles')).map((x) => [x.mob, x.island])
    expect(under).toEqual([
      ['Noble Dojorn', 1.5],
      ['Overseer of Air', 4],
      ['The Hand of Veeshan', 8]
    ])
    const knuckles = t.find((x) => x.mob === 'Overseer of Air')!.items.find((i) => i.item.name === 'Brass Knuckles')!
    expect(knuckles).toMatchObject({ have: 0, need: 2, tests: [FISTS, CLAW], also: ['Noble Dojorn', 'The Hand of Veeshan'] })
    // The rune for Fists is held: only Claw's is missing.
    expect(t[0].items.map((i) => i.item.name)).toEqual(['Wind Rune Izah'])
  })

  it('Cleanup: what every Test taking it was handed in for and no wish wants; a whole set says keep', () => {
    const spare = state({ logged: { 'silken strands': 2 }, runs: { 'Monk Test of Strength': [1] } })
    expect(cleanupRows(spare, 'log').map((r) => [r.item.name, r.have, r.keep])).toEqual([['Silken Strands', 2, false]])
    const set = state({ logged: { 'silken strands': 1, 'wind rune caza': 1 }, runs: { 'Monk Test of Strength': [1] } })
    // Its rune is taken by a Test not handed in too: not spare.
    expect(cleanupRows(set, 'log').map((r) => [r.item.name, r.keep])).toEqual([['Silken Strands', true]])
    expect(cleanupRows({ ...set, wishes: [{ quest: 'Monk Test of Strength', want: 2, since: 0 }] }, 'log')).toEqual([])
    // A Test not handed in still wants it.
    expect(cleanupRows(state({ logged: { 'brass knuckles': 1 }, runs: { [FISTS]: [1] } }), 'log')).toEqual([])
  })

  it('Classes: the export’s word on an unlock, else every Test handed in', () => {
    const monk = SKY_QUESTS.filter((q) => q.cls === 'Monk').map((q) => q.name)
    const rows = classRows(
      state({ runs: Object.fromEntries(monk.map((n) => [n, [1]])), achieved: { modified: 1, obtained: [], unlocked: { Bard: true, Cleric: false }, granted: ['Bard'] } })
    )
    const row = (c: string) => rows.find((r) => r.cls === c)!
    expect(row('Monk')).toMatchObject({ turnedIn: 6, tests: 6, unlocked: true, from: 'tests' })
    expect(row('Bard')).toMatchObject({ unlocked: true, from: 'export', granted: true })
    expect(row('Cleric')).toMatchObject({ unlocked: false, from: 'export' })
    expect(row('Wizard')).toMatchObject({ turnedIn: 0, unlocked: null, from: null })
  })
})
