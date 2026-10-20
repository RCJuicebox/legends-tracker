import { describe, expect, it } from 'vitest'
import { parseLogLine } from '../../../src/core/logLine'
import { loggedCounts } from '../../../src/core/itemTally'
import {
  emptyEpicCharacter,
  emptyEpicTally,
  EPIC_CLASSES,
  EPIC_LISTS,
  everyStep,
  isEpicItem,
  isTick,
  readEpicLine,
  sanitizeEpicCharacter,
  SPELL_QUESTS,
  stepName,
  tickKey,
  type EpicState
} from '../../../src/features/epics/core'
import { classViews, everyView, itemRows, pickClasses, targets, type StepView } from '../../../src/features/epics/views'
import { dropsOf, lootCue, namedKills, wantedBy } from '../../../src/features/epics/cue'

// Goals › Epics' spell quests: the five class spells a quest gives, as lists like the epics', counted,
// ticked, wanted and cued the same way.

const state = (p: Partial<EpicState> = {}): EpicState => ({
  character: 'Kelwyn_neriak',
  ...emptyEpicCharacter(),
  logged: {},
  last: {},
  classes: ['Shadow Knight'],
  exported: null,
  ...p
})
const spell = (name: string) => SPELL_QUESTS.find((q) => q.key === name)!
const find = (views: readonly StepView[], name: string): StepView => everyView(views).find((v) => v.name === name)!

describe('the spell quests', () => {
  it('are the five, each a class’s, its scroll what finishes it', () => {
    expect(SPELL_QUESTS.map((q) => [q.key, q.cls, q.epic[0]])).toEqual([
      ['Tashania', 'Enchanter', 'Spell: Tashania'],
      ['Ice Comet', 'Wizard', 'Spell: Ice Comet'],
      ['Divine Might', 'Paladin', 'Spell: Divine Might'],
      ['Life Leech', 'Shadow Knight', 'Spell: Life Leech'],
      ['Call of Flame', 'Ranger', 'Spell: Call of Flame']
    ])
    expect(SPELL_QUESTS.every((q) => q.kind === 'spell' && q.spell && q.steps[0].item === q.epic[0])).toBe(true)
    expect(EPIC_CLASSES.every((c) => c.kind === 'epic' && c.key === c.cls)).toBe(true)
    // Every list's key is its own, and every step's name its list's own: the ticks and the rows.
    expect(new Set(EPIC_LISTS.map((c) => c.key)).size).toBe(EPIC_LISTS.length)
    for (const q of SPELL_QUESTS) {
      const names = everyStep(q.steps).map(stepName)
      expect(new Set(names).size).toBe(names.length)
      expect(everyStep(q.steps).every((s) => s.how && s.qty >= 1)).toBe(true)
    }
  })

  it('name the same-named ground spawns by their spot, and count them as the one item', () => {
    const coins = everyStep(spell('Tashania').steps).filter((s) => s.item === 'Old Silver Coin')
    expect(coins.map((s) => s.label)).toEqual(['Azia', 'Beza', 'Caza', 'Dena', 'Ena', 'Fana', 'Geza', 'Heda', 'Izah', 'Jaka'])
    expect(stepName(coins[0])).toBe('Old Silver Coin (Azia)')
    expect(tickKey('Tashania', coins[0])).toBe('Tashania|Old Silver Coin (Azia)')
    expect(isTick('Tashania|Old Silver Coin (Azia)')).toBe(true)
    expect(isTick('Enchanter|Old Silver Coin (Azia)')).toBe(false)
    expect(everyStep(spell('Ice Comet').steps).filter((s) => s.item === 'Rod')).toHaveLength(10)
    expect(['Old Silver Coin', 'Rod', 'Spell: Tashania', 'Crystalline Orb'].every(isEpicItem)).toBe(true)
    expect(sanitizeEpicCharacter({ ticks: ['Tashania|Old Silver Coin (Azia)', 'Tashania|Nothing'] }).ticks).toEqual(['Tashania|Old Silver Coin (Azia)'])
  })

  it('are counted from the log', () => {
    const t = emptyEpicTally()
    for (const raw of ["--You have looted a Crystalline Orb from a stone spider's corpse.--", "--You have looted a Burnt Sash from an imp protector's corpse.--"])
      readEpicLine(parseLogLine(`[Tue Sep 29 22:09:00 2026] ${raw}`)!, t)
    expect(loggedCounts(t)).toEqual({ 'crystalline orb': 1, 'burnt sash': 1 })
  })
})

describe('a spell quest’s steps', () => {
  it('want the ten coins between the ten spots, and the Coin of Tash in hand covers them', () => {
    const [tash] = classViews([spell('Tashania')], state({ logged: { 'old silver coin': 3 } }), 'log')
    const azia = find(tash.steps, 'Old Silver Coin (Azia)')
    expect([azia.have, azia.need, azia.done]).toEqual([3, 10, false])
    expect(tash.pieces).toBe(11)
    const [made] = classViews([spell('Tashania')], state({ logged: { 'coin of tash': 1 } }), 'log')
    expect(find(made.steps, 'Old Silver Coin (Jaka)').covered).toBe('Coin of Tash in hand')
    expect(made.done).toBe(11)
    const [ticked] = classViews([spell('Tashania')], state({ ticks: ['Tashania|Old Silver Coin (Azia)'] }), 'log')
    expect(find(ticked.steps, 'Old Silver Coin (Azia)').done).toBe(true)
    expect(find(ticked.steps, 'Old Silver Coin (Beza)').done).toBe(false)
  })

  it('are all covered once the scroll is in hand', () => {
    const [leech] = classViews([spell('Life Leech')], state({ logged: { 'spell life leech': 1 } }), 'log')
    expect(leech.finished).toBe('Spell: Life Leech')
    expect(leech.near).toBe(1)
  })

  it('count an item with an epic’s when listed together: the Shadow Knight’s three bars and the Paladin’s two', () => {
    const lists = [...pickClasses({ cls: 'mine' }, ['Paladin', 'Shadow Knight'], 'epic'), ...pickClasses({ cls: 'mine' }, ['Paladin', 'Shadow Knight'], 'spell')]
    const views = classViews(lists, state({ logged: { 'enchanted platinum bar': 4 } }), 'log')
    const dm = find(views.find((c) => c.key === 'Divine Might')!.steps, 'Enchanted Platinum Bar')
    expect([dm.have, dm.need, dm.shared, dm.enough]).toEqual([4, 5, true, false])
    expect(find(views.find((c) => c.key === 'Shadow Knight')!.steps, 'Darkforge Breastplate').parts.find((p) => p.name === 'Enchanted Platinum Bar')!.need).toBe(5)
  })
})

describe('the spell quests on the page', () => {
  it('are picked by class like the epics', () => {
    expect(pickClasses({ cls: 'mine' }, ['Enchanter', 'Monk'], 'spell').map((c) => c.key)).toEqual(['Tashania'])
    expect(pickClasses({ cls: 'mine' }, ['Monk'], 'spell')).toEqual([])
    expect(pickClasses({ cls: 'all' }, ['Monk'], 'spell')).toHaveLength(5)
    expect(pickClasses({ cls: 'Ranger' }, [], 'spell').map((c) => c.key)).toEqual(['Call of Flame'])
  })

  it('send the Targets to each coin’s city, named by the quest', () => {
    const list = targets(classViews([spell('Tashania')], state(), 'log'))
    const oggok = list.find((t) => t.zone === 'Oggok')!
    expect(oggok.rows).toEqual([
      {
        name: 'Old Silver Coin (Izah)',
        how: 'Ground spawn',
        have: 0,
        need: 10,
        classes: ['Tashania (Enchanter)'],
        unverified: false,
        note: 'in the lake by the warriors’ guild, north end (109, 101)'
      }
    ])
  })

  it('list their items once, the scrolls after the pieces', () => {
    const rows = itemRows('spell')
    expect(rows.filter((r) => r.name === 'Old Silver Coin')).toEqual([
      { name: 'Old Silver Coin', how: 'Ground spawn', zone: "Ak'Anon", classes: ['Tashania (Enchanter)'], kind: 'piece' }
    ])
    expect(rows.find((r) => r.name === 'Spell: Tashania')).toMatchObject({ kind: 'spell', classes: ['Tashania (Enchanter)'] })
    expect(rows.find((r) => r.name === 'Enchanted Platinum Bar')!.classes).toEqual(['Divine Might (Paladin)'])
    expect(rows.find((r) => r.name === 'Ghoulbane')).toBeUndefined()
  })
})

describe('the spell quests’ cue', () => {
  it('names the quest and what the piece makes', () => {
    const w = wantedBy(state(), 'Crystalline Orb')
    expect(w).toEqual([{ cls: 'Shadow Knight', spell: 'Life Leech', forWhat: 'Faceted Hyacinth Telesm', epic: false }])
    expect(lootCue('Crystalline Orb', w)).toBe('Crystalline Orb dropped: Shadow Knight’s Life Leech quest, for the Faceted Hyacinth Telesm')
    expect(wantedBy(state({ ticks: ['Life Leech|Spell: Life Leech'] }), 'Crystalline Orb')).toEqual([])
    // Each kind is its own module: the epics alone want no Crystalline Orb.
    expect(wantedBy(state(), 'Crystalline Orb', ['epic'])).toEqual([])
    expect(wantedBy(state(), 'Crystalline Orb', ['spell'])).toHaveLength(1)
  })

  it('knows the named that drop a piece, and leaves the common mobs to their loot', () => {
    expect(dropsOf('Butler Syncall')).toEqual(['Butler Syncalls Fang'])
    expect(dropsOf('Vance Bearstalker')).toEqual(["Poacher's Head"])
    expect(dropsOf('a stone spider')).toEqual([])
    const named = SPELL_QUESTS.flatMap((q) => everyStep(q.steps).flatMap((s) => namedKills(s.how)))
    expect(named.sort()).toEqual(['Butler Syncall', 'Maid Issis', 'Vance Bearstalker'])
  })
})
