import { createReadStream, promises as fs } from 'node:fs'
import { writeFileAtomic } from '../storeCore'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { decodeCp1252, parseLogLine, type LogLine } from '../../core/logLine'
import { fileIdentity, sameFile } from '../../core/fileIdentity'
import { characterArchives, feedZip, isArchiveOf, readLines } from '../../core/logReading'
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
async function readChunksBackward(
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
      return false
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
  /**
   * Archives never change, so each is read once. By file name for this PC's archive folder; by
   * lower-cased path for another PC's. `at` is when the file was last written to.
   */
  archives: Record<string, { size: number; values: Values; at?: number }>
  /** By lower-cased log path: how far into the live log the values go, when it was last written to and last asked about. */
  live: Record<string, { id: string; offset: number; values: Values; askedAt?: number; at?: number }>
}

/** A live log nothing has asked about in this long (a moved Logs folder, a renamed character) is forgotten (LT-423). */
const UNASKED_MS = 60 * 86_400_000

/** One stretch of a character's log that was read: an archive, or a live log. */
export interface HistoryStretch<T> {
  /** The file's name. */
  name: string
  /** The last date an archive covers ("2026-09-24"); '' for a live log. */
  end: string
  /** When the file was last written to: what puts two PCs' stretches in order. 0 when not known. */
  at: number
  value: T
}

export interface HistorySlice<T> {
  /** This PC's archives read, oldest first, with the last date each covers. */
  archives: HistoryStretch<T>[]
  live: T
  /** When the live log was last written to; 0 when there is none. */
  liveAt: number
  /**
   * The character's archives and live logs in other PCs' Logs folders. One whose PC is out of reach
   * is as it was last read.
   */
  elsewhere: HistoryStretch<T>[]
}

/**
 * Every stretch of a slice, oldest first: the archives, then the live log; with other PCs' logs among
 * them, in the order each file was last written to. Joins that let a later stretch settle something
 * (a cap, the last rank bought) take them in this order.
 */
export function everyStretch<T>(slice: HistorySlice<T>): T[] {
  if (!slice.elsewhere.length) return [...slice.archives.map((a) => a.value), slice.live]
  const live: HistoryStretch<T> = { name: '', end: '', at: slice.liveAt || Infinity, value: slice.live }
  return [...slice.archives, ...slice.elsewhere, live]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.at - b.s.at || a.i - b.i)
    .map(({ s }) => s.value)
}

/** The character's log in another PC's Logs folder. */
interface ElsewhereLog {
  /** The Logs folder, as the settings name it: whether it answers is asked by this. */
  folder: string
  logPath: string
  archiveDir: string
}

export interface HistoryWhere {
  logPath: string
  archiveDir: string
  /** "eqlog_Kelwyn_neriak": only archives named for it are read. */
  stem: string
  /** The same character's logs on other PCs (Settings › Game). */
  elsewhere?: ElsewhereLog[]
}

/** "…_2026-08-07_to_2026-09-24.zip", "…_thru-2026-08-07.zip": the last date is where it ends. */
const archiveEnd = (name: string): string => [...name.matchAll(/(\d{4}-\d{2}-\d{2})/g)].pop()?.[1] ?? ''

/** What one read did, for the cache and the slow-read line. */
interface ReadRun {
  bytes: number
  changed: boolean
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
    private readonly consumers: Record<string, HistoryConsumer<unknown>>,
    /** Whether another PC's Logs folder answers now (LogFolders): one that does not is never touched. */
    readonly reachable: (folder: string) => Promise<boolean> = async () => true
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
          sources.ok(
            'history',
            `${where.stem.replace(/^eqlog_/, '')}: ${slice.archives.length} archive${slice.archives.length === 1 ? '' : 's'} and the live log${slice.elsewhere.length ? `, and ${slice.elsewhere.length} from other PCs` : ''}`
          )
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
        // Live logs unasked for two months go; one kept before this was noted counts as asked now.
        const now = Date.now()
        for (const [path, entry] of Object.entries(p.live)) {
          if (now - (entry.askedAt ?? now) > UNASKED_MS) delete p.live[path]
          else entry.askedAt ??= now
        }
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
    const run: ReadRun = { bytes: 0, changed: false }
    const out: HistorySlice<T> = { archives: [], live: this.consumers[key].empty() as T, liveAt: 0, elsewhere: [] }

    out.archives = await this.readArchives<T>(cache, key, where.archiveDir, where.stem, wantArchive, (name) => name, run)
    const live = await this.readLive<T>(cache, key, where.logPath, run, false)
    if (live) {
      out.live = live.value
      out.liveAt = live.at
    }
    for (const o of where.elsewhere ?? []) {
      if (o.logPath.toLowerCase() === where.logPath.toLowerCase()) continue
      // Another PC's archives are kept by path: two PCs' archives can share a name.
      const keyOf = (name: string) => join(o.archiveDir, name).toLowerCase()
      if (await this.reachable(o.folder)) {
        out.elsewhere.push(...(await this.readArchives<T>(cache, key, o.archiveDir, where.stem, wantArchive, keyOf, run)))
        const there = await this.readLive<T>(cache, key, o.logPath, run, true)
        if (there) out.elsewhere.push(there)
      } else out.elsewhere.push(...this.lastRead<T>(cache, key, o.logPath, where.stem, wantArchive, keyOf))
    }

    if (run.changed) this.changed()
    const ms = performance.now() - started
    if (ms > SLOW_MS) log.info(`Log history: read ${(run.bytes / 1048576).toFixed(1)} MB of ${where.stem} in ${Math.round(ms)} ms`)
    return out
  }

  /** A character's archives in one folder, read where the cache has not got them; `keyOf` names each in the cache. */
  private async readArchives<T>(
    cache: CacheFile,
    key: string,
    dir: string,
    stem: string,
    wantArchive: (name: string, end: string) => boolean,
    keyOf: (name: string) => string,
    run: ReadRun
  ): Promise<HistoryStretch<T>[]> {
    const out: HistoryStretch<T>[] = []
    const listed = await characterArchives(dir, stem, log.warn)
    // This character's archives no longer in the folder (moved, deleted) are forgotten (LT-423); a
    // folder that could not be read says nothing either way.
    const present = new Set(listed.map(keyOf))
    const looked =
      listed.length > 0 ||
      (await fs.access(dir).then(
        () => true,
        (e: NodeJS.ErrnoException) => e.code === 'ENOENT'
      ))
    if (looked)
      for (const k of Object.keys(cache.archives))
        if (keyOf(basename(k)) === k && isArchiveOf(basename(k), stem) && !present.has(k)) {
          delete cache.archives[k]
          run.changed = true
        }
    for (const name of listed) {
      const end = archiveEnd(name)
      if (!wantArchive(name, end)) continue
      const path = join(dir, name)
      const k = keyOf(name)
      const st = await fs.stat(path).catch(() => null)
      const size = st?.size ?? 0
      let entry = cache.archives[k]
      if (entry?.size !== size) entry = cache.archives[k] = { size, values: {} }
      if (st && entry.at !== st.mtimeMs) {
        entry.at = st.mtimeMs
        run.changed = true
      }
      const stale = this.stale(entry.values)
      if (stale.length) {
        const values: Values = { ...entry.values }
        for (const c of stale) delete values[c]
        try {
          if (name.toLowerCase().endsWith('.zip')) await feedZip(path, async (s) => (run.bytes += await this.feed(s, stale, values, true)))
          else run.bytes += await this.feed(createReadStream(path), stale, values, true)
        } catch (e) {
          log.warn(`Log history: could not read ${path}; leaving it out:`, e)
          delete cache.archives[k]
          continue
        }
        entry.values = values
        run.changed = true
      }
      out.push({ name, end, at: entry.at ?? 0, value: entry.values[key].value as T })
    }
    return out
  }

  /**
   * A live log brought up to date; null when it is not there. Another PC's (`apart`) is read into a
   * copy: its PC can go away part way through a read, and its last good counts stand until it is back.
   */
  private async readLive<T>(cache: CacheFile, key: string, logPath: string, run: ReadRun, apart: boolean): Promise<HistoryStretch<T> | null> {
    let st
    try {
      st = await fs.stat(logPath, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Log history: could not look at ${logPath}:`, e)
    }
    if (!st) return null
    const pathKey = logPath.toLowerCase()
    const id = identityOf(st)
    const size = Number(st.size)
    let live = cache.live[pathKey]
    // A new file at this path, or the same file cut short: from the top, for every consumer.
    if (!live || !sameFile({ id: live.id, size: live.offset }, { id, size })) {
      live = cache.live[pathKey] = { id, offset: 0, values: {} }
      run.changed = true
    } else {
      // A consumer new, or bumped to a new version, reads alone up to where the others have got; the
      // others' counts stand, and all go on together from there.
      const stale = this.stale(live.values)
      if (stale.length && live.offset > 0) {
        const values = structuredClone(live.values)
        for (const k of stale) delete values[k]
        run.bytes += await this.feed(createReadStream(logPath, { start: 0, end: live.offset - 1 }), stale, values, true)
        live = cache.live[pathKey] = { ...live, id, values }
        run.changed = true
      }
    }
    if (size > live.offset) {
      // This PC's log is read into the values kept, not a copy of them (half a megabyte cloned per
      // Factions poll, LT-378): reads are one at a time, and one that fails part way has counted lines
      // the offset does not cover, so those counts go and this log is read from the top next time.
      const into = apart ? structuredClone(live.values) : live.values
      try {
        const read = await this.feed(createReadStream(logPath, { start: live.offset }), Object.keys(this.consumers), into, false)
        run.bytes += read
        if (read > 0) {
          live.values = into
          live.offset += read
          run.changed = true
        }
      } catch (e) {
        if (!apart) {
          delete cache.live[pathKey]
          this.changed()
          throw e
        }
        log.warn(`Log history: could not read ${logPath}; its counts stay as they were:`, e)
      }
    }
    const at = Number(st.mtimeMs)
    if (live.at !== at) {
      live.at = at
      run.changed = true
    }
    live.askedAt = Date.now()
    const v = live.values[key]
    // The asker's own copy of its one value: the one kept is read into in place next time.
    return { name: basename(logPath), end: '', at, value: (v ? structuredClone(v.value) : this.consumers[key].empty()) as T }
  }

  /** Another PC's archives and live log as they were last read, while that PC is out of reach. */
  private lastRead<T>(
    cache: CacheFile,
    key: string,
    logPath: string,
    stem: string,
    wantArchive: (name: string, end: string) => boolean,
    keyOf: (name: string) => string
  ): HistoryStretch<T>[] {
    const version = this.consumers[key].version
    const out: HistoryStretch<T>[] = []
    for (const [k, entry] of Object.entries(cache.archives)) {
      const name = basename(k)
      const v = entry.values[key]
      if (keyOf(name) !== k || !isArchiveOf(name, stem) || v?.version !== version || !wantArchive(name, archiveEnd(name))) continue
      out.push({ name, end: archiveEnd(name), at: entry.at ?? 0, value: v.value as T })
    }
    out.sort((a, b) => a.at - b.at)
    const live = cache.live[logPath.toLowerCase()]
    if (live) {
      // Asked about, though not read: kept while its PC is off.
      live.askedAt = Date.now()
      const v = live.values[key]
      if (v?.version === version) out.push({ name: basename(logPath), end: '', at: live.at ?? 0, value: structuredClone(v.value) as T })
    }
    return out
  }
}
