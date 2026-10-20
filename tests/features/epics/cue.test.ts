import { describe, expect, it } from 'vitest'
import { beforeCopy, dropsOf, killCue, lootCue, namedKills, slainMob, wantedBy } from '../../../src/features/epics/cue'
import type { EpicState } from '../../../src/features/epics/core'

// Goals › Epics' live cue: which classes on the record still want a piece that drops, and what the
// Live page's feed and the alert overlay say of it.

const state = (o: Partial<EpicState> = {}): EpicState => ({
  character: 'Kelwyn_neriak',
  ticks: [],
  adjust: {},
  logged: {},
  last: {},
  classes: ['Shadow Knight'],
  exported: null,
  ...o
})

describe('what still wants a piece', () => {
  it('names the class and the reward the piece makes', () => {
    const w = wantedBy(state(), 'Ghoulbane')
    expect(w).toEqual([{ cls: 'Shadow Knight', forWhat: 'Corrupted Ghoulbane', epic: false }])
    expect(lootCue('Ghoulbane', w)).toBe('Ghoulbane dropped: Shadow Knight epic, for the Corrupted Ghoulbane')
  })

  it('names the finished epic for a piece at the top of the list', () => {
    const w = wantedBy(state(), 'Corrupted Ghoulbane')
    expect(w).toEqual([{ cls: 'Shadow Knight', forWhat: "Innoruuk's Curse", epic: true }])
    expect(lootCue('Corrupted Ghoulbane', w)).toBe("Corrupted Ghoulbane dropped: Shadow Knight epic, for Innoruuk's Curse")
  })

  it('wants nothing already held enough of, covered by the reward or the finished epic, or ticked off', () => {
    expect(wantedBy(state({ logged: { ghoulbane: 1 } }), 'Ghoulbane')).toEqual([])
    expect(wantedBy(state({ exported: { file: 'x', modified: 0, counts: { ghoulbane: 1 } } }), 'Ghoulbane')).toEqual([])
    expect(wantedBy(state({ logged: { 'corrupted ghoulbane': 1 } }), 'Ghoulbane')).toEqual([])
    expect(wantedBy(state({ logged: { 'innoruuks curse': 1 } }), 'Ghoulbane')).toEqual([])
    expect(wantedBy(state({ ticks: ['Shadow Knight|Ghoulbane'] }), 'Ghoulbane')).toEqual([])
    expect(lootCue('Ghoulbane', [])).toBeNull()
  })

  it('asks only the classes on the record, and counts what they want between them', () => {
    expect(wantedBy(state({ classes: ['Bard'] }), 'Ghoulbane')).toEqual([])
    expect(wantedBy(state({ classes: [] }), 'Ghoulbane')).toEqual([])
    // A Shadow Knight and a Paladin each take one: one held is not enough for both.
    const both = state({ classes: ['Paladin', 'Shadow Knight'], logged: { ghoulbane: 1 } })
    const w = wantedBy(both, 'Ghoulbane')
    expect(w.map((x) => x.cls)).toEqual(['Paladin', 'Shadow Knight'])
    expect(lootCue('Ghoulbane', w)).toBe('Ghoulbane dropped: Paladin epic, for the Fiery Avenger; Shadow Knight epic, for the Corrupted Ghoulbane')
    expect(wantedBy({ ...both, logged: { ghoulbane: 2 } }, 'Ghoulbane')).toEqual([])
  })

  it('judges a copy just looted by the counts before it came in', () => {
    const s = state({ logged: { ghoulbane: 1 }, last: { ghoulbane: 5000 } })
    expect(beforeCopy(s, 'Ghoulbane', 1, 5000).logged.ghoulbane).toBe(0)
    // The log had not reached it yet: the counts are already before it.
    expect(beforeCopy(s, 'Ghoulbane', 1, 6000)).toBe(s)
  })
})

describe('named that drop pieces', () => {
  it('reads the named a step says to kill, and leaves the common mobs out', () => {
    expect(namedKills('Kill Lady Vox (raid)')).toEqual(['Lady Vox'])
    expect(namedKills('Kill Dread, Fright, or Terror (raid)')).toEqual(['Dread', 'Fright', 'Terror'])
    expect(namedKills('Kill The froglok shin lord')).toEqual(['The froglok shin lord'])
    expect(namedKills('Kill a skunk+')).toEqual([])
    expect(namedKills('Kill any snake')).toEqual([])
    expect(namedKills('Kill clockwork')).toEqual([])
    expect(namedKills('Kill A Lizard Crusader or A lizard ritualist')).toEqual([])
    expect(namedKills('Kill 3x [Brownie Scouts]/Corrupted brownie')).toEqual(['Corrupted brownie'])
    expect(namedKills('Forage')).toEqual([])
  })

  it('knows what a named drops, by the death lines', () => {
    expect(slainMob('You have slain the froglok shin lord!')).toBe('the froglok shin lord')
    expect(slainMob('The froglok shin lord has been slain by Kelwyn!')).toBe('The froglok shin lord')
    expect(slainMob('The froglok shin lord died.')).toBe('The froglok shin lord')
    expect(slainMob('You have looted a Ghoulbane.')).toBeNull()
    expect(dropsOf('the froglok shin lord')).toEqual(['Ghoulbane'])
    expect(dropsOf('a giant rat')).toEqual([])
    const w = wantedBy(state(), 'Ghoulbane')
    expect(killCue('The froglok shin lord', [{ item: 'Ghoulbane', wanted: w }])).toBe(
      'The froglok shin lord slain, drops Ghoulbane: Shadow Knight epic, for the Corrupted Ghoulbane'
    )
    expect(killCue('The froglok shin lord', [{ item: 'Ghoulbane', wanted: [] }])).toBeNull()
  })
})
