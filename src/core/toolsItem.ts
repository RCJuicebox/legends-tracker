import type { CatalogItem } from './wikiItem'

// eqlegendstools.com's item pages, for gear eqlwiki has no page for yet (a new zone's drops). Each
// page's tooltip is the game's own lines, one to an <li>; they are put into the form of an eqlwiki
// stats block ("Slot: CHEST<br>\n…"), so the finder, the optimizer and the effect readers read them
// as they read the wiki's. The site's robots.txt allows its item pages.

const TOOLS_SITE = 'https://eqlegendstools.com'
export const TOOLS_SITEMAP_URL = `${TOOLS_SITE}/sitemap.xml`

export const toolsItemUrl = (slug: string) => `${TOOLS_SITE}/items/${slug}/`

/**
 * Zones the site lists that eqlwiki tags no era for yet, with the era tag their items take (in era,
 * as Template:PageEra's list or gearFinder's copy of it says).
 */
const ZONE_ERAS: Record<string, string> = { 'Nektropos Castle': 'Nektropos' }

/** The item pages the sitemap lists, by their slug ("pyrosilk-robe"); not the item lists (weapons, gear). */
export function toolsItemSlugs(xml: string): string[] {
  const out = new Set<string>()
  for (const m of xml.matchAll(/<loc>\s*https?:\/\/[^/<]+\/items\/([a-z0-9-]+)\/\s*<\/loc>/gi)) {
    const slug = m[1].toLowerCase()
    if (slug !== 'weapons' && slug !== 'gear') out.add(slug)
  }
  return [...out]
}

/**
 * The slugs an item's page may have: the site writes an apostrophe as nothing ("dolls-fang") or as a
 * hyphen ("hierophant-s-crook").
 */
export function toolsSlugs(title: string): string[] {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const t = title.replace(/[`’]/g, "'")
  return [...new Set([slug(t.replace(/'/g, '')), slug(t)])]
}

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

const plain = (html: string) =>
  decode(html.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * "Drops From: Nektropos Castle: Alexa Everling" → its zones and mobs. Several zones may be listed,
 * each with its mobs after a colon; mobs are split at commas.
 */
function drops(text: string): { zones: string[]; mobs: string[] } {
  const zones: string[] = []
  const mobs: string[] = []
  for (const part of text.split(/\s*[;·|]\s*/)) {
    const m = /^([^:]+?):\s*(.*)$/.exec(part.trim())
    if (!m) continue
    zones.push(m[1].trim())
    for (const mob of m[2].split(/\s*,\s*/)) if (mob.trim()) mobs.push(mob.trim())
  }
  return { zones: [...new Set(zones)], mobs: [...new Set(mobs)] }
}

/** An item page's parts as the catalog keeps them; null for a page that is not a piece of equipment (no Slot line). */
export function parseToolsItemPage(html: string, slug: string): CatalogItem | null {
  const title = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '')
  const list = /<ul class="tooltip-lines">([\s\S]*?)<\/ul>/i.exec(html)?.[1] ?? ''
  const lines = [...list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => plain(m[1])).filter(Boolean)
  if (!title || !lines.some((l) => /^Slot:/i.test(l))) return null
  const flags = plain(/<p class="tooltip-flags">([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? '')
  let from = { zones: [] as string[], mobs: [] as string[] }
  const kept: string[] = []
  for (const line of lines) {
    if (/^Drops From:/i.test(line)) from = drops(line.replace(/^Drops From:\s*/i, ''))
    else if (/^Farming Speed:/i.test(line)) continue
    // The wiki's stats blocks part a weapon's skill from its delay by two spaces, as the stats reader expects.
    else kept.push(line.replace(/ (Atk Delay:)/, '  $1').replace(/ (Dmg Bonus:)/, '  $1'))
  }
  const head = flags
    .split(/\s*·\s*/)
    .map((f) => f.toUpperCase())
    .filter(Boolean)
    .join('  ')
  const statsblock = [...(head ? [head] : []), ...kept].map((l) => `${l}<br>`).join('\n')
  const focus = kept.map((l) => /^Focus Effect:\s*(.+)$/i.exec(l)?.[1].trim()).find(Boolean) ?? ''
  return {
    title,
    statsblock,
    icon: 0,
    focus,
    era: from.zones.map((z) => ZONE_ERAS[z]).find(Boolean) ?? '',
    zones: from.zones,
    mobs: from.mobs,
    quest: false,
    crafted: false,
    url: toolsItemUrl(slug)
  }
}
