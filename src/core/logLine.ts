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
// Node's decoder passes the five bytes 1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) through
// as the same code points, as the hand-written table this replaced did.
const CP1252 = new TextDecoder('windows-1252')

export function decodeCp1252(bytes: Uint8Array): string {
  return CP1252.decode(bytes)
}

// "You have entered The Plane of Fear 4 (Refined)." Arenas and the Drunken Monkey's areas print the
// same words without being zones.
export const RE_ZONE = /^You have entered (.+)\.$/
export const RE_NOT_ZONE = /^(?:an? (?:area|Arena)|the Drunken)/i

/** The zone a line says you entered, or null when it is not a zone change. */
export function zoneEntered(text: string): string | null {
  const m = RE_ZONE.exec(text)
  return m && !RE_NOT_ZONE.test(m[1]) ? m[1] : null
}
