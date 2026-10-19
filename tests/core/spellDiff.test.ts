import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpellBook } from '../../src/core/spells'
import { diffSpellBooks, spellDiffEmpty, spellDiffSummary, spellDiffText } from '../../src/core/spellDiff'

// What a game patch changed in the spell file (FEAT-026), from the fixture file and an edited copy of it.

const dir = join(__dirname, '..', 'fixtures')
const SPELLS = readFileSync(join(dir, 'spells_us.txt'), 'latin1')
const STRINGS = readFileSync(join(dir, 'spells_us_str.txt'), 'latin1')
const book = (text = SPELLS) => SpellBook.parse(text, STRINGS)

describe('diffSpellBooks', () => {
  it('says nothing for the same file', () => {
    const d = diffSpellBooks(book(), book(), ['Harm Touch'])
    expect(spellDiffEmpty(d)).toBe(true)
    expect(spellDiffSummary(d)).toBe('no spell you use changed')
  })

  it('lists a watched spell whose numbers moved, a new spell and one gone', () => {
    const lines = SPELLS.split('\n')
    const ht = lines.findIndex((l) => l.startsWith('88^Harm Touch^'))
    // Harm Touch's recast halved; a new spell copied from it; the first other row dropped.
    const halved = lines[ht].replace('^1200000^', '^600000^')
    const added = halved.replace('88^Harm Touch^', '99999^Harm Touch Test^')
    const gone = lines.findIndex((l, i) => i !== ht && /^\d+\^/.test(l))
    const name = lines[gone].split('^')[1]
    const edited = lines.map((l, i) => (i === ht ? halved : l)).filter((_, i) => i !== gone)
    edited.push(added)
    const d = diffSpellBooks(book(), book(edited.join('\n')), ['Harm Touch', 'Not A Spell'])
    expect(d.changed).toEqual([{ name: 'Harm Touch', what: ['recast 1200s → 600s'] }])
    expect(d.added).toEqual(['Harm Touch Test'])
    expect(d.removed).toEqual([name])
    expect(d.layout).toBeNull()
    expect(spellDiffSummary(d)).toBe('1 new spell, 1 gone, 1 of yours changed (Harm Touch)')
    const text = spellDiffText(d)
    expect(text).toContain('Harm Touch: recast 1200s → 600s')
    expect(text).toContain('New (1):\n  Harm Touch Test')
  })

  it('says when the columns moved', () => {
    const a = book()
    const b = book()
    b.layout = { effects: a.layout.effects + 1, icon: a.layout.icon + 1 }
    const d = diffSpellBooks(a, b, [])
    expect(d.layout).toBe(`effects field ${a.layout.effects} → ${a.layout.effects + 1}, icon field ${a.layout.icon} → ${a.layout.icon + 1}`)
    expect(spellDiffSummary(d)).toBe('its columns moved')
    expect(spellDiffText(d, 1)).toContain('Columns moved')
  })
})
