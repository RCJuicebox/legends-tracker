// The upgrade finder: for each worn slot, the catalog items this character could wear there, scored
// with the player's own stat weights against what they wear now.

import { itemKey, mergeLevel, parseStatsBlock, scaledStats, type InvItem, type ItemStats } from './inventory'
import type { CatalogItem } from './wikiItem'

/** The class codes the game prints in "Class: …" lines, by the tracker's class ids. */
const CLASS_CODE: Record<string, string> = {
  war: 'WAR', clr: 'CLR', pal: 'PAL', rng: 'RNG', shd: 'SHD', dru: 'DRU', mnk: 'MNK', brd: 'BRD',
  rog: 'ROG', shm: 'SHM', nec: 'NEC', wiz: 'WIZ', mag: 'MAG', enc: 'ENC', bst: 'BST', ber: 'BER'
}

/** Worn locations as the inventory export names them → the words a stats block's "Slot:" line uses. */
export const SLOT_WORDS: Record<string, string[]> = {
  Ear: ['EAR'], Head: ['HEAD'], Face: ['FACE'], Neck: ['NECK'], Shoulders: ['SHOULDERS', 'SHOULDER'], Arms: ['ARMS'], Back: ['BACK'],
  Wrist: ['WRIST'], Range: ['RANGE'], Hands: ['HANDS'], Primary: ['PRIMARY'], Secondary: ['SECONDARY'], Fingers: ['FINGER', 'FINGERS'],
  Chest: ['CHEST'], Legs: ['LEGS'], Feet: ['FEET'], Waist: ['WAIST'], Ammo: ['AMMO'], 'Any Slot': ['CHARM']
}

/** Expansions whose zones are not in EverQuest Legends yet: hidden unless the player turns them on. */
export const DEFAULT_HIDDEN_ERAS = ['Kunark', 'Velious', 'Luclin']
export const UNKNOWN_ERA = 'Unknown'

/**
 * Wiki tags that are not eras of their own, folded into the one they belong to: Legends' reworked
 * classic zones count as Classic; Chardok is a Kunark zone, and the epics are grouped with Kunark
 * for now.
 */
const ERA_OF_TAG: Record<string, string> = {
  fearhaterevamp: 'Classic',
  fear: 'Classic',
  hate: 'Classic',
  temple: 'Classic',
  sky: 'Classic',
  paineel: 'Classic',
  chardok: 'Kunark',
  epics: 'Kunark',
  epicquests: 'Kunark'
}

/** One name per era, whatever the tag's case or name. */
export function normalizeEra(tag: string): string {
  const t = tag.trim().toLowerCase()
  if (!t) return ''
  return ERA_OF_TAG[t] ?? t[0].toUpperCase() + t.slice(1)
}

/** Earliest first: Classic, then Legends' own tags, then the expansions in release order. */
function eraRank(era: string): number {
  return era === 'Classic' ? 0 : era === 'Kunark' ? 2 : era === 'Velious' ? 3 : era === 'Luclin' ? 4 : 1
}

/**
 * Each zone's era, learned from the catalog itself: the era most of the tagged items dropping there
 * carry, when at least three in five agree.
 */
export function zoneEras(catalog: CatalogItem[]): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const item of catalog) {
    const era = normalizeEra(item.era)
    if (!era) continue
    for (const z of item.zones) {
      const m = votes.get(z) ?? new Map<string, number>()
      m.set(era, (m.get(era) ?? 0) + 1)
      votes.set(z, m)
    }
  }
  const out = new Map<string, string>()
  for (const [zone, m] of votes) {
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    const [era, n] = [...m].sort((a, b) => b[1] - a[1])[0]
    if (n / total >= 0.6) out.set(zone, era)
  }
  return out
}

/**
 * An item's era: its own tag, or, for an untagged item, the earliest era among the zones it drops in
 * (it can be had in the earliest of them). Unknown when neither says.
 */
export function eraOf(item: CatalogItem, zones: Map<string, string>): { era: string; inferred: boolean } {
  const own = normalizeEra(item.era)
  if (own) return { era: own, inferred: false }
  const eras = item.zones.map((z) => zones.get(z)).filter((e): e is string => !!e)
  if (!eras.length) return { era: UNKNOWN_ERA, inferred: false }
  return { era: eras.sort((a, b) => eraRank(a) - eraRank(b))[0], inferred: true }
}

export interface Restrictions {
  slots: string[]
  /** Class codes, or ['ALL']. */
  classes: string[]
  /** Race codes, or ['ALL']. */
  races: string[]
  reqLevel: number
}

export function restrictions(block: string): Restrictions {
  const text = block.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  const words = (label: string) =>
    (new RegExp(`\\b${label}:\\s*([A-Z0-9 ]+)`, 'i').exec(text)?.[1] ?? '')
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
  return {
    slots: words('Slot'),
    classes: words('Class'),
    races: words('Race'),
    reqLevel: Number(/Required level of (\d+)/i.exec(text)?.[1] ?? 0)
  }
}

export interface Wearer {
  /** Tracker class ids: 'shd', 'mnk', … */
  classes: string[]
  /** 'IKS' and the like; '' when not known, which skips the race check. */
  race: string
  level: number
}

export function canWear(r: Restrictions, who: Wearer, slot: string): boolean {
  const words = SLOT_WORDS[slot] ?? []
  if (!r.slots.some((s) => words.includes(s))) return false
  if (!r.classes.includes('ALL') && !who.classes.some((c) => r.classes.includes(CLASS_CODE[c] ?? ''))) return false
  if (who.race && r.races.length && !r.races.includes('ALL') && !r.races.includes(who.race)) return false
  return !(r.reqLevel && r.reqLevel > who.level)
}

/** Slots where a weapon's damage and delay count. */
export const WEAPON_SLOTS = ['Primary', 'Secondary', 'Range']

export type WeightKey =
  | 'ac' | 'hp' | 'mana' | 'end' | 'str' | 'sta' | 'agi' | 'dex' | 'wis' | 'int' | 'cha'
  | 'resists' | 'haste' | 'attack' | 'hpRegen' | 'manaRegen' | 'endRegen' | 'ratio'

export type Weights = Record<WeightKey, number>

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  ac: 'AC', hp: 'HP', mana: 'Mana', end: 'Endurance', str: 'Strength', sta: 'Stamina', agi: 'Agility', dex: 'Dexterity',
  wis: 'Wisdom', int: 'Intelligence', cha: 'Charisma', resists: 'Resists', haste: 'Haste %', attack: 'Attack',
  hpRegen: 'HP regen', manaRegen: 'Mana regen', endRegen: 'End regen', ratio: 'Weapon ratio'
}

/** Starting points; every weight can be moved. Per point of the stat. */
export const PRESETS: Record<string, Weights> = {
  Balanced: { ac: 2, hp: 0.25, mana: 0.2, end: 0.1, str: 0.6, sta: 0.8, agi: 0.6, dex: 0.5, wis: 0.5, int: 0.5, cha: 0.1, resists: 0.2, haste: 2, attack: 1, hpRegen: 2, manaRegen: 2, endRegen: 1, ratio: 0 },
  Tank: { ac: 4, hp: 0.4, mana: 0, end: 0.1, str: 0.4, sta: 1.2, agi: 0.8, dex: 0.3, wis: 0.1, int: 0.1, cha: 0, resists: 0.4, haste: 1.5, attack: 0.5, hpRegen: 3, manaRegen: 0, endRegen: 1, ratio: 40 },
  Melee: { ac: 1, hp: 0.2, mana: 0, end: 0.2, str: 1.2, sta: 0.5, agi: 0.6, dex: 1, wis: 0, int: 0, cha: 0, resists: 0.1, haste: 4, attack: 2, hpRegen: 1, manaRegen: 0, endRegen: 2, ratio: 40 },
  Caster: { ac: 0.8, hp: 0.25, mana: 0.5, end: 0, str: 0, sta: 0.6, agi: 0.3, dex: 0.1, wis: 1.2, int: 1.2, cha: 0.2, resists: 0.3, haste: 0, attack: 0, hpRegen: 1, manaRegen: 4, endRegen: 0, ratio: 0 }
}

/** An item's stats as the weights read them. */
export function statValues(s: ItemStats): Record<WeightKey, number> {
  const resists = Object.values(s.saves).reduce<number>((a, b) => a + (b ?? 0), 0)
  return {
    ac: s.ac,
    hp: s.pools.HP ?? 0,
    mana: s.pools.MANA ?? 0,
    end: s.pools.END ?? 0,
    str: s.stats.STR ?? 0,
    sta: s.stats.STA ?? 0,
    agi: s.stats.AGI ?? 0,
    dex: s.stats.DEX ?? 0,
    wis: s.stats.WIS ?? 0,
    int: s.stats.INT ?? 0,
    cha: s.stats.CHA ?? 0,
    resists,
    haste: s.haste,
    attack: s.attack,
    hpRegen: s.hpRegen,
    manaRegen: s.manaRegen,
    endRegen: s.endRegen,
    ratio: s.damage && s.delay ? Math.round((s.damage / s.delay) * 100) / 100 : 0
  }
}

export function score(s: ItemStats, w: Weights): number {
  const v = statValues(s)
  return (Object.keys(w) as WeightKey[]).reduce((sum, k) => sum + v[k] * w[k], 0)
}

export interface Candidate {
  item: CatalogItem
  stats: ItemStats
  score: number
  delta: number
  /** Stat changes against the item it would replace, biggest first. */
  diffs: { key: WeightKey; label: string; delta: number }[]
  owned: boolean
  era: string
  /** The era came from the zones it drops in, not a tag on its page. */
  eraInferred: boolean
}

export interface SlotResult {
  slot: string
  /** The worn item this would replace: the weaker one where the slot comes in pairs. */
  current: { item: InvItem; score: number; stats: ItemStats | null } | null
  candidates: Candidate[]
}

export interface FinderOptions {
  worn: InvItem[]
  /** Stats for a worn item at its merge level, from the wiki. */
  statsOf: (item: InvItem) => ItemStats | null
  catalog: CatalogItem[]
  wearer: Wearer
  weights: Weights
  /** 'drop': candidates as they drop (+0). 'level': at the merge level of what they replace. */
  compare: 'drop' | 'level'
  /** Eras to leave out, by normalizeEra() name, 'Unknown' included. */
  hiddenEras: string[]
  /** itemKeys of everything the character owns anywhere. */
  owned: Set<string>
  perSlot?: number
}

/** Per worn slot, the best candidates that beat what is worn there, by the chosen weights. */
export function findUpgrades(o: FinderOptions): SlotResult[] {
  const perSlot = o.perSlot ?? 6
  const zones = zoneEras(o.catalog)
  const hidden = new Set(o.hiddenEras)
  const parsed = o.catalog.map((item) => ({ item, r: restrictions(item.statsblock), base: parseStatsBlock(item.statsblock), ...eraOf(item, zones) }))
  const slots = [...new Set(o.worn.map((w) => w.location))]
  for (const s of Object.keys(SLOT_WORDS)) if (!slots.includes(s)) slots.push(s)
  return slots.map((slot) => {
    // A weapon's damage and delay only matter in the hands; anywhere else they are no reason to wear it.
    const weights: Weights = WEAPON_SLOTS.includes(slot) ? o.weights : { ...o.weights, ratio: 0 }
    const worn = o.worn.filter((w) => w.location === slot)
    const scored = worn.map((item) => {
      const stats = o.statsOf(item)
      return { item, stats, score: stats ? score(stats, weights) : 0 }
    })
    const current = scored.sort((a, b) => a.score - b.score)[0] ?? null
    const level = current ? mergeLevel(current.item.name) : 0
    const wornKeys = new Set(worn.map((w) => itemKey(w.name)))
    const currentValues = current?.stats ? statValues(current.stats) : null
    const candidates: Candidate[] = []
    for (const p of parsed) {
      if (hidden.has(p.era)) continue
      // Summoned items are conjured and vanish; they are not gear to chase.
      if (/^Summoned:/i.test(p.item.title)) continue
      if (!canWear(p.r, o.wearer, slot)) continue
      if (wornKeys.has(itemKey(p.item.title))) continue
      const stats = o.compare === 'level' && level ? scaledStats(p.base, level) : p.base
      const sc = score(stats, weights)
      const delta = sc - (current?.score ?? 0)
      if (delta <= 0) continue
      const values = statValues(stats)
      const diffs = (Object.keys(values) as WeightKey[])
        .map((k) => ({ key: k, label: WEIGHT_LABELS[k], delta: Math.round((values[k] - (currentValues?.[k] ?? 0)) * 100) / 100 }))
        .filter((d) => d.delta !== 0 && weights[d.key] !== 0)
        .sort((a, b) => Math.abs(b.delta * weights[b.key]) - Math.abs(a.delta * weights[a.key]))
      candidates.push({ item: p.item, stats, score: sc, delta, diffs, owned: o.owned.has(itemKey(p.item.title)), era: p.era, eraInferred: p.inferred })
    }
    candidates.sort((a, b) => b.delta - a.delta)
    return { slot, current: current ? { item: current.item, score: current.score, stats: current.stats } : null, candidates: candidates.slice(0, perSlot) }
  })
}
