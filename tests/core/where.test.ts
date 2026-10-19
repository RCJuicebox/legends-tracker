import { describe, expect, it } from 'vitest'
import { bearing, locPoint, nearest, nearText, parseLoc } from '../../src/core/where'

// The game's /loc (FEAT-023): y, x, z as printed; on the map north is up and east is right.

describe('where the player is', () => {
  it('reads a /loc line as the game prints it, and nothing else', () => {
    expect(parseLoc('Your Location is 661.88, -301.44, -40.42')).toEqual({ y: 661.88, x: -301.44, z: -40.42 })
    expect(parseLoc('Your Location is -158, 646, -25')).toEqual({ y: -158, x: 646, z: -25 })
    expect(parseLoc('Your Location is somewhere')).toBeNull()
    expect(parseLoc("Fenwick says, 'Your Location is 1, 2, 3'")).toBeNull()
  })

  it('says how far a spot is and which way, north being +y in a /loc and east -x', () => {
    const here = locPoint({ y: 0, x: 0 })
    // /loc 100, 0 is north of /loc 0, 0; /loc 0, -100 is east of it (x grows to the west).
    expect(bearing(here, locPoint({ y: 100, x: 0 }))).toEqual({ dist: 100, dir: 'north' })
    expect(bearing(here, locPoint({ y: 0, x: -100 }))).toEqual({ dist: 100, dir: 'east' })
    expect(bearing(here, locPoint({ y: -100, x: 100 })).dir).toBe('south-west')
    expect(nearest(here, [locPoint({ y: 500, x: 0 }), locPoint({ y: 0, x: 300 })])).toMatchObject({ dist: 300, dir: 'west' })
    expect(nearest(here, [])).toBeNull()
  })

  it('says it with the age of the /loc', () => {
    expect(nearText({ dist: 1320, dir: 'north-east' }, 0, 4 * 60_000)).toBe('≈ 1,320 to the north-east (your /loc 4 min ago)')
    expect(nearText({ dist: 5, dir: 'west' }, 0, 10_000)).toBe('≈ 5 to the west (your /loc just now)')
  })
})
