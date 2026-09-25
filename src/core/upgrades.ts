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

/** Legends' two Any slots take any piece of gear: a shield, a necklace, a charm. */
export const ANY_SLOT = 'Any Slot'
const EVERY_SLOT_WORD = [...new Set(Object.values(SLOT_WORDS).flat())]

/** Lore: one to a character, so one already worn cannot be worn again elsewhere. */
export const isLore = (statsblock: string) => /\bLORE\b/i.test(statsblock)

export const OTHER_ERA = 'Other'
export const OTHER_OUT_ERA = 'Other OOE'
/** Groups out of era on EverQuest Legends: hidden unless the player turns them on. */
export const DEFAULT_HIDDEN_ERAS = ['Kunark', 'Velious', 'Luclin', OTHER_OUT_ERA]
/** The order the era chips appear in. */
export const ERA_ORDER = ['Classic', OTHER_ERA, 'Kunark', 'Velious', 'Luclin', OTHER_OUT_ERA]

/**
 * Which eras eqlwiki counts as in era for EverQuest Legends, as its Template:PageEra switch lists them
 * (key: the tag lowercased, spaces out). The catalog download reads the live list; this copy is the
 * fallback. Anything not listed is out, as on the wiki.
 */
export const DEFAULT_ERA_STATUS: Record<string, 'in' | 'out'> = {
  classic: 'in', fear: 'in', hate: 'in', hole: 'in', sky: 'in', stonebrunt: 'in', temple: 'in', warrens: 'in', paineel: 'in',
  kunark: 'out', velious: 'out', luclin: 'out', chardok: 'out', chardokrevamp: 'out', holevp: 'out', warrensfearhaterevamp: 'out',
  fearhaterevamp: 'out', epics: 'out', epicquests: 'out', unknown: 'out'
}

/** Reads the in/out list out of Template:PageEra's source ("| kunark = out"). */
export function parseEraStatus(templateSource: string): Record<string, 'in' | 'out'> {
  const out: Record<string, 'in' | 'out'> = {}
  // Only the switch's own lines read "| name = in" or "| name = out"; its documentation uses "# name".
  for (const m of templateSource.matchAll(/^\s*\|\s*([a-z0-9]+)\s*=\s*(in|out)\s*$/gim)) out[m[1].toLowerCase()] = m[2].toLowerCase() as 'in' | 'out'
  return out
}

/** Out-of-era tags that belong to a named expansion. Chardok and the epics sit with Kunark for now. */
const EXPANSION_OF_TAG: Record<string, string> = {
  kunark: 'Kunark',
  chardok: 'Kunark',
  epics: 'Kunark',
  epicquests: 'Kunark',
  velious: 'Velious',
  chardokrevamp: 'Velious',
  luclin: 'Luclin'
}

/**
 * The era group a wiki tag falls in: every in-era tag (Legends' live classic content) is Classic, an
 * out-of-era tag goes to its expansion, and an out-of-era tag with no expansion is Other OOE.
 */
export function normalizeEra(tag: string, status: Record<string, 'in' | 'out'> = DEFAULT_ERA_STATUS): string {
  const key = tag.trim().toLowerCase().replace(/\s+/g, '')
  if (!key) return ''
  if ((status[key] ?? DEFAULT_ERA_STATUS[key]) === 'in') return 'Classic'
  return EXPANSION_OF_TAG[key] ?? OTHER_OUT_ERA
}

/** Earliest first, so an item from several zones counts in the one easiest to reach. */
function eraRank(era: string): number {
  const i = ERA_ORDER.indexOf(era)
  return i < 0 ? ERA_ORDER.length : i
}

/**
 * Each zone's era, learned from the catalog itself: the era most of the tagged items dropping there
 * carry, when at least three in five agree.
 */
export function zoneEras(catalog: CatalogItem[], status?: Record<string, 'in' | 'out'>): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const item of catalog) {
    const era = normalizeEra(item.era, status)
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
 * An item's era group: its own tag, or, for an untagged item, the earliest group among the zones it
 * drops in (it can be had in the earliest of them). Other when neither says.
 */
export function eraOf(item: CatalogItem, zones: Map<string, string>, status?: Record<string, 'in' | 'out'>): { era: string; inferred: boolean } {
  const own = normalizeEra(item.era, status)
  if (own) return { era: own, inferred: false }
  const eras = item.zones.map((z) => zones.get(z)).filter((e): e is string => !!e)
  if (!eras.length) return { era: OTHER_ERA, inferred: false }
  return { era: eras.sort((a, b) => eraRank(a) - eraRank(b))[0], inferred: true }
}

export interface Restrictions {
  slots: string[]
  /** A weapon's skill as its stats block names it ("2H Slashing", "Hand to Hand"); '' for anything else. */
  skill: string
  /** Class codes, or ['ALL']. */
  classes: string[]
  /** Race codes, or ['ALL']. */
  races: string[]
  reqLevel: number
}

const RE_WORDS = {
  Slot: /\bSlot:\s*([A-Z0-9 ]+)/i,
  Class: /\bClass:\s*([A-Z0-9 ]+)/i,
  Race: /\bRace:\s*([A-Z0-9 ]+)/i
}

export function restrictions(block: string): Restrictions {
  const text = block.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  const words = (label: keyof typeof RE_WORDS) =>
    (RE_WORDS[label].exec(text)?.[1] ?? '')
      .trim()
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean)
  return {
    slots: words('Slot'),
    skill: /\bSkill:\s*([0-9A-Za-z ]+?)(?:\s{2,}|\s*Atk Delay|\s*$|\n)/m.exec(text)?.[1].trim() ?? '',
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
  const words = slot === ANY_SLOT ? EVERY_SLOT_WORD : (SLOT_WORDS[slot] ?? [])
  if (!r.slots.some((s) => words.includes(s))) return false
  if (!r.classes.includes('ALL') && !who.classes.some((c) => r.classes.includes(CLASS_CODE[c] ?? ''))) return false
  if (who.race && r.races.length && !r.races.includes('ALL') && !r.races.includes(who.race)) return false
  return !(r.reqLevel && r.reqLevel > who.level)
}

/** Two-handed: it takes the secondary hand too. */
export const isTwoHanded = (r: Restrictions) => /^2H\b/i.test(r.skill)

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
  /** Its focus effect, and what swapping it in does to the worth of the foci worn (in score points). */
  focus: { name: string; gain: number } | null
}

export interface SlotResult {
  slot: string
  /** The worn item this would replace: the weaker one where the slot comes in pairs. */
  current: { item: InvItem; score: number; stats: ItemStats | null; focusLoss: number } | null
  candidates: Candidate[]
}

/** Focus effects in the finder: what a worn item carries (with its exaltations) and what a set of foci is worth. */
export interface FinderFocus {
  worn: (item: InvItem) => string[]
  value: (names: string[]) => number
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
  /** Era groups to leave out, as normalizeEra() names them. */
  hiddenEras: string[]
  /** The wiki's in/out list; the built-in copy when absent. */
  eraStatus?: Record<string, 'in' | 'out'>
  /** Suggest two-handed weapons for Primary; off when the secondary hand is in use. */
  twoHanders?: boolean
  /** itemKeys of everything the character owns anywhere. */
  owned: Set<string>
  focus?: FinderFocus
  perSlot?: number
}

interface ParsedItem {
  item: CatalogItem
  r: Restrictions
  base: ItemStats
  era: string
  inferred: boolean
}

/** Parsed catalogs, by the catalog array itself: the finder runs again on every slider move. */
const parsedCatalogs = new WeakMap<CatalogItem[], { status: FinderOptions['eraStatus']; items: ParsedItem[] }>()

/**
 * Every catalog item's restrictions, base stats and era, parsed once per catalog (eras again when the
 * era list changes). Candidates at +0 share these stats objects, so they are read-only.
 */
function parseCatalog(catalog: CatalogItem[], eraStatus: FinderOptions['eraStatus']): ParsedItem[] {
  const hit = parsedCatalogs.get(catalog)
  if (hit && hit.status === eraStatus) return hit.items
  const zones = zoneEras(catalog, eraStatus)
  const items = hit
    ? hit.items.map((p) => ({ ...p, ...eraOf(p.item, zones, eraStatus) }))
    : catalog.map((item) => ({ item, r: restrictions(item.statsblock), base: parseStatsBlock(item.statsblock), ...eraOf(item, zones, eraStatus) }))
  parsedCatalogs.set(catalog, { status: eraStatus, items })
  return items
}

/** Per worn slot, the best candidates that beat what is worn there, by the chosen weights. */
export function findUpgrades(o: FinderOptions): SlotResult[] {
  const perSlot = o.perSlot ?? 6
  const hidden = new Set(o.hiddenEras)
  const parsed = parseCatalog(o.catalog, o.eraStatus)
  const slots = [...new Set(o.worn.map((w) => w.location))]
  for (const s of Object.keys(SLOT_WORDS)) if (!slots.includes(s)) slots.push(s)
  const wornAnywhere = new Set(o.worn.map((w) => itemKey(w.name)))
  // The foci worn now, item by item, and what they are worth together.
  const wornFoci = o.worn.map((w) => o.focus?.worn(w) ?? [])
  const focusNow = o.focus ? o.focus.value(wornFoci.flat()) : 0
  const focusWithout = (item: InvItem | undefined, add: string[] = []) =>
    o.focus ? o.focus.value([...wornFoci.filter((_, i) => o.worn[i] !== item).flat(), ...add]) : 0
  // Haste does not add up: only the best worn counts. Items are scored without it, and haste is
  // counted as what the best worn one gives, so a second haste item is worth only what it adds.
  const wornHaste = o.worn.map((w) => o.statsOf(w)?.haste ?? 0)
  const hasteNow = Math.max(0, ...wornHaste)
  const hasteWithout = (item?: InvItem) => Math.max(0, ...wornHaste.filter((_, i) => o.worn[i] !== item))
  return slots.map((slot) => {
    // A weapon's damage and delay only matter in the hands; anywhere else they are no reason to wear it.
    const shown: Weights = WEAPON_SLOTS.includes(slot) ? o.weights : { ...o.weights, ratio: 0 }
    const weights: Weights = { ...shown, haste: 0 }
    const worn = o.worn.filter((w) => w.location === slot)
    const scored = worn.map((item) => {
      const stats = o.statsOf(item)
      const hasteLoss = (hasteNow - hasteWithout(item)) * o.weights.haste
      return { item, stats, score: (stats ? score(stats, weights) : 0) + hasteLoss, focusLoss: focusNow - focusWithout(item) }
    })
    // The one to replace is the one worth least, its focus effects counted.
    const current = scored.sort((a, b) => a.score + a.focusLoss - (b.score + b.focusLoss))[0] ?? null
    const level = current ? mergeLevel(current.item.name) : 0
    const wornKeys = new Set(worn.map((w) => itemKey(w.name)))
    const currentValues = current?.stats ? statValues(current.stats) : null
    const withoutCurrent = focusWithout(current?.item)
    const hasteLeft = hasteWithout(current?.item)
    const candidates: Candidate[] = []
    for (const p of parsed) {
      if (hidden.has(p.era)) continue
      // Summoned items are conjured and vanish; they are not gear to chase.
      if (/^Summoned:/i.test(p.item.title)) continue
      if (!canWear(p.r, o.wearer, slot)) continue
      if (slot === 'Primary' && !o.twoHanders && isTwoHanded(p.r)) continue
      const key = itemKey(p.item.title)
      if (wornKeys.has(key) || (wornAnywhere.has(key) && isLore(p.item.statsblock))) continue
      const stats = o.compare === 'level' && level ? scaledStats(p.base, level) : p.base
      const hasteChange = Math.max(hasteLeft, stats.haste) - hasteNow
      const sc = score(stats, weights) + (Math.max(hasteLeft, stats.haste) - hasteLeft) * o.weights.haste
      const focusGain = !o.focus ? 0 : (p.item.focus ? focusWithout(current?.item, [p.item.focus]) : withoutCurrent) - focusNow
      const delta = sc - (current?.score ?? 0) + focusGain
      if (delta <= 0) continue
      const values = statValues(stats)
      const diffs = (Object.keys(values) as WeightKey[])
        .map((k) => ({ key: k, label: WEIGHT_LABELS[k], delta: Math.round((k === 'haste' ? hasteChange : values[k] - (currentValues?.[k] ?? 0)) * 100) / 100 }))
        .filter((d) => d.delta !== 0 && shown[d.key] !== 0)
        .sort((a, b) => Math.abs(b.delta * shown[b.key]) - Math.abs(a.delta * shown[a.key]))
      candidates.push({
        item: p.item,
        stats,
        score: sc,
        delta,
        diffs,
        owned: o.owned.has(key),
        era: p.era,
        eraInferred: p.inferred,
        focus: p.item.focus ? { name: p.item.focus, gain: focusGain } : null
      })
    }
    candidates.sort((a, b) => b.delta - a.delta)
    return {
      slot,
      current: current ? { item: current.item, score: current.score, stats: current.stats, focusLoss: current.focusLoss } : null,
      candidates: candidates.slice(0, perSlot)
    }
  })
}
