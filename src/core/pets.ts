// The pet gear optimizer. EverQuest Legends pets wear gear given to them in the Inventory window's
// Pet tab. What the eqlwiki Pet Guide (https://eqlwiki.com/index.php/Pet_Guide) says, and this
// follows:
//   - A pet may wear anything its owner's three classes could, or its own classes could. Summoned
//     pets are Warrior plus at most one more class; each "<spell> Summon" wiki page names them.
//   - The pet inventory holds 4 items, plus 3 for a Magician or Beastlord, 2 for a Necromancer and 1
//     for an Enchanter, Druid or Shaman (a Shadow Knight adds none): 12 at most.
//   - It wears them as a player would, one chest, two earrings and so on; given two for one slot it
//     wears the one with more AC. So the best gift is at most one item per slot.
//   - Weapons: a weapon with a better damage/delay ratio than the pet's own is used outright
//     (damage, delay and bonus damage). One with a worse ratio but more damage lends only its damage;
//     the pet keeps its own delay and bonus. Anything else changes nothing.
// The game shows what a pet wears with `/pet inventory check`; the inventory export does not list it.
// Nothing about any pet is kept here: the pet's classes, level, stats and base melee come from the
// wiki at run time.

import { CLASSES } from './acModel'
import { summonsPet } from './spellKinds'
import { itemKey, type InvItem, type ItemStats } from './inventory'
import { canWear, isTwoHanded, score, type Restrictions, type Wearer, type Weights } from './upgrades'
import type { ClassFactors, Conversions, RoleWeights } from './statValue'
import { conversions } from './statValue'
import type { PieceSource } from './gearOptimizer'
import { parseWikiTables } from './wikiTable'
import type { SpellBook } from './spells'
import { CLASS_NAMES } from '../shared/types'

// ---- slots ----

const SLOT_BONUS: Record<string, number> = { mag: 3, bst: 3, nec: 2, enc: 1, dru: 1, shm: 1 }
export const PET_BASE_SLOTS = 4
export const PET_MAX_SLOTS = 12

/** How many items the pet inventory holds for a character of these classes. */
export function petSlots(classes: string[]): number {
  return Math.min(PET_MAX_SLOTS, PET_BASE_SLOTS + classes.reduce((n, c) => n + (SLOT_BONUS[c] ?? 0), 0))
}

/** Where a pet wears things: one of each, two ears, wrists and rings. No charm or ammo slot is known to work. */
export const PET_SLOT_CAPACITY: Record<string, number> = {
  Head: 1, Face: 1, Ear: 2, Neck: 1, Shoulders: 1, Back: 1, Arms: 1, Chest: 1, Wrist: 2, Hands: 1,
  Fingers: 2, Waist: 1, Legs: 1, Feet: 1, Primary: 1, Secondary: 1, Range: 1
}

// ---- what the pet wears now: /pet inventory check ----

export const PET_GEAR_HEAD = 'Your pet has the following items equipped:'
const RE_PET_GEAR_ITEM = /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?): (.+)$/

export interface PetGearItem {
  slot: string
  name: string
}

export interface PetGearReading {
  /** When the list was printed. */
  at: number
  items: PetGearItem[]
}

/** One line of the list that follows the heading: "Arms: Lustrous Russet Vambraces +7". */
export function parsePetGearItem(text: string): PetGearItem | null {
  const m = RE_PET_GEAR_ITEM.exec(text)
  return m ? { slot: m[1], name: m[2].trim() } : null
}

/**
 * Collects the list from log lines as they come: the heading, then one line per item in the same
 * second. Whatever else comes next ends it.
 */
export class PetGearReader {
  private open: PetGearReading | null = null

  constructor(private readonly done: (r: PetGearReading) => void) {}

  handle(text: string, time: number): void {
    if (text === PET_GEAR_HEAD) {
      this.flush()
      this.open = { at: time, items: [] }
      return
    }
    if (!this.open) return
    const item = time - this.open.at <= 2000 ? parsePetGearItem(text) : null
    if (item) this.open.items.push(item)
    else this.flush()
  }

  /** Ends a list the log has stopped adding to. */
  tick(now: number): void {
    if (this.open && now - this.open.at > 3000) this.flush()
  }

  flush(): void {
    const r = this.open
    this.open = null
    if (r) this.done(r)
  }
}

// ---- the pet itself, from the wiki ----

export interface PetMelee {
  damage: number
  delay: number
  bonus: number
  /** Off-hand swings per main-hand swing, 0–1. */
  dualWield: number
}

export interface PetProfile {
  /** The summoning spell, unranked: "Frenzied Spirit". */
  spell: string
  /** Tracker class ids: ['bst', 'war']. */
  classes: string[]
  level: number
  hp: number
  stats: { STR: number; STA: number; AGI: number; DEX: number; WIS: number; INT: number }
  /** Base melee, from the Pet Guide's tables; null where the guide has no figures yet. */
  melee: PetMelee | null
  /** Figures the wiki marks as unconfirmed ("?"), by name. */
  unsure: string[]
}

const classId = (name: string): string | null => {
  const n = name.replace(/[\s_]/g, '').toLowerCase()
  return CLASSES.find(([, label]) => label.toLowerCase() === n)?.[0] ?? null
}

const num = (s: string | undefined): number | null => {
  const m = /-?\d+(?:\.\d+)?/.exec(s ?? '')
  return m ? Number(m[0]) : null
}

/** A "<spell> Summon" page: its classes, level, hit points and base stats. */
export function parseSummonPage(spell: string, wikitext: string): Omit<PetProfile, 'melee'> & { dualWield: number | null } {
  const field = (label: string) => new RegExp(`<li>\\s*${label}:\\s*([^<\\n]*)`, 'i').exec(wikitext)?.[1].trim() ?? ''
  const unsure: string[] = []
  const val = (label: string, key = label) => {
    const raw = field(label)
    if (raw.includes('?')) unsure.push(key)
    return num(raw)
  }
  const classes = [...field('Pet Classes').matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => classId(m[1])).filter((c): c is string => !!c)
  const dw = val('Dual Wield', 'dual wield')
  return {
    spell,
    classes: classes.length ? classes : ['war'],
    level: val('Pet Level', 'level') ?? 0,
    hp: val('Hit Points', 'hit points') ?? 0,
    stats: {
      STR: val('Strength') ?? 75,
      STA: val('Stamina') ?? 75,
      AGI: val('Agility') ?? 75,
      DEX: val('Dexterity') ?? 75,
      WIS: val('Wisdom') ?? 75,
      INT: val('Intelligence') ?? 75
    },
    dualWield: dw === null ? null : dw / 100,
    unsure
  }
}

/** Base melee per summoning spell, from the Pet Guide's per-class tables. */
export function parsePetGuide(wikitext: string): Map<string, PetMelee & { unsure: boolean }> {
  const out = new Map<string, PetMelee & { unsure: boolean }>()
  for (const t of parseWikiTables(wikitext)) {
    const h = t.headers.map((x) => x.toLowerCase())
    const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x.includes(n)))
    const ratio = col('melee ratio')
    const dmg = h.findIndex((x) => x === 'damage')
    const delay = h.findIndex((x) => x === 'delay')
    const bonus = col('bonus damage')
    const dw = col('dual wield')
    if (bonus < 0 || (ratio < 0 && (dmg < 0 || delay < 0))) continue
    for (const row of t.rows) {
      const link = row.map((c) => /\[\[([^\]|]+?) Summon(?:\|[^\]]*)?\]\]/.exec(c)?.[1]).find(Boolean)
      if (!link) continue
      const r = ratio >= 0 ? /(\d+)\s*\/\s*(\d+)/.exec(row[ratio] ?? '') : null
      const damage = r ? Number(r[1]) : num(row[dmg])
      const del = r ? Number(r[2]) : num(row[delay])
      if (!damage || !del) continue
      const cells = [ratio >= 0 ? row[ratio] : `${row[dmg]} ${row[delay]}`, row[bonus], dw >= 0 ? row[dw] : '']
      out.set(link.toLowerCase(), {
        damage,
        delay: del,
        bonus: num(row[bonus]) ?? 0,
        dualWield: (num(dw >= 0 ? row[dw] : '') ?? 0) / 100,
        unsure: cells.some((c) => /\?|X/.test(c ?? ''))
      })
    }
  }
  return out
}

// ---- melee ----

/**
 * The damage bonus a warrior-class attacker gets with a weapon: EQEmu's GetWeaponDamageBonus. Pets
 * are warriors. Off-hand weapons get none worth counting below level 40.
 */
export function weaponDamageBonus(level: number, delay: number, twoHanded: boolean, offhand = false): number {
  if (level < 28) return 0
  const t = (n: number) => Math.trunc(n)
  if (!twoHanded) {
    if (offhand) return level < 40 ? 0 : Math.max(0, 1 + t(t((level - 40) / 3) * (delay / 30)))
    const lvl = t((level - 28) / 3)
    if (delay <= 39) return 1 + lvl
    const extra = t((delay - 40) / 3)
    return (delay < 43 ? 2 : delay < 45 ? 3 : 4) + lvl + extra
  }
  let bonus = 1 + t((level - 28) / 3)
  if (delay <= 27) return bonus + 1
  if (level > 29) {
    let levelBonus = t((level - 30) / 5) + 1
    if (level > 50) {
      levelBonus++
      let l2 = level - 50
      if (level > 67) l2 += 5
      else if (level > 59) l2 += 4
      else if (level > 58) l2 += 3
      else if (level > 56) l2 += 2
      else if (level > 54) l2++
      levelBonus += t((l2 * delay) / 40)
    }
    bonus += levelBonus
  }
  if (delay >= 40) {
    let delayBonus = t((delay - 40) / 3) + 1
    if (delay >= 45) delayBonus += 2
    else if (delay >= 43) delayBonus++
    bonus += delayBonus
  }
  return bonus
}

export interface PetWeapon {
  damage: number
  delay: number
  twoHanded: boolean
}

/** What one hand swings with a weapon in it (or none), by the Pet Guide's rules. */
export function petSwing(base: PetMelee, level: number, w: PetWeapon | null, offhand = false): { damage: number; delay: number; bonus: number } {
  const own = { damage: base.damage, delay: base.delay, bonus: offhand ? 0 : base.bonus }
  if (!w || w.damage <= 0 || w.delay <= 0) return own
  if (w.damage / w.delay > base.damage / base.delay) return { damage: w.damage, delay: w.delay, bonus: weaponDamageBonus(level, w.delay, w.twoHanded, offhand) }
  if (w.damage > base.damage) return { ...own, damage: w.damage }
  return own
}

/**
 * Melee damage per second of delay, main hand plus off hand, in arbitrary units. A hit averages the
 * bonus plus 1.5× damage: the wiki's pet pages give a max hit of bonus + 2× damage. A two-hander
 * leaves no off hand.
 */
export function petMelee(base: PetMelee, level: number, primary: PetWeapon | null, secondary: PetWeapon | null): number {
  const rate = (s: { damage: number; delay: number; bonus: number }) => (s.bonus + 1.5 * s.damage) / s.delay
  const main = rate(petSwing(base, level, primary))
  if (primary?.twoHanded) return main
  return main + base.dualWield * rate(petSwing(base, level, secondary, true))
}

// ---- weights ----

/**
 * What a pet values, per unit of outcome, as the player roles do; `ratio` here is per 1% more melee
 * damage. A pet has no use for endurance, and mana only for its few spells.
 */
export const PET_ROLE_PRESETS: Record<string, RoleWeights> = {
  Damage: { hp: 0.3, mana: 0, end: 0, ac: 2, avoidance: 0.3, offense: 2, attack: 1, procs: 0.8, haste: 15, resists: 0.3, hpRegen: 5, manaRegen: 0, endRegen: 0, ratio: 15 },
  Balanced: { hp: 0.6, mana: 0, end: 0, ac: 5, avoidance: 0.8, offense: 1, attack: 0.5, procs: 0.4, haste: 10, resists: 0.6, hpRegen: 12, manaRegen: 0, endRegen: 0, ratio: 10 },
  Tank: { hp: 1, mana: 0, end: 0, ac: 8, avoidance: 1.5, offense: 0.5, attack: 0.3, procs: 0.2, haste: 6, resists: 1.2, hpRegen: 25, manaRegen: 0, endRegen: 0, ratio: 6 }
}

/**
 * What a point of each stat buys the pet: the player formulas with the pet's own classes and
 * stats, except agility, which the Pet Guide puts at +5 evasion for +10 AGI.
 */
export function petConversions(pet: PetProfile, factors: Record<string, ClassFactors>): Conversions {
  const c = conversions({ classes: pet.classes, factors, stats: pet.stats, hpBonusPct: 0, evasionPct: 0 })
  return { ...c, avoidancePerAgi: 0.5, notes: [...c.notes, 'AGI: +5 evasion per 10, from the Pet Guide'] }
}

// ---- the optimizer ----

export type PetSource = PieceSource | 'pet'

export interface PetPiece {
  item: InvItem
  from: PetSource
  key: string
  r: Restrictions
  stats: ItemStats
  lore: boolean
  /** Flagged NO PET on its page: a pet will not take it. */
  noPet: boolean
}

export interface PetChoice {
  piece: PetPiece
  slot: string
}

export interface PetPlanOptions {
  pieces: PetPiece[]
  /** What the pet wears now; kept apart so the plan can be compared with it. */
  current: PetChoice[]
  capacity: number
  /** The owner's classes and the pet's together, at the pet's level. */
  wearer: Wearer
  weights: Weights
  melee: PetMelee | null
  level: number
}

export interface PetPlan {
  chosen: PetChoice[]
  total: number
  current: number
  /** Each part of the totals, to show where the gain comes from. */
  parts: { stats: number; haste: number; melee: number }
  currentParts: { stats: number; haste: number; melee: number }
}

const weaponOf = (p: PetPiece | undefined): PetWeapon | null =>
  p?.stats.damage && p.stats.delay ? { damage: p.stats.damage, delay: p.stats.delay, twoHanded: isTwoHanded(p.r) } : null

/** Where a piece could go on this pet. */
export function petSlotsFor(p: PetPiece, wearer: Wearer): string[] {
  if (p.noPet) return []
  return Object.keys(PET_SLOT_CAPACITY).filter((s) => canWear(p.r, wearer, s) && !(s === 'Secondary' && isTwoHanded(p.r)))
}

/** A plan's worth: each item's stats (haste aside), the best haste once, and the melee its weapons give. */
export function petPlanValue(
  chosen: PetChoice[],
  o: Pick<PetPlanOptions, 'weights' | 'melee' | 'level'>,
  statScore: (p: PetPiece) => number = statScorer(o.weights)
): { stats: number; haste: number; melee: number } {
  const stats = chosen.reduce((s, c) => s + statScore(c.piece), 0)
  const haste = o.weights.haste * Math.max(0, ...chosen.map((c) => c.piece.stats.haste))
  let melee = 0
  if (o.melee) {
    const pri = chosen.find((c) => c.slot === 'Primary')?.piece
    const sec = chosen.find((c) => c.slot === 'Secondary')?.piece
    const bare = petMelee(o.melee, o.level, null, null)
    melee = o.weights.ratio * 100 * (petMelee(o.melee, o.level, weaponOf(pri), weaponOf(sec)) / bare - 1)
  }
  return { stats, haste, melee }
}

const total = (v: { stats: number; haste: number; melee: number }) => v.stats + v.haste + v.melee

/** Each piece's stats by the weights, haste and weapon aside (counted over the whole set); worked out once a piece. */
export function statScorer(weights: Weights): (p: PetPiece) => number {
  const w = { ...weights, haste: 0, ratio: 0 }
  const memo = new Map<PetPiece, number>()
  return (p) => {
    let v = memo.get(p)
    if (v === undefined) memo.set(p, (v = score(p.stats, w)))
    return v
  }
}

function fits(chosen: PetChoice[], c: PetChoice, capacity: number): boolean {
  if (chosen.length >= capacity) return false
  if (chosen.some((x) => x.piece === c.piece)) return false
  if (c.piece.lore && chosen.some((x) => x.piece.key === c.piece.key)) return false
  if (chosen.filter((x) => x.slot === c.slot).length >= (PET_SLOT_CAPACITY[c.slot] ?? 0)) return false
  const pri = c.slot === 'Primary' ? c.piece : chosen.find((x) => x.slot === 'Primary')?.piece
  const hasSec = c.slot === 'Secondary' || chosen.some((x) => x.slot === 'Secondary')
  return !(pri && isTwoHanded(pri.r) && hasSec)
}

/**
 * The best set of at most `capacity` items, one per slot: a greedy fill, then single swaps, adds and
 * removals until none helps. Started from what the pet wears and from nothing; the better one wins.
 */
export function optimizePetGear(o: PetPlanOptions): PetPlan {
  const options: PetChoice[] = []
  for (const p of o.pieces) for (const slot of petSlotsFor(p, o.wearer)) options.push({ piece: p, slot })
  const scorer = statScorer(o.weights)
  const value = (sel: PetChoice[]) => total(petPlanValue(sel, o, scorer))

  const improve = (start: PetChoice[]): PetChoice[] => {
    let sel = [...start]
    let best = value(sel)
    for (let pass = 0; pass < 60; pass++) {
      let move: PetChoice[] | null = null
      let moveValue = best
      for (const opt of options) {
        // Add it.
        if (fits(sel, opt, o.capacity)) {
          const next = [...sel, opt]
          const v = value(next)
          if (v > moveValue + 1e-9) {
            move = next
            moveValue = v
          }
        }
        // Or put it in place of each one chosen.
        for (let i = 0; i < sel.length; i++) {
          const rest = sel.filter((_, k) => k !== i)
          if (!fits(rest, opt, o.capacity)) continue
          const next = [...rest, opt]
          const v = value(next)
          if (v > moveValue + 1e-9) {
            move = next
            moveValue = v
          }
        }
      }
      // Or drop one that costs more than it gives (an off-hand under a two-hander's worth, say).
      for (let i = 0; i < sel.length; i++) {
        const next = sel.filter((_, k) => k !== i)
        const v = value(next)
        if (v > moveValue + 1e-9) {
          move = next
          moveValue = v
        }
      }
      if (!move) break
      sel = move
      best = moveValue
    }
    return sel
  }

  // What the pet wears now, as far as the rules allow (the export may be stale, a slot doubled).
  const start: PetChoice[] = []
  for (const c of o.current) if (fits(start, c, o.capacity)) start.push(c)
  const a = improve(start)
  const b = improve([])
  const chosen = value(b) > value(a) + 1e-9 ? b : a
  const parts = petPlanValue(chosen, o, scorer)
  const currentParts = petPlanValue(o.current, o, scorer)
  return { chosen: sortChoices(chosen), total: total(parts), current: total(currentParts), parts, currentParts }
}

const ORDER = Object.keys(PET_SLOT_CAPACITY)
/** In the order to hand them over: the main-hand weapon first, as the Pet Guide says, then head to feet. */
export function sortChoices(list: PetChoice[]): PetChoice[] {
  const rank = (s: string) => (s === 'Primary' ? -2 : s === 'Secondary' ? -1 : ORDER.indexOf(s))
  return [...list].sort((a, b) => rank(a.slot) - rank(b.slot) || a.piece.item.name.localeCompare(b.piece.item.name))
}

/** The same item, whatever its merge level: for telling what the plan keeps from what it changes. */
export const sameItem = (a: PetPiece, b: PetPiece) => a === b || (a.from === 'pet' && b.from === 'pet' && itemKey(a.item.name) === itemKey(b.item.name))

// ---- which pet: the summoning spells ----

/** A pet summoning spell the character's classes can cast, for choosing one by hand. */
export interface PetSpellOption {
  spell: string
  /** The lowest level any of the classes gets it. */
  level: number
  classes: string[]
}

/** The unranked name of a pet summoning spell, or null when the spell summons nothing. */
export function petSummonName(book: SpellBook, rankedName: string): string | null {
  const r = book.resolve(rankedName)
  if (!r || !summonsPet(r.spell)) return null
  return r.rank ? rankedName.replace(/\s+[IVXL]+$/, '') : r.spell.name
}

const CLASS_IDS: Record<string, string> = {
  war: 'Warrior', clr: 'Cleric', pal: 'Paladin', rng: 'Ranger', shd: 'Shadow Knight', dru: 'Druid', mnk: 'Monk', brd: 'Bard',
  rog: 'Rogue', shm: 'Shaman', nec: 'Necromancer', wiz: 'Wizard', mag: 'Magician', enc: 'Enchanter', bst: 'Beastlord', ber: 'Berserker'
}

/** Every pet these classes can summon by this level, lowest first. Class ids are the tracker's. */
export function petSpells(book: SpellBook, classes: string[], level: number): PetSpellOption[] {
  // The spell file's class columns run in the game's class order, which CLASS_NAMES follows.
  const idx = (c: string) => CLASS_NAMES.indexOf(CLASS_IDS[c] as (typeof CLASS_NAMES)[number])
  const out = new Map<string, PetSpellOption>()
  for (const s of book.all()) {
    if (!summonsPet(s)) continue
    const mine = classes.filter((c) => {
      const l = s.classLevels[idx(c)]
      return l > 0 && l < 254 && l <= level
    })
    if (!mine.length) continue
    const name = s.name.replace(/\s+[IVXL]+$/, '')
    const lvl = Math.min(...mine.map((c) => s.classLevels[idx(c)]))
    const had = out.get(name)
    if (!had || lvl < had.level) out.set(name, { spell: name, level: lvl, classes: mine })
  }
  return [...out.values()].sort((a, b) => a.level - b.level || a.spell.localeCompare(b.spell))
}

