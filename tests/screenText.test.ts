import { describe, expect, it } from 'vitest'
import { composeRows, countsFromComposite, findMoteRows, moteCountsFromScreen, readCount, type OcrWord } from '../src/core/screenText'

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
