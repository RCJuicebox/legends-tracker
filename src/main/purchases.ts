import { createReadStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { parsePurchase, type Purchase } from '../core/tradeskills'
import { feedZip, isArchiveOf, readLines } from './logReading'
import { log } from './log'

// What a character paid for things, from their logs: "You purchased 100 Small Vial from Kizzie
// Mintopp for 1 platinum." The last purchase of each item is kept, with who sold it. Archives never
// change, so each is read once; the live log is read on from where the last read stopped, as the
// cast history does.

/** The newest purchase of each item, by lower-cased name. */
export type Purchases = Record<string, Purchase>

interface CacheFile {
  version: 1
  archives: Record<string, { size: number; bought: Purchases }>
  live: { path: string; id: string; offset: number; bought: Purchases } | null
}

function keep(into: Purchases, p: Purchase): void {
  const k = p.item.toLowerCase()
  if (!into[k] || p.at >= into[k].at) into[k] = p
}

function readStream(stream: Readable, into: Purchases, flushLast = true): Promise<number> {
  return readLines(
    stream,
    (line) => {
      if (!line.text.startsWith('You purchased ')) return
      const p = parsePurchase(line.text, line.time)
      if (p) keep(into, p)
    },
    { flushLast }
  )
}

export class PurchaseHistory {
  private cache: CacheFile | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly cacheFile: string) {}

  private async load(): Promise<CacheFile> {
    if (this.cache) return this.cache
    try {
      const p = JSON.parse(await fs.readFile(this.cacheFile, 'utf8')) as CacheFile
      if (p.version === 1) this.cache = p
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Purchase cache ${this.cacheFile} unreadable; reading again:`, e)
    }
    this.cache ??= { version: 1, archives: {}, live: null }
    return this.cache
  }

  private async save(): Promise<void> {
    const tmp = this.cacheFile + '.tmp'
    try {
      await fs.writeFile(tmp, JSON.stringify(this.cache), 'utf8')
      await fs.rename(tmp, this.cacheFile)
    } catch (e) {
      log.warn(`Could not save the purchase cache ${this.cacheFile}:`, e)
    }
  }

  /** The last price paid for each item, over the live log and every archive of it. */
  latest(o: { logPath: string; archiveDir: string; stem: string }): Promise<Purchases> {
    const run = this.queue.then(() => this.read(o))
    this.queue = run.catch(() => undefined)
    return run
  }

  private async read(o: { logPath: string; archiveDir: string; stem: string }): Promise<Purchases> {
    const cache = await this.load()
    let changed = false
    const all: Purchases = {}
    // Archives first: the live log is newer and wins.
    let names: string[] = []
    try {
      names = (await fs.readdir(o.archiveDir)).filter((f) => isArchiveOf(f, o.stem))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Purchases: could not list ${o.archiveDir}:`, e)
    }
    for (const name of names) {
      const path = join(o.archiveDir, name)
      const size = (await fs.stat(path).catch(() => null))?.size ?? 0
      if (cache.archives[name]?.size !== size) {
        const bought: Purchases = {}
        try {
          if (name.toLowerCase().endsWith('.zip')) await feedZip(path, (s) => readStream(s, bought))
          else await readStream(createReadStream(path), bought)
        } catch (e) {
          log.warn(`Purchases: could not read ${path}; leaving it out:`, e)
          continue
        }
        cache.archives[name] = { size, bought }
        changed = true
      }
      for (const p of Object.values(cache.archives[name].bought)) keep(all, p)
    }
    let st
    try {
      st = await fs.stat(o.logPath, { bigint: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Purchases: could not look at ${o.logPath}:`, e)
    }
    if (st) {
      const id = `${st.dev}:${st.ino}`
      const size = Number(st.size)
      let live = cache.live
      // Another log, a new file at this path, or the same file cut short: read from the top.
      if (!live || live.path.toLowerCase() !== o.logPath.toLowerCase() || live.id !== id || size < live.offset) {
        live = cache.live = { path: o.logPath, id, offset: 0, bought: {} }
        changed = true
      }
      if (size > live.offset) {
        const bought = { ...live.bought }
        const read = await readStream(createReadStream(o.logPath, { start: live.offset }), bought, false)
        if (read > 0) {
          cache.live = { ...live, offset: live.offset + read, bought }
          changed = true
        }
      }
      for (const p of Object.values(cache.live!.bought)) keep(all, p)
    }
    if (changed) await this.save()
    return all
  }
}
