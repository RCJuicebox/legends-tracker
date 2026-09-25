import { baseName } from './inventory'
import { SELF } from './combatLines'
import { displayName } from './combatMeter'
import type { LogLine } from './logLine'

// Loot, as EverQuest Legends prints it. Auto-loot tells you what became of each item:
//
//   --You have looted a Star Ruby from a fetid fiend's corpse.--            kept
//   --You have looted 2 Bone Chips from a putrid skeleton's corpse.--
//   You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.
//   You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.
//   You looted a Crystallized Sulfur from an ire ghast's corpse and stored it in your tradeskill depot
//   You looted a Mote of Major Potential from a loathling lich's corpse and stored it in your currency
//   You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6
//   You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.
//   You receive 6 gold from Zok Zribb.                                      (a sale)

export type LootOutcome = 'kept' | 'sold' | 'depot' | 'currency' | 'merged'

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

const RE_AUTO = /^You looted (a|an|\d+) (.+?) from (.+?) and (?:sold it for (.+?)\.|stored it in your (tradeskill depot|currency)\.?)$/
const RE_MERGE = /^You looted (a|an|\d+) (.+?) from (.+?) to create (?:a|an) (.+?)\.?$/
const RE_KEPT = /^--(You have|(.+?) has) looted (a|an|\d+) (.+?) from (.+?)\.--$/
const RE_COIN_CORPSE = /^You receive (.+?) from the corpse\.$/
const RE_COIN_BAG = /^You receive\s+(.+?) from (.+?) for the contents of your bag\.$/
const RE_COIN_SALE = /^You receive (.+?) from (.+?)\.$/

/** "4 platinum, 2 gold, 9 silver and 8 copper" (or the bag sale's "52 platinum 2 gold") → copper. */
export function parseCoin(text: string): number {
  let copper = 0
  for (const m of text.matchAll(/(\d+) (platinum|gold|silver|copper)/g)) {
    const n = Number(m[1])
    copper += m[2] === 'platinum' ? n * 1000 : m[2] === 'gold' ? n * 100 : m[2] === 'silver' ? n * 10 : n
  }
  return copper
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
      const outcome: LootOutcome = m[5] === 'tradeskill depot' ? 'depot' : m[5] === 'currency' ? 'currency' : 'sold'
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
    if ((m = RE_COIN_CORPSE.exec(text))) return { kind: 'coin', copper: parseCoin(m[1]), from: 'corpse', bag: false }
    if ((m = RE_COIN_BAG.exec(text))) return { kind: 'coin', copper: parseCoin(m[1]), from: m[2], bag: true }
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

  handle(line: LogLine, zone: string, sessionId: string): void {
    const c = line.text.charCodeAt(0)
    // "You looted", "You receive", "--You have looted"; the cheap check first.
    if (c !== 89 && c !== 45) return
    const ev = parseLootLine(line.text)
    if (!ev) return
    if (ev.kind === 'coin') {
      this.coins.push({ at: line.time, sessionId, copper: ev.copper, from: ev.from, bag: ev.bag })
      if (this.coins.length > COIN_KEPT) this.coins.shift()
      this.hooks.onChange?.()
      return
    }
    const plus = Number(/\+(\d+)$/.exec(ev.item)?.[1] ?? 0)
    const entry: LootEntry = {
      id: ++this.seq, at: line.time, zone, sessionId, looter: ev.looter, item: ev.item, base: baseName(ev.item), plus, count: ev.count,
      source: ev.source, outcome: ev.outcome, copper: ev.copper, ...(ev.into ? { into: ev.into } : {})
    }
    this.entries.push(entry)
    if (this.entries.length > KEPT) this.entries.shift()
    this.hooks.onLoot?.(entry)
    this.hooks.onChange?.()
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
