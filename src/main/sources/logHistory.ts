import { createReadStream, promises as fs } from 'node:fs'
import { writeFileAtomic } from '../storeCore'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { decodeCp1252, parseLogLine, type LogLine } from '../../core/logLine'
import { fileIdentity, sameFile } from '../../core/fileIdentity'
import { characterArchives, feedZip, readLines } from '../../core/logReading'
import { log } from '../log'
import { sources } from './registry'

// Reading a character's log history: backwards from the end for the newest of something, forwards
// over a stretch, and whole (the live log plus every archive) for the counts that pages ask about.
// Logs are Windows-1252, one byte per character, so a decoded string's length is its size in bytes.

/** The identity of a file on disk, logged once when the volume has none. */
export function identityOf(st: { dev: bigint; ino: bigint }): string {
  return fileIdentity(st, () => log.info('This drive gives files no fixed identity; a log is taken as replaced only when it shrinks.'))
}

/**
 * Reads a file back from the end (or from `end`) a chunk at a time. `onChunk` gets each chunk's text
 * and where it starts, and returns true to stop. Stops at the start of the file or after `maxBytes`.
 */
export async function readChunksBackward(
  path: string,
  onChunk: (text: string, start: number) => boolean | void,
  opts: { step?: number; maxBytes?: number; stopAt?: number; end?: number } = {}
): Promise<void> {
  const step = opts.step ?? 1 << 20
  const handle = await fs.open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const top = Math.min(opts.end ?? size, size)
    const floor = Math.max(opts.stopAt ?? 0, opts.maxBytes ? top - opts.maxBytes : 0, 0)
    for (let end = top; end > floor; end -= step) {
      const start = Math.max(floor, end - step)
      const buf = Buffer.alloc(end - start)
      await handle.read(buf, 0, buf.length, start)
      if (onChunk(decodeCp1252(buf), start)) return
    }
  } finally {
    await handle.close()
  }
}

/**
 * A log's lines newest first, each with the offset it starts at. `visit` returns true to stop. The
 * first piece of each chunk may be the end of a line begun in the chunk before; it is carried back and
 * joined to that chunk's last piece. With `stopAt`, lines that start before it are not visited; with
 * `end` (a line's start), the read begins there rather than at the end of the file.
 */
export async function readBackward(
  path: string,
  visit: (raw: string, offset: number) => boolean | void,
  opts: { step?: number; maxBytes?: number; stopAt?: number; end?: number } = {}
): Promise<void> {
  let carry = ''
  await readChunksBackward(
    path,
    (text, start) => {
      const joined = text + carry
      const lines = joined.split('\n')
      carry = start > (opts.stopAt ?? 0) ? (lines.shift() ?? '') : ''
      // Just past the last piece: each piece is followed by the newline split took away.
      let offset = start + joined.length + 1
      for (let i = lines.length - 1; i >= 0; i--) {
        offset -= lines[i].length + 1
        const raw = lines[i].replace(/\r$/, '')
        if (raw && visit(raw, offset)) return true
      }
    },
    opts
  )
}

/** The start of the first whole line at or after `pos`: just past the next newline (the end of the file when none). */
export async function lineStartAfter(path: string, pos: number): Promise<number> {
  if (pos <= 0) return 0
  const handle = await fs.open(path, 'r')
  try {
    const buf = Buffer.alloc(1 << 16)
    for (let at = pos - 1; ; at += buf.length) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, at)
      if (!bytesRead) return at
      const nl = buf.subarray(0, bytesRead).indexOf(10)
      if (nl >= 0) return at + nl + 1
    }
  } finally {
    await handle.close()
  }
}

/** Streams a stretch of a log forwards (see readLines); `end` is exclusive. */
export function readForward(path: string, from: number, end: number | undefined, onLine: (line: LogLine) => void, opts: { flushLast?: boolean } = {}): Promise<number> {
  return readLines(createReadStream(path, { start: from, ...(end !== undefined ? { end: end - 1 } : {}) }), onLine, opts)
}

/**
 * Where to start reading a log to see every line stamped at or after `time`: the start of a line
 * stamped earlier, within a few kilobytes of the first one that is not. Lines are written in time
 * order, so a binary search over the file's bytes finds it in a few dozen small reads however big the
 * log (a live log runs to the archiver's 300 MB). 0 when the whole log is newer. `slackMs` looks further
 * back than asked: in the hour clocks go back, stamps repeat, and a read that must miss nothing allows
 * for it. `step` is how much is read at each look, enough for a whole line.
 */
export async function offsetBefore(path: string, time: number, opts: { step?: number; slackMs?: number } = {}): Promise<number> {
  const before = time - (opts.slackMs ?? 0)
  const step = opts.step ?? 1 << 12
  const handle = await fs.open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const buf = Buffer.alloc(step)
    /** The first whole stamped line at or after `pos`: where it starts and its time; null when the look holds none. */
    const lineAt = async (pos: number): Promise<{ at: number; time: number } | null> => {
      const { bytesRead } = await handle.read(buf, 0, step, pos)
      const text = decodeCp1252(buf.subarray(0, bytesRead))
      // The first piece may be the tail of a line that began before `pos`.
      let at = pos === 0 ? 0 : text.indexOf('\n') + 1
      if (at === 0 && pos > 0) return null
      while (at < text.length) {
        const nl = text.indexOf('\n', at)
        // A line the look cuts off is not read, unless the file ends there.
        if (nl < 0 && pos + bytesRead < size) return null
        const line = parseLogLine(text.slice(at, nl < 0 ? undefined : nl).replace(/\r$/, ''))
        if (line) return { at: pos + at, time: line.time }
        if (nl < 0) return null
        at = nl + 1
      }
      return null
    }
    let found = 0
    let lo = 0
    let hi = size
    while (hi - lo > step) {
      const mid = lo + Math.floor((hi - lo) / 2)
      const hit = await lineAt(mid)
      // A look with no stamped line in it counts as too late: the search goes earlier, which reads more but misses nothing.
      if (hit && hit.time < before) {
        found = hit.at
        lo = mid
      } else hi = mid
    }
    return found
  } finally {
    await handle.close()
  }
}

// ---- Whole history, counted once ----

/** One thing counted over a character's whole log history: casts, melee, purchases. */
export interface HistoryConsumer<T> {
  /** Bumped when what it keeps changes, so values cached by an older build are read again. */
  version: number
  empty(): T
  /** Made fresh for each stretch of log read, so it may keep state across lines. */
  reader(): LineReader<T>
}

/** Declared as a method so a consumer of any value type fits a list of consumers. */
type LineReader<T> = { read(line: LogLine, into: T): void }['read']

type Values = Record<string, { version: number; value: unknown }>

/**
 * The cache is written this long after its first unsaved change, and at quit, not after every read:
 * pages and the achievements sweep read every few seconds while playing, and the file is the whole
 * history (half a megabyte and growing). A crash loses at most this much, which the next read makes up.
 */
const SAVE_AFTER_MS = 90_000
/** A read or a save slower than this is logged, with its size: the cost to watch (README, Measuring). */
const SLOW_MS = 250

interface CacheFile {
  version: 1
  /** By archive file name; archives never change, so each is read once. */
  archives: Record<string, { size: number; values: Values }>
  /** By lower-cased log path: how far into the live log the values go. */
  live: Record<string, { id: string; offset: number; values: Values }>
}

export interface HistorySlice<T> {
  /** The archives read, oldest first, with the last date each covers. */
  archives: { name: string; end: string; value: T }[]
  live: T
}

export interface HistoryWhere {
  logPath: string
  archiveDir: string
  /** "eqlog_Kelwyn_neriak": only archives named for it are read. */
  stem: string
}

/**
 * Every consumer's values over each character's live log and archives, kept in one cache file. One
 * read brings them all up to date together, so a log is read once however many pages ask, and only
 * what the live log has gained since is read again.
 */
export class LogHistory {
  private cache: CacheFile | null = null
  /** One read at a time, so two asking at once never read the same tail twice. */
  private queue: Promise<unknown> = Promise.resolve()
  /** Changed since the file was last written; written when the timer runs out or at flush(). */
  private dirty = false
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(
    private readonly cacheFile: string,
    private readonly consumers: Record<string, HistoryConsumer<unknown>>
  ) {}

  /**
   * One consumer's values, after bringing every consumer up to date. `wantArchive` says which
   * archives are needed, by name and the last date each covers ("2026-09-24"); all by default.
   */
  get<T>(key: string, where: HistoryWhere, wantArchive: (name: string, end: string) => boolean = () => true): Promise<HistorySlice<T>> {
    const run = this.queue
      .then(() => this.read<T>(key, where, wantArchive))
      .then(
        (slice) => {
          sources.ok('history', `${where.stem.replace(/^eqlog_/, '')}: ${slice.archives.length} archive${slice.archives.length === 1 ? '' : 's'} and the live log`)
          return slice
        },
        (e: unknown) => {
          sources.fail('history', e)
          throw e
        }
      )
    this.queue = run.catch(() => undefined)
    return run
  }

  private async load(): Promise<CacheFile> {
    if (this.cache) return this.cache
    try {
      const p = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as CacheFile
      if (p.version === 1 && p.archives && p.live) {
        // Values of a consumer the app no longer has (a page since removed) are dropped, not kept for ever.
        for (const entry of [...Object.values(p.archives), ...Object.values(p.live)])
          for (const k of Object.keys(entry.values ?? {})) if (!(k in this.consumers)) delete entry.values[k]
        this.cache = p
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Log history cache ${this.cacheFile} unreadable; reading again:`, e)
    }
    this.cache ??= { version: 1, archives: {}, live: {} }
    return this.cache
  }

  /** Something changed: written within SAVE_AFTER_MS, however many reads change it meanwhile. */
  private changed(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_AFTER_MS)
    this.saveTimer.unref?.()
  }

  /** Writes what is unsaved now: at quit, and when the timer runs out. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.saving = this.saving.then(() => (this.dirty ? this.save() : undefined))
    return this.saving
  }

  private async save(): Promise<void> {
    this.dirty = false
    const started = performance.now()
    const text = JSON.stringify(this.cache)
    try {
      await writeFileAtomic(this.cacheFile, text)
    } catch (e) {
      this.dirty = true
      log.warn(`Could not save the log history cache ${this.cacheFile}:`, e)
    }
    const ms = performance.now() - started
    if (ms > SLOW_MS) log.info(`Log history: saved ${(text.length / 1048576).toFixed(1)} MB in ${Math.round(ms)} ms`)
  }

  /** The consumers whose values in `values` are missing or from an older version. */
  private stale(values: Values): string[] {
    return Object.entries(this.consumers)
      .filter(([k, c]) => values[k]?.version !== c.version)
      .map(([k]) => k)
  }

  /** Reads a stream into the given consumers' values. */
  private async feed(stream: Readable, keys: string[], values: Values, flushLast: boolean): Promise<number> {
    const readers = keys.map((k) => {
      values[k] ??= { version: this.consumers[k].version, value: this.consumers[k].empty() }
      return { read: this.consumers[k].reader(), into: values[k].value }
    })
    return readLines(stream, (line) => readers.forEach((r) => r.read(line, r.into)), { flushLast })
  }

  private async read<T>(key: string, where: HistoryWhere, wantArchive: (name: string, end: string) => boolean): Promise<HistorySlice<T>> {
    const cache = await this.load()
    const started = performance.now()
    let bytes = 0
    let changed = false
    const out: HistorySlice<T> = { archives: [], live: this.consumers[key].empty() as T }

    for (const name of await characterArchives(where.archiveDir, where.stem, log.warn)) {
      // "…_2026-08-07_to_2026-09-24.zip", "…_thru-2026-08-07.zip": the last date is where it ends.
      const end = [...name.matchAll(/(\d{4}-\d{2}-\d{2})/g)].pop()?.[1] ?? ''
      if (!wantArchive(name, end)) continue
      const path = join(where.archiveDir, name)
      const size = (await fs.stat(path).catch(() => null))?.size ?? 0
      let entry = cache.archives[name]
      if (entry?.size !== size) entry = cache.archives[name] = { size, values: {} }
      const stale = this.stale(entry.values)
      if (stale.length) {
        const values: Values = { ...entry.values }
        for (const k of stale) delete values[k]
        try {
          if (name.toLowerCase().endsWith('.zip')) await feedZip(path, async (s) => (bytes += await this.feed(s, stale, values, true)))
          else bytes += await this.feed(createReadStream(path), stale, values, true)
        } catch (e) {
          log.warn(`Log history: could not read ${path}; leaving it out:`, e)
          delete cache.archives[name]
          continue
        }
        entry.values = values
        changed = true
      }
      out.archives.push({ name, end, value: entry.values[key].value as T })
    }

    let st
    try {
      st = await fs.stat(where.logPath, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Log history: could not look at ${where.logPath}:`, e)
    }
    if (st) {
      const pathKey = where.logPath.toLowerCase()
      const id = identityOf(st)
      const size = Number(st.size)
      let live = cache.live[pathKey]
      // A new file at this path, the same file cut short, or a consumer that has not read it: from the top.
      if (!live || !sameFile({ id: live.id, size: live.offset }, { id, size }) || this.stale(live.values).length) {
        live = cache.live[pathKey] = { id, offset: 0, values: {} }
        changed = true
      }
      if (size > live.offset) {
        // Read into a copy: a read that fails part way leaves the values and the offset as they were.
        const values = structuredClone(live.values)
        const read = await this.feed(createReadStream(where.logPath, { start: live.offset }), Object.keys(this.consumers), values, false)
        bytes += read
        if (read > 0) {
          cache.live[pathKey] = { id, offset: live.offset + read, values }
          changed = true
        }
      }
      const v = cache.live[pathKey].values[key]
      if (v) out.live = v.value as T
    }
    if (changed) this.changed()
    const ms = performance.now() - started
    if (ms > SLOW_MS) log.info(`Log history: read ${(bytes / 1048576).toFixed(1)} MB of ${where.stem} in ${Math.round(ms)} ms`)
    return out
  }
}
