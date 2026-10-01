// EverQuest log lines: `[Wed Sep 23 13:29:05 2026] You begin casting Spirit of the Puma X.`
// Timestamps are local time with one-second resolution and a space-padded day (`Jul  9`).

export interface LogLine {
  /** Milliseconds since the epoch, from the line's own timestamp. */
  time: number
  text: string
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11
}

const LINE = /^\[\w{3} (\w{3}) ([ \d]\d) (\d\d):(\d\d):(\d\d) (\d{4})\] (.*)$/

/** The last stamp read ("[Wed Sep 23 13:29:05 2026]") and its time: a raid writes dozens of lines a second. */
let lastStamp = ''
let lastTime = 0

export function parseLogLine(raw: string): LogLine | null {
  // The same second as the line before: its time is known, no Date to build.
  if (lastStamp && raw.charCodeAt(26) === 32 && raw.startsWith(lastStamp)) return { time: lastTime, text: raw.slice(27) }
  const m = LINE.exec(raw)
  if (!m) return null
  const month = MONTHS[m[1]]
  if (month === undefined) return null
  const time = new Date(+m[6], month, +m[2], +m[3], +m[4], +m[5]).getTime()
  if (raw.charCodeAt(25) === 93) {
    lastStamp = raw.slice(0, 26)
    lastTime = time
  }
  return { time, text: m[7] }
}

const HOUR = 3_600_000

/** Whether a local wall-clock time happens twice (the hour the clocks go back): new Date() gives the first. */
function repeatedHour(time: number): boolean {
  const first = new Date(time)
  const second = new Date(time + HOUR)
  return first.getHours() === second.getHours() && first.getMinutes() === second.getMinutes()
}

/**
 * Reads a log's lines in order, keeping their times in order across the hour the clocks go back.
 * The log writes local time, so that hour's times come round twice; a time in it that falls about
 * an hour behind the line before is the second one. One clock per log read from start to end.
 */
export class LogClock {
  private last = -Infinity

  parse(raw: string): LogLine | null {
    const line = parseLogLine(raw)
    if (!line) return null
    // Lines are in order to within a few seconds, so a step back of close to an hour is the repeat.
    if (line.time < this.last - 60_000 && line.time + HOUR >= this.last - 60_000 && repeatedHour(line.time)) line.time += HOUR
    this.last = line.time
    return line
  }
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
const RE_ZONE = /^You have entered (.+)\.$/
const RE_NOT_ZONE = /^(?:an? (?:area|Arena)|the Drunken)/i

/** The zone a line says you entered, or null when it is not a zone change. */
export function zoneEntered(text: string): string | null {
  // Every reader asks of every line; nearly none is a zone line, and this says so before the regex.
  if (!text.startsWith('You have entered ')) return null
  const m = RE_ZONE.exec(text)
  return m && !RE_NOT_ZONE.test(m[1]) ? m[1] : null
}
