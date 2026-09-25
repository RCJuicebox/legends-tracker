import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { localDay } from '../core/dates'
import { feedZip, isArchiveOf, readLines } from './logReading'
import { log } from './log'

// What a character casts, and how often, counted from their logs: "You begin casting Envenomed Bolt X."
// Counts are kept per day so a window (the last two weeks) can be taken. Archives never change, so
// each is read once and its counts kept on disk. The live log's counts are kept too, with how far
// into it they go, so only what it has gained since is read.

type Days = Record<string, Record<string, number>>

const CAST = /^You begin (?:casting|singing) (.+)\.$/

interface LiveCounts {
  path: string
  /** The file's identity (volume and file index): a new log at the same path starts over. */
  id: string
  /** Counted up to here, the end of the last whole line. */
  offset: number
  days: Days
}

interface CacheFile {
  version: 2
  archives: Record<string, { size: number; days: Days }>
  live: LiveCounts | null
}

async function countStream(stream: Readable, into: Days, flushLast = true): Promise<number> {
  return readLines(
    stream,
    (line) => {
      const m = CAST.exec(line.text)
      if (!m) return
      const day = (into[localDay(line.time)] ??= {})
      day[m[1]] = (day[m[1]] ?? 0) + 1
    },
    { flushLast }
  )
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
  private cache: CacheFile | null = null
  /** One count at a time, so two asking at once never read the same tail twice. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly cacheFile: string) {}

  private async load(): Promise<CacheFile> {
    if (this.cache) return this.cache
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Cast history cache ${this.cacheFile} unreadable; counting again:`, e)
    }
    const p = parsed as Partial<CacheFile> | Record<string, { size: number; days: Days }> | undefined
    // The first cache was the archive table on its own.
    if (p && (p as Partial<CacheFile>).version === 2) this.cache = { version: 2, archives: (p as CacheFile).archives ?? {}, live: (p as CacheFile).live ?? null }
    else this.cache = { version: 2, archives: (p as Record<string, { size: number; days: Days }>) ?? {}, live: null }
    return this.cache
  }

  private async save(): Promise<void> {
    const tmp = this.cacheFile + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache), 'utf8')
      await fs.rename(tmp, this.cacheFile)
    } catch (e) {
      log.warn(`Could not save the cast history cache ${this.cacheFile}:`, e)
    }
  }

  /** Brings the live log's counts up to date, reading only what it has gained. */
  private async liveDays(cache: CacheFile, logPath: string): Promise<{ days: Days; changed: boolean }> {
    let st
    try {
      st = await fs.stat(logPath, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Cast history: could not look at ${logPath}:`, e)
      return { days: {}, changed: false }
    }
    const id = `${st.dev}:${st.ino}`
    const size = Number(st.size)
    let live = cache.live
    let changed = false
    // Another log, a new file at this path, or the same file cut short: count from the top.
    if (!live || live.path.toLowerCase() !== logPath.toLowerCase() || live.id !== id || size < live.offset) {
      live = cache.live = { path: logPath, id, offset: 0, days: {} }
      changed = true
    }
    if (size > live.offset) {
      const days: Days = structuredClone(live.days)
      const read = await countStream(createReadStream(logPath, { start: live.offset }), days, false)
      if (read > 0) {
        cache.live = { ...live, offset: live.offset + read, days }
        changed = true
      }
    }
    return { days: cache.live!.days, changed }
  }

  /** Casts over the last `days` days of play (0 for all of it), ending at the newest cast. */
  recent(o: { logPath: string; archiveDir: string; stem: string; days: number }): Promise<CastCounts> {
    const run = this.queue.then(() => this.count(o))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async count(o: { logPath: string; archiveDir: string; stem: string; days: number }): Promise<CastCounts> {
    const cache = await this.load()
    const live = await this.liveDays(cache, o.logPath)
    let changed = live.changed
    const liveDays = live.days
    const newest = Object.keys(liveDays).sort().pop() ?? localDay(Date.now())
    const cutoff = o.days ? localDay(new Date(newest + 'T12:00:00').getTime() - (o.days - 1) * 86400_000) : ''
    const oldestLive = Object.keys(liveDays).sort()[0] ?? newest

    const all: Days[] = [liveDays]
    // Archives only when the live log does not reach back far enough.
    if (!o.days || oldestLive > cutoff) {
      let names: string[] = []
      try {
        names = (await fs.readdir(o.archiveDir)).filter((f) => isArchiveOf(f, o.stem))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Cast history: could not list ${o.archiveDir}:`, e)
      }
      for (const name of names) {
        // "…_2026-08-07_to_2026-09-24.zip", "…_thru-2026-08-07.zip": the last date is where it ends.
        const end = [...name.matchAll(/(\d{4}-\d{2}-\d{2})/g)].pop()?.[1] ?? ''
        if (cutoff && end && end < cutoff) continue
        const path = join(o.archiveDir, name)
        const size = (await fs.stat(path).catch(() => null))?.size ?? 0
        if (cache.archives[name]?.size !== size) {
          const days: Days = {}
          try {
            if (name.toLowerCase().endsWith('.zip')) await feedZip(path, (s) => countStream(s, days))
            else await countStream(createReadStream(path), days)
          } catch (e) {
            log.warn(`Cast history: could not read ${path}; leaving it out:`, e)
            continue
          }
          cache.archives[name] = { size, days }
          changed = true
        }
        all.push(cache.archives[name].days)
      }
    }
    if (changed) await this.save()

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
