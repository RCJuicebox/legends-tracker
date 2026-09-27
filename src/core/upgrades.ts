// The upgrade finder: for each worn slot, the catalog items this character could wear there, scored
// with the player's own stat weights against what they wear now.

import { itemKey, mergeLevel, parseStatsBlock, scaledStats, type InvItem, type ItemStats } from './inventory'
import type { CatalogItem } from './wikiItem'
import type { EffectValue } from './gearOptimizer'
import { procOf, wornEffectOf } from './itemEffects'
import { classCode } from '../shared/game/classes'

/** Worn locations as the inventory export names them → the words a stats block's "Slot:" line uses. */
export const SLOT_WORDS: Record<string, string[]> = {
  Ear: ['EAR'],
  Head: ['HEAD'],
  Face: ['FACE'],
  Neck: ['NECK'],
  Shoulders: ['SHOULDERS', 'SHOULDER'],
  Arms: ['ARMS'],
  Back: ['BACK'],
  Wrist: ['WRIST'],
  Range: ['RANGE'],
  Hands: ['HANDS'],
  Primary: ['PRIMARY'],
  Secondary: ['SECONDARY'],
  Fingers: ['FINGER', 'FINGERS'],
  Chest: ['CHEST'],
  Legs: ['LEGS'],
  Feet: ['FEET'],
  Waist: ['WAIST'],
  Ammo: ['AMMO'],
  'Any Slot': ['CHARM']
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
  classic: 'in',
  fear: 'in',
  hate: 'in',
  hole: 'in',
  sky: 'in',
  stonebrunt: 'in',
  temple: 'in',
  warrens: 'in',
  paineel: 'in',
  kunark: 'out',
  velious: 'out',
  luclin: 'out',
  chardok: 'out',
  chardokrevamp: 'out',
  holevp: 'out',
  warrensfearhaterevamp: 'out',
  fearhaterevamp: 'out',
  epics: 'out',
  epicquests: 'out',
  unknown: 'out'
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
 * An item's era group: its own tag; for an untagged crafted item, the latest group its recipe's
 * ingredients need (it is made only once all can be had); else the earliest group among the zones it
 * drops in (it can be had in the earliest of them). Other when none says.
 */
export function eraOf(item: CatalogItem, zones: Map<string, string>, status?: Record<string, 'in' | 'out'>): { era: string; inferred: boolean; by?: 'zone' | 'recipe' } {
  const own = normalizeEra(item.era, status)
  if (own) return { era: own, inferred: false }
  // Crafted: made only once every ingredient can be had, so the latest era among them.
  const made = (item.craftEras ?? []).map((t) => normalizeEra(t, status)).filter(Boolean)
  const byRecipe = made.length ? made.sort((a, b) => eraRank(b) - eraRank(a))[0] : ''
  // Dropped: had in the earliest zone it drops in.
  const eras = item.zones.map((z) => zones.get(z)).filter((e): e is string => !!e)
  const byZone = eras.length ? eras.sort((a, b) => eraRank(a) - eraRank(b))[0] : ''
  // Both: whichever way comes first.
  if (byRecipe && (!byZone || eraRank(byRecipe) < eraRank(byZone))) return { era: byRecipe, inferred: true, by: 'recipe' }
  if (byZone) return { era: byZone, inferred: true, by: 'zone' }
  return { era: OTHER_ERA, inferred: false }
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
  const words = (label: keyof typeof RE_WORDS) => (RE_WORDS[label].exec(text)?.[1] ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean)
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
  if (!r.classes.includes('ALL') && !who.classes.some((c) => r.classes.includes(classCode(c)))) return false
  if (who.race && r.races.length && !r.races.includes('ALL') && !r.races.includes(who.race)) return false
  return !(r.reqLevel && r.reqLevel > who.level)
}

/** Two-handed: it takes the secondary hand too. */
export const isTwoHanded = (r: Restrictions) => /^2H\b/i.test(r.skill)

/**
 * The weights as a slot reads them. A weapon's damage and delay count in the hands (weapon ratio) and
 * in the Range slot (ranged ratio, weighed apart so a melee's range slot can go to stats); anywhere
 * else they are no reason to wear it. Both weights are per 1% more damage from that slot, as the pet
 * planner has them; a weapon's ratio (damage ÷ delay, near 1) moves that by about 1% each 0.01, so a
 * whole point of ratio is worth 100 times the weight.
 */
export function weightsForSlot(w: Weights, slot: string, hands?: HandWeights | null): Weights {
  const hand = slot === 'Primary' ? (hands?.main ?? 1) : slot === 'Secondary' ? (hands?.off ?? 1) : 0
  return { ...w, ratio: w.ratio * 100 * hand, rangedRatio: slot === 'Range' ? w.rangedRatio * 100 : 0 }
}

/**
 * How much each hand's weapon counts, from how often it swings: the main hand every round (with its
 * double and triple attacks), the offhand only when dual wield comes up. Scaled so the two average
 * 1, as when both count alike: a hand that swings more is worth more ratio, and procs more.
 */
export interface HandWeights {
  main: number
  off: number
}

export function handWeights(swings: { main: number; off: number }): HandWeights {
  const both = swings.main + swings.off
  return both > 0 ? { main: (2 * swings.main) / both, off: (2 * swings.off) / both } : { main: 1, off: 1 }
}

export type WeightKey =
  | 'ac'
  | 'hp'
  | 'mana'
  | 'end'
  | 'str'
  | 'sta'
  | 'agi'
  | 'dex'
  | 'wis'
  | 'int'
  | 'cha'
  | 'resists'
  | 'haste'
  | 'attack'
  | 'hpRegen'
  | 'manaRegen'
  | 'endRegen'
  | 'ratio'
  | 'rangedRatio'

export type Weights = Record<WeightKey, number>

export const WEIGHT_LABELS: Record<WeightKey, string> = {
  ac: 'AC',
  hp: 'HP',
  mana: 'Mana',
  end: 'Endurance',
  str: 'Strength',
  sta: 'Stamina',
  agi: 'Agility',
  dex: 'Dexterity',
  wis: 'Wisdom',
  int: 'Intelligence',
  cha: 'Charisma',
  resists: 'Resists',
  haste: 'Haste %',
  attack: 'Attack',
  hpRegen: 'HP regen',
  manaRegen: 'Mana regen',
  endRegen: 'End regen',
  ratio: 'Weapon ratio',
  rangedRatio: 'Ranged ratio'
}

/** An item's stats as the weights read them. */
export function statValues(s: ItemStats): Record<WeightKey, number> {
  const resists = Object.values(s.saves).reduce<number>((a, b) => a + (b ?? 0), 0)
  const ratio = s.damage && s.delay ? Math.round((s.damage / s.delay) * 100) / 100 : 0
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
    ratio,
    rangedRatio: ratio
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
  /** What the era was worked out from, when inferred: the zones it drops in, or its recipe's ingredients. */
  eraBy?: 'zone' | 'recipe'
  /** Its focus effect, and what swapping it in does to the worth of the foci worn (in score points). */
  focus: { name: string; gain: number } | null
  /** Its worn effect and proc, and what swapping it in does to the worth of those worn (in score points). */
  effects?: { worn: string; proc: string; gain: number }
  /**
   * Judged in the round (see finderRound.ts): what the whole set gains with it, where it lands, and
   * what else moves. Filled in by the finder page, not here.
   */
  round?: { delta: number; placed: string | null; moves: { slot: string; out: string | null; in: string | null }[] }
}

export interface SlotResult {
  slot: string
  /** The worn item this would replace: the weaker one where the slot comes in pairs. */
  current: { item: InvItem; score: number; stats: ItemStats | null; focusLoss: number; effectLoss?: number } | null
  candidates: Candidate[]
}

/** Worn effects and procs in the finder: what a worn item carries (with its exaltations) and what they are worth. */
export interface FinderEffects {
  of: (item: InvItem) => { worn: string[]; procs: string[] }
  value: EffectValue
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
  /**
   * The stats of the best copy the character owns (at its merge level), by itemKey; null when none
   * is known. An owned candidate is judged as that copy, whatever `compare` says: it is the one they
   * would put on, and the one the optimizer weighs.
   */
  ownedStats?: (key: string) => ItemStats | null
  focus?: FinderFocus
  effects?: FinderEffects
  /** How much each hand's weapon counts; alike when absent. */
  hands?: HandWeights | null
  perSlot?: number
  /**
   * Keep candidates whose stats beat the worn item even when the focus lost with it makes the swap
   * a loss slot by slot: judged in the round, the displaced item may keep its focus in another slot.
   */
  keepStatWinners?: boolean
}

interface ParsedItem {
  item: CatalogItem
  r: Restrictions
  base: ItemStats
  /** Its worn effect and combat proc; '' for none. */
  worn: string
  proc: string
  era: string
  inferred: boolean
  by?: 'zone' | 'recipe'
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
    : catalog.map((item) => ({
        item,
        r: restrictions(item.statsblock),
        base: parseStatsBlock(item.statsblock),
        worn: wornEffectOf(item.statsblock),
        proc: procOf(item.statsblock),
        ...eraOf(item, zones, eraStatus)
      }))
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
  const focusWithout = (item: InvItem | undefined, add: string[] = []) => (o.focus ? o.focus.value([...wornFoci.filter((_, i) => o.worn[i] !== item).flat(), ...add]) : 0)
  // Haste does not add up: only the best worn counts. Items are scored without it, and haste is
  // counted as what the best worn one gives, so a second haste item is worth only what it adds.
  const wornHaste = o.worn.map((w) => o.statsOf(w)?.haste ?? 0)
  const hasteNow = Math.max(0, ...wornHaste)
  const hasteWithout = (item?: InvItem) => Math.max(0, ...wornHaste.filter((_, i) => o.worn[i] !== item))
  // Worn effects count once wherever worn; procs count on weapons in the hands.
  const HANDS = ['Primary', 'Secondary']
  // An offhand proc fires on offhand swings: as often as the offhand swings against the main hand.
  const procShare = (slot: string) => (slot === 'Secondary' && o.hands ? o.hands.off / o.hands.main : 1)
  const wornFx = o.worn.map((w) => o.effects?.of(w) ?? { worn: [], procs: [] })
  const effectsWith = (item: InvItem | undefined, add: { worn: string[]; procs: string[] } | null, slot: string): number => {
    const fx = o.effects
    if (!fx) return 0
    const names = new Set<string>()
    let t = 0
    o.worn.forEach((w, i) => {
      if (w === item) return
      for (const n of wornFx[i].worn) names.add(n)
      if (HANDS.includes(w.location)) for (const n of wornFx[i].procs) t += fx.value.proc(n) * procShare(w.location)
    })
    if (add) {
      for (const n of add.worn) names.add(n)
      if (HANDS.includes(slot)) for (const n of add.procs) t += fx.value.proc(n) * procShare(slot)
    }
    return t + (names.size ? fx.value.worn([...names].sort()) : 0)
  }
  const effectsNow = effectsWith(undefined, null, '')
  return slots.map((slot) => {
    const shown = weightsForSlot(o.weights, slot, o.hands)
    const weights: Weights = { ...shown, haste: 0 }
    const worn = o.worn.filter((w) => w.location === slot)
    const scored = worn.map((item) => {
      const stats = o.statsOf(item)
      const hasteLoss = (hasteNow - hasteWithout(item)) * o.weights.haste
      const effectLoss = effectsNow - effectsWith(item, null, slot)
      return { item, stats, score: (stats ? score(stats, weights) : 0) + hasteLoss, focusLoss: focusNow - focusWithout(item), effectLoss }
    })
    // The one to replace is the one worth least, its focus effects, worn effects and procs counted.
    const current = scored.sort((a, b) => a.score + a.focusLoss + a.effectLoss - (b.score + b.focusLoss + b.effectLoss))[0] ?? null
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
      const mine = o.owned.has(key) ? o.ownedStats?.(key) : null
      const stats = mine ?? (o.compare === 'level' && level ? scaledStats(p.base, level) : p.base)
      const hasteChange = Math.max(hasteLeft, stats.haste) - hasteNow
      const sc = score(stats, weights) + (Math.max(hasteLeft, stats.haste) - hasteLeft) * o.weights.haste
      const focusGain = !o.focus ? 0 : (p.item.focus ? focusWithout(current?.item, [p.item.focus]) : withoutCurrent) - focusNow
      const worn = o.effects ? p.worn : ''
      const proc = o.effects ? p.proc : ''
      const effectGain = o.effects ? effectsWith(current?.item, { worn: worn ? [worn] : [], procs: proc ? [proc] : [] }, slot) - effectsNow : 0
      const statDelta = sc - (current?.score ?? 0)
      const delta = statDelta + focusGain + effectGain
      if (delta <= 0 && !(o.keepStatWinners && statDelta > 0)) continue
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
        eraBy: p.by,
        focus: p.item.focus ? { name: p.item.focus, gain: focusGain } : null,
        ...(worn || proc || effectGain ? { effects: { worn, proc, gain: effectGain } } : {})
      })
    }
    candidates.sort((a, b) => b.delta - a.delta)
    return {
      slot,
      current: current ? { item: current.item, score: current.score, stats: current.stats, focusLoss: current.focusLoss, effectLoss: current.effectLoss } : null,
      candidates: candidates.slice(0, perSlot)
    }
  })
}
