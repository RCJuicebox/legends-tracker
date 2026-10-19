import { afterEach, describe, expect, it } from 'vitest'
import { legendsSpawnsOf, setFoundSpawns } from '../../../src/features/slayer/spawns'
import { sanitizeFound } from '../../../src/features/hunter/main'

// The spots the player found named at (FEAT-020): kept beside the built-in list, a named both have
// being one with every spot, and the file read back only as it should be.

afterEach(() => setFoundSpawns([]))

describe('found spots', () => {
  it('join the built-in ones for the same named, and stand alone for one the list lacks', () => {
    setFoundSpawns([
      { zone: 'The Western Plains of Karana', name: 'a werewolf bandit', spots: [{ at: [100, 200] }], said: 'you, 2026-10-19' },
      { zone: 'Befallen', name: 'Andrew Pine', spots: [{ at: [10, 20, 3], where: 'by the stairs' }], said: 'you, 2026-10-19' }
    ])
    const [wolf] = legendsSpawnsOf('The Western Plains of Karana', ['A werewolf bandit'])
    expect(wolf.spots).toHaveLength(5)
    expect(wolf.said).toBe('the player, 2026-10-13; you, 2026-10-19')
    expect(wolf.ph).toEqual(['a bandit'])
    expect(legendsSpawnsOf('Befallen 2 (Adaptive)', ['Andrew Pine'])[0].spots).toEqual([{ at: [10, 20, 3], where: 'by the stairs' }])
    expect(legendsSpawnsOf('Befallen', ['Skeletal Orc'])).toEqual([])
  })

  it('reads hunter-spots.json back as spots with a zone, a name and two or three numbers', () => {
    expect(
      sanitizeFound({
        spots: [
          { zone: 'Befallen', name: 'Andrew Pine', at: [1, 2], on: 5 },
          { zone: 'Befallen', name: 'Andrew Pine', at: [1, 2, 3], where: 'x', on: 6 },
          { zone: '', name: 'x', at: [1, 2] },
          { zone: 'Befallen', name: 'y', at: [1] },
          { zone: 'Befallen', name: 'y', at: [1, 'a'] },
          null
        ]
      })
    ).toEqual([
      { zone: 'Befallen', name: 'Andrew Pine', at: [1, 2], on: 5 },
      { zone: 'Befallen', name: 'Andrew Pine', at: [1, 2, 3], where: 'x', on: 6 }
    ])
    expect(sanitizeFound(null)).toEqual([])
  })
})
