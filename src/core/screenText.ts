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

/** Digits as OCR tends to misread them: O for 0, l, I or | for 1, a stray comma or period for thousands. */
const ocrDigits = (t: string) => t.replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[,.]/g, '')

/** A count as OCR tends to misread it, an apostrophe for a thousands separator included. */
export function readCount(text: string): number | null {
  const t = ocrDigits(text).replace(/['’]/g, '')
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

// Distances in a mote row, in multiples of the text height of "Potential" unless said otherwise.
/** A mote's name is at most this far left of "Potential"… */
const NAME_REACH = 4
/** …with gaps between its words no wider than this. */
const NAME_WORD_GAP = 1.5
/** A Quantity header this many pixels above a row or less can head its column. */
const HEADER_REACH_PX = 800
/** The count cell under a header: it starts this far left of the header's right edge… */
const CELL_LEFT = 4
/** …and is this wide. */
const CELL_WIDTH = 5
/** With no header, the cell is this many widths of "Potential". */
const CELL_WIDTH_NO_HEADER = 7

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
    while (first > 0 && pi - first < 3 && p.x - (ws[first - 1].x + ws[first - 1].w) < p.h * NAME_REACH && ws[first].x - (ws[first - 1].x + ws[first - 1].w) < p.h * NAME_WORD_GAP) first--
    const left = ws[first].x
    const right = p.x + p.w
    const top = Math.min(...ws.slice(first, pi + 1).map((w) => w.y))
    const bottom = Math.max(...ws.slice(first, pi + 1).map((w) => w.y + w.h))
    const pad = Math.ceil(p.h * 0.35)
    const name: Box = { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 }
    // The nearest Quantity header above the row and to its right. Counts are right-aligned under it,
    // so the cell hugs its right edge, wide enough for six digits.
    const header = headers
      .filter((h) => h.x > right && h.y < p.y && p.y - h.y < HEADER_REACH_PX)
      .sort((a, b) => a.x - right - (b.x - right) || b.y - a.y)[0]
    const cell: Box = header
      ? { x: header.x + header.w - p.h * CELL_LEFT, y: name.y, w: p.h * CELL_WIDTH, h: name.h }
      : { x: right + p.h, y: name.y, w: p.w * CELL_WIDTH_NO_HEADER, h: name.h }
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

/** The rebuilt image's border, which composeRows lays out and countsFromComposite reads back. */
const COMPOSITE_MARGIN = 12

/**
 * Lays the rows out tight: name, a small gap, the count cell, then the word "Potential" again, one row
 * under the next. OCR drops a lone digit far off to the right of a list, and a lone 0 even beside its
 * label; with words on both sides it reads it as part of the line.
 */
export function composeRows(found: MoteRow[]): Composite {
  if (!found.length) return { width: 0, height: 0, rowHeight: 0, pieces: [] }
  const margin = COMPOSITE_MARGIN
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
  const margin = COMPOSITE_MARGIN
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

/**
 * The labels of the in-game Inventory window's Stats tab, as it lays them out: a left column
 * (vitals, regen, stats, resists) and a right column (heroic mods, spell mods, skill damage mods)
 * on the same lines. Longer labels come first so "Attack Speed" is not read as "Attack".
 */
export const STAT_WINDOW_LABELS = [
  'Combat HP Regen', 'Combat Mana Regen', 'Combat End Regen', 'Damage Shield Mitigation', 'Damage Shield Mitiga', 'Damage Shielding',
  'DoT Shielding', 'Melee Shielding', 'Spell Shielding', 'Strike Through', 'Stun Resist', 'Combat Effects', 'Heal Amount',
  'Spell Damage', 'Dragon Punch', 'Eagle Strike', 'Flying Kick', 'Round Kick', 'Tiger Claw', 'Attack Speed',
  'HP', 'Mana', 'Endurance', 'AC', 'Attack', 'Velocity', 'Strength', 'Stamina', 'Intelligence', 'Wisdom', 'Agility', 'Dexterity',
  'Charisma', 'Magic', 'Fire', 'Cold', 'Disease', 'Poison', 'Void', 'Accuracy', 'Avoidance', 'Clairvoyance', 'Luck', 'Bash',
  'Backstab', 'Frenzy', 'Kick'
] as const

const labelWords = STAT_WINDOW_LABELS.map((l) => ({ label: l, words: l.toLowerCase().split(' ') }))
const CANONICAL: Record<string, string> = { 'Damage Shield Mitiga': 'Damage Shield Mitigation' }

/** The most a value can show, where the window prints "value / most". */
const WINDOW_CAPS: Record<string, number> = {
  Strength: 510, Stamina: 510, Intelligence: 510, Wisdom: 510, Agility: 510, Dexterity: 510, Charisma: 510,
  Magic: 1000, Fire: 1000, Cold: 1000, Disease: 1000, Poison: 1000, Void: 1000,
  Accuracy: 150, Avoidance: 100, 'Combat Effects': 100, 'Damage Shielding': 35, 'Damage Shield Mitigation': 25, 'DoT Shielding': 35,
  'Melee Shielding': 35, 'Spell Shielding': 35, 'Strike Through': 35, 'Stun Resist': 35,
  Bash: 100, Backstab: 125, 'Dragon Punch': 100, 'Eagle Strike': 100, 'Flying Kick': 100, Frenzy: 125, Kick: 100, 'Round Kick': 100, 'Tiger Claw': 100
}
/** Lines that print "current / most" with no fixed most. */
const PAIRS = new Set(['HP', 'Mana', 'Endurance', 'Attack'])

const clean = ocrDigits

/**
 * "value/most" as OCR returned it. The window's thin slash after a coloured number often reads as
 * a 1 ("68/1000" → "6811000"), so a run of digits is split at the 1 that leaves the known most, or,
 * with no known most, into two equal halves (a full HP bar), or at the only 1 there is.
 */
export function splitPair(token: string, most?: number): [number, number] | null {
  const t = clean(token)
  const slash = /^(\d+)\/(\d+)$/.exec(t)
  if (slash) return [Number(slash[1]), Number(slash[2])]
  if (!/^\d+$/.test(t)) return null
  const ones = [...t].map((c, i) => (c === '1' && i > 0 && i < t.length - 1 ? i : -1)).filter((i) => i >= 0)
  if (most !== undefined) {
    const i = ones.find((i) => t.slice(i + 1) === String(most))
    return i === undefined ? null : [Number(t.slice(0, i)), most]
  }
  const even = ones.find((i) => t.slice(0, i) === t.slice(i + 1))
  if (even !== undefined) return [Number(t.slice(0, even)), Number(t.slice(even + 1))]
  return ones.length === 1 ? [Number(t.slice(0, ones[0])), Number(t.slice(ones[0] + 1))] : null
}

/** The numbers after one label, read the way that label prints them. */
function valuesFor(label: string, tokens: string[]): number[] {
  const toks = tokens.map((t) => t.trim()).filter((t) => /\d/.test(t))
  if (!toks.length) return []
  const most = WINDOW_CAPS[label]
  if (most !== undefined || PAIRS.has(label)) {
    let pair = splitPair(toks[0], most)
    let rest = toks.slice(1)
    // The two halves can come back as separate words: "6321" then "16321" or "/6321".
    if (!pair && rest.length && /^\d+$/.test(clean(toks[0]))) {
      const second = clean(rest[0]).replace(/^\//, '')
      const b = second.startsWith('1') && second.length > clean(toks[0]).length ? second.slice(1) : second
      if (/^\d+$/.test(b) && (most === undefined || Number(b) === most)) {
        pair = [Number(clean(toks[0])), Number(b)]
        rest = rest.slice(1)
      }
    }
    if (!pair) return []
    // Stats carry their heroic bonus after: "234/510 +0".
    const extra = rest.map((t) => /^[+-]?\d+$/.exec(clean(t))?.[0]).filter(Boolean).map(Number)
    return [...pair, ...extra]
  }
  if (label === 'AC') {
    // "475/439 /502": mitigation, soft cap, avoidance. The lone slash before avoidance can read as a 1.
    const nums = toks.flatMap((t) => clean(t).split('/').filter(Boolean)).map((t) => t.replace(/\D/g, ''))
    if (nums.length >= 3 && nums[2].startsWith('1') && nums[2].length > nums[0].length) nums[2] = nums[2].slice(1)
    return nums.slice(0, 3).map(Number)
  }
  const n = /\d+/.exec(clean(toks[0]))
  return n ? [Number(n[0])] : []
}

/**
 * Reads the Stats tab: each label with the numbers after it, up to the next label on the line.
 * Returns what it found by label ("AC" → [475, 439, 502]) and the lines it used, and the area of the
 * screen the window covers so a closer second read can be taken.
 */
export function statsWindowFromScreen(words: OcrWord[]): { values: Record<string, number[]>; rows: string[]; area: Box | null } {
  const values: Record<string, number[]> = {}
  const seen: string[] = []
  const used: OcrWord[] = []
  const segments = labelSegments(words)
  // Lines with a known most ("68/1000") read reliably, and their numbers end at the window's right
  // edge. Anything further right belongs to another window.
  let edge = Infinity
  const capped = segments.filter((g) => WINDOW_CAPS[g.label] !== undefined && valuesFor(g.label, g.words.map((w) => w.text)).length)
  if (capped.length >= 3) {
    const ends = capped.map((g) => g.words.find((w) => /\d/.test(w.text))!).map((w) => w.x + w.w)
    edge = Math.max(...ends) + 12
  }
  for (const g of segments) {
    const inside = g.words.filter((w) => w.x <= edge)
    const v = valuesFor(g.label, inside.map((w) => w.text))
    if (!v.length || values[g.label]) continue
    values[g.label] = v
    used.push(...g.all.filter((w) => w.x <= edge))
    if (!seen.includes(g.row)) seen.push(g.row)
  }
  if (used.length < 6) return { values, rows: seen, area: null }
  const x0 = Math.min(...used.map((w) => w.x))
  const y0 = Math.min(...used.map((w) => w.y))
  const x1 = Math.max(...used.map((w) => w.x + w.w))
  const y1 = Math.max(...used.map((w) => w.y + w.h))
  const pad = 24
  return { values, rows: seen, area: { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 } }
}

interface LabelSegment {
  label: string
  label0: number
  /** The words after the label, up to the next label on the line. */
  words: OcrWord[]
  /** The label's words and those after it. */
  all: OcrWord[]
  row: string
}

/** Every label found on each line, with the words that follow it. */
function labelSegments(words: OcrWord[]): LabelSegment[] {
  const segments: LabelSegment[] = []
  for (const row of rows(words)) {
    const ws = row.words
    const plainWords = ws.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, ''))
    // Each label's place on the line, longest labels first, without overlaps.
    const taken = new Array(ws.length).fill(false)
    const hits: { at: number; end: number; label: string }[] = []
    for (const { label, words: lw } of labelWords) {
      for (let i = 0; i + lw.length <= ws.length; i++) {
        if (taken.slice(i, i + lw.length).some(Boolean)) continue
        if (lw.every((w, j) => plainWords[i + j] === w.replace(/[^a-z]/g, ''))) {
          hits.push({ at: i, end: i + lw.length, label: CANONICAL[label] ?? label })
          for (let j = i; j < i + lw.length; j++) taken[j] = true
        }
      }
    }
    // OCR drops the two-letter "HP"; its numbers still open the line beside "Heroic Mods".
    const heroic = plainWords.indexOf('heroic')
    if (heroic > 0 && !hits.some((h) => h.label === 'HP') && /\d/.test(ws[0].text)) hits.push({ at: -1, end: 0, label: 'HP' })
    if (!hits.length) continue
    hits.sort((a, b) => a.at - b.at)
    hits.forEach((h, k) => {
      const stop = k + 1 < hits.length ? hits[k + 1].at : heroic > h.end ? heroic : ws.length
      segments.push({ label: h.label, label0: Math.max(0, h.at), words: ws.slice(h.end, stop), all: ws.slice(Math.max(0, h.at), stop), row: row.text })
    })
  }
  return segments
}
