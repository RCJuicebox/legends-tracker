import { describe, expect, it } from 'vitest'
import { CHECKS } from '../../src/main/ipc/checks'

// The first look at each invoke channel's arguments (LT-754): kinds, count, optional and null ones.

describe('CHECKS', () => {
  it('passes the right kinds and refuses the wrong ones', () => {
    expect(CHECKS['character:get'](['Testchar'])).toEqual(['Testchar'])
    expect(CHECKS['character:get']([1])).toBeNull()
    expect(CHECKS['character:get']([])).toBeNull()
    expect(CHECKS['combat:rebuild']([30])).toEqual([30])
    expect(CHECKS['combat:rebuild']([NaN])).toBeNull()
    expect(CHECKS['hunter:autoTimers'](['yes'])).toBeNull()
    expect(CHECKS['gear:foci']([['a'], ['Warrior'], 50, 'Testchar', 14])).toEqual([['a'], ['Warrior'], 50, 'Testchar', 14])
    expect(CHECKS['gear:foci']([['a', 2], ['Warrior'], 50, 'Testchar', 14])).toBeNull()
  })

  it('takes optional arguments sent or not, a null where one may be, and only the values listed', () => {
    expect(CHECKS['logs:folders']([])).toEqual([])
    expect(CHECKS['logs:folders']([undefined])).toEqual([])
    expect(CHECKS['logs:folders']([true])).toEqual([true])
    expect(CHECKS['factions:plan'](['Testchar', undefined, true])).toEqual(['Testchar', undefined, true])
    expect(CHECKS['spells:rule'](['Envenomed Bolt', null])).toEqual(['Envenomed Bolt', null])
    expect(CHECKS['spells:rule'](['Envenomed Bolt', 'x'])).toBeNull()
    expect(CHECKS['motes:setKind'](['id', 'crawl'])).toEqual(['id', 'crawl'])
    expect(CHECKS['motes:setKind'](['id', 'raid'])).toBeNull()
  })

  it('knows an object or a list only as one, and drops arguments past those it takes', () => {
    expect(CHECKS['settings:save']([{}])).toEqual([{}])
    expect(CHECKS['settings:save']([[]])).toBeNull()
    expect(CHECKS['settings:save']([null])).toBeNull()
    expect(CHECKS['triggers:save']([[]])).toEqual([[]])
    expect(CHECKS['triggers:save']([{}])).toBeNull()
    expect(CHECKS['app:state'](['extra'])).toEqual([])
    expect(CHECKS['character:get'](['Testchar', 'extra'])).toEqual(['Testchar'])
  })
})
