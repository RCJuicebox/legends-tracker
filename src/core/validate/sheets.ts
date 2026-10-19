import { type CharacterSheet } from '../../shared/types'
import type { TradeFavorite, TradeSaved } from '../../shared/ipc'
import { isObj } from './args'
import { num } from './settings'

// The Stats page's sheet and the Tradeskills favourites.

/** The largest Stats page input the sheet keeps, as JSON: far above any real one. */
export const SHEET_STATS_MAX = 200_000

/** A character sheet from the Stats and Gear pages; null when it is not one. */
export function sanitizeSheet(v: unknown): CharacterSheet | null {
  if (!isObj(v)) return null
  const acOverrides: Record<string, number> = {}
  if (isObj(v.acOverrides)) {
    for (const [k, n] of Object.entries(v.acOverrides)) if (typeof n === 'number' && Number.isFinite(n)) acOverrides[k.slice(0, 200)] = num(n, 0, -10_000, 10_000)
  }
  const stats = isObj(v.stats) ? v.stats : {}
  if (JSON.stringify(stats).length > SHEET_STATS_MAX) return null
  return { acOverrides, shield: typeof v.shield === 'boolean' ? v.shield : null, stats }
}

/** tradeskills.json, the Tradeskills page's favourites: only what the page is allowed to store, strings where strings go, sane numbers. */
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
