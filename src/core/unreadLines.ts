// The lines no part of the app took (FEAT-025): a game patch that changes a wording shows up here
// on the player's own PC, as the shapes of the lines nothing read, rather than as timers that quietly
// stop. The replay check (tests/replay) uses the same shapes over a whole log.

export interface Shape {
  shape: string
  n: number
  example: string
}

/**
 * Chat and talk, which no part reads on purpose: says, tells, shouts, channels, an NPC's "told you"
 * (a banker's welcome, a merchant's offer) and the AA window's "Description:" dump (LT-753).
 */
export const CHAT =
  /^(?:You (?:say|tell|shout|auction)\b|\S+ (?:says|tells|shouts|auctions|told you|says out of character)\b|\S+ tells (?:the group|the guild|the raid|you)|\[\d+ |.+? told you, '|Description: )/

/** A line's shape: numbers, quoted words and a leading name stripped, so like lines count together. */
export function shapeOf(text: string): string {
  return (
    text
      // What someone says, to the end of the line ("I'll give you…" has a quote of its own).
      .replace(/, '.*'\.?$/, ", '…'")
      .replace(/\d[\d,.]*/g, 'N')
      .replace(/^(?!You\b|Your\b)[A-Z][a-z`']+(?: [A-Z][a-z`']+)?\b/, 'X')
  )
}

/** Distinct shapes kept at most: past it, a new shape is only counted. */
const SHAPES_MAX = 2000

/** Unread lines by shape, with one example each, and how many in all. */
export class UnreadLines {
  private readonly by = new Map<string, Shape>()
  /** Lines counted, chat left out. */
  total = 0
  /** Lines whose shape came after SHAPES_MAX were full. */
  others = 0

  /** A line nothing took; chat is not counted. */
  add(text: string): void {
    if (CHAT.test(text)) return
    this.total++
    const shape = shapeOf(text)
    const had = this.by.get(shape)
    if (had) had.n++
    else if (this.by.size < SHAPES_MAX) this.by.set(shape, { shape, n: 1, example: text.slice(0, 160) })
    else this.others++
  }

  top(n: number): Shape[] {
    return [...this.by.values()].sort((a, b) => b.n - a.n).slice(0, n)
  }

  clear(): void {
    this.by.clear()
    this.total = 0
    this.others = 0
  }
}

/** The shapes as text to paste into a bug report: counts and shapes, never the examples, which name people. */
export function unreadText(lines: UnreadLines, n: number): string {
  if (!lines.total) return ''
  return [`${lines.total.toLocaleString()} lines no part read (chat left out), by shape:`, ...lines.top(n).map((s) => `${s.n.toLocaleString()}  ${s.shape}`)].join('\n')
}
