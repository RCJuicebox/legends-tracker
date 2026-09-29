import { describe, expect, it } from 'vitest'
import { PLAYABLE_RACES, playableRace, raceFromWho } from '../src/shared/game/races'
import { parseWho } from '../src/core/buffs'

describe('Playable races', () => {
  it('lists the sixteen the client has "created as a …" achievements for', () => {
    expect(PLAYABLE_RACES).toHaveLength(16)
    expect(PLAYABLE_RACES).toContain('Kerran')
    expect(PLAYABLE_RACES).not.toContain('Vah Shir')
  })

  it("reads a race in the game's spelling, whatever the case, and nothing else", () => {
    expect(playableRace('wood elf')).toBe('Wood Elf')
    expect(playableRace(' Iksar ')).toBe('Iksar')
    expect(playableRace('Elemental')).toBe('')
    expect(playableRace('')).toBe('')
  })
})

describe("A character's race from its own /who", () => {
  const seen = (line: string) => parseWho(line, 0)?.race ?? ''

  it('changes the record when the race changes', () => {
    expect(raceFromWho('Iksar', seen('[50 SHD/MNK/SHM] Kelwyn (Wood Elf) <Test Guild> ZONE: Misty Thicket (misty)'))).toBe('Wood Elf')
  })

  it('fills a record with no race yet', () => {
    expect(raceFromWho('', 'Iksar')).toBe('Iksar')
    expect(raceFromWho(undefined, 'Dark Elf')).toBe('Dark Elf')
  })

  it('leaves the record alone when the race is the same, in any case', () => {
    expect(raceFromWho('Iksar', 'Iksar')).toBeNull()
    expect(raceFromWho('iksar', 'Iksar')).toBeNull()
  })

  it("passes over an illusion's form that no character can be", () => {
    expect(raceFromWho('Wood Elf', seen('[50 WIZ/MAG/ENC] Kelwyn (Elemental) <Test Guild> ZONE: The Northern Plains of Karana (northkarana)'))).toBeNull()
  })

  it('takes the Legends races classic EQ did not have', () => {
    expect(raceFromWho('Iksar', 'Kerran')).toBe('Kerran')
    expect(raceFromWho('Iksar', 'Froglok')).toBe('Froglok')
  })
})
