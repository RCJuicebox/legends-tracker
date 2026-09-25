import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

// The app's own diagnostic log: %APPDATA%\Legends Tracker\logs\main.log, rolled over to main.old.log
// past 2 MB. It is what a player attaches to a bug report, so anything that fails quietly elsewhere
// is written here. No Electron import, so the engine can use it under test; until initLog() names a
// folder, lines go to the console only.

const MAX_BYTES = 2 * 1024 * 1024

let dir = ''
let file = ''

export function initLog(folder: string): void {
  dir = folder
  file = join(folder, 'main.log')
  try {
    mkdirSync(folder, { recursive: true })
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

function write(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${args.map(describe).join(' ')}\n`
  if (!file) {
    ;(level === 'info' ? console.log : console.error)(line.trimEnd())
    return
  }
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(file, join(dir, 'main.old.log'))
    appendFileSync(file, line, 'utf8')
  } catch {
    // Nowhere left to report a failure to write the log.
  }
}

export const log = {
  info: (...args: unknown[]) => write('info', args),
  warn: (...args: unknown[]) => write('warn', args),
  error: (...args: unknown[]) => write('error', args)
}
