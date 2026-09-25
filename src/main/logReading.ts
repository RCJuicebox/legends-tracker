import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'
import { decodeCp1252, parseLogLine, type LogLine } from '../core/logLine'
import { log } from './log'

// Reading character logs and their archives, shared by mote history, cast counts and catch-up.
// Logs are Windows-1252, one byte per character, so a decoded string's length is its size in bytes.

/**
 * Streams a log's lines, yielding to the event loop now and then so the live tailer and overlays keep
 * running. Returns how many bytes were read up to the end of the last line handed over. A last line
 * with no newline yet is handed over too unless `flushLast` is false: a live log may be mid-write.
 */
export async function readLines(
  stream: Readable,
  onLine: (line: LogLine) => void,
  opts: { onBytes?: (bytes: number) => void; flushLast?: boolean } = {}
): Promise<number> {
  let partial = ''
  let pos = 0
  let n = 0
  for await (const chunk of stream) {
    opts.onBytes?.((chunk as Buffer).length)
    const lines = (partial + decodeCp1252(chunk as Buffer)).split('\n')
    partial = lines.pop() ?? ''
    for (const raw of lines) {
      pos += raw.length + 1
      const line = parseLogLine(raw.replace(/\r$/, ''))
      if (line) onLine(line)
    }
    if (++n % 8 === 0) await new Promise((r) => setImmediate(r))
  }
  if (partial && opts.flushLast !== false) {
    pos += partial.length
    const line = parseLogLine(partial.replace(/\r$/, ''))
    if (line) onLine(line)
  }
  return pos
}

/** Feeds each .txt entry of a zipped log to `feed`, one after another. */
export function feedZip(path: string, feed: (s: Readable) => Promise<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open archive'))
      zip.on('error', reject)
      zip.on('end', () => resolve())
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.toLowerCase().endsWith('.txt')) return zip.readEntry()
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error('could not read archive'))
          feed(stream).then(() => zip.readEntry(), reject)
        })
      })
      zip.readEntry()
    })
  })
}

/** The unpacked size of a zip's .txt entries, read from its directory without unpacking anything. */
export function zipTextSize(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open archive'))
      let size = 0
      zip.on('error', reject)
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.toLowerCase().endsWith('.txt')) size += entry.uncompressedSize
        zip.readEntry()
      })
      zip.on('end', () => resolve(size))
      zip.readEntry()
    })
  })
}

/** Whether an archive file belongs to a log stem: "eqlog_Kelwyn_neriak_2026-08-07_to_2026-09-24.zip". */
export function isArchiveOf(name: string, stem: string): boolean {
  return name.toLowerCase().startsWith(stem.toLowerCase() + '_') && /\.(zip|txt)$/i.test(name)
}

/**
 * The names of one character's archives, oldest first. Archive names carry their dates;
 * "thru-2026-08-07" sorts before "2026-08-07_to_…" on its own, so order by the first date instead.
 */
export async function characterArchives(archiveDir: string, stem: string): Promise<string[]> {
  let names: string[] = []
  try {
    names = (await fs.readdir(archiveDir)).filter((f) => isArchiveOf(f, stem))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not list the archive folder ${archiveDir}:`, e)
    return []
  }
  const firstDate = (p: string) => (/thru-/.test(p) ? '0' : (/(\d{4}-\d{2}-\d{2})/.exec(p)?.[1] ?? ''))
  return names.sort((a, b) => firstDate(a).localeCompare(firstDate(b)))
}

/** The same as characterArchives, as full paths. */
export async function characterArchivePaths(archiveDir: string, stem: string): Promise<string[]> {
  return (await characterArchives(archiveDir, stem)).map((f) => join(archiveDir, f))
}

/**
 * Where to start reading a log to see every line stamped at or after `time`: the start of a line
 * stamped earlier, found by reading back from the end a chunk at a time. Log lines are written in
 * time order, so everything after that line is newer. 0 when the whole log is newer.
 */
export async function offsetBefore(path: string, time: number, step = 1 << 20): Promise<number> {
  const handle = await fs.open(path, 'r')
  try {
    const size = (await handle.stat()).size
    for (let end = size; end > 0; end -= step) {
      const start = Math.max(0, end - step)
      const buf = Buffer.alloc(end - start)
      await handle.read(buf, 0, buf.length, start)
      const text = buf.toString('latin1')
      // The chunk's first piece may be the tail of a line that began in the chunk before.
      let at = start === 0 ? 0 : text.indexOf('\n') + 1
      if (at === 0 && start > 0) continue
      while (at < text.length) {
        const nl = text.indexOf('\n', at)
        const line = parseLogLine(text.slice(at, nl < 0 ? undefined : nl).replace(/\r$/, ''))
        if (line) {
          if (line.time < time) return start + at
          break
        }
        if (nl < 0) break
        at = nl + 1
      }
    }
    return 0
  } finally {
    await handle.close()
  }
}
