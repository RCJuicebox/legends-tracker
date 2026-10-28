import { afterEach, describe, expect, it } from 'vitest'
import { legendsSpawnsOf, setFoundSpawns } from '../../../src/features/slayer/spawns'
import { sanitizeFound, withWaypoints } from '../../../src/features/hunter/main'

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

  it('give a named with one spot alone its /waypoint, from the tables or from a spot found', () => {
    const guk = (...names: string[]) =>
      withWaypoints({ zone: 'Lower Guk', achievement: 'Hunter of Lower Guk', left: names.map((name) => ({ name })), total: 3, since: [], wait: null, dueIn: 0 })
    // The tables' one spot for the king; none for the magus.
    expect(guk('The Froglok King', 'Ghoul Arch Magus').left).toEqual([{ name: 'The Froglok King', waypoint: '/waypoint -104, 22' }, { name: 'Ghoul Arch Magus' }])
    // A spot found makes the magus one spot, and the king two: no single place to send the player.
    setFoundSpawns([
      { zone: 'Lower Guk', name: 'Ghoul Arch Magus', spots: [{ at: [300.4, -120.6] }], said: 'you, 2026-10-28' },
      { zone: 'Lower Guk', name: 'The Froglok King', spots: [{ at: [1, 2] }], said: 'you, 2026-10-28' }
    ])
    expect(guk('The Froglok King', 'Ghoul Arch Magus').left).toEqual([{ name: 'The Froglok King' }, { name: 'Ghoul Arch Magus', waypoint: '/waypoint 300, -121' }])
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
