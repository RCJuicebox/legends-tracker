import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { log } from './log'
import { parseJson } from '../core/json'
import { sanitizeTradeSaved } from '../core/validate'
import type { TradeSaved } from '../shared/ipc'
import { newerBuildWrote } from './schema'

// tradeskills.json: the recipes the player starred, how many combines they plan of each, and prices
// they typed in for things the log has never seen them buy.

export type { TradeSaved }

const EMPTY: TradeSaved = { favorites: [], prices: {} }

export class TradeFavorites {
  private data: TradeSaved | null = null

  constructor(private readonly path: string) {}

  async get(): Promise<TradeSaved> {
    if (this.data) return this.data
    try {
      this.data = sanitizeTradeSaved(parseJson(await fs.readFile(this.path, 'utf8'))) ?? { ...EMPTY }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${this.path} unreadable; starting empty:`, e)
      this.data = { ...EMPTY }
    }
    return this.data
  }

  async set(input: unknown): Promise<TradeSaved> {
    const clean = sanitizeTradeSaved(input)
    if (!clean) throw new Error('The favourites were not saved: they were not in the expected form.')
    // A newer version of the app wrote the file: it is read, never written over (LT-639).
    if (newerBuildWrote(this.path)) throw new Error('The favourites were not saved: a newer version of Legends Tracker wrote tradeskills.json.')
    this.data = clean
    await writeFileAtomic(this.path, JSON.stringify(clean, null, 2))
    return clean
  }
}
