import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'
import { decodeCp1252, parseLogLine, type LogLine } from '../core/logLine'
import { MoteTracker, type MoteState } from '../core/motes'

/**
 * Rebuilds mote history by replaying a character's logs, oldest first: its zipped and loose archives,
 * then the live log. Returns the state as of the last line read, plus that line's time.
 */
export async function scanMoteHistory(opts: {
  logPath: string
  archiveDir: string
  /** e.g. "eqlog_Kelwyn_neriak": only this character's archives are read. */
  stem: string
  /** What is being read, and how far through all of it (0 to 1, by bytes). */
  progress?: (message: string, fraction: number) => void
}): Promise<{ state: MoteState; lastTime: number }> {
  const tracker = new MoteTracker({ active: null, sessions: [], daily: {} }, { onChange: () => {} })
  let lastTime = 0
  let done = 0
  let total = 1
  let message = ''
  let lastReport = 0
  const report = (force = false) => {
    const now = Date.now()
    if (!force && now - lastReport < 150) return
    lastReport = now
    opts.progress?.(message, Math.min(1, done / total))
  }
  const feed = (stream: Readable) =>
    readLines(
      stream,
      (line) => {
        tracker.handle(line)
        lastTime = line.time
      },
      (bytes) => {
        done += bytes
        report()
      }
    )

  let archives: string[] = []
  try {
    archives = (await fs.readdir(opts.archiveDir))
      .filter((f) => f.toLowerCase().startsWith(opts.stem.toLowerCase() + '_') && /\.(zip|txt)$/i.test(f))
      .map((f) => join(opts.archiveDir, f))
  } catch {
    // no archive folder yet
  }
  // Archive names carry their dates; "thru-2026-08-07" sorts before "2026-08-07_to_…" on its own,
  // so order by the first date in the name instead.
  const firstDate = (p: string) => /(\d{4}-\d{2}-\d{2})/.exec(p)?.[1] ?? ''
  archives.sort((a, b) => (/thru-/.test(a) ? '0' : firstDate(a)).localeCompare(/thru-/.test(b) ? '0' : firstDate(b)))

  // The whole job in bytes, so progress is honest: a zip counts at its unpacked size.
  const sizes = await Promise.all(
    [...archives, opts.logPath].map((p) => (p.toLowerCase().endsWith('.zip') ? zipTextSize(p) : fs.stat(p).then((s) => s.size))).map((p) => p.catch(() => 0))
  )
  total = Math.max(1, sizes.reduce((a, b) => a + b, 0))

  for (const path of archives) {
    message = `Reading ${path.split(/[\\/]/).pop()}…`
    report(true)
    if (path.toLowerCase().endsWith('.zip')) await feedZip(path, feed)
    else await feed(createReadStream(path))
  }
  message = 'Reading the current log…'
  report(true)
  await feed(createReadStream(opts.logPath))
  return { state: tracker.state, lastTime }
}

/** The unpacked size of a zip's .txt entries, read from its directory without unpacking anything. */
function zipTextSize(path: string): Promise<number> {
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

/** Streams a log's lines, yielding to the event loop now and then so the live tailer and overlays keep running. */
export async function readLines(stream: Readable, onLine: (line: LogLine) => void, onBytes?: (bytes: number) => void): Promise<void> {
  let partial = ''
  let n = 0
  for await (const chunk of stream) {
    onBytes?.((chunk as Buffer).length)
    const lines = (partial + decodeCp1252(chunk as Buffer)).split('\n')
    partial = lines.pop() ?? ''
    for (const raw of lines) {
      const line = parseLogLine(raw.replace(/\r$/, ''))
      if (line) onLine(line)
    }
    if (++n % 8 === 0) await new Promise((r) => setImmediate(r))
  }
}

function feedZip(path: string, feed: (s: Readable) => Promise<void>): Promise<void> {
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
