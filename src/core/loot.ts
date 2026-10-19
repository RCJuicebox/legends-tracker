import { baseName } from './inventory'
import { SELF } from './combatLines'
import { displayName, nameKey } from './combatMeter'
import type { LogLine } from './logLine'
import type { ItemInfo, Segment } from '../shared/types'

// Loot, as EverQuest Legends prints it. Auto-loot tells you what became of each item:
//
//   --You have looted a Star Ruby from a fetid fiend's corpse.--            kept
//   --You have looted 2 Bone Chips from a putrid skeleton's corpse.--
//   You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.
//   You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.
//   You looted a Crystallized Sulfur from an ire ghast's corpse and stored it in your tradeskill depot
//   You looted a Mote of Major Potential from a loathling lich's corpse and stored it in your currency
//   You looted an Apothic Crown +4 from a spite golem's corpse and stored it in your Dragon Hoard
//   You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6
//   You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.
//   You receive 6 gold from Zok Zribb.                                      (a sale)
//   You receive 2 gold and 3 silver as your split.     (EQEmu's group split; none in months of EQL group play)

export type LootOutcome = 'kept' | 'sold' | 'depot' | 'currency' | 'hoard' | 'merged'

export interface LootEvent {
  kind: 'loot'
  /** SELF, or the group member's name. */
  looter: string
  /** As printed: "Shadow Rage Helm +4". */
  item: string
  count: number
  /** The corpse's owner ("a fetid fiend", "Cleric of Innoruuk") or "Reward Chest". */
  source: string
  outcome: LootOutcome
  /** What it sold for, in copper. */
  copper: number
  /** What it was merged into. */
  into?: string
}

export interface CoinEvent {
  kind: 'coin'
  copper: number
  /** 'corpse', or the merchant's name. */
  from: string
  /** A merchant paid for the contents of a bag. */
  bag: boolean
}

const RE_AUTO = /^You looted (a|an|\d+) (.+?) from (.+?) and (?:sold it for (.+?)\.|stored it in your (tradeskill depot|currency|Dragon Hoard)\.?)$/
const RE_MERGE = /^You looted (a|an|\d+) (.+?) from (.+?) to create (?:a|an) (.+?)\.?$/
const RE_KEPT = /^--(You have|(.+?) has) looted (a|an|\d+) (.+?) from (.+?)\.--$/
const RE_COIN_CORPSE = /^You receive (.+?) from the corpse\.$/
const RE_COIN_BAG = /^You receive\s+(.+?) from (.+?) for the contents of your bag\.$/
/** "You receive 4 gold 7 silver 6 copper from Melixis for the Large Cloth Shirt(s).": a stack sold, the merchant before "for the". */
const RE_COIN_STACK = /^You receive (.+?) from (.+?) for the (.+?)\.$/
const RE_COIN_SALE = /^You receive (.+?) from (.+?)\.$/
const RE_COIN_SPLIT = /^You receive (.+?) as your split\.$/

/** "4 platinum, 2 gold, 9 silver and 8 copper" (or the bag sale's "52 platinum 2 gold") → copper. */
export function parseCoin(text: string): number {
  let copper = 0
  for (const m of text.matchAll(/(\d+) (platinum|gold|silver|copper)/g)) {
    const n = Number(m[1])
    copper += m[2] === 'platinum' ? n * 1000 : m[2] === 'gold' ? n * 100 : m[2] === 'silver' ? n * 10 : n
  }
  return copper
}

/** The wiki's shorthand coin, "4g 7s 6c" or "35p" or "1.2pp", in copper; 0 when there is none. */
export function parseWikiCoin(text: string): number {
  let copper = 0
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(pp|p|gp|g|sp|s|cp|c)\b/gi)) {
    const n = Number(m[1])
    const u = m[2][0].toLowerCase()
    copper += n * (u === 'p' ? 1000 : u === 'g' ? 100 : u === 's' ? 10 : 1)
  }
  return Math.round(copper)
}

/** "1 platinum, 2 gold, 8 silver and 6 copper" → "1p 2g 8s 6c"; 0 → "nothing". */
export function fmtCoin(copper: number): string {
  if (copper <= 0) return 'nothing'
  const parts: string[] = []
  const p = Math.floor(copper / 1000)
  const g = Math.floor((copper % 1000) / 100)
  const s = Math.floor((copper % 100) / 10)
  const c = copper % 10
  if (p) parts.push(`${p}p`)
  if (g) parts.push(`${g}g`)
  if (s) parts.push(`${s}s`)
  if (c) parts.push(`${c}c`)
  return parts.join(' ')
}

/** "a putrid skeleton's corpse" → "A putrid skeleton"; "*Duggin Scumber's corpse" → "Duggin Scumber"; "Reward Chest" stays. */
function sourceName(s: string): string {
  return displayName(s.replace(/^\*/, '').replace(/'s corpse$/, ''))
}

const count = (word: string) => (word === 'a' || word === 'an' ? 1 : Number(word))

export function parseLootLine(text: string): LootEvent | CoinEvent | null {
  let m: RegExpExecArray | null
  if (text.startsWith('You looted ')) {
    if ((m = RE_AUTO.exec(text))) {
      const outcome: LootOutcome = m[5] === 'tradeskill depot' ? 'depot' : m[5] === 'currency' ? 'currency' : m[5] === 'Dragon Hoard' ? 'hoard' : 'sold'
      return { kind: 'loot', looter: SELF, item: m[2], count: count(m[1]), source: sourceName(m[3]), outcome, copper: m[4] && m[4] !== 'free' ? parseCoin(m[4]) : 0 }
    }
    if ((m = RE_MERGE.exec(text))) return { kind: 'loot', looter: SELF, item: m[2], count: count(m[1]), source: sourceName(m[3]), outcome: 'merged', copper: 0, into: m[4] }
    return null
  }
  if (text.startsWith('--')) {
    if ((m = RE_KEPT.exec(text))) return { kind: 'loot', looter: m[2] ? m[2] : SELF, item: m[4], count: count(m[3]), source: sourceName(m[5]), outcome: 'kept', copper: 0 }
    return null
  }
  if (text.startsWith('You receive ')) {
    if ((m = RE_COIN_CORPSE.exec(text)) || (m = RE_COIN_SPLIT.exec(text))) return { kind: 'coin', copper: parseCoin(m[1]), from: 'corpse', bag: false }
    if ((m = RE_COIN_BAG.exec(text))) return { kind: 'coin', copper: parseCoin(m[1]), from: m[2], bag: true }
    if ((m = RE_COIN_STACK.exec(text)) && /\d+ (?:platinum|gold|silver|copper)/.test(m[1])) return { kind: 'coin', copper: parseCoin(m[1]), from: m[2], bag: false }
    if ((m = RE_COIN_SALE.exec(text)) && /\d+ (?:platinum|gold|silver|copper)/.test(m[1])) return { kind: 'coin', copper: parseCoin(m[1]), from: m[2], bag: false }
  }
  return null
}

export interface LootEntry {
  id: number
  at: number
  zone: string
  /** The damage meter's session it fell in, for grouping. */
  sessionId: string
  looter: string
  item: string
  /** The item's name without its +N, for the wiki. */
  base: string
  /** The +N it carried; 0 for none. */
  plus: number
  count: number
  source: string
  outcome: LootOutcome
  copper: number
  into?: string
}

export interface CoinEntry {
  at: number
  sessionId: string
  copper: number
  from: string
  bag: boolean
}

export interface LootSnapshot {
  /** Newest first. */
  entries: LootEntry[]
  /** Coin per session id: from corpses, and from sales. */
  coin: Record<string, { corpse: number; sales: number }>
  reading: string
  /**
   * Sent to a page that has the entries already: `entries` holds the new ones alone, and the page
   * keeps those it has from `oldest` on (mergeLoot). Entries never change once added, so a loot
   * line costs one entry, not the whole list (LT-369: 580 KB at the 2,000 kept).
   */
  addedOnly?: { oldest: number }
}

/** The loot as a page shows it, after a push of new entries alone or a whole list. */
export function mergeLoot<T extends LootSnapshot>(had: T | null, next: T): T {
  if (!next.addedOnly || !had) return next
  const { oldest } = next.addedOnly
  const fresh = new Set(next.entries.map((e) => e.id))
  const kept = had.entries.filter((e) => e.id >= oldest && !fresh.has(e.id))
  const { addedOnly: _addedOnly, ...rest } = next
  return { ...rest, entries: [...next.entries, ...kept].slice(0, KEPT) } as T
}

const KEPT = 2000
const COIN_KEPT = 4000

export interface LootHooks {
  onChange?: () => void
  onLoot?: (e: LootEntry) => void
}

/** Every item looted and every coin received, in order, tagged with the zone and session it fell in. */
export class LootLedger {
  entries: LootEntry[] = []
  coins: CoinEntry[] = []
  reading = ''
  private seq = 0

  constructor(private readonly hooks: LootHooks = {}) {}

  reset(): void {
    this.entries = []
    this.coins = []
    this.hooks.onChange?.()
  }

  /** Whether the line was loot or coin. */
  handle(line: LogLine, zone: string, sessionId: string): boolean {
    const c = line.text.charCodeAt(0)
    // "You looted", "You receive", "--You have looted"; the cheap check first.
    if (c !== 89 && c !== 45) return false
    const ev = parseLootLine(line.text)
    if (!ev) return false
    if (ev.kind === 'coin') {
      this.coins.push({ at: line.time, sessionId, copper: ev.copper, from: ev.from, bag: ev.bag })
      if (this.coins.length > COIN_KEPT) this.coins.shift()
      this.hooks.onChange?.()
      return true
    }
    const plus = Number(/\+(\d+)$/.exec(ev.item)?.[1] ?? 0)
    const entry: LootEntry = {
      id: ++this.seq,
      at: line.time,
      zone,
      sessionId,
      looter: ev.looter,
      item: ev.item,
      base: baseName(ev.item),
      plus,
      count: ev.count,
      source: ev.source,
      outcome: ev.outcome,
      copper: ev.copper,
      ...(ev.into ? { into: ev.into } : {})
    }
    this.entries.push(entry)
    if (this.entries.length > KEPT) this.entries.shift()
    this.hooks.onLoot?.(entry)
    this.hooks.onChange?.()
    return true
  }

  snapshot(): LootSnapshot {
    const coin: LootSnapshot['coin'] = {}
    for (const c of this.coins) {
      const s = (coin[c.sessionId] ??= { corpse: 0, sales: 0 })
      if (c.from === 'corpse') s.corpse += c.copper
      else s.sales += c.copper
    }
    for (const e of this.entries) {
      if (e.outcome !== 'sold' || !e.copper) continue
      const s = (coin[e.sessionId] ??= { corpse: 0, sales: 0 })
      s.sales += e.copper
    }
    return { entries: [...this.entries].reverse(), coin, reading: this.reading }
  }
}

// ---- drop rates (FEAT-037) ----

/** A mob's kills and what dropped from them, each item with how many and how often a kill. */
export interface MobDrops {
  mob: string
  kills: number
  items: { item: string; n: number; perKill: number }[]
}

/**
 * Drop rates per mob over the span the meter's kept fights cover (FEAT-037): kills from the fights
 * (each enemy that died in one), drops from the ledger's entries since the oldest fight, by the corpse
 * they came from, whoever looted. Mobs with no kill in that span are left out.
 */
export function dropRates(entries: readonly LootEntry[], fights: readonly Pick<Segment, 'startedAt' | 'enemies' | 'entities'>[]): MobDrops[] {
  const since = fights.length ? Math.min(...fights.map((f) => f.startedAt)) : Infinity
  const kills = new Map<string, { name: string; n: number }>()
  for (const f of fights)
    for (const [k, alive] of Object.entries(f.enemies)) {
      if (alive) continue
      const had = kills.get(k) ?? { name: f.entities[k]?.name ?? k, n: 0 }
      had.n++
      kills.set(k, had)
    }
  const drops = new Map<string, Map<string, number>>()
  for (const e of entries) {
    if (e.at < since) continue
    const k = nameKey(e.source)
    if (!kills.has(k)) continue
    const items = drops.get(k) ?? new Map<string, number>()
    items.set(e.base, (items.get(e.base) ?? 0) + e.count)
    drops.set(k, items)
  }
  return [...kills]
    .map(([k, { name, n }]) => ({
      mob: name,
      kills: n,
      items: [...(drops.get(k) ?? [])].map(([item, c]) => ({ item, n: c, perKill: c / n })).sort((a, b) => b.n - a.n || a.item.localeCompare(b.item))
    }))
    .filter((m) => m.items.length)
    .sort((a, b) => b.kills - a.kills || a.mob.localeCompare(b.mob))
}

// ---- what loot is worth (LT-725, LT-744) ----

/** Where a price came from: auto-loot selling one, a merchant's offer to this character, the wiki. */
export type WorthFrom = 'sold' | 'offer' | 'wiki'

/** What one of each base name last sold for, from the ledger's auto-loot sales (newest first, as the snapshot gives them). */
export function lastSales(entries: readonly LootEntry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries) {
    if (e.outcome !== 'sold' || e.copper <= 0) continue
    const k = e.base.toLowerCase()
    if (!out.has(k)) out.set(k, e.copper / Math.max(1, e.count))
  }
  return out
}

/**
 * What one of an item fetches: the last time one of its name sold, else what a merchant last offered
 * this character for it (charisma and faction in), else the wiki's merchant value ("238p 9s 5c").
 */
export function itemWorth(
  base: string,
  o: { sales: Map<string, number>; offers: Record<string, { copper: number }>; wikiValue?: string }
): { copper: number; from: WorthFrom } | null {
  const k = base.toLowerCase()
  const sold = o.sales.get(k)
  if (sold) return { copper: sold, from: 'sold' }
  const offer = o.offers[k]?.copper
  if (offer) return { copper: offer, from: 'offer' }
  const wiki = o.wikiValue ? parseWikiCoin(o.wikiValue) : 0
  return wiki > 0 ? { copper: wiki, from: 'wiki' } : null
}

/** What a session's kept loot is worth, of the rows a price is known for: sold, merged and currency rows left out. */
export function sessionWorth(entries: readonly LootEntry[], worthOf: (e: LootEntry) => { copper: number } | null): { copper: number; priced: number; items: number } {
  let copper = 0
  let priced = 0
  let items = 0
  for (const e of entries) {
    if (e.outcome !== 'kept' && e.outcome !== 'depot' && e.outcome !== 'hoard') continue
    items++
    const w = worthOf(e)
    if (!w) continue
    priced++
    copper += w.copper * e.count
  }
  return { copper, priced, items }
}

/** What the wiki says an item is, in a line or two. Its merchant value is left to the caller, which prices it beside a sale or an offer. */
export function describeItem(info: ItemInfo | undefined): { head: string; body: string[] } {
  if (!info) return { head: '', body: [] }
  if (!info.found) return { head: 'Not on eqlwiki', body: [] }
  const lines = info.statsblock
    .split(/<br\s*\/?>/i)
    .map((l) =>
      l
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
  const slot = lines.find((l) => /^Slot:/i.test(l))
  const head: string[] = []
  if (slot) {
    head.push(slot.replace(/^Slot:\s*/i, ''))
    for (const l of lines) if (/^(AC|DMG|Skill|Effect|Focus):|^[A-Z]{2,4}: [+-]?\d/.test(l) && !/^(WT|Size):/i.test(l) && head.length < 4) head.push(l)
    const cls = lines.find((l) => /^Class:/i.test(l))
    if (cls) head.push(cls.replace(/^Class:\s*/i, ''))
  } else {
    const flags = lines[0] && !/^(WT|Size):/i.test(lines[0]) ? lines[0] : ''
    if (flags) head.push(flags)
  }
  const body: string[] = []
  const u = info.use
  if (u?.notes) body.push(u.notes)
  if (u?.quests.length) body.push(`Quests: ${u.quests.slice(0, 4).join(', ')}${u.quests.length > 4 ? ` +${u.quests.length - 4}` : ''}`)
  if (u?.recipes.length) body.push(`Recipes: ${u.recipes.slice(0, 4).join(', ')}${u.recipes.length > 4 ? ` +${u.recipes.length - 4}` : ''}`)
  return { head: head.join(' · '), body }
}
