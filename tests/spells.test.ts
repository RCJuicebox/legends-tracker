import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpellBook } from '../src/core/spells'
import { fixtureBook } from './helpers'

describe('SpellBook.search', () => {
  it('sorts every match before cutting to the limit', () => {
    // In file order Superior Healing and Plague come first; alphabetically they do not.
    expect(fixtureBook().search('e', 2, true).map((s) => s.name)).toEqual(['Elixir of Clarity VI', 'Envenomed Bolt'])
  })
})

describe('SpellBook.parse', () => {
  it('reads a blank cast time as 0, not NaN', () => {
    const dir = join(__dirname, 'fixtures')
    const puma = readFileSync(join(dir, 'spells_us.txt'), 'latin1').split('\n').find((l) => l.includes('^Spirit of the Puma^'))!
    const f = puma.replace(/\r$/, '').split('^')
    f[8] = ''
    const book = SpellBook.parse(f.join('^'), readFileSync(join(dir, 'spells_us_str.txt'), 'latin1'))
    expect(book.named('Spirit of the Puma')!.castMs).toBe(0)
  })
})
