import { useState } from 'react'
import { slotLabel, type InvItem } from '../../../core/inventory'
import type { PieceSource } from '../../../core/gearOptimizer'
import type { CatalogItem } from '../../../core/wikiItem'

// Small pieces the Gear tools share: icons, wiki links, where an item is.

export const num = (n: number) => Math.round(n).toLocaleString()
export const pct = (n: number) => `${Math.round(n * 10) / 10}%`
const itemIconUrl = (icon?: number) => (icon && icon >= 500 ? `eqicon://item/${icon}` : '')
export const wikiUrl = (title: string) => `https://eqlwiki.com/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}`

export function Icon({ icon, size = 34 }: { icon?: number; size?: number }) {
  const [ok, setOk] = useState(true)
  const src = itemIconUrl(icon)
  if (!src || !ok) return <span className="lt-icon blank" style={{ width: size, height: size }} />
  return <img className="lt-icon" src={src} width={size} height={size} alt="" onError={() => setOk(false)} />
}

/** Where an item comes from, in a few words: the zone and who drops it, or quest / crafted. */
export function source(item: CatalogItem): string {
  const parts: string[] = []
  if (item.zones.length) parts.push(item.zones.slice(0, 2).join(', ') + (item.mobs.length ? ` · ${item.mobs.slice(0, 2).join(', ')}` : ''))
  else if (item.mobs.length) parts.push(item.mobs.slice(0, 2).join(', '))
  if (item.quest) parts.push('quest')
  if (item.crafted) parts.push('crafted')
  return parts.join(' · ') || 'source not listed'
}

/** Where a piece the character owns is now. */
export function whereText(from: PieceSource, item: InvItem): string {
  if (from === 'worn') return `worn in ${slotLabel(item.location)}`
  if (from === 'bags') return `in your bags (${item.location.split('-')[0]})`
  if (from === 'bank') return 'in your bank'
  return 'in the shared bank'
}
