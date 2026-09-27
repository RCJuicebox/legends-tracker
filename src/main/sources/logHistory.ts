import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { decodeCp1252, parseLogLine, type LogLine } from '../../core/logLine'
import { fileIdentity, sameFile } from '../../core/fileIdentity'
import { characterArchives, feedZip, readLines } from '../logReading'
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
 * Reads a file back from the end a chunk at a time. `onChunk` gets each chunk's text and where it
 * starts, and returns true to stop. Stops at the start of the file or after `maxBytes`.
 */
export async function readChunksBackward(
  path: string,
  onChunk: (text: string, start: number) => boolean | void,
  opts: { step?: number; maxBytes?: number; stopAt?: number } = {}
): Promise<void> {
  const step = opts.step ?? 1 << 20
  const handle = await fs.open(path, 'r')
  try {
    const size = (await handle.stat()).size
    const floor = Math.max(opts.stopAt ?? 0, opts.maxBytes ? size - opts.maxBytes : 0, 0)
    for (let end = size; end > floor; end -= step) {
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
 * joined to that chunk's last piece. With `stopAt`, lines that start before it are not visited.
 */
export async function readBackward(
  path: string,
  visit: (raw: string, offset: number) => boolean | void,
  opts: { step?: number; maxBytes?: number; stopAt?: number } = {}
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

/** Streams a stretch of a log forwards (see readLines); `end` is exclusive. */
export function readForward(path: string, from: number, end: number | undefined, onLine: (line: LogLine) => void, opts: { flushLast?: boolean } = {}): Promise<number> {
  return readLines(createReadStream(path, { start: from, ...(end !== undefined ? { end: end - 1 } : {}) }), onLine, opts)
}

/**
 * Where to start reading a log to see every line stamped at or after `time`: the start of a line
 * stamped earlier, found a chunk at a time from the end. Lines are written in time order, so what
 * follows it is newer. 0 when the whole log is newer. `slackMs` looks further back than asked: in the
 * hour clocks go back, stamps repeat, and a read that must miss nothing allows for it.
 */
export async function offsetBefore(path: string, time: number, opts: { step?: number; slackMs?: number } = {}): Promise<number> {
  const before = time - (opts.slackMs ?? 0)
  let found = 0
  await readChunksBackward(
    path,
    (text, start) => {
      // The chunk's first piece may be the tail of a line that began in the chunk before.
      let at = start === 0 ? 0 : text.indexOf('\n') + 1
      if (at === 0 && start > 0) return
      while (at < text.length) {
        const nl = text.indexOf('\n', at)
        const line = parseLogLine(text.slice(at, nl < 0 ? undefined : nl).replace(/\r$/, ''))
        if (line) {
          if (line.time < before) {
            found = start + at
            return true
          }
          return
        }
        if (nl < 0) return
        at = nl + 1
      }
    },
    { step: opts.step }
  )
  return found
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

/** A live log read this far past what is on disk is written even if it counted nothing. */
const RESAVE_BYTES = 8 << 20

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
  /** How far into each live log the file on disk goes. */
  private readonly savedOffsets = new Map<string, number>()

  constructor(
    private readonly cacheFile: string,
    private readonly consumers: Record<string, HistoryConsumer<unknown>>
  ) {}

  /**
   * One consumer's values, after bringing every consumer up to date. `wantArchive` says which
   * archives are needed, by name and the last date each covers ("2026-09-24"); all by default.
   */
  get<T>(key: string, where: HistoryWhere, wantArchive: (name: string, end: string) => boolean = () => true): Promise<HistorySlice<T>> {
    const run = this.queue.then(() => this.read<T>(key, where, wantArchive)).then(
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
        this.cache = p
        for (const [k, v] of Object.entries(p.live)) this.savedOffsets.set(k, v.offset)
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Log history cache ${this.cacheFile} unreadable; reading again:`, e)
    }
    this.cache ??= { version: 1, archives: {}, live: {} }
    return this.cache
  }

  private async save(): Promise<void> {
    const tmp = this.cacheFile + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache), 'utf8')
      await fs.rename(tmp, this.cacheFile)
    } catch (e) {
      log.warn(`Could not save the log history cache ${this.cacheFile}:`, e)
    }
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
    let changed = false
    const out: HistorySlice<T> = { archives: [], live: this.consumers[key].empty() as T }

    for (const name of await characterArchives(where.archiveDir, where.stem)) {
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
          if (name.toLowerCase().endsWith('.zip')) await feedZip(path, (s) => this.feed(s, stale, values, true))
          else await this.feed(createReadStream(path), stale, values, true)
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
        const before = JSON.stringify(live.values)
        const values = structuredClone(live.values)
        const read = await this.feed(createReadStream(where.logPath, { start: live.offset }), Object.keys(this.consumers), values, false)
        if (read > 0) {
          cache.live[pathKey] = { id, offset: live.offset + read, values }
          // Lines that counted nothing move only the offset: that is written with the next real
          // change, or once it is far behind. Losing it costs a re-read of those lines, no more.
          const saved = this.savedOffsets.get(pathKey) ?? 0
          if (JSON.stringify(values) !== before || live.offset + read - saved > RESAVE_BYTES) changed = true
        }
      }
      const v = cache.live[pathKey].values[key]
      if (v) out.live = v.value as T
    }
    if (changed) {
      await this.save()
      for (const [k, v] of Object.entries(cache.live)) this.savedOffsets.set(k, v.offset)
    }
    return out
  }
}
