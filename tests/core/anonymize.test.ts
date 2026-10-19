import { describe, expect, it } from 'vitest'
import { anonymizer } from '../../src/core/anonymize'

// A bug report's names swapped for the test characters' (FEAT-039). The "real" names here are made up.

const LINES = [
  "[Mon Oct 19 20:00:00 2026] Quixly tells you, 'meet me at the docks, my number is 555'",
  '[Mon Oct 19 20:00:01 2026] Vandrel has joined the group.',
  '[Mon Oct 19 20:00:02 2026] [50 SHD/BRD/WIZ] Ostrevan (Erudite) <Made Up Guild> ZONE: neriakc',
  '[Mon Oct 19 20:00:03 2026] You hit a cave bear for 120 points of damage.',
  "[Mon Oct 19 20:00:04 2026] You say, 'hello there'"
]

describe('anonymizer', () => {
  it('swaps each player the lines name, and yours, for a test character, cutting what anyone said', () => {
    const a = anonymizer(['bear'], LINES)
    const out = a.apply([...LINES, 'Log: E:\\EQ\\Logs\\eqlog_Bear_neriak.txt, key bear_neriak'].join('\n')).split('\n')
    expect(out[0]).toBe("[Mon Oct 19 20:00:00 2026] Aldric tells you, '…'")
    expect(out[1]).toBe('[Mon Oct 19 20:00:01 2026] Brenna has joined the group.')
    expect(out[2]).toBe('[Mon Oct 19 20:00:02 2026] [50 SHD/BRD/WIZ] Corvin (Erudite) <Guild1> ZONE: neriakc')
    // A character named Bear: the cave bear is left alone, the file name and key are not.
    expect(out[3]).toBe('[Mon Oct 19 20:00:03 2026] You hit a cave bear for 120 points of damage.')
    expect(out[4]).toBe("[Mon Oct 19 20:00:04 2026] You say, '…'")
    expect(out[5]).toBe('Log: E:\\EQ\\Logs\\eqlog_Kelwyn_neriak.txt, key kelwyn_neriak')
    expect([...a.swaps]).toEqual([
      ['Bear', 'Kelwyn'],
      ['Quixly', 'Aldric'],
      ['Vandrel', 'Brenna'],
      ['Ostrevan', 'Corvin']
    ])
  })

  it('leaves a test character as it is, and numbers players past the stand-ins', () => {
    const many = Array.from({ length: 14 }, (_, i) => `Name${String.fromCharCode(97 + i)}x`)
    const a = anonymizer(['Kelwyn', ...many])
    expect(a.apply('Kelwyn and Namenx')).toBe('Kelwyn and Player14')
    expect(anonymizer([]).apply('nothing to swap')).toBe('nothing to swap')
  })
})
