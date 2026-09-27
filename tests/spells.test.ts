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

  const dir = join(__dirname, 'fixtures')
  const spells = () => readFileSync(join(dir, 'spells_us.txt'), 'latin1')
  const strings = () => readFileSync(join(dir, 'spells_us_str.txt'), 'latin1')
  const summary = (b: SpellBook) => [...b.all()].map((s) => [s.id, s.name, s.classLevels.join(','), s.effects.map((e) => `${e.slot}:${e.spa}:${e.base}`).join(' ')])

  it('reads the same with CRLF or LF lines, and skips comments and blank lines', () => {
    const lf = spells().replace(/\r\n/g, '\n')
    const crlf = '# a comment^1^2\r\n\r\n' + lf.replace(/\n/g, '\r\n')
    expect(summary(SpellBook.parse(crlf, strings()))).toEqual(summary(SpellBook.parse(lf, strings())))
  })

  it('still finds the effects when a client adds fields after them', () => {
    const plain = SpellBook.parse(spells(), strings())
    const longer = spells()
      .split('\n')
      .map((l) => (l.replace(/\r$/, '').split('^').length > 100 ? l.replace(/\r$/, '') + '^extra^0' : l))
      .join('\n')
    const book = SpellBook.parse(longer, strings())
    expect(summary(book)).toEqual(summary(plain))
    expect(book.named('Spirit of the Puma')!.effects.length).toBeGreaterThan(0)
  })

  it('holds identical class levels and effects once', () => {
    const book = SpellBook.parse(spells(), strings())
    const all = [...book.all()]
    const levels = new Set(all.map((s) => s.classLevels))
    expect(levels.size).toBe(new Set(all.map((s) => s.classLevels.join(','))).size)
  })
})

describe('what the spell file says about reach and resists', () => {
  it('reads the resist type, the range and the area range', () => {
    const bolt = fixtureBook().named('Envenomed Bolt')!
    expect(bolt).toMatchObject({ resist: 'poison', range: 200, aeRange: 0 })
    expect(fixtureBook().named('Plague')!.resist).toBe('disease')
  })
})
