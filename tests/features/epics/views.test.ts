import { describe, expect, it } from 'vitest'
import { emptyEpicCharacter, EPIC_CLASSES, everyStep, stepName, type EpicState } from '../../../src/features/epics/core'
import { ANYWHERE, classViews, everyView, filterViews, held, itemRows, NO_FILTER, pickClasses, stepMatch, targets, type StepView } from '../../../src/features/epics/views'

// What Goals › Epics draws from a character's state: the counts from either source, which steps are
// done and why, what the classes shown want of a shared item, and the Targets and Items lists.

const state = (p: Partial<EpicState> = {}): EpicState => ({
  character: 'Kelwyn_neriak',
  ...emptyEpicCharacter(),
  logged: {},
  last: {},
  classes: ['Shadow Knight'],
  exported: null,
  ...p
})
const exported = (counts: Record<string, number>) => ({ file: 'Kelwyn_neriak-Inventory.txt', modified: 1, counts })
const classes = (...names: string[]) => names.map((n) => EPIC_CLASSES.find((c) => c.cls === n)!)
const find = (views: readonly StepView[], name: string): StepView => everyView(views).find((v) => v.name === name)!

describe('the counts', () => {
  it('come from the log, the inventory export, or the higher of the two; without an export, the log', () => {
    const s = state({ logged: { ghoulbane: 1 }, adjust: { ghoulbane: 1 }, exported: exported({ ghoulbane: 3 }) })
    expect(['both', 'log', 'export'].map((f) => held(s, 'Ghoulbane', f as 'both'))).toEqual([3, 2, 3])
    expect(held(state({ logged: { ghoulbane: 1 } }), 'Ghoulbane', 'export')).toBe(1)
  })
})

describe('a class’s steps', () => {
  it('are done once held as many as they take, and a reward in hand covers what makes it', () => {
    const [sk] = classViews(classes('Shadow Knight'), state({ logged: { 'decayed chainmail': 1, 'darkforge greaves': 1 } }), 'log')
    expect(sk.finished).toBeNull()
    const chainmail = find(sk.steps, 'Decayed Chainmail')
    expect(chainmail).toMatchObject({ have: 1, need: 1, enough: true, done: true, covered: null, ticked: false, depth: 1 })
    expect(find(sk.steps, 'Decayed Breastplate')).toMatchObject({ have: 0, need: 1, enough: false, done: false })
    // The Greaves in hand: its Decayed pieces and Melatite are covered, and wanted no more.
    expect(find(sk.steps, 'Darkforge Greaves')).toMatchObject({ enough: true, done: true, covered: null })
    expect(find(sk.steps, 'Decayed Left Legplate')).toMatchObject({ done: true, covered: 'Darkforge Greaves in hand', need: 0 })
    expect(find(sk.steps, 'Melatite')).toMatchObject({ done: true, need: 0 })
    // Three pieces done of the Shadow Knight's: the chainmail and the two under the Greaves... and the Melatite.
    expect(sk.done).toBe(4)
    expect(sk.pieces).toBe(everyStep(sk.epic ? classes('Shadow Knight')[0].steps : []).filter((s) => !s.parts.length).length)
  })

  it('want every step’s share of an item: the Shadow Knight’s bars are two for the Breastplate and one for the Sheath', () => {
    const [sk] = classViews(classes('Shadow Knight'), state({ logged: { 'enchanted platinum bar': 2 } }), 'log')
    const bars = everyView(sk.steps).filter((v) => v.name === 'Enchanted Platinum Bar')
    expect(bars.map((b) => [b.step.qty, b.need, b.have, b.enough, b.shared])).toEqual([
      [2, 3, 2, false, true],
      [1, 3, 2, false, true]
    ])
    // The Sheath ticked off: its bar is wanted no more, so two are enough for the Breastplate.
    const [ticked] = classViews(classes('Shadow Knight'), state({ logged: { 'enchanted platinum bar': 2 }, ticks: ['Shadow Knight|Decrepit Sheath'] }), 'log')
    expect(find(ticked.steps, 'Decrepit Sheath')).toMatchObject({ ticked: true, done: true, need: 0 })
    expect(find(ticked.steps, 'Drake Spine')).toMatchObject({ done: true, covered: 'Decrepit Sheath ticked off' })
    expect(everyView(ticked.steps).filter((v) => v.name === 'Enchanted Platinum Bar')[0]).toMatchObject({ need: 2, enough: true, done: true, shared: false })
  })

  it('cover a chain: the Corrupted Ghoulbane in hand covers the Sheath and what makes it', () => {
    const [sk] = classViews(classes('Shadow Knight'), state({ exported: exported({ 'corrupted ghoulbane': 1 }) }), 'both')
    expect(find(sk.steps, 'Corrupted Ghoulbane')).toMatchObject({ done: true, enough: true })
    expect(find(sk.steps, 'Decrepit Sheath')).toMatchObject({ done: true, covered: 'Corrupted Ghoulbane in hand' })
    expect(find(sk.steps, 'Drake Spine')).toMatchObject({ done: true, covered: 'Corrupted Ghoulbane in hand' })
    expect(find(sk.steps, 'Decayed Helm').done).toBe(false)
  })

  it('are all covered once the finished epic is in hand', () => {
    const [sk] = classViews(classes('Shadow Knight'), state({ logged: { 'innoruuks curse': 1 } }), 'log')
    expect(sk.finished).toBe("Innoruuk's Curse")
    expect(everyView(sk.steps).every((v) => v.done && v.covered === "Innoruuk's Curse in hand")).toBe(true)
    expect(sk).toMatchObject({ done: sk.pieces, near: 1 })
    // A Ranger's is either of two.
    const [ranger] = classViews(classes('Ranger'), state({ logged: { swiftwind: 1 } }), 'log')
    expect(ranger.finished).toBe('Swiftwind')
  })

  it('want a shared item for each class shown: one Shining Metallic Robes is half of what an Enchanter and a Rogue want', () => {
    const s = state({ logged: { 'shining metallic robes': 1 } })
    const [ench, rogue] = classViews(classes('Enchanter', 'Rogue'), s, 'log')
    expect(find(ench.steps, 'Shining Metallic Robes')).toMatchObject({ have: 1, need: 2, shared: true, enough: false, done: false })
    expect(find(rogue.steps, 'Shining Metallic Robes')).toMatchObject({ have: 1, need: 2, shared: true, done: false })
    // The Enchanter alone: enough.
    const [alone] = classViews(classes('Enchanter'), s, 'log')
    expect(find(alone.steps, 'Shining Metallic Robes')).toMatchObject({ need: 1, shared: false, enough: true, done: true })
  })

  it('count a class with nothing to gather as done', () => {
    const [bst] = classViews(classes('Beastlord'), state(), 'log')
    expect(bst).toMatchObject({ steps: [], pieces: 0, done: 0, near: 1, finished: null })
  })
})

describe('the filter', () => {
  it('picks the character’s classes, every class, or one; every class when the character has none', () => {
    expect(pickClasses({ cls: 'mine' }, ['Monk', 'Bard']).map((c) => c.cls)).toEqual(['Bard', 'Monk'])
    expect(pickClasses({ cls: 'mine' }, [])).toHaveLength(16)
    expect(pickClasses({ cls: 'all' }, ['Monk'])).toHaveLength(16)
    expect(pickClasses({ cls: 'Rogue' }, ['Monk']).map((c) => c.cls)).toEqual(['Rogue'])
  })

  it('finds a step by every word typed, in its name, how, zone or note', () => {
    const vox = everyStep(classes('Bard')[0].steps).find((s) => s.item === 'White Dragon Scales')!
    expect(['', 'white scales', 'lady vox', 'permafrost', 'raid'].map((t) => stepMatch(vox, t))).toEqual([true, true, true, true, true])
    expect(stepMatch(vox, 'vox nagafen')).toBe(false)
  })

  it('keeps a step whose parts match, and hides what is done when asked', () => {
    const [sk] = classViews(classes('Shadow Knight'), state({ logged: { 'decayed chainmail': 1 } }), 'log')
    const bars = filterViews(sk.steps, { ...NO_FILTER, text: 'platinum' })
    expect(bars.map((v) => v.name)).toEqual(['Darkforge Breastplate', 'Corrupted Ghoulbane'])
    expect(bars[0].parts.map((v) => v.name)).toEqual(['Enchanted Platinum Bar'])
    expect(bars[1].parts[0].parts.map((v) => v.name)).toEqual(['Enchanted Platinum Bar'])
    const left = filterViews(sk.steps, { ...NO_FILTER, hideDone: true })
    expect(everyView(left).map((v) => v.name)).not.toContain('Decayed Chainmail')
    expect(everyView(left).map((v) => v.name)).toContain('Decayed Breastplate')
    expect(filterViews(sk.steps, { ...NO_FILTER, text: 'no such thing' })).toEqual([])
  })
})

describe('the Targets', () => {
  it('list each piece not done under its zone, with every class that wants it, the fullest zone first and Anywhere last', () => {
    const list = targets(classViews(classes('Paladin', 'Shadow Knight'), state({ logged: { 'decayed chainmail': 1 } }), 'log'))
    const cazic = list.find((t) => t.zone === 'Temple of Cazic-Thule')!
    expect(list[0]).toBe(cazic)
    expect(cazic.rows.map((r) => r.name)).toEqual(['Decayed Breastplate', 'Decayed Helm', 'Decayed Left Legplate', 'Decayed Right Legplate', 'Decayed Visor'])
    const guk = list.find((t) => t.zone === 'Upper Guk')!
    expect(guk.rows).toEqual([{ name: 'Ghoulbane', how: 'Kill The froglok shin lord', have: 0, need: 2, classes: ['Paladin', 'Shadow Knight'], unverified: false }])
    expect(list[list.length - 1].zone).toBe(ANYWHERE)
    expect(list.find((t) => t.zone === 'Rathe Mountains')!.rows[0]).toMatchObject({ name: 'Drake Spine', unverified: true })
    // A quest step is never a target: its pieces are.
    expect(list.flatMap((t) => t.rows.map((r) => r.name))).not.toContain('Darkforge Breastplate')
  })

  it('are empty once everything is in hand', () => {
    expect(targets(classViews(classes('Bard'), state({ logged: { 'singing short sword': 1 } }), 'log'))).toEqual([])
  })
})

describe('the Items', () => {
  it('list every item once with who takes it, the finished epics last', () => {
    const rows = itemRows()
    const robes = rows.find((r) => r.name === 'Shining Metallic Robes')!
    expect(robes).toEqual({ name: 'Shining Metallic Robes', how: 'Kill The ghoul arch magi', zone: 'Lower Guk', classes: ['Enchanter', 'Rogue'], kind: 'piece' })
    const bars = rows.filter((r) => r.name === 'Enchanted Platinum Bar')
    expect(bars).toHaveLength(1)
    expect(rows[rows.length - 1].kind).toBe('epic')
    expect(rows.find((r) => r.name === 'Swiftwind')).toMatchObject({ kind: 'epic', classes: ['Ranger'] })
    expect(rows.filter((r) => r.kind === 'epic').map((r) => r.name)).toContain("Innoruuk's Curse")
    expect(stepName(classes('Druid')[0].steps[0])).toBe('Cleansed Spirit of Antonica')
  })
})
