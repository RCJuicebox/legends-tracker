import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The app's own diagnostic log: %APPDATA%\Legends Tracker\logs\main.log, rolled over past 2 MB to
// main.old.log, and that to main.old2.log. It is what a player attaches to a bug report, so anything
// that fails quietly elsewhere is written here. No Electron import, so the engine can use it under
// test; until initLog() names a folder, lines go to the console only.
//
// Times are the PC's local time with its offset from UTC, as the game's own log is local time: a line
// here and a line there can be matched by eye. A line written again and again (a page's warning every
// frame, a check failing each hour offline) is written once, then counted.

const MAX_BYTES = 2 * 1024 * 1024
/** The same line again within this long is counted, not written. */
const REPEAT_MS = 60_000

let dir = ''
let file = ''
/** What main.log holds, kept here rather than asked of the disk for every line. */
let size = 0
let last = { text: '', at: 0, repeats: 0 }

export function initLog(folder: string): void {
  dir = folder
  file = join(folder, 'main.log')
  try {
    mkdirSync(folder, { recursive: true })
    size = statSync(file, { throwIfNoEntry: false })?.size ?? 0
  } catch {
    file = ''
  }
}

/** The folder the log is written to; '' before initLog(). */
export function logDir(): string {
  return dir
}

function describe(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`
  if (typeof arg === 'string') return arg
  try {
    // undefined and functions stringify to nothing.
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

const two = (n: number) => String(n).padStart(2, '0')

/** "2026-09-30 07:45:12.345 -04:00": local time, and how far it is from UTC. */
function stamp(d = new Date()): string {
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? '-' : '+'
  const zone = `${sign}${two(Math.floor(Math.abs(off) / 60))}:${two(Math.abs(off) % 60)}`
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')} ${zone}`
}

function append(line: string): void {
  if (size + line.length > MAX_BYTES) {
    rmSync(join(dir, 'main.old2.log'), { force: true })
    try {
      renameSync(join(dir, 'main.old.log'), join(dir, 'main.old2.log'))
    } catch {
      // No older log yet.
    }
    renameSync(file, join(dir, 'main.old.log'))
    size = 0
  }
  appendFileSync(file, line, 'utf8')
  size += Buffer.byteLength(line, 'utf8')
}

function write(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const text = `${level.toUpperCase().padEnd(5)} ${args.map(describe).join(' ')}`
  const now = Date.now()
  if (text === last.text && now - last.at < REPEAT_MS) {
    last.repeats++
    last.at = now
    return
  }
  const lines = [
    ...(last.repeats ? [`${stamp(new Date(last.at))} ${last.text.slice(0, 5)} (the line above ${last.repeats} more time${last.repeats === 1 ? '' : 's'})`] : []),
    `${stamp()} ${text}`
  ]
  last = { text, at: now, repeats: 0 }
  if (!file) {
    for (const l of lines) (level === 'info' ? console.log : console.error)(l)
    return
  }
  try {
    append(lines.map((l) => l + '\n').join(''))
  } catch {
    // Nowhere left to report a failure to write the log.
  }
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args)
}
