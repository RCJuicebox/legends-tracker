import { createReadStream, promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { Readable } from 'node:stream'
import { MoteTracker, type MoteState } from '../core/motes'
import { localDay } from '../core/dates'
import { characterArchivePaths, feedZip, readLines, zipTextSize } from './logReading'
import { log } from './log'

export { readLines }

export interface MoteScanJob {
  archiveDir: string
  /**
   * The character logs to read, each with its archives. `stem` is the log's name without .txt
   * ("eqlog_Kelwyn_neriak"): only archives named for it are read. `end` stops the live log there,
   * where the live tailer took over.
   */
  logs: { logPath: string; stem: string; end?: number }[]
}

export interface CharacterScan {
  logPath: string
  stem: string
  /** This character's history on its own, as of its last line. */
  state: MoteState
  lastTime: number
  /** How far into the live log was read, to the end of the last whole line. */
  end: number
}

export interface MoteScanResult {
  characters: CharacterScan[]
  /** Every day any of the logs has a line on, "2026-09-24". */
  days: string[]
}

/**
 * Rebuilds mote history by replaying each character's logs, oldest first: its zipped and loose
 * archives, then the live log. Each character gets a tracker of its own; merging is the caller's.
 */
export async function scanMoteHistory(job: MoteScanJob, progress?: (message: string, fraction: number) => void): Promise<MoteScanResult> {
  let done = 0
  let message = ''
  let lastReport = 0
  const report = (force = false) => {
    const now = Date.now()
    if (!force && now - lastReport < 150) return
    lastReport = now
    progress?.(message, Math.min(1, done / total))
  }
  const onBytes = (bytes: number) => {
    done += bytes
    report()
  }

  const plan = await Promise.all(job.logs.map(async (l) => ({ ...l, archives: await characterArchivePaths(job.archiveDir, l.stem) })))
  // The whole job in bytes, so progress is honest: a zip counts at its unpacked size.
  const sizeOf = (p: string) => (p.toLowerCase().endsWith('.zip') ? zipTextSize(p) : fs.stat(p).then((s) => s.size)).catch(() => 0)
  const sizes = await Promise.all(plan.flatMap((l) => [...l.archives.map(sizeOf), l.end !== undefined ? Promise.resolve(l.end) : sizeOf(l.logPath)]))
  const total = Math.max(1, sizes.reduce((a, b) => a + b, 0))

  const days = new Set<string>()
  let dayFrom = 0
  let dayTo = -1
  const noteDay = (time: number) => {
    if (time >= dayFrom && time < dayTo) return
    // Days change rarely line to line; only work one out when the time leaves the last one.
    const d = new Date(time)
    dayFrom = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    dayTo = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
    days.add(localDay(time))
  }

  const characters: CharacterScan[] = []
  for (const l of plan) {
    const tracker = new MoteTracker({ active: null, sessions: [], daily: {} }, { onChange: () => {} })
    let lastTime = 0
    const feed = (stream: Readable, flushLast = true) =>
      readLines(
        stream,
        (line) => {
          tracker.handle(line)
          lastTime = line.time
          noteDay(line.time)
        },
        { onBytes, flushLast }
      )
    for (const path of l.archives) {
      message = `Reading ${basename(path)}…`
      report(true)
      try {
        if (path.toLowerCase().endsWith('.zip')) await feedZip(path, feed)
        else await feed(createReadStream(path))
      } catch (e) {
        log.warn(`Mote history: could not read ${path}; carrying on without it:`, e)
      }
    }
    message = `Reading ${basename(l.logPath)}…`
    report(true)
    let end = 0
    if (l.end === undefined || l.end > 0) {
      try {
        // Read to the end, a last line with no newline counts too; read to where the tailer took over, that is a line's end.
        end = await feed(createReadStream(l.logPath, l.end !== undefined ? { end: l.end - 1 } : {}), l.end === undefined)
      } catch (e) {
        log.warn(`Mote history: could not read ${l.logPath}:`, e)
      }
    }
    characters.push({ logPath: l.logPath, stem: l.stem, state: tracker.state, lastTime, end })
  }
  return { characters, days: [...days].sort() }
}
