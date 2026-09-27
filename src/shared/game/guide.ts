// The EQL spell upgrade (mote) guide's per-rank table, in one place: what each rank of a spell gives,
// by the spell's category. Pure data, so settings defaults, core and pages share it.

/**
 * Spell categories, matching the rows of the guide's per-tier bonus table. The category decides what
 * a ranked spell gains, its duration included.
 */
export type SpellCategory = 'nuke' | 'dot' | 'heal' | 'hot' | 'debuff' | 'charm' | 'mez' | 'buff'

export const CATEGORY_LABELS: Record<SpellCategory, string> = {
  nuke: 'Nuke / Lifetap',
  dot: 'DoT',
  heal: 'Heal',
  hot: 'Heal over Time',
  debuff: 'Debuff',
  charm: 'Charm',
  mez: 'Mez',
  buff: 'Buff'
}

/** What one rank gives a spell of each category, in percent. */
export interface RankBonus {
  /** Percent less cast time. */
  cast: number
  /** Percent less mana. */
  mana: number
  /** Percent more damage or healing; per tick for DoTs and heals over time. 0 when nothing scales. */
  power: number
  /** What `power` is, for showing. */
  powerNote: string
  /** The highest level the spell works on rises by one (charm and mez). */
  level?: boolean
  /** The guide's own caveat on this row. */
  caveat?: string
}

export const RANK_BONUS: Record<SpellCategory, RankBonus> = {
  nuke: { cast: 2, mana: 2, power: 6, powerNote: 'damage' },
  dot: { cast: 4, mana: 2, power: 3, powerNote: 'per tick', caveat: 'the per-tick gain is unconfirmed; the direct hit of a hybrid gets +6%' },
  heal: { cast: 4, mana: 2, power: 3, powerNote: 'healing', caveat: 'from a single report (65 → 79 at rank VII)' },
  hot: { cast: 4, mana: 2, power: 3, powerNote: 'per tick', caveat: 'per-tick gain from the community table only' },
  debuff: { cast: 4, mana: 4, power: 0, powerNote: '', caveat: 'the effect itself does not scale' },
  charm: { cast: 4, mana: 4, power: 0, powerNote: '', level: true },
  mez: { cast: 4, mana: 4, power: 0, powerNote: '', level: true },
  buff: { cast: 4, mana: 4, power: 0, powerNote: '', caveat: "the buff's stats do not grow (damage shields confirmed not to)" }
}

/**
 * Duration bonus per tier, in percent. A setting (Spell Timers › per-tier bonus) starts from these.
 * Heal over time is the exception to the guide: it marks its 5% uncertain, and Slugs Healing V fits
 * only 6–8% (Spell window 0:48 with the ring off, 9 ticks in the log with it on), so it is set to 7%.
 */
export const DEFAULT_TIER_DURATION_PCT: Record<SpellCategory, number> = {
  nuke: 0, dot: 5, heal: 0, hot: 7, debuff: 10, charm: 10, mez: 10, buff: 10
}

/** The same for every category, per rank. */
export const UNIVERSAL = { recovery: 2, reuse: 2, resist: 15 }

/**
 * Transport and utility spells are not in the guide's table. They get the cast and mana cuts every
 * non-nuke category shares and nothing else: there is no damage, healing or duration to grow.
 */
export const UTILITY_BONUS: RankBonus = {
  cast: 4,
  mana: 2,
  power: 0,
  powerNote: '',
  caveat: 'not in the guide; the cast and mana cuts of other spells assumed'
}
