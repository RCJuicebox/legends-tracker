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
  dot: { cast: 4, mana: 2, power: 3, powerNote: 'per tick', caveat: 'the direct hit of a hybrid gets +6%' },
  heal: { cast: 4, mana: 2, power: 3, powerNote: 'healing' },
  hot: { cast: 4, mana: 2, power: 3, powerNote: 'per tick' },
  debuff: { cast: 4, mana: 4, power: 0, powerNote: '', caveat: 'stats, resists and AC taken +2%; slows do not grow' },
  charm: { cast: 4, mana: 4, power: 0, powerNote: '', level: true },
  mez: { cast: 4, mana: 4, power: 0, powerNote: '', level: true },
  buff: {
    cast: 4,
    mana: 4,
    power: 0,
    powerNote: '',
    caveat: 'by effect: max HP +10%, attack and healing +3%, haste +2.5%, stats, resists and AC +2%, a proc a rank of its own every two; movement and endurance regen do not grow'
  }
}

/**
 * What a rank adds to a buff's or debuff's effects, in percent of the base, linear in rank. Not the
 * guide's (it said they do not grow): read off spell windows on 2026-10-28. Stats, resists and attack
 * round to the nearest point; healing and damage drop the fraction. Slows (Togor's Insects X still 60%),
 * movement (Spirit of Wolf IV 55), endurance regen (Chloroplast VI 10) and counters do not grow.
 * The guide's own rows check out the same way: Superior Healing V 600 → 689, Slugs Healing V 200 → 229
 * a tick, Envenomed Bolt X 345 → 448 a tick and 41 → 65 on the hit.
 */
export const EFFECT_RANK_PCT = {
  /** Max HP: Harnessing of Spirit 251 → 276 → 301. */
  maxHp: 10,
  /** HP regen and heals on a buff: Chloroplast VI 16 → 18, Harnessing II's heal 251 → 266. */
  healing: 3,
  /** Attack ("Offense"): Dark Temptation V and VI 25 → 29, Spirit of Bih`Li IV 15 → 17, Grim Aura IV 10 → 11. */
  attack: 3,
  /**
   * A proc's damage: its own spell goes up a rank every two (Vampiric Embrace V–X fire Vampiric Embrace
   * II–V), and that spell's lifetap 6% a rank (62 → 69, 73, 76, 80), so 3% a rank on average.
   */
  procDamage: 3,
  /** Haste: Alacrity VI 40% → 46%, a single window. */
  haste: 2.5,
  /** STR to CHA, resists and AC, given or taken: Rage VI 52 → 58, Malosi VIII 60 → 70, Incapacitate III AC 20 → 21. */
  stats: 2,
  resists: 2,
  AC: 2
} as const

/**
 * Duration bonus per tier, in percent. A setting (Spell Timers › per-tier bonus) starts from these.
 * Heal over time is the exception to the guide: it marks its 5% uncertain, and Slugs Healing V fits
 * only 6–8% (Spell window 0:48 with the ring off, 9 ticks in the log with it on), so it is set to 7%.
 */
export const DEFAULT_TIER_DURATION_PCT: Record<SpellCategory, number> = {
  nuke: 0,
  dot: 5,
  heal: 0,
  hot: 7,
  debuff: 10,
  charm: 10,
  mez: 10,
  buff: 10
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
