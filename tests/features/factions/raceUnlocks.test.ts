import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../../src/core/achievements'
import { parseRaceUnlocks, raceUnlocks, unlockedRaces, unlockGoals } from '../../../src/features/factions/unlocks'

// As the client's Resources/Achievements files have them (a few of each kind).
const CLIENT = [
  '20000101^Race Unlock - Human (Freeport)^Completing this achievement will allow you to select Human as a Race in Loadouts.^4472^5^1^0^',
  '20000102^Race Unlock - Barbarian^Completing this achievement will allow you to select Barbarian as a Race in Loadouts.^4466^5^1^0^',
  '20000104^Race Unlock - Wood Elf^Completing this achievement will allow you to select Wood Elf as a Race in Loadouts.^4479^5^1^0^',
  '20000107^Race Unlock - Half Elf^Completing this achievement will allow you to select Half Elf as a Race in Loadouts.^4468^5^1^0^',
  '20000114^Race Unlock - Kerran^Completing this achievement will allow you to select Kerran as a Race in Loadouts.^4461^5^1^0^',
  '20000116^Race Unlock - Drakkin^Completing this achievement will allow you to select Drakkin as a Race in Loadouts.^4486^5^0^0^',
  '20000201^Primary Class Unlock - Warrior^Completing this achievement will allow you to select Warrior as a Primary Class in Loadouts.^4487^5^1^0^'
].join('\n')
const COMPONENTS = [
  '20000101^4^1^60229^Get maximum faction with Coalition of Tradesfolk.^',
  '20000101^5^1^60330^Get maximum faction with Freeport Militia.^',
  '20000101^6^1^60281^Get maximum faction with Knights of Truth.^',
  '20000101^7^2^20000121^This achievement will autocomplete if your character was created as a Human.^',
  '20000101^8^2^20000141^This achievement can by bypassed using a Race Unlock Token.^',
  '20000102^0^1^60305^Get maximum faction with Rogues of the White Rose.^',
  '20000102^1^1^60320^Get maximum faction with Wolves of the North.^',
  '20000102^2^1^60328^Get maximum faction with Merchants of Halas.^',
  '20000104^0^1^60326^Get maximum faction with Emerald Warriors.^',
  '20000104^1^1^60310^Get maximum faction with Soldiers of Tunare.^',
  '20000104^2^1^60276^Get maximum faction with Kelethin Merchants.^',
  '20000107^0^1^20000107^This achievement will autocomplete when you unlock Human or Wood Elf as a race.^',
  '20000107^1^2^20000127^This achievement will autocomplete if your character was created as a Half Elf.^',
  "20000114^0^1^65114^Complete the 'Aid the Kerrans of Kerra Isle' Task.^",
  '20000116^0^3^711^Visibility Requires TSS^',
  '20000116^0^1^20000116^Future Placeholder for Drakkin Requirements.^'
].join('\n')

// A character's achievements export: Barbarian done, Freeport's one faction of three done, Wood Elf's none.
const EXPORT = [
  'Untapped Potential: Races',
  'C\tRace Unlock - Barbarian',
  'C\t\tGet maximum faction with Rogues of the White Rose.',
  'C\t\tGet maximum faction with Wolves of the North.',
  'C\t\tGet maximum faction with Merchants of Halas.',
  'I\t\tThis achievement will autocomplete if your character was created as a Barbarian.',
  'I\tRace Unlock - Human (Freeport)',
  'C\t\tGet maximum faction with Coalition of Tradesfolk.',
  'I\t\tGet maximum faction with Freeport Militia.',
  'I\t\tGet maximum faction with Knights of Truth.',
  'I\tRace Unlock - Wood Elf',
  'I\t\tGet maximum faction with Emerald Warriors.',
  'I\t\tGet maximum faction with Soldiers of Tunare.',
  'I\t\tGet maximum faction with Kelethin Merchants.',
  'I\tRace Unlock - Half Elf',
  'I\t\tThis achievement will autocomplete when you unlock Human or Wood Elf as a race.',
  'I\tRace Unlock - Kerran',
  "I\t\tComplete the 'Aid the Kerrans of Kerra Isle' Task."
].join('\n')

// The game's names by faction id, where the client's differ: Coalition of Tradefolk, The Freeport Militia.
const GAME: Record<number, string> = { 229: 'Coalition of Tradefolk', 330: 'The Freeport Militia' }
const nameOf = (id: number, name: string) => GAME[id] ?? name

describe('race unlocks', () => {
  it("reads the client's race unlocks: three factions each, Half Elf's by other unlocks, Kerran's a task, Drakkin's a placeholder", () => {
    const defs = parseRaceUnlocks(CLIENT, COMPONENTS)
    expect(defs.map((d) => [d.achievement, d.race])).toEqual([
      ['Race Unlock - Human (Freeport)', 'Human'],
      ['Race Unlock - Barbarian', 'Barbarian'],
      ['Race Unlock - Wood Elf', 'Wood Elf'],
      ['Race Unlock - Half Elf', 'Half Elf'],
      ['Race Unlock - Kerran', 'Kerran']
    ])
    expect(defs[0].factions).toEqual([
      { id: 229, name: 'Coalition of Tradesfolk' },
      { id: 330, name: 'Freeport Militia' },
      { id: 281, name: 'Knights of Truth' }
    ])
    expect(defs[3]).toMatchObject({ factions: [], withRaces: ['Human', 'Wood Elf'] })
    expect(defs[4]).toMatchObject({ factions: [], other: "Complete the 'Aid the Kerrans of Kerra Isle' Task" })
  })

  it('takes which are done from the achievements export, part by part, and a faction at 2000 since as done', () => {
    const defs = parseRaceUnlocks(CLIENT, COMPONENTS)
    const standings: Record<string, number> = { 'Knights of Truth': 2000, 'The Freeport Militia': -226 }
    const unlocks = raceUnlocks(defs, parseAchievements(EXPORT).sections, nameOf, (f) => standings[f] ?? null)
    expect(unlocks.find((u) => u.race === 'Barbarian')).toMatchObject({ done: true })
    expect(unlocks[0]).toEqual({
      achievement: 'Race Unlock - Human (Freeport)',
      race: 'Human',
      done: false,
      factions: [
        { faction: 'Coalition of Tradefolk', done: true },
        { faction: 'The Freeport Militia', done: false },
        { faction: 'Knights of Truth', done: true }
      ]
    })
    expect(unlockedRaces(unlocks)).toEqual(['Barbarian'])
    // What the plan is to do: the Freeport Militia for Human's, Wood Elf's three, and Half Elf's with either; not Kerran's task.
    expect(unlockGoals(unlocks)).toEqual([
      { achievement: 'Race Unlock - Human (Freeport)', race: 'Human', factions: ['The Freeport Militia'] },
      { achievement: 'Race Unlock - Wood Elf', race: 'Wood Elf', factions: ['Emerald Warriors', 'Soldiers of Tunare', 'Kelethin Merchants'] },
      { achievement: 'Race Unlock - Half Elf', race: 'Half Elf', factions: [], anyOf: ['Race Unlock - Human (Freeport)', 'Race Unlock - Wood Elf'] }
    ])
  })

  it('takes a race unlock an export leaves out as done: the achievements window can hide what is done', () => {
    // Only what is open: here just Wood Elf's, part by part.
    const open = [
      'Untapped Potential: Races',
      'I\tRace Unlock - Wood Elf',
      'C\t\tGet maximum faction with Emerald Warriors.',
      'I\t\tGet maximum faction with Soldiers of Tunare.'
    ].join('\n')
    // The Freeport Militia fell back after it was maxed: the part stays done, as the unlock does.
    const unlocks = raceUnlocks(parseRaceUnlocks(CLIENT, COMPONENTS), parseAchievements(open).sections, nameOf, (f) => (f === 'The Freeport Militia' ? -226 : null))
    expect(unlocks.map((u) => [u.race, u.done])).toEqual([
      ['Human', true],
      ['Barbarian', true],
      ['Wood Elf', false],
      ['Half Elf', true],
      ['Kerran', true]
    ])
    expect(unlocks[0].factions.every((f) => f.done)).toBe(true)
    expect(unlockGoals(unlocks)).toEqual([{ achievement: 'Race Unlock - Wood Elf', race: 'Wood Elf', factions: ['Soldiers of Tunare', 'Kelethin Merchants'] }])
    expect(unlockedRaces(unlocks)).toEqual(['Human', 'Barbarian', 'Half Elf', 'Kerran'])
  })

  it('cannot say from an export that lists completed achievements but no race unlock at all', () => {
    const shown = ['EverQuest: Hunter', 'C\tHunter of Befallen', 'C\t\ta skeleton'].join('\n')
    const unlocks = raceUnlocks(parseRaceUnlocks(CLIENT, COMPONENTS), parseAchievements(shown).sections, nameOf, () => null)
    expect(unlocks.every((u) => u.done === null)).toBe(true)
    expect(unlockedRaces(unlocks)).toBeNull()
    // Only open ones listed and no race unlock among them: every one is done.
    const open = ['EverQuest: Hunter', 'I\tHunter of Befallen', 'I\t\ta skeleton'].join('\n')
    expect(raceUnlocks(parseRaceUnlocks(CLIENT, COMPONENTS), parseAchievements(open).sections, nameOf, () => null).every((u) => u.done === true)).toBe(true)
  })

  it('without an achievements export, goes by the standings, and knows no race to be unlocked', () => {
    const unlocks = raceUnlocks(parseRaceUnlocks(CLIENT, COMPONENTS), null, nameOf, (f) => (f === 'Emerald Warriors' ? 2000 : f === 'Soldiers of Tunare' ? 150 : null))
    expect(unlocks.find((u) => u.race === 'Wood Elf')).toEqual({
      achievement: 'Race Unlock - Wood Elf',
      race: 'Wood Elf',
      done: null,
      factions: [
        { faction: 'Emerald Warriors', done: true },
        { faction: 'Soldiers of Tunare', done: false },
        { faction: 'Kelethin Merchants', done: null }
      ]
    })
    expect(unlockedRaces(unlocks)).toBeNull()
  })
})
