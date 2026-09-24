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

/**
 * Finds "Mote(s) of <Rank> Potential" rows and the count on each. The plain rank reads "Mote of
 * Potential"; Void-Touched Potential is a different item and is skipped. When a count appears more
 * than once on a row, the rightmost is taken: windows put the count after the name.
 */
export function moteCountsFromScreen(words: OcrWord[]): { counts: Partial<Record<MoteKey, number>>; rows: string[] } {
  const counts: Partial<Record<MoteKey, number>> = {}
  const seen: string[] = []
  for (const row of rows(words)) {
    const ws = row.words
    const pi = ws.findIndex((w) => /^potential\b/i.test(w.text.replace(/[^a-z]/gi, '')))
    if (pi < 0) continue
    const before = (ws[pi - 1]?.text ?? '').toLowerCase().replace(/[^a-z-]/g, '')
    if (before.includes('void')) continue
    const rank = RANK_WORDS.get(before) ?? (before === 'of' || before === 'mote' || before === 'motes' || before === '' ? ('potential' as MoteKey) : null)
    if (!rank) continue
    const numbers = ws.map((w, i) => ({ i, n: i === pi ? null : readCount(w.text) })).filter((x) => x.n !== null)
    if (!numbers.length) continue
    counts[rank] = numbers[numbers.length - 1].n!
    seen.push(row.text)
  }
  return { counts, rows: seen }
}
