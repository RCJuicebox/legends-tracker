import { describe, expect, it } from 'vitest'
import { composeRows, countsFromComposite, findMoteRows, moteCountsFromScreen, readCount, splitPair, statsWindowFromScreen, type OcrWord } from '../src/core/screenText'

/** Lays words out as a window would: each [text, x] on one row at height y. */
function line(y: number, ...parts: [string, number][]): OcrWord[] {
  return parts.map(([text, x]) => ({ text, x, y, w: text.length * 7, h: 12 }))
}

describe('reading mote counts off the screen', () => {
  it('pairs each mote row with its count, whatever order OCR returned the words in', () => {
    const words = [
      ...line(100, ['Mote', 10], ['of', 45], ['Major', 62], ['Potential', 104], ['60', 300]),
      ...line(120, ['Mote', 10], ['of', 45], ['Potential', 62], ['15', 300]),
      ...line(140, ['Mote', 10], ['of', 45], ['Superior', 62], ['Potential', 125], ['1l', 300]),
      ...line(160, ['Void-Touched', 10], ['Potential', 100], ['3', 300]),
      ...line(180, ['Mote', 10], ['of', 45], ['Grand', 62], ['Potential', 104], ['1', 301])
    ].reverse()
    expect(moteCountsFromScreen(words).counts).toEqual({ major: 60, potential: 15, superior: 11, grand: 1 })
  })

  it('repairs the usual OCR digit slips and rejects words', () => {
    expect(readCount('1,024')).toBe(1024)
    expect(readCount('O')).toBe(0)
    expect(readCount('l2')).toBe(12)
    expect(readCount('Major')).toBeNull()
  })
})

describe('the rebuilt second read', () => {
  // A currency list as the first read sees it: counts right-aligned under Quantity, the lone
  // single digits missed.
  const words = [
    ...line(80, ['Name', 10], ['Expansion', 200], ['Quantity', 330]),
    ...line(100, ['Motes', 10], ['of', 50], ['Grand', 65], ['Potential', 104], ['EverQuest', 200]),
    ...line(120, ['Motes', 10], ['of', 50], ['Major', 65], ['Potential', 104], ['EverQuest', 200], ['44', 378]),
    ...line(140, ['Void-Touched', 10], ['Potential', 100], ['EverQuest', 200], ['3', 385])
  ]

  it('finds each mote row and puts its count cell under the Quantity header', () => {
    const found = findMoteRows(words)
    expect(found.map((r) => [r.rank, r.count])).toEqual([
      ['grand', null],
      ['major', 44]
    ])
    for (const r of found) {
      expect(r.cell.x).toBeGreaterThan(300)
      expect(r.cell.x + r.cell.w).toBeGreaterThanOrEqual(392)
    }
  })

  it('reads each count between its label and the end marker, ignoring stray marks past it', () => {
    const found = findMoteRows(words)
    const layout = composeRows(found)
    expect(layout.pieces).toHaveLength(6)
    // What OCR returns for the rebuilt image: a count in each cell, and a sliver read as 1 on the marker.
    const second: OcrWord[] = found.flatMap((_, i) => {
      const [, cell, end] = layout.pieces.slice(i * 3, i * 3 + 3)
      return [
        { text: i === 0 ? '1' : '44', x: cell.x + 20, y: cell.y + 3, w: 7, h: 12 },
        { text: '1', x: end.x + 1, y: end.y + 3, w: 2, h: 12 },
        { text: 'Potential', x: end.x + 4, y: end.y + 3, w: 60, h: 12 }
      ]
    })
    expect(countsFromComposite(second, found, layout)).toEqual([1, 44])
  })
})

describe('reading the Stats window', () => {
  // Lines as Windows OCR returned them from a real Stats tab: the thin slash after a coloured number
  // often comes back as a 1, and the two-letter "HP" not at all.
  const at = (y: number, ...parts: [string, number][]) => line(y, ...parts)
  const words = [
    ...at(10, ['6321', 60], ['16321', 90], ['Heroic', 230], ['Mods', 262]),
    ...at(30, ['Mana', 10], ['564815648', 60], ['Accuracy', 230], ['01150', 368]),
    ...at(50, ['AC', 10], ['475/439', 60], ['1502', 110], ['Combat', 230], ['Effects', 270], ['01100', 368]),
    ...at(70, ['Attack', 10], ['3761937', 60], ['Damage', 230], ['Shielding', 270], ['0135', 368]),
    ...at(90, ['Attack', 10], ['Speed', 50], ['150%', 90], ['Stun', 230], ['Resist', 262], ['0135', 368]),
    ...at(110, ['Strength', 10], ['234/510', 60], ['+0', 110], ['Bash', 230], ['01100', 368]),
    ...at(130, ['Magic', 10], ['6811000', 60], ['Frenzy', 230], ['01125', 368]),
    ...at(150, ['Fire', 10], ['12911000', 60], ['Kick', 230], ['01100', 368]),
    ...at(170, ['Stamina', 10], ['265/510', 60], ['+0', 110], ['Clairvoyance', 230], ['02', 520])
  ]

  it('splits pairs whose slash read as a 1, using the known maximum where there is one', () => {
    expect(splitPair('6811000', 1000)).toEqual([68, 1000])
    expect(splitPair('12911000', 1000)).toEqual([129, 1000])
    expect(splitPair('0135', 35)).toEqual([0, 35])
    expect(splitPair('564815648')).toEqual([5648, 5648])
    expect(splitPair('3761937')).toEqual([376, 937])
    expect(splitPair('234/510', 510)).toEqual([234, 510])
  })

  it('reads every line of both columns, and nothing from beside the window', () => {
    const { values, area } = statsWindowFromScreen(words)
    expect(values).toMatchObject({
      HP: [6321, 6321],
      Mana: [5648, 5648],
      AC: [475, 439, 502],
      Attack: [376, 937],
      'Attack Speed': [150],
      Strength: [234, 510, 0],
      Magic: [68, 1000],
      Fire: [129, 1000],
      Accuracy: [0, 150],
      'Combat Effects': [0, 100],
      'Damage Shielding': [0, 35],
      Frenzy: [0, 125]
    })
    expect(values.Clairvoyance).toBeUndefined()
    expect(area!.w).toBeLessThan(520)
  })
})

describe('composeRows with nothing found', () => {
  it('lays out an empty image rather than NaN', () => {
    expect(composeRows([])).toEqual({ width: 0, height: 0, rowHeight: 0, pieces: [] })
  })
})
