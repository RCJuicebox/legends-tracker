import { afterEach, describe, expect, it } from 'vitest'
import { SlayerRaces, sayKey, setSaidRaces } from '../../src/core/slayer'
import { NO_RACE_TABLE } from '../../src/core/raceNames'
import { sanitizeSaid } from '../../src/features/slayer/main'

// A mob's race as the player said it (FEAT-021): over eqlwiki's and the name's, under a zone's settled one.

afterEach(() => setSaidRaces({}))

describe('races the player said', () => {
  it('place a mob over eqlwiki and its name, for any article or case', () => {
    const races = new SlayerRaces([], NO_RACE_TABLE)
    expect(races.place('a mystery', null).key).toBeNull()
    setSaidRaces({ [sayKey('A mystery')]: 'goblin' })
    expect(races.place('a mystery', null)).toEqual({ key: 'goblin', by: 'you', sure: true })
    expect(races.place('Mystery', 'Gnoll')).toEqual({ key: 'goblin', by: 'you', sure: true })
    expect(races.names()).toContain('dark elf')
  })

  it('read slayer-races.json back as short race keys by mob', () => {
    expect(sanitizeSaid({ version: 1, races: { mystery: 'goblin', __proto__x: 5, ok: '' } })).toEqual({ mystery: 'goblin' })
    expect(sanitizeSaid(null)).toEqual({})
  })
})
