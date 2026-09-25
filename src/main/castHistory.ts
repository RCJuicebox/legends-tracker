import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'
import { readLines } from './moteHistory'

// What a character casts, and how often, counted from their logs: "You begin casting Envenomed Bolt X."
// Counts are kept per day so a window (the last two weeks) can be taken. Archives never change, so
// each is read once and its counts kept on disk; the live log is read again when it has grown.

type Days = Record<string, Record<string, number>>

const CAST = /^You begin (?:casting|singing) (.+)\.$/

const dayOf = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function countStream(stream: Readable, into: Days): Promise<void> {
  await readLines(stream, (line) => {
    const m = CAST.exec(line.text)
    if (!m) return
    const day = (into[dayOf(line.time)] ??= {})
    day[m[1]] = (day[m[1]] ?? 0) + 1
  })
}

function countZip(path: string, into: Days): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('could not open archive'))
      zip.on('error', reject)
      zip.on('end', () => resolve())
      zip.on('entry', (entry: yauzl.Entry) => {
        if (!entry.fileName.toLowerCase().endsWith('.txt')) return zip.readEntry()
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error('could not read archive'))
          countStream(stream, into).then(() => zip.readEntry(), reject)
        })
      })
      zip.readEntry()
    })
  })
}

export interface CastCounts {
  /** Casts by the name the log gives ("Envenomed Bolt X"). */
  counts: Record<string, number>
  total: number
  /** The first and last day counted, "2026-09-10". */
  from: string
  to: string
}

export class CastHistory {
  private archives: Record<string, { size: number; days: Days }> | null = null
  private live = { path: '', size: -1, mtime: 0, days: {} as Days }

  constructor(private readonly cacheFile: string) {}

  private async archiveCache() {
    if (!this.archives) {
      try {
        this.archives = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'))
      } catch {
        this.archives = {}
      }
    }
    return this.archives!
  }

  /** Casts over the last `days` days of play (0 for all of it), ending at the newest cast. */
  async recent(o: { logPath: string; archiveDir: string; stem: string; days: number }): Promise<CastCounts> {
    const st = await fs.stat(o.logPath).catch(() => null)
    if (st && (this.live.path !== o.logPath || this.live.size !== st.size || this.live.mtime !== st.mtimeMs)) {
      const days: Days = {}
      await countStream(createReadStream(o.logPath), days)
      this.live = { path: o.logPath, size: st.size, mtime: st.mtimeMs, days }
    }
    const liveDays = st ? this.live.days : {}
    const newest = Object.keys(liveDays).sort().pop() ?? dayOf(Date.now())
    const cutoff = o.days ? dayOf(new Date(newest + 'T12:00:00').getTime() - (o.days - 1) * 86400_000) : ''
    const oldestLive = Object.keys(liveDays).sort()[0] ?? newest

    const all: Days[] = [liveDays]
    // Archives only when the live log does not reach back far enough.
    if (!o.days || oldestLive > cutoff) {
      const cache = await this.archiveCache()
      let names: string[] = []
      try {
        names = (await fs.readdir(o.archiveDir)).filter((f) => f.toLowerCase().startsWith(o.stem.toLowerCase() + '_') && /\.(zip|txt)$/i.test(f))
      } catch {
        // no archive folder
      }
      let changed = false
      for (const name of names) {
        // "…_2026-08-07_to_2026-09-24.zip", "…_thru-2026-08-07.zip": the last date is where it ends.
        const end = [...name.matchAll(/(\d{4}-\d{2}-\d{2})/g)].pop()?.[1] ?? ''
        if (cutoff && end && end < cutoff) continue
        const path = join(o.archiveDir, name)
        const size = (await fs.stat(path).catch(() => null))?.size ?? 0
        if (cache[name]?.size !== size) {
          const days: Days = {}
          try {
            if (name.toLowerCase().endsWith('.zip')) await countZip(path, days)
            else await countStream(createReadStream(path), days)
          } catch {
            continue
          }
          cache[name] = { size, days }
          changed = true
        }
        all.push(cache[name].days)
      }
      if (changed) await fs.writeFile(this.cacheFile, JSON.stringify(cache), 'utf8').catch(() => undefined)
    }

    const counts: Record<string, number> = {}
    let total = 0
    let from = ''
    let to = ''
    for (const days of all) {
      for (const [day, casts] of Object.entries(days)) {
        if (cutoff && day < cutoff) continue
        if (!from || day < from) from = day
        if (!to || day > to) to = day
        for (const [name, n] of Object.entries(casts)) {
          counts[name] = (counts[name] ?? 0) + n
          total += n
        }
      }
    }
    return { counts, total, from, to }
  }
}
