import { promises as fs } from 'node:fs'
import { log } from './log'
import { sanitizeTradeSaved } from '../core/validate'
import type { TradeFavorite, TradeSaved } from '../shared/ipc'

// tradeskills.json: the recipes the player starred, how many combines they plan of each, and prices
// they typed in for things the log has never seen them buy.

export type { TradeFavorite, TradeSaved }

const EMPTY: TradeSaved = { favorites: [], prices: {} }

export class TradeFavorites {
  private data: TradeSaved | null = null

  constructor(private readonly path: string) {}

  async get(): Promise<TradeSaved> {
    if (this.data) return this.data
    try {
      this.data = sanitizeTradeSaved(JSON.parse(await fs.readFile(this.path, 'utf8'))) ?? { ...EMPTY }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${this.path} unreadable; starting empty:`, e)
      this.data = { ...EMPTY }
    }
    return this.data
  }

  async set(input: unknown): Promise<TradeSaved> {
    const clean = sanitizeTradeSaved(input)
    if (!clean) throw new Error('The favourites were not saved: they were not in the expected form.')
    this.data = clean
    const tmp = this.path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2), 'utf8')
    await fs.rename(tmp, this.path)
    return clean
  }
}
