import { MOTE_RANKS, type MoteKey } from './motes'

/** One word Windows OCR found, with its box in screen pixels. */
export interface OcrWord {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrRow {
  words: OcrWord[]
  y: number
  text: string
}

/** Groups words into visual rows: a label and the number beside it come back as separate words. */
export function rows(words: OcrWord[]): OcrRow[] {
  const sorted = [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
  const heights = sorted.map((w) => w.h).sort((a, b) => a - b)
  const tol = Math.max(3, (heights[Math.floor(heights.length / 2)] ?? 10) * 0.6)
  const out: OcrRow[] = []
  for (const w of sorted) {
    const cy = w.y + w.h / 2
    const row = out.find((r) => Math.abs(r.y - cy) <= tol)
    if (row) {
      row.words.push(w)
      row.y = (row.y * (row.words.length - 1) + cy) / row.words.length
    } else out.push({ words: [w], y: cy, text: '' })
  }
  for (const r of out) {
    r.words.sort((a, b) => a.x - b.x)
    r.text = r.words.map((w) => w.text).join(' ')
  }
  return out
}

/** A count as OCR tends to misread it: O for 0, l or I for 1, a stray comma or period for thousands. */
export function readCount(text: string): number | null {
  const t = text.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[,.'’]/g, '')
  return /^\d{1,7}$/.test(t) ? Number(t) : null
}

const RANK_WORDS = new Map<string, MoteKey>(MOTE_RANKS.filter((r) => r.name).map((r) => [r.name.toLowerCase(), r.key as MoteKey]))

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** One "Motes of <Rank> Potential" line on screen: where its name is, and where its count should be. */
export interface MoteRow {
  rank: MoteKey
  text: string
  name: Box
  cell: Box
  /** The word "Potential" itself, reused as an end marker in the rebuilt image. */
  word: Box
  /** The count if the first read caught it. Lone single digits are often missed there. */
  count: number | null
}

const plain = (w: OcrWord) => w.text.toLowerCase().replace(/[^a-z-]/g, '')

/**
 * Finds "Mote(s) of <Rank> Potential" rows. The plain rank reads "Motes of Potential";
 * Void-Touched Potential is a different item and is skipped. The name is traced left from
 * "Potential" through tightly spaced words only, so text from a window beside it is not included.
 * The count cell is under the list's Quantity header when one is on screen, else the stretch to the
 * right of the name.
 */
export function findMoteRows(words: OcrWord[]): MoteRow[] {
  const headers = words.filter((w) => /^quantit/i.test(w.text))
  const out: MoteRow[] = []
  for (const row of rows(words)) {
    const ws = row.words
    const pi = ws.findIndex((w) => plain(w).startsWith('potential'))
    if (pi < 0) continue
    const before = pi > 0 ? plain(ws[pi - 1]) : ''
    if (before.includes('void')) continue
    const rank = RANK_WORDS.get(before) ?? (before === 'of' || before === 'mote' || before === 'motes' || before === '' ? ('potential' as MoteKey) : null)
    if (!rank) continue
    const p = ws[pi]
    let first = pi
    while (first > 0 && pi - first < 3 && p.x - (ws[first - 1].x + ws[first - 1].w) < p.h * 4 && ws[first].x - (ws[first - 1].x + ws[first - 1].w) < p.h * 1.5) first--
    const left = ws[first].x
    const right = p.x + p.w
    const top = Math.min(...ws.slice(first, pi + 1).map((w) => w.y))
    const bottom = Math.max(...ws.slice(first, pi + 1).map((w) => w.y + w.h))
    const pad = Math.ceil(p.h * 0.35)
    const name: Box = { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 }
    // The nearest Quantity header above the row and to its right. Counts are right-aligned under it,
    // so the cell hugs its right edge, wide enough for six digits.
    const header = headers
      .filter((h) => h.x > right && h.y < p.y && p.y - h.y < 800)
      .sort((a, b) => a.x - right - (b.x - right) || b.y - a.y)[0]
    const cell: Box = header
      ? { x: header.x + header.w - p.h * 4, y: name.y, w: p.h * 5, h: name.h }
      : { x: right + p.h, y: name.y, w: p.w * 7, h: name.h }
    const numbers = ws.filter((w) => w.x >= cell.x && w.x + w.w <= cell.x + cell.w + p.h).map((w) => readCount(w.text)).filter((n): n is number => n !== null)
    // No padding on its left: that would pick up the end of the rank word before it.
    const word: Box = { x: p.x, y: name.y, w: p.w + pad, h: name.h }
    out.push({ rank, text: ws.slice(first).map((w) => w.text).join(' '), name, cell, word, count: numbers.length ? numbers[numbers.length - 1] : null })
  }
  return out
}

/** Where each piece goes in the rebuilt image: every row's name with its count cell right beside it. */
export interface Composite {
  width: number
  height: number
  rowHeight: number
  /** Source box and destination corner of each piece, in drawing order. */
  pieces: { from: Box; x: number; y: number }[]
}

/**
 * Lays the rows out tight: name, a small gap, the count cell, then the word "Potential" again, one row
 * under the next. OCR drops a lone digit far off to the right of a list, and a lone 0 even beside its
 * label; with words on both sides it reads it as part of the line.
 */
export function composeRows(found: MoteRow[]): Composite {
  const margin = 12
  const gap = 10
  const rowHeight = Math.max(...found.map((r) => Math.max(r.name.h, r.cell.h))) + 12
  let width = 0
  const pieces: Composite['pieces'] = []
  found.forEach((r, i) => {
    const y = margin + i * rowHeight
    pieces.push({ from: r.name, x: margin, y })
    pieces.push({ from: r.cell, x: margin + r.name.w + gap, y })
    pieces.push({ from: r.word, x: margin + r.name.w + gap * 2 + r.cell.w, y })
    width = Math.max(width, margin * 2 + r.name.w + gap * 2 + r.cell.w + r.word.w)
  })
  return { width: Math.ceil(width), height: Math.ceil(margin * 2 + found.length * rowHeight), rowHeight, pieces }
}

/** Reads the counts off the rebuilt image: each row band holds one mote's name and its count. */
export function countsFromComposite(words: OcrWord[], found: MoteRow[], layout: Composite): (number | null)[] {
  const margin = 12
  return found.map((_, i) => {
    const top = margin + i * layout.rowHeight
    const [, cell, end] = layout.pieces.slice(i * 3, i * 3 + 3)
    const inRow = words
      .filter((w) => w.y + w.h / 2 >= top && w.y + w.h / 2 < top + layout.rowHeight && w.x + w.w / 2 > cell.x && w.x + w.w / 2 < end.x)
      .sort((a, b) => a.x - b.x)
    const numbers = inRow.map((w) => readCount(w.text)).filter((n): n is number => n !== null)
    return numbers.length ? numbers[numbers.length - 1] : null
  })
}

/**
 * The single-pass read: each mote row and the count the first OCR saw on it. Kept for when the
 * rebuilt read is not possible; it misses lone single-digit counts.
 */
export function moteCountsFromScreen(words: OcrWord[]): { counts: Partial<Record<MoteKey, number>>; rows: string[] } {
  const counts: Partial<Record<MoteKey, number>> = {}
  const seen: string[] = []
  for (const r of findMoteRows(words)) {
    if (r.count === null) continue
    counts[r.rank] = r.count
    seen.push(r.text)
  }
  return { counts, rows: seen }
}
