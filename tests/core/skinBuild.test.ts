import { describe, expect, it } from 'vitest'
import { bagCells, bagGrid, bagKindOf, isSkinName, parseSkinBuild, readBagSlots, sanitizeColumns, tailOutput } from '../../src/core/skinBuild'

// A UI skin asks for a rebuild button with a file in its folder; only a well-formed one, naming a
// program by its full path, gets a button.

const file = (o: unknown) => JSON.stringify(o)
const PY = 'C:/Python314/python.exe'

describe('parseSkinBuild', () => {
  it('reads the label and the command', () => {
    expect(parseSkinBuild('MySkin', file({ label: 'Rebuild bag sizes', command: [PY, '-B', 'D:/skins/build.py', '--install'] }))).toEqual({
      skin: 'MySkin',
      label: 'Rebuild bag sizes',
      command: [PY, '-B', 'D:/skins/build.py', '--install']
    })
  })

  it('names the button after the skin when the file gives no label', () => {
    expect(parseSkinBuild('MySkin', file({ command: [PY] }))?.label).toBe('Rebuild MySkin')
    expect(parseSkinBuild('MySkin', file({ label: '   ', command: [PY] }))?.label).toBe('Rebuild MySkin')
  })

  it('takes a program only by its full path to an .exe', () => {
    expect(parseSkinBuild('S', file({ command: ['python.exe', 'b.py'] }))).toBeNull()
    expect(parseSkinBuild('S', file({ command: ['C:/scripts/build.cmd'] }))).toBeNull()
    expect(parseSkinBuild('S', file({ command: ['C:\\Python314\\python.exe'] }))?.command).toEqual(['C:\\Python314\\python.exe'])
  })

  it('turns away anything that is not a command list of plain strings', () => {
    for (const bad of [
      'not json',
      file(null),
      file([PY]),
      file({}),
      file({ command: [] }),
      file({ command: [PY, 3] }),
      file({ command: [PY, ''] }),
      file({ command: [PY, 'a\nb'] })
    ])
      expect(parseSkinBuild('S', bad)).toBeNull()
    expect(parseSkinBuild('S', file({ command: Array(21).fill(PY) }))).toBeNull()
  })

  it('turns away a folder name /loadskin could not take', () => {
    expect(parseSkinBuild('../up', file({ command: [PY] }))).toBeNull()
  })
})

describe('isSkinName', () => {
  it('takes folder names and nothing that climbs out of uifiles', () => {
    expect(isSkinName('default')).toBe(true)
    expect(isSkinName('My Skin-2')).toBe(true)
    for (const bad of ['', '..', '.hidden', 'a/b', 'a\\b', 'trailing.', 'trailing ', 'x'.repeat(65), 7]) expect(isSkinName(bad)).toBe(false)
  })
})

describe('tailOutput', () => {
  it('keeps the end of long output, trimmed, with Windows line ends made plain', () => {
    expect(tailOutput('  a\r\nb  ')).toBe('a\nb')
    expect(tailOutput('x'.repeat(10) + 'END', 5)).toBe('…xxEND')
  })
})

describe('bag layout', () => {
  const spec = { defaults: { General: 13, Bank: 11, SharedBank: 6 }, slots: { General: 2, Bank: 1, SharedBank: 1 }, minSlots: 10, maxColumns: 30 }

  it("reads a skin's bag layout from its file, and leaves it out when it is not whole", () => {
    expect(parseSkinBuild('S', file({ command: [PY], bagLayout: spec }))?.bagLayout).toEqual(spec)
    expect(parseSkinBuild('S', file({ command: [PY], bagLayout: { defaults: { General: 13 } } }))?.bagLayout).toBeUndefined()
    // Slot counts the file leaves out are what the export lists.
    expect(parseSkinBuild('S', file({ command: [PY], bagLayout: { defaults: spec.defaults } }))?.bagLayout?.slots).toEqual({ General: 12, Bank: 24, SharedBank: 6 })
  })

  it('lays a bag out: its own slot and its contents, at least the minimum, in lines', () => {
    // A 24-slot bag, 13 to a line: two lines of 13.
    expect(bagGrid(bagCells(24, spec), 13)).toEqual({ lines: 2, across: 13 })
    // An 8-slot bag keeps room for 10: one line of 11.
    expect(bagGrid(bagCells(8, spec), 11)).toEqual({ lines: 1, across: 11 })
    expect(bagGrid(bagCells(0, spec), 6)).toEqual({ lines: 2, across: 6 })
  })

  it('keeps only bag slots the export names and numbers the skin can draw', () => {
    expect(sanitizeColumns({ 'General 1': 12, Bank3: 0, SharedBank2: 31, Primary: 5, 'General 2': 2.5, Bank4: 8 }, spec)).toEqual({ 'General 1': 12, Bank4: 8 })
    expect(sanitizeColumns(null, spec)).toEqual({})
    expect(bagKindOf('General 12')).toBe('General')
    expect(bagKindOf('Bank16')).toBe('Bank')
    expect(bagKindOf('General 1-Slot3')).toBeNull()
  })

  it('reads the bag slots the skin draws from the export, empty ones included', () => {
    const text = [
      'Location\tName\tID\tCount\tSlots',
      'General 1\tSpacious Rucksack\t1\t1\t24',
      'General 1-Slot1\tRation\t2\t20\t0',
      'General 2\tEmpty\t0\t0\t0',
      'Bank1\tLight Burlap Sack\t3\t1\t8',
      'Bank2\tBronze Sword\t4\t1\t0'
    ].join('\r\n')
    expect(readBagSlots(text, spec)).toEqual([
      { location: 'General 1', kind: 'General', name: 'Spacious Rucksack', slots: 24 },
      { location: 'General 2', kind: 'General', name: '', slots: 0 },
      { location: 'Bank1', kind: 'Bank', name: 'Light Burlap Sack', slots: 8 },
      { location: 'SharedBank1', kind: 'SharedBank', name: '', slots: 0 }
    ])
  })
})
