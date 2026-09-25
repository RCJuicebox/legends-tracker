// The game's inventory export (/outputfile inventory): where every item is, and nothing about what
// it does. Stats come from the item's eqlwiki page (its in-game stats block), scaled for the item's
// +N merge level the way the wiki's own item level slider scales them.

/** One line of the export: a location, the item there, and what sits inside it. */
export interface InvItem {
  /** "Head", "General 1-Slot3", "Bank10-Slot2". */
  location: string
  name: string
  id: number
  count: number
  /** Augments in its augment slots (worn gear holds its exaltations in slots 7-10). */
  augs: InvItem[]
}

export interface Inventory {
  /** Worn slots, in the export's order. The slot is the location. */
  worn: InvItem[]
  /** Bags and their contents: General 1-12. */
  bags: InvItem[]
  bank: InvItem[]
  sharedBank: InvItem[]
  /** The key ring: collections by kind (Equipment, Augmentation, Activated, …). */
  keyRing: { kind: string; name: string; id: number }[]
}

/** Worn slots in the order the game lists them. "Any Slot" is the charm slot. */
export const WORN_SLOTS = [
  'Any Slot', 'Ear', 'Head', 'Face', 'Neck', 'Shoulders', 'Arms', 'Back', 'Wrist', 'Range', 'Hands',
  'Primary', 'Secondary', 'Fingers', 'Chest', 'Legs', 'Feet', 'Waist', 'Ammo'
]

const EMPTY = (name: string) => !name || name === 'Empty'

export function parseInventory(text: string): Inventory {
  const inv: Inventory = { worn: [], bags: [], bank: [], sharedBank: [], keyRing: [] }
  const lines = String(text).replace(/^﻿/, '').replace(/\r/g, '').split('\n')
  let inKeyRing = false
  // The item each nesting level last added, so "General 1-Slot3-Slot7" lands in the item at General 1-Slot3.
  const byLocation = new Map<string, InvItem>()
  for (const line of lines) {
    if (!line.includes('\t')) continue
    const [loc, name, id, count] = line.split('\t')
    if (loc === 'Location') continue
    if (loc === 'KeyRing') {
      inKeyRing = true
      continue
    }
    if (inKeyRing) {
      if (!EMPTY(name)) inv.keyRing.push({ kind: loc, name, id: Number(id) || 0 })
      continue
    }
    if (EMPTY(name)) continue
    const item: InvItem = { location: loc, name, id: Number(id) || 0, count: Number(count) || 1, augs: [] }
    const cut = loc.lastIndexOf('-')
    const parent = cut > 0 ? byLocation.get(loc.slice(0, cut)) : undefined
    const top = loc.split('-')[0]
    byLocation.set(loc, item)
    if (parent) {
      // Inside worn gear, or inside an item that is itself in a bag, it is an augment. Inside a
      // bag or bank slot it is just what the bag holds.
      const isAug = /\(Exaltation\)$/i.test(name) || WORN_SLOTS.includes(parent.location) || parent.location.includes('-')
      if (isAug) parent.augs.push(item)
      else list(inv, top)?.push(item)
      continue
    }
    list(inv, top)?.push(item)
  }
  return inv
}

function list(inv: Inventory, top: string): InvItem[] | undefined {
  if (WORN_SLOTS.includes(top)) return inv.worn
  if (/^General \d+$/.test(top)) return inv.bags
  if (/^Bank\d+$/.test(top)) return inv.bank
  if (/^SharedBank\d+$/.test(top)) return inv.sharedBank
  return undefined
}

/** The worn slot an item sits in, as the game names it. The two Any slots take any piece of gear. */
export function slotLabel(location: string): string {
  const top = location.split('-')[0]
  return top === 'Any Slot' ? 'Any slot' : top
}

/** "Earring of Bashing +7" → 7. Merge levels run 0-10. */
export function mergeLevel(name: string): number {
  const m = /\+(\d+)$/.exec(String(name).trim())
  return m ? Math.min(10, Number(m[1])) : 0
}

/** The item without its +N or " (Exaltation)": the name its wiki page has. */
export function baseName(name: string): string {
  return String(name)
    .replace(/\s*\(Exaltation\)\s*$/i, '')
    .replace(/\s*\+\d+$/, '')
    .replace(/`/g, "'")
    .trim()
}

/** A loose key for matching an item to its page: case, apostrophes and punctuation ignored. */
export function itemKey(name: string): string {
  return baseName(name)
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const STAT_KEYS = ['STR', 'STA', 'AGI', 'DEX', 'WIS', 'INT', 'CHA'] as const
export const POOL_KEYS = ['HP', 'MANA', 'END'] as const
export const SAVE_KEYS = ['COLD', 'DISEASE', 'FIRE', 'MAGIC', 'POISON', 'CORRUPTION', 'VOID'] as const

/** What an item's stats block says, at its base (unmerged) level. */
export interface ItemStats {
  ac: number
  stats: Partial<Record<(typeof STAT_KEYS)[number], number>>
  pools: Partial<Record<(typeof POOL_KEYS)[number], number>>
  saves: Partial<Record<(typeof SAVE_KEYS)[number], number>>
  haste: number
  hpRegen: number
  manaRegen: number
  endRegen: number
  attack: number
  /** Required level to equip, 0 when none. */
  reqLevel: number
  weight: number
  slots: string
  damage: number
  delay: number
  skill: string
}

/** Reads the in-game stats block, as the wiki page holds it ("AC: 20<br>STR: +5  DEX: +5 …"). */
export function parseStatsBlock(block: string): ItemStats {
  const text = String(block)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
  const num = (re: RegExp) => {
    const m = re.exec(text)
    return m ? Number(m[1]) : 0
  }
  const out: ItemStats = {
    ac: num(/\bAC:\s*([+-]?\d+)/),
    stats: {},
    pools: {},
    saves: {},
    haste: num(/\bHaste:\s*\+?(\d+)%/i),
    // "HP Regen: +10", or a bare "Regen: 2" beside Mana Regen and End Regen.
    hpRegen: num(/(?:\bHP Regen|(?<!Mana |End )\bRegen):\s*\+?(\d+)/i),
    manaRegen: num(/\bMana Regen:\s*\+?(\d+)/i),
    endRegen: num(/\bEnd(?:urance)? Regen:\s*\+?(\d+)/i),
    attack: num(/\b(?:Attack|ATK):\s*\+?(\d+)/i),
    reqLevel: num(/Required level of (\d+)/i),
    weight: num(/\bWT:\s*([\d.]+)/),
    slots: /\bSlot:\s*([A-Z0-9 ]+)/.exec(text)?.[1].trim() ?? '',
    damage: num(/\bDMG:\s*(\d+)/),
    delay: num(/\bAtk Delay:\s*(\d+)/),
    skill: /\bSkill:\s*([A-Za-z0-9 ]+?)\s{2,}|\bSkill:\s*([A-Za-z0-9 ]+?)\s*(?:\n|$)/.exec(text)?.slice(1).find(Boolean)?.trim() ?? ''
  }
  for (const k of STAT_KEYS) {
    const v = num(new RegExp(`\\b${k}:\\s*([+-]?\\d+)`))
    if (v) out.stats[k] = v
  }
  // Pages write "END:" and "End:" alike.
  for (const k of POOL_KEYS) {
    const v = num(new RegExp(`\\b${k}:\\s*([+-]?\\d+)`, 'i'))
    if (v) out.pools[k] = v
  }
  for (const k of SAVE_KEYS) {
    const v = num(new RegExp(`\\bSV ${k}:\\s*([+-]?\\d+)`, 'i'))
    if (v) out.saves[k] = v
  }
  return out
}

/** Round half away from zero: the wiki's excelRound, which JavaScript's Math.round is not. */
function excelRound(v: number): number {
  return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5)
}

/**
 * A primary stat (AC, HP, mana, endurance, the seven stats, every save) at merge level n: small values
 * gain a flat point per level, larger ones a tenth of their base per level. Negatives mirror it, up to 0.
 */
export function scalePrimary(base: number, n: number): number {
  if (!base || !n) return base || 0
  if (base > 0 && base <= 10) return base + n
  if (base > 10) return Math.floor(base + excelRound((base * n) / 10))
  if (Math.abs(base) <= 10) return Math.min(0, base + n)
  return Math.min(0, base + excelRound((Math.abs(base) * n) / 10))
}

/** Weapon damage: a tenth of base per level, rounded down. */
export function scaleDamage(base: number, n: number): number {
  return base + Math.floor((base * n) / 10)
}

/** Haste and regen: flat +1 per level. */
export function scaleFlat(base: number, n: number): number {
  return base ? base + n : 0
}

/** Weight falls 9% per doubling of merges, rounded up to a tenth. Very light items do not change. */
export function scaleWeight(base: number, n: number): number {
  if (base <= 0.1 || !n) return base
  const w = base * (1 - 0.09 * Math.log2(2 ** n))
  return Math.max(0, Math.ceil(w * 10 - 1e-9) / 10)
}

/** An item's stats at its merge level. */
export function scaledStats(s: ItemStats, n: number): ItemStats {
  const map = <K extends string>(o: Partial<Record<K, number>>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, scalePrimary(v as number, n)])) as Partial<Record<K, number>>
  return {
    ...s,
    ac: scalePrimary(s.ac, n),
    stats: map(s.stats),
    pools: map(s.pools),
    saves: map(s.saves),
    haste: scaleFlat(s.haste, n),
    hpRegen: scaleFlat(s.hpRegen, n),
    manaRegen: scaleFlat(s.manaRegen, n),
    endRegen: scaleFlat(s.endRegen, n),
    damage: scaleDamage(s.damage, n),
    weight: scaleWeight(s.weight, n)
  }
}

export interface WornTotals {
  ac: number
  stats: Record<string, number>
  pools: Record<string, number>
  saves: Record<string, number>
  /** Haste does not stack: the best worn haste counts. */
  haste: number
  hpRegen: number
  manaRegen: number
  endRegen: number
  attack: number
  /** The highest required level among worn items. */
  reqLevel: number
  weight: number
  /** Worn items with no stats found. */
  unknown: number
}

/**
 * What the worn gear adds up to. Ammo is left out of AC, the way Dzarn's AC post leaves it out.
 * Exaltation augments add nothing on top: their effects are already in the item's own figures,
 * as the in-game AC check confirmed.
 */
export function wornTotals(worn: InvItem[], statsOf: (item: InvItem) => ItemStats | null, acOverride: (item: InvItem) => number | undefined = () => undefined): WornTotals {
  const t: WornTotals = { ac: 0, stats: {}, pools: {}, saves: {}, haste: 0, hpRegen: 0, manaRegen: 0, endRegen: 0, attack: 0, reqLevel: 0, weight: 0, unknown: 0 }
  for (const it of worn) {
    const s = statsOf(it)
    const override = acOverride(it)
    const top = it.location.split('-')[0]
    if (top !== 'Ammo') t.ac += override ?? s?.ac ?? 0
    if (!s) {
      if (override === undefined) t.unknown++
      continue
    }
    for (const [k, v] of Object.entries(s.stats)) t.stats[k] = (t.stats[k] ?? 0) + (v ?? 0)
    for (const [k, v] of Object.entries(s.pools)) t.pools[k] = (t.pools[k] ?? 0) + (v ?? 0)
    for (const [k, v] of Object.entries(s.saves)) t.saves[k] = (t.saves[k] ?? 0) + (v ?? 0)
    t.haste = Math.max(t.haste, s.haste)
    t.hpRegen += s.hpRegen
    t.manaRegen += s.manaRegen
    t.endRegen += s.endRegen
    t.attack += s.attack
    t.reqLevel = Math.max(t.reqLevel, s.reqLevel)
    t.weight += s.weight
  }
  t.weight = Math.round(t.weight * 10) / 10
  return t
}

/** Shield-like names in the secondary slot: its AC then lifts the soft cap too. */
export const SHIELD_NAME = /\b(shield|buckler|aegis|bulwark|targ|barrier|protector)\b/i
