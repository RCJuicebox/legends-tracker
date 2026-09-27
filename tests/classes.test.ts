import { describe, expect, it } from 'vitest'
import { CLASSES, CLASS_NAMES, CLASS_NUMBER, CLASS_TABLE, classCode, classColumn, classIdOf, className, isClassId } from '../src/shared/game/classes'

describe('the class table', () => {
  it('numbers classes the way the game files do, and names each one once', () => {
    expect(CLASS_NAMES[CLASS_NUMBER.shd - 1]).toBe('Shadow Knight')
    expect(CLASS_TABLE.map((c) => c.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(classColumn('ber')).toBe(15)
    expect(new Set(CLASSES.map(([id]) => id)).size).toBe(16)
  })

  it('spells Shadow Knight the same way on every page', () => {
    expect(className('shd')).toBe('Shadow Knight')
    expect(CLASSES.find(([id]) => id === 'shd')?.[1]).toBe('Shadow Knight')
  })

  it('reads a class from any of the ways it is written', () => {
    for (const s of ['Shadow Knight', 'Shadow_Knight', 'Shadowknight', 'SHD', 'shd']) expect(classIdOf(s)).toBe('shd')
    expect(classIdOf('Paladin')).toBe('pal')
    expect(classIdOf('Pirate')).toBeNull()
    expect(classCode('bst')).toBe('BST')
    expect(isClassId('mnk')).toBe(true)
    expect(isClassId('Monk')).toBe(false)
  })
})
