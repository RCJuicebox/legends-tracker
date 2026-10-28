// Which spells to put motes into: what one more rank of each spell you cast is worth, against the
// xp it costs, so the best value per upgrade comes first.
//
// The spell side of motes, as the community's EQL spell upgrade (mote) guide has it and play bears
// out:
//   - A spell at rank N needs 2^N xp to reach rank N+1 (rank 4 takes 15 xp in all, rank 5 31).
//   - Every mote counts its xp on any spell, whatever the spell's rank: Infinitesimal 1, Minor 1,
//     Lesser 2, Potential 4, Major 5 … Infinite 10. There is no tier limit as on items, so motes
//     that no item of yours can use any more (an Infinitesimal only works on a +0 item) are worth
//     their full xp here. Spending the lowest ranks first costs the least combine value.
//   - What a rank gives depends on the spell's category (the guide's table, RANK_BONUS below), plus
//     the same for every spell: recovery and reuse −2%, resist modifier −15 on resistable spells.
//     Buffs and debuffs also grow their stats, resists and max HP (valueGainOf), measured in game.
//     Duration bonuses are the ones the spell timers use (the tracking settings' per-rank table).
//   - Instant and permanent spells get no duration bonus; a zero-mana spell nothing on the mana line.
//
// A rank's worth to you is how often you cast the spell times what the rank gives each cast, in
// percent points weighed the way you choose: a point is one cast made one percent better.

import { MOTE_RANKS, moteWorth, type MoteCounts } from './motes'
import { round } from './format'
import { countsToArray } from './moteCalc'
import { casterLevel, formulaTicks } from './durations'
import { isItemEffect } from './focus'
import { isSong, summonsPet } from './spellKinds'
import { RESIST_SPA, SPA, STAT_SPA } from '../shared/game/spa'
import type { SpellBook } from './spells'
import { CLASS_NAMES, type CharacterSettings, type SpellCategory } from '../shared/types'
import { MAX_HP_RANK_PCT, RANK_BONUS, STAT_RANK_PCT, UNIVERSAL, UTILITY_BONUS, type RankBonus } from '../shared/game/guide'

const MAX_RANK = 10

export { RANK_BONUS, UNIVERSAL, UTILITY_BONUS } from '../shared/game/guide'

/** Gate, teleport, succor, translocate, teleport (v2): a spell that moves you. */
const TRANSPORT_SPAS = [26, 83, 88, 104, 145]
/** Bind affinity: misc, with the cures and summons. */
/** Effects that heal: hit points now, or over time. */
const HEAL_SPAS = [0, 79, 100]

/** Percent a pet gains per rank: +1 pet level. */
const PET_LEVELS_PER_RANK = 1

/** How much each kind of gain counts, in points per percent (a level counts as `level` percent). */
export interface SpellWeights {
  power: number
  duration: number
  mana: number
  cast: number
  reuse: number
  level: number
}

export const DEFAULT_SPELL_WEIGHTS: SpellWeights = { power: 1, duration: 1, mana: 0.5, cast: 0.5, reuse: 0.25, level: 5 }

export const WEIGHT_LABELS: Record<keyof SpellWeights, string> = {
  power: 'Damage, healing & stats',
  duration: 'Duration',
  mana: 'Mana',
  cast: 'Cast time',
  reuse: 'Recovery & reuse',
  level: 'A level'
}

/** The guide's sections, in its order, with the app's categories each takes. Pets are the guide's "other scaling". */
export const SECTIONS = [
  { key: 'nuke', label: 'Nuke / Lifetap', cats: ['nuke'] },
  { key: 'dot', label: 'DoT', cats: ['dot'] },
  { key: 'heal', label: 'Heal', cats: ['heal'] },
  { key: 'hot', label: 'Heal over Time', cats: ['hot'] },
  { key: 'debuff', label: 'Debuff', cats: ['debuff'] },
  { key: 'cc', label: 'Charm / Mez', cats: ['charm', 'mez'] },
  { key: 'buff', label: 'Buff', cats: ['buff'] },
  { key: 'pet', label: 'Pet summons', cats: [] },
  { key: 'transport', label: 'Transport', cats: [] },
  { key: 'utility', label: 'Misc', cats: [] }
] as const

export type SectionKey = (typeof SECTIONS)[number]['key']

/**
 * The guide's section a spell belongs in. The spell file marks a gate or a cure beneficial with no
 * duration, the same as a heal, so those are told apart by their effects: anything that moves you is
 * transport; bind affinity and a "heal" that heals nothing (cures, summoned items, resurrection) are
 * misc (`utility`).
 */
export function sectionOf(category: SpellCategory, pet: boolean, effects: { spa: number; base: number }[] = []): SectionKey {
  if (effects.some((e) => TRANSPORT_SPAS.includes(e.spa))) return 'transport'
  if (effects.some((e) => e.spa === SPA.BIND)) return 'utility'
  if (pet) return 'pet'
  if (category === 'heal' && !effects.some((e) => HEAL_SPAS.includes(e.spa) && e.base > 0)) return 'utility'
  return SECTIONS.find((s) => (s.cats as readonly string[]).includes(category))?.key ?? 'buff'
}

/** Max HP, an effect of buffs like Harnessing of Spirit. */
const MAX_HP_SPA = 69

/**
 * What a rank adds to a buff's or debuff's values, by the effects measured (STAT_RANK_PCT): max HP 10%,
 * stats and resists 2%, anything else nothing. A spell with max HP and stats counts the max HP rate.
 * The blank CHA 0 effects spells pad their slots with are not a stat.
 */
export function valueGainOf(category: SpellCategory, effects: { spa: number; base: number }[]): { pct: number; note: string } {
  if (category !== 'buff' && category !== 'debuff') return { pct: 0, note: '' }
  const stats = effects.some((e) => e.base !== 0 && (e.spa in STAT_SPA || e.spa in RESIST_SPA))
  if (effects.some((e) => e.spa === MAX_HP_SPA && e.base > 0)) return { pct: MAX_HP_RANK_PCT, note: stats ? `max HP (stats +${STAT_RANK_PCT}%)` : 'max HP' }
  return stats ? { pct: STAT_RANK_PCT, note: category === 'debuff' ? 'stats and resists taken' : 'stats and resists' } : { pct: 0, note: '' }
}

/** The per-rank table for a spell: its category's row, unless its section has none in the guide. */
function bonusFor(category: SpellCategory, section: SectionKey): RankBonus {
  return section === 'transport' || section === 'utility' ? UTILITY_BONUS : RANK_BONUS[category]
}

/** One spell you cast, as the log and the spell file describe it. */
export interface SpellCastRow {
  /** The spell's unranked name. */
  name: string
  /**
   * The rank it is at now: the highest the log has seen you cast it at, or buy with motes ("… to create
   * a new item: Drain Spirit VI", LT-756), whichever is higher.
   */
  rank: number
  /** Casts in the window, every rank counted. */
  casts: number
  category: SpellCategory
  section: SectionKey
  icon: number
  castMs: number
  recastMs: number
  mana: number
  /** The duration formula's ticks at your level: 0 instant, -1 permanent. */
  ticks: number
  song: boolean
  /** Summons a pet: each rank adds a pet level. */
  pet: boolean
  /** What a rank adds to a buff's or debuff's values (valueGainOf), in percent, and what it is. */
  valueGain: number
  valueNote: string
  /** Whether a resist modifier applies: a detrimental spell. */
  resistable: boolean
  /** Casts in the window a target resisted outright, every rank counted (LT-722). */
  resisted: number
  /** The classes that cast it, for showing. */
  classes: string
  /** The level each class gets it at, by class name, for the class filter (abilities' 254 left out). */
  classLevels: Record<string, number>
}

/** One of the character's classes and the level it is at, for the class filter. */
export interface MyClass {
  name: string
  level: number
}

/**
 * Whether one of your classes can cast the spell at its level: a spell a Necromancer gets at 39 is
 * not the Shadow Knight's until 49, so under the level cap it is theirs alone.
 */
export function castableByMine(row: Pick<SpellCastRow, 'classLevels'>, mine: MyClass[]): boolean {
  return mine.some((m) => {
    const l = row.classLevels[m.name]
    return l !== undefined && l <= m.level
  })
}

/** An ability granted outside the spell book (Harm Touch X, Life Burn I): no class has a level under 254 for it. */
export function isAbility(spell: { classLevels: number[] }): boolean {
  return !spell.classLevels.some((l) => l > 0 && l < 254)
}

/**
 * The spells behind a window of cast counts ("Envenomed Bolt X": 120), one row per spell with every
 * rank's casts summed and the highest rank seen as the rank it is at now. What is not a spell-book
 * spell is returned apart, since motes go into spells: a name the spell file does not know, a potion
 * or clicky no class casts, or an ability granted outside the spell book (Harm Touch, Life Burn:
 * class level 254).
 */
export function castRows(
  book: SpellBook,
  counts: Record<string, number>,
  character: CharacterSettings,
  resists: Record<string, number> = {},
  /** Ranked names the log saw bought with motes. */
  merged: readonly string[] = []
): { rows: SpellCastRow[]; unknown: { name: string; casts: number }[] } {
  const rows = new Map<string, SpellCastRow>()
  const unknown: { name: string; casts: number }[] = []
  for (const [name, casts] of Object.entries(counts)) {
    const r = book.resolve(name)
    if (!r || isItemEffect(r.spell) || isAbility(r.spell)) {
      unknown.push({ name, casts })
      continue
    }
    const s = r.spell
    const had = rows.get(s.name)
    if (had) {
      had.casts += casts
      had.rank = Math.max(had.rank, r.rank)
      continue
    }
    const pet = summonsPet(s)
    const value = valueGainOf(s.category, s.effects)
    rows.set(s.name, {
      name: s.name,
      rank: r.rank,
      casts,
      category: s.category,
      section: sectionOf(s.category, pet, s.effects),
      icon: s.icon,
      castMs: s.castMs,
      recastMs: s.recastMs,
      mana: s.mana,
      ticks: formulaTicks(casterLevel(s, character), s.formula, s.cap),
      song: isSong(s),
      pet,
      valueGain: value.pct,
      valueNote: value.note,
      resistable: !s.beneficial,
      resisted: 0,
      classes: s.classLevels
        .map((l, i) => (l > 0 && l < 255 ? `${CLASS_NAMES[i]} ${l === 254 ? '(ability)' : l}` : ''))
        .filter(Boolean)
        .join(', '),
      classLevels: Object.fromEntries(s.classLevels.flatMap((l, i) => (l > 0 && l < 254 ? [[CLASS_NAMES[i], l]] : [])))
    })
  }
  for (const [name, n] of Object.entries(resists)) {
    const row = rows.get(book.resolve(name)?.spell.name ?? '')
    if (row) row.resisted += n
  }
  for (const name of merged) {
    const r = book.resolve(name)
    const row = rows.get(r?.spell.name ?? '')
    if (r && row) row.rank = Math.max(row.rank, r.rank)
  }
  return { rows: [...rows.values()], unknown: unknown.sort((a, b) => b.casts - a.casts) }
}

interface Spend {
  /** Rank index into MOTE_RANKS … */
  m: number
  /** … and how many of it. */
  n: number
}

export interface SpendPlan {
  motes: Spend[]
  /** XP the motes give; `over` of it past what was needed. */
  xp: number
  over: number
  /** Their combine value, in Infinitesimal motes. */
  worth: number
  /** XP still missing when the stock cannot cover it. */
  short: number
}

/** Every mote's xp on a spell, summed. */
export function stockXp(stock: MoteCounts): number {
  return MOTE_RANKS.reduce((n, r, i) => n + (stock[r.key] ?? 0) * MOTE_RANKS[i].xp, 0)
}

/**
 * Motes to pay `need` xp with, lowest rank first: a rank's combine value doubles each step while its
 * xp grows by one or two, so the low ranks are always the cheapest xp. The last mote may give more
 * than was needed; whether the spare carries over is not known, so it is shown as `over`.
 */
export function spendOnSpell(need: number, stock: MoteCounts): SpendPlan {
  const inv = countsToArray(stock)
  const motes: Spend[] = []
  let remaining = need
  let xp = 0
  let worth = 0
  for (let m = 0; m < MOTE_RANKS.length && remaining > 0; m++) {
    const n = Math.min(inv[m], Math.ceil(remaining / MOTE_RANKS[m].xp))
    if (n <= 0) continue
    motes.push({ m, n })
    xp += n * MOTE_RANKS[m].xp
    worth += n * moteWorth(m)
    remaining -= n * MOTE_RANKS[m].xp
  }
  return { motes, xp, over: Math.max(0, -remaining), worth, short: Math.max(0, remaining) }
}

export interface GainPart {
  key: keyof SpellWeights
  /** Percent (or levels) the rank gives. */
  pct: number
  /** Points it counts for, after the weight. */
  points: number
  label: string
}

export interface SpellUpgradeOption {
  row: SpellCastRow
  section: SectionKey
  /** The rank it is at and the one the step reaches. */
  rank: number
  next: number
  /** Points one cast gains from the step, and what makes them up. */
  benefit: number
  parts: GainPart[]
  /** casts × benefit: what the step is worth over the window. */
  worth: number
  /** XP the step needs. */
  need: number
  /** Worth per xp: the number to sort by. */
  rate: number
  /** Share of every cast in the window. */
  share: number
  spend: SpendPlan
  affordable: boolean
  /** At rank X already: nothing to plan. */
  maxed: boolean
}

export interface SpellUpgradeInput {
  rows: SpellCastRow[]
  /** Duration bonus per rank by category, in percent: the spell timers' table. */
  tierPct: Record<SpellCategory, number>
  weights?: SpellWeights
  stock?: MoteCounts
}

/** What one more rank gives one cast of the spell, in weighed points, part by part. */
export function rankGain(row: SpellCastRow, tierPct: Record<SpellCategory, number>, w: SpellWeights): GainPart[] {
  const b = bonusFor(row.category, row.section)
  const parts: GainPart[] = []
  const add = (key: keyof SpellWeights, pct: number, label: string) => {
    if (pct > 0) parts.push({ key, pct, points: round(pct * w[key], 3), label })
  }
  if (b.power) add('power', b.power, `+${b.power}% ${b.powerNote}`)
  else if (row.valueGain) add('power', row.valueGain, `+${row.valueGain}% ${row.valueNote}`)
  const dur = row.ticks > 0 ? (tierPct[row.category] ?? 0) : 0
  if (dur) add('duration', dur, `+${dur}% duration`)
  if (row.mana > 0) add('mana', b.mana, `−${b.mana}% mana`)
  if (row.castMs > 0) add('cast', b.cast, `−${b.cast}% cast time`)
  add(
    'reuse',
    UNIVERSAL.recovery + (row.recastMs > 0 ? UNIVERSAL.reuse : 0),
    row.recastMs > 0 ? `−${UNIVERSAL.recovery}% recovery, −${UNIVERSAL.reuse}% reuse` : `−${UNIVERSAL.recovery}% recovery`
  )
  if (row.pet) add('level', PET_LEVELS_PER_RANK, '+1 pet level')
  else if (b.level) add('level', 1, '+1 to the highest level it works on')
  return parts
}

/** The next rank of every spell you cast, best worth per xp first. Spells at rank X are listed last, with nothing to plan. */
export function spellUpgradeOptions(o: SpellUpgradeInput): SpellUpgradeOption[] {
  const w = o.weights ?? DEFAULT_SPELL_WEIGHTS
  const stock = o.stock ?? {}
  const total = o.rows.reduce((n, r) => n + r.casts, 0)
  const out: SpellUpgradeOption[] = []
  for (const row of o.rows) {
    const maxed = row.rank >= MAX_RANK
    const rank = Math.min(row.rank, MAX_RANK)
    const parts = rankGain(row, o.tierPct, w)
    const benefit = round(
      parts.reduce((n, p) => n + p.points, 0),
      3
    )
    const worth = round(row.casts * benefit, 1)
    const need = maxed ? 0 : 2 ** rank
    const spend = maxed ? { motes: [], xp: 0, over: 0, worth: 0, short: 0 } : spendOnSpell(need, stock)
    out.push({
      row,
      section: row.section,
      rank,
      next: maxed ? rank : rank + 1,
      benefit,
      parts,
      worth,
      need,
      rate: maxed ? 0 : round(worth / need, 2),
      share: total ? row.casts / total : 0,
      spend,
      affordable: !maxed && spend.short === 0,
      maxed
    })
  }
  return out.sort((a, b) => Number(a.maxed) - Number(b.maxed) || b.rate - a.rate || b.worth - a.worth || b.row.casts - a.row.casts || a.row.name.localeCompare(b.row.name))
}
