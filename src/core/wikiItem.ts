// An eqlwiki item page, as far as the upgrade finder needs it: the in-game stats block, the icon,
// its focus effect, which era the item belongs to, and where it comes from.

import type { ItemSources, ItemUse } from '../shared/types'

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

const FIELD_RE = new Map<string, RegExp>()

/** A template parameter's text: "|dropsfrom = …" up to the next parameter or the template's end. */
export function field(content: string, name: string): string {
  // Cached per name. Not global, so a cached pattern keeps no lastIndex between pages.
  let re = FIELD_RE.get(name)
  if (!re) FIELD_RE.set(name, (re = fieldPattern(name)))
  return re.exec(content)?.[1].trim() ?? ''
}

function fieldPattern(name: string): RegExp {
  return new RegExp(`\\|\\s*${name}\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*\\w+\\s*=|\\n?\\}\\}\\s*</onlyinclude>|\\n\\}\\}\\s*(?:\\n|$))`)
}

/** "[[Innoruuk_(God)|Innoruuk]]" → "Innoruuk"; "[[Plane of Hate]]" → "Plane of Hate". */
export function linkTexts(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map((m) => (m[2] ?? m[1]).replace(/_/g, ' ').trim())
}

/** Wiki markup to plain words: links to their text, templates to their argument, tags dropped. */
export function plainText(wiki: string): string {
  return wiki
    .replace(/\{\{Item Lore\s*\|([\s\S]*?)\}\}/gi, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const NOTES_MAX = 280

/** What the page says the item is for. */
export function parseItemUse(content: string): ItemUse {
  let notes = plainText(field(content, 'notes'))
  if (notes.length > NOTES_MAX) notes = notes.slice(0, NOTES_MAX - 1).replace(/\s+\S*$/, '') + '…'
  const recipes: string[] = []
  let skill = ''
  for (const line of field(content, 'recipes').split('\n')) {
    const t = line.trim()
    if (!t.startsWith('*')) continue
    const names = linkTexts(t)
    if (!names.length) continue
    if (t.startsWith('**')) {
      const trivial = /trivial:?\s*(\d+)/i.exec(t)?.[1]
      recipes.push(`${skill ? `${skill}: ` : ''}${names[0]}${trivial ? ` (${trivial})` : ''}`)
    } else skill = names[0]
  }
  return { notes, quests: linkTexts(field(content, 'relatedquests')), recipes, value: plainText(field(content, 'merchant_value')), vendors: parseVendors(content), sources: parseSources(content) }
}

/**
 * Drops, forage and crafting. "dropsfrom" lists a zone link on its own line, then its creatures as
 * bullets under it; a creature before any zone goes under ''.
 */
export function parseSources(content: string): ItemSources {
  const drops: { zone: string; mobs: string[] }[] = []
  for (const line of field(content, 'dropsfrom').split('\n')) {
    const names = linkTexts(line)
    if (!names.length) continue
    if (line.trim().startsWith('*')) {
      if (!drops.length) drops.push({ zone: '', mobs: [] })
      drops[drops.length - 1].mobs.push(...names)
    } else for (const zone of names) drops.push({ zone, mobs: [] })
  }
  return { drops, foraged: [...new Set(linkTexts(field(content, 'foraged')))], crafted: /\S/.test(field(content, 'playercrafted')) }
}

export interface Vendor {
  zone: string
  npc: string
  /** Where in the zone, as the wiki says it; '' when it does not. */
  note: string
}

/** The soldby field's rows: {{ItemWhereRow | [[Rivervale]] | [[Kizzie Mintopp]] | note | (loc) }}. */
export function parseVendors(content: string): Vendor[] {
  const out: Vendor[] = []
  for (const m of field(content, 'soldby').matchAll(/\{\{ItemWhereRow\w*\s*\|([^\n]*?)\}\}/g)) {
    const cells = m[1].split(/\|(?![^[]*\]\])/).map((c) => c.trim())
    const zone = linkTexts(cells[0] ?? '')[0] ?? (cells[0] ?? '')
    const npc = linkTexts(cells[1] ?? '')[0] ?? (cells[1] ?? '')
    if (npc) out.push({ zone, npc, note: plainText(cells[2] ?? '') })
  }
  return out
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
