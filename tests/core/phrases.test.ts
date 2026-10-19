import { describe, expect, it } from 'vitest'
import { PET_ATTACKING } from '../../src/core/phrases'
import { slayerLine } from '../../src/core/slayer'

// The one pattern for a pet's "Attacking X Master." (LT-634): the meter and the Slayer counts read it
// the same way, the counts then keeping a pet of one word only.

describe("a pet's attack tell", () => {
  it('gives the pet and its target, a charmed mob of several words too', () => {
    expect(PET_ATTACKING.exec("Jobarab told you, 'Attacking a forsaken revenant Master.'")?.slice(1)).toEqual(['Jobarab', 'a forsaken revenant'])
    expect(PET_ATTACKING.exec("a gnoll told you, 'Attacking a decaying skeleton Master.'")?.slice(1)).toEqual(['a gnoll', 'a decaying skeleton'])
    expect(PET_ATTACKING.exec("Jobarab tells the group, 'Attacking a rat Master.'")).toBeNull()
  })

  it('is a pet to the Slayer counts only when its name is one word', () => {
    expect(slayerLine("Jobarab told you, 'Attacking a forsaken revenant Master.'")).toEqual({ pet: 'Jobarab', engaged: 'a forsaken revenant' })
    expect(slayerLine("a gnoll told you, 'Attacking a decaying skeleton Master.'")).toBeNull()
  })
})
