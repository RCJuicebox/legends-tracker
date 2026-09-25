// An eqlwiki item page, as far as the upgrade finder needs it: the in-game stats block, the icon,
// its focus effect, which era the item belongs to, and where it comes from.

/** Bumped when a catalog entry gains something, so a stored catalog from an older build is fetched again. */
export const CATALOG_FORMAT = 3

export interface CatalogItem {
  title: string
  /** The in-game stats block, base (unmerged) values. */
  statsblock: string
  /** Icon number (lucy_img_ID), 500 and up; 0 when unknown. */
  icon: number
  /** The focus effect it carries ("Extended Enhancement II"); '' for none. */
  focus: string
  /** The page's era template name without " Era": 'Classic', 'Chardok Revamp' …; '' when untagged. */
  era: string
  /** Zones the page lists it dropping in. */
  zones: string[]
  /** Creatures the page lists dropping it. */
  mobs: string[]
  quest: boolean
  crafted: boolean
}

/** A template parameter's text: "|dropsfrom = …" up to the next parameter or the template's end. */
function field(content: string, name: string): string {
  const re = new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*\\w+\\s*=|\\n?\\}\\}\\s*</onlyinclude>|\\n\\}\\}\\s*(?:\\n|$))`)
  return re.exec(content)?.[1].trim() ?? ''
}

/** "[[Innoruuk_(God)|Innoruuk]]" → "Innoruuk"; "[[Plane of Hate]]" → "Plane of Hate". */
function linkTexts(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((m) => (m[2] ?? m[1]).replace(/_/g, ' ').trim())
}

/** An item page's parts, or null for a page that is not a piece of equipment (no Slot line). */
export function parseItemPage(title: string, content: string): CatalogItem | null {
  const statsblock = field(content, 'statsblock')
  if (!/\bSlot:/i.test(statsblock)) return null
  const drops = field(content, 'dropsfrom')
  const zones: string[] = []
  const mobs: string[] = []
  for (const line of drops.split('\n')) {
    const names = linkTexts(line)
    if (!names.length) continue
    ;(line.trim().startsWith('*') ? mobs : zones).push(...names)
  }
  return {
    title,
    statsblock,
    icon: Number(field(content, 'lucy_img_ID')) || 0,
    focus: field(content, 'focus_effect').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/_/g, ' ').trim(),
    era: /\{\{\s*([A-Za-z][A-Za-z ]*?)\s+Era\s*\}\}/.exec(content)?.[1] ?? '',
    zones: [...new Set(zones)],
    mobs: [...new Set(mobs)],
    quest: /\S/.test(field(content, 'relatedquests')),
    crafted: /\S/.test(field(content, 'playercrafted'))
  }
}
