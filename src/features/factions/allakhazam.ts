// Allakhazam's faction pages (everquest.allakhazam.com/db/faction.html?faction=66), for what eqlwiki
// leaves out: the con a quest's NPC wants before it takes the hand-in, how much a kill or a quest
// moves the faction, and mobs eqlwiki does not list. Each page speaks of one faction; a kill's whole
// effect is put together from every page that names the mob. The site asks crawlers to wait twenty
// seconds between pages, and the main process does (FactionAlla).

const SITE = 'https://everquest.allakhazam.com'

/**
 * Whether the tracker reads the site: the page readers below are checked against its real pages (a
 * reader that misread would keep a month of wrong pages). Turn off if the site's pages change.
 */
export const ALLA_READY = true

/** The site's list of every faction, each linked to its page (about 720). */
export const ALLA_INDEX_URL = `${SITE}/db/factionlist.html`

/** A faction's page on the site, by the site's own number for it. */
export const allaPageUrl = (id: number) => `${SITE}/db/faction.html?faction=${id}`

/** Every faction a page links, by factionKey of the link's text: the site's number for each. */
export function parseAllaIndex(html: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of html.matchAll(/<a\b[^>]*href=["'][^"']*faction\.html\?faction=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = textOf(m[2])
    if (name) out[factionKeyOf(name)] ??= parseInt(m[1], 10)
  }
  return out
}

/**
 * A faction page: its title, the table of quests that want a con with the faction (Quest Name,
 * Minimum Faction Required, Maximum Faction Allowed), then pairs of rows, a heading row and a row of
 * lists under it: "NPCs you can kill to raise the faction" beside "Quests you can do to raise the
 * faction", each line "a mature arborean (Greater Faydark) +1" or "Pixie Dust +15", and the same to
 * lower it. Null for a page with no title.
 */
export function parseAllaFaction(id: number, html: string): AllaFaction | null {
  const title = /<title>\s*([^<]*?)\s*::/i.exec(html)?.[1]
  if (!title) return null
  const rows = tableRows(html)
  const after = (heading: RegExp) => {
    const i = rows.findIndex((r) => r.some((c) => heading.test(c.join(' '))))
    return i < 0 ? null : { head: rows[i], body: rows[i + 1] ?? [] }
  }
  const needs: AllaFaction['needs'] = []
  const needsAt = rows.findIndex((r) => r.some((c) => /Minimum Faction Required/i.test(c.join(' '))))
  if (needsAt >= 0)
    for (const r of rows.slice(needsAt + 1)) {
      if (r.length < 2) break
      const [quest, min, max] = r.map((c) => c.join(' ').trim())
      if (!quest || /Zones in which/i.test(quest)) break
      needs.push({ quest, min: min ?? '', max: max ?? '' })
    }
  const mobs: AllaFaction['mobs'] = []
  const quests: AllaFaction['quests'] = []
  for (const [heading, sign] of [
    [/NPCs you can kill to raise/i, 1],
    [/NPCs you kill to lower/i, -1]
  ] as const) {
    const at = after(heading)
    if (!at) continue
    const [killed = [], done = []] = at.body
    for (const line of killed) {
      const m = /^(.+?)\s*\(\s*([^)]+?)\s*\)\s*([+-]?\d+)?\s*$/.exec(line)
      if (m) mobs.push({ name: m[1].trim(), zone: m[2].trim(), amount: m[3] === undefined ? null : sign * Math.abs(parseInt(m[3], 10)) })
    }
    for (const line of done) {
      const m = /^(.+?)\s*([+-]?\d+)?\s*$/.exec(line)
      if (m) quests.push({ name: m[1].trim(), amount: m[2] === undefined ? null : sign * Math.abs(parseInt(m[2], 10)) })
    }
  }
  return { id, name: textOf(title), needs, mobs, quests }
}

/** An HTML fragment's text: tags off, entities read, spaces closed up. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A page's table rows, each cell's lines (a cell holding a list is one line an item). */
function tableRows(html: string): string[][][] {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      td[1]
        .split(/<br\s*\/?>|<\/li>|<\/div>|<\/p>/i)
        .map(textOf)
        .filter(Boolean)
    )
  )
}

/** A faction name reduced for matching, as the planner's factionKey does (kept here so this file stands alone). */
const factionKeyOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*\(faction\)\s*$/, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')

/** One faction as its Allakhazam page gives it. */
export interface AllaFaction {
  /** Allakhazam's own number for it (not the game's). */
  id: number
  name: string
  /** Quests whose NPC wants a con with this faction first: the lowest and the highest allowed, as the page words them ("Amiable"); '' for none. */
  needs: { quest: string; min: string; max: string }[]
  /** Mobs whose death moves it: how much a kill, + up and - down; null where the page gives no amount. */
  mobs: { name: string; zone: string; amount: number | null }[]
  /** Quests that move it, and how much. */
  quests: { name: string; amount: number | null }[]
}

/** The lowest con in each band, as Allakhazam words them (EQEmu's bands, as the Factions page uses). */
const BAND_MIN: Record<string, number> = {
  ally: 1100,
  warmly: 750,
  kindly: 500,
  amiable: 100,
  amiably: 100,
  indifferent: 0,
  indifferently: 0,
  apprehensive: -100,
  apprehensively: -100,
  dubious: -500,
  dubiously: -500,
  threatening: -750,
  threateningly: -750,
  scowling: -Infinity,
  scowls: -Infinity
}
/** The bands highest first, for the top of one: the next band's lowest, less one. */
const ORDER = ['ally', 'warmly', 'kindly', 'amiable', 'indifferent', 'apprehensive', 'dubious', 'threatening', 'scowling']

/** The lowest con a band word allows; undefined for none or one not known. */
export function bandMin(word: string): number | undefined {
  const w = word.trim().toLowerCase()
  return w ? BAND_MIN[w] : undefined
}

/** The highest con a band word allows: just under the band above it; undefined for none, not known, or Ally. */
export function bandMax(word: string): number | undefined {
  const min = bandMin(word)
  if (min === undefined) return undefined
  const i = ORDER.findIndex((b) => BAND_MIN[b] === min)
  return i > 0 ? BAND_MIN[ORDER[i - 1]] - 1 : undefined
}

/** A quest's name reduced for matching Allakhazam's to eqlwiki's: case, punctuation and a trailing "Quest" dropped. */
export const questKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*\((?:quest|evil|good)\)\s*$/, '')
    .replace(/\bquest$/, '')
    .replace(/[^a-z0-9]/g, '')

/** A con a quest wants: of which faction, the band's word, and the lowest and highest con allowed. */
export interface Need {
  faction: string
  band: string
  min?: number
  max?: number
}

/** What every page says of the quests that want a con: by questKey, each faction's need. `name` puts a faction the game's way. */
export function allaNeeds(factions: AllaFaction[], name: (f: string) => string): Map<string, Need[]> {
  const out = new Map<string, Need[]>()
  for (const f of factions)
    for (const n of f.needs) {
      const min = bandMin(n.min)
      const max = bandMax(n.max)
      if (min === undefined && max === undefined) continue
      const k = questKey(n.quest)
      out.set(k, [...(out.get(k) ?? []), { faction: name(f.name), band: n.min || n.max, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }])
    }
  return out
}

/** What each quest does to each faction, by questKey: only where a page gives it one amount (a chain's steps can give several). */
export function allaQuestAmounts(factions: AllaFaction[], name: (f: string) => string): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  for (const f of factions) {
    const byQuest = new Map<string, Set<number>>()
    for (const q of f.quests) if (q.amount !== null) byQuest.set(questKey(q.name), (byQuest.get(questKey(q.name)) ?? new Set()).add(q.amount))
    for (const [k, amounts] of byQuest) {
      if (amounts.size !== 1) continue
      out.set(k, { ...(out.get(k) ?? {}), [name(f.name)]: [...amounts][0] })
    }
  }
  return out
}

/** One mob's kill, put together from every page that names it: where it is, and what it does to each faction. */
export interface AllaKill {
  name: string
  zone: string
  hits: Record<string, number>
}

/** Every mob the pages name with an amount, by lower-cased name and zone. */
export function allaKills(factions: AllaFaction[], name: (f: string) => string): AllaKill[] {
  const out = new Map<string, AllaKill>()
  for (const f of factions)
    for (const m of f.mobs) {
      if (m.amount === null || !m.zone) continue
      const k = `${m.name.toLowerCase()}|${m.zone.toLowerCase()}`
      const kill = out.get(k) ?? { name: m.name, zone: m.zone, hits: {} }
      kill.hits[name(f.name)] = m.amount
      out.set(k, kill)
    }
  return [...out.values()]
}
