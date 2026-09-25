import { promises as fs } from 'node:fs'
import { log } from './log'

// tradeskills.json: the recipes the player starred, how many combines they plan of each, and prices
// they typed in for things the log has never seen them buy.

export interface TradeFavorite {
  /** The recipe's key: its product and ingredients (see recipeKey). */
  key: string
  product: string
  combines: number
}

export interface TradeSaved {
  favorites: TradeFavorite[]
  /** Copper for one, by lower-cased item name. */
  prices: Record<string, number>
}

const EMPTY: TradeSaved = { favorites: [], prices: {} }

/** Only what the page is allowed to store: strings where strings go, sane numbers. */
export function sanitizeTradeSaved(v: unknown): TradeSaved | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as { favorites?: unknown; prices?: unknown }
  const favorites = (Array.isArray(o.favorites) ? o.favorites : []).flatMap((f): TradeFavorite[] => {
    if (!f || typeof f !== 'object') return []
    const x = f as Record<string, unknown>
    if (typeof x.key !== 'string' || typeof x.product !== 'string' || !x.key) return []
    const combines = typeof x.combines === 'number' && Number.isFinite(x.combines) ? Math.max(1, Math.min(100_000, Math.round(x.combines))) : 1
    return [{ key: x.key.slice(0, 2000), product: x.product.slice(0, 200), combines }]
  })
  const prices: Record<string, number> = {}
  if (o.prices && typeof o.prices === 'object' && !Array.isArray(o.prices)) {
    for (const [k, n] of Object.entries(o.prices as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) prices[k.toLowerCase().slice(0, 200)] = Math.round(n)
    }
  }
  return { favorites, prices }
}

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
