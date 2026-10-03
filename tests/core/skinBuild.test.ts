import { describe, expect, it } from 'vitest'
import { isSkinName, parseSkinBuild, tailOutput } from '../../src/core/skinBuild'

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
