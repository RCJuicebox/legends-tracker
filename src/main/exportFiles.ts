import { promises as fs } from 'node:fs'

// The game's /outputfile exports, read one way (LT-633): left a moment after the game writes one,
// since it writes inventory, achievements and factions in the same second and a read mid-write sees a
// cut-off file (LT-417), then read once a write, kept by the time it was written.

/** How long after the game writes an export it is left before it is read. */
export const EXPORT_SETTLE_MS = 1500

/** The exports of one kind read so far, by path, each as `parse` made it. */
export class SettledReads<T> {
  private readonly kept = new Map<string, { modified: number; value: T }>()

  constructor(
    private readonly parse: (text: string) => T,
    /** How many files are kept before the lot is let go: a character or two of each kind in play. */
    private readonly keep = 20
  ) {}

  /**
   * The file at `path` as parsed, with the time it was written (`modified`, when the caller has
   * already looked). Read again only once the game has written it again, and not until that write has
   * settled; one written again meanwhile is waited for afresh. Throws as fs does (ENOENT for none).
   */
  async read(path: string, modified?: number): Promise<{ modified: number; value: T }> {
    const at = modified ?? (await fs.stat(path)).mtimeMs
    const had = this.kept.get(path)
    if (had?.modified === at) return had
    const young = EXPORT_SETTLE_MS - (Date.now() - at)
    if (young > 0) {
      await new Promise((r) => setTimeout(r, Math.min(young, EXPORT_SETTLE_MS)))
      if ((await fs.stat(path)).mtimeMs !== at) return this.read(path)
    }
    const read = { modified: at, value: this.parse(await fs.readFile(path, 'utf8')) }
    if (this.kept.size >= this.keep) this.kept.clear()
    this.kept.set(path, read)
    return read
  }
}

/** The game folder's names as last listed, and the folder's time then (its entries' last change). */
let listing: { dir: string; mtime: number; names: string[] } | null = null

/**
 * The names in the game folder, listed again only when its entries change (a new export is a new
 * entry; one written over keeps its name, and its own time says so). The folder holds some three
 * thousand files and the pages ask every few seconds (LT-633). Throws as fs does (ENOENT for none).
 */
export async function gameFolderNames(dir: string): Promise<string[]> {
  const mtime = (await fs.stat(dir)).mtimeMs
  if (!listing || listing.dir !== dir || listing.mtime !== mtime) listing = { dir, mtime, names: await fs.readdir(dir) }
  return listing.names
}
