import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SpellBook } from '../src/core/spells'
import { bestStack, checkStack, coexist, pairOrder, type StackItem, type StackSpell } from '../src/core/stacking'

// Real rows from the EQL client's spell file: every spell in the log's "did not take hold" pairs,
// and the ones whose stacking is spelled out below.
const book = SpellBook.parse(readFileSync(join(__dirname, 'fixtures', 'stacking_spells_us.txt'), 'latin1'), readFileSync(join(__dirname, 'fixtures', 'stacking_spells_us_str.txt'), 'latin1'))
const GROUP = [3, 41, 42]
const spell = (name: string): StackSpell => {
  const s = book.named(name)
  if (!s) throw new Error(`no fixture row for ${name}`)
  return { effects: s.effects, beneficial: s.beneficial, group: GROUP.includes(s.targetType) }
}
/** What happens when `nu` is cast over `old`, both by level-50 casters. */
const over = (old: string, nu: string, oldLevel = 50, newLevel = 50) => checkStack(spell(old), oldLevel, spell(nu), newLevel)

describe('what lands over what', () => {
  it('blocks every pair a real log saw blocked (different spells, level-50 casters)', () => {
    // "Your <new> spell did not take hold on X. (Blocked by <old>.)", July to September 2026.
    const blocked: [string, string][] = [
      ['Shield of Words', 'Guardian'], ['Armor of Faith', 'Guardian'], ['Group Resist Magic', 'Resist Magic'], ['Swift Like the Wind', 'Alacrity'],
      ['Celerity', 'Alacrity'], ['Alacrity', 'Quickness'], ['Haste', 'Quickness'], ['Harnessing of Spirit', 'Infusion of Spirit'],
      ['Harnessing of Spirit', 'Dexterity'], ['Harnessing of Spirit', 'Strength'], ['Harnessing of Spirit', 'Deftness'], ['Harnessing of Spirit', 'Furious Strength'],
      ['Harnessing of Spirit', 'Talisman of Altuna'], ['Armor of the Faithful', 'Talisman of Altuna'], ['Strength', 'Furious Strength'], ['Dexterity', 'Deftness'],
      ['Rising Dexterity', 'Spirit of Monkey'], ['Raging Strength', 'Spirit Strength'], ['Health', 'Spirit of Ox'], ['Stamina', 'Spirit of Ox'],
      ['Spirit of Cat', 'Feet like Cat'], ['Center', 'Inner Fire'], ['Skin like Steel', 'Inner Fire'], ['Protection of Rock', 'Inner Fire'],
      ['Protection of Steel', 'Inner Fire'], ['Greater Wolf Form', 'Spirit of Wolf'], ['Illusion Benefit Dena', 'Spirit of Bih`Li'],
      ['Ignite Blood', 'Chloroplast'], ['Dooming Darkness', 'Chloroplast'], ['Tashania', 'Tashani']
    ]
    for (const [old, nu] of blocked) expect([old, nu, over(old, nu)]).toEqual([old, nu, -1])
  })

  it('lets a stronger buff replace a weaker, and an equal one too', () => {
    expect(over('Guardian', 'Shield of Words')).toBe(1)
    expect(over('Furious Strength', 'Strength')).toBe(1)
    expect(over('Inner Fire', 'Center')).toBe(1)
    // Spirit of Wolf and Spirit of Bih`Li are both 55% run speed: either replaces the other (since
    // the August 2026 patch; before it, both were blocked).
    expect(over('Spirit of Wolf', 'Spirit of Bih`Li')).toBe(1)
    expect(over('Spirit of Bih`Li', 'Spirit of Wolf')).toBe(1)
  })

  it('reads the stacking commands at the caster’s level: Harnessing of Spirit over Strength', () => {
    // Harnessing overwrites slot-1 STR below 67 and blocks it below 1067. A level-50 Strength is 67:
    // Harnessing lands over it and both stay; Strength never lands over Harnessing.
    expect(over('Strength', 'Harnessing of Spirit')).toBe(0)
    expect(over('Harnessing of Spirit', 'Strength')).toBe(-1)
    expect(coexist(spell('Strength'), 50, spell('Harnessing of Spirit'), 50)).toBe('a-first')
    // A level-46 shaman's Strength is 65: Harnessing replaces it.
    expect(over('Strength', 'Harnessing of Spirit', 46, 50)).toBe(1)
    expect(over('Dexterity', 'Harnessing of Spirit')).toBe(0)
    expect(over('Deftness', 'Harnessing of Spirit')).toBe(1)
    // Temperance blocks slot-3 HP below 2800: every Symbol.
    expect(over('Temperance', 'Symbol of Naltron')).toBe(-1)
    expect(over('Symbol of Naltron', 'Temperance')).toBe(1)
  })

  it('lets the group twin replace the single buff, not the other way round', () => {
    expect(over('Temperance', 'Blessing of Temperance')).toBe(1)
    expect(over('Blessing of Temperance', 'Temperance')).toBe(-1)
  })

  it('leaves out effects the client ignores in stacking, and different slots', () => {
    // Levitate (SPA 57) is ignored: Dead Man Floating's levitation is no clash.
    expect(coexist(spell('Levitate'), 50, spell('Dead Man Floating'), 50)).toBe('any')
    // Harnessing's HP is in slot 1, Temperance's in slot 2.
    expect(coexist(spell('Harnessing of Spirit'), 50, spell('Temperance'), 50)).toBe('any')
    expect(coexist(spell('Harnessing of Spirit'), 50, spell('Talisman of Altuna'), 50)).toBeNull()
    // Rune I to IV are four spells with a rune in slot 1.
    expect(coexist(spell('Rune I'), 50, spell('Rune IV'), 50)).toBeNull()
    expect(over('Rune I', 'Rune IV')).toBe(1)
  })
})

describe('the best combination', () => {
  const item = (key: string, value: number, keep = false, level = 50): StackItem => ({ key, value, spell: spell(key), level, keep })

  it('orders what must land after what', () => {
    const best = bestStack([item('Harnessing of Spirit', 368), item('Strength', 67), item('Dexterity', 50), item('Stamina', 60)])
    expect([...best.chosen].sort()).toEqual(['Dexterity', 'Harnessing of Spirit', 'Stamina', 'Strength'])
    expect(best.after.get('Harnessing of Spirit')?.sort()).toEqual(['Dexterity', 'Strength'])
    expect(best.after.has('Strength')).toBe(false)
  })

  it('cannot land a buff over one on already that blocks it', () => {
    // Harnessing on: Strength can no longer go on. Strength on: Harnessing can.
    expect(pairOrder(item('Harnessing of Spirit', 368, true), item('Strength', 67))).toBeNull()
    expect(pairOrder(item('Strength', 67, true), item('Harnessing of Spirit', 368))).toBe('a-first')
    const best = bestStack([item('Harnessing of Spirit', 368, true), item('Strength', 67), item('Talisman of Altuna', 250)])
    expect([...best.chosen]).toEqual(['Harnessing of Spirit'])
  })

  it('never takes two of a spell, and prefers what is on at a tie', () => {
    expect(pairOrder(item('Strength', 67), item('Strength', 67))).toBeNull()
    const best = bestStack([item('Temperance', 1120), item('Blessing of Temperance', 1120, true)])
    expect([...best.chosen]).toEqual(['Blessing of Temperance'])
  })
})
