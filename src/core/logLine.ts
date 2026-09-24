// EverQuest log lines: `[Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.`
// Timestamps are local time with one-second resolution and a space-padded day (`Jul  9`).

export interface LogLine {
  /** Milliseconds since the epoch, from the line's own timestamp. */
  time: number
  text: string
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
}

const LINE = /^\[\w{3} (\w{3}) ([ \d]\d) (\d\d):(\d\d):(\d\d) (\d{4})\] (.*)$/

export function parseLogLine(raw: string): LogLine | null {
  const m = LINE.exec(raw)
  if (!m) return null
  const month = MONTHS[m[1]]
  if (month === undefined) return null
  const time = new Date(+m[6], month, +m[2], +m[3], +m[4], +m[5]).getTime()
  return { time, text: m[7] }
}

// Windows-1252, not UTF-8: a UTF-8 decode corrupts extended characters in zone and mob names.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178
]

export function decodeCp1252(bytes: Uint8Array): string {
  let out = ''
  const chunk: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    chunk.push(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b)
    if (chunk.length === 8192) {
      out += String.fromCharCode(...chunk)
      chunk.length = 0
    }
  }
  return out + String.fromCharCode(...chunk)
}
