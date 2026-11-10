import { describe, expect, it } from 'vitest'
import { LandingIndex } from '../../src/core/spellLandings'
import type { Spell, SpellBook } from '../../src/core/spells'

// Messages as spells_us_str.txt gives them: "on you", then "on other" with its leading space.
const spell = (name: string, landSelf: string, landOther: string) => ({ name, landSelf, landOther }) as Spell
const book = {
  all: () =>
    [
      spell('Strip Enchantment', 'You feel very dispelled.', ' feels very dispelled.'),
      spell('Pillage Enchantment', 'You feel very dispelled.', ' feels very dispelled.'),
      spell('Armor of Protection', 'You feel protected.', ' looks protected.'),
      spell('Gaze', '', '.')
    ][Symbol.iterator]()
} as unknown as SpellBook

describe('LandingIndex', () => {
  const index = new LandingIndex(book)

  it('finds the spells a message on you may be', () => {
    expect(index.find('You feel very dispelled.')).toEqual({
      target: 'You',
      spells: ['Strip Enchantment', 'Pillage Enchantment'],
      text: 'You feel very dispelled.'
    })
  })

  it('splits a message on someone else at the shortest name, a mob of several words included', () => {
    expect(index.find('Phinigel Autropos feels very dispelled.')).toMatchObject({ target: 'Phinigel Autropos', spells: ['Strip Enchantment', 'Pillage Enchantment'] })
    expect(index.find('a swirlspine seahorse looks protected.')).toEqual({ target: 'a swirlspine seahorse', spells: ['Armor of Protection'], text: 'You feel protected.' })
  })

  it('passes over every other line', () => {
    expect(index.find('Phinigel Autropos crushes YOU for 142 points of damage.')).toBeUndefined()
    expect(index.find('You feel very well.')).toBeUndefined()
  })
})
