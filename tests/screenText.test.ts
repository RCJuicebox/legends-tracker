import { describe, expect, it } from 'vitest'
import { moteCountsFromScreen, readCount, type OcrWord } from '../src/core/screenText'

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
