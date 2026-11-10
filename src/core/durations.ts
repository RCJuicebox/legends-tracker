import type { Spell } from './spells'
import { clock } from './format'
import { CATEGORY_LABELS, CLASS_NAMES, type CharacterSettings, type DurationBreakdown, type SpellCategory } from '../shared/types'

export const TICK_MS = 6000

/**
 * The client's buff duration formulas, in ticks, as EQEmu reproduces them. `cap` is the spell's
 * duration field: when non-zero it caps the formula. -1 means permanent.
 */
export function formulaTicks(level: number, formula: number, cap: number): number {
  let t: number
  switch (formula) {
    case 0:
      return 0
    case 1:
      t = level > 3 ? Math.floor(level / 2) : 1
      break
    case 2:
      t = level > 3 ? Math.floor(level / 2) + 5 : 6
      break
    case 3:
      t = 30 * level
      break
    case 4:
      t = 50
      break
    case 5:
      t = 2
      break
    case 6:
      t = Math.floor(level / 2) + 2
      break
    case 7:
      t = level
      break
    case 8:
      t = level + 10
      break
    case 9:
      t = 2 * level + 10
      break
    case 10:
      t = 3 * level + 10
      break
    case 11:
      t = 30 * (level + 3)
      break
    case 12:
      t = level > 7 ? Math.floor(level / 4) : 1
      break
    case 13:
      t = 4 * level + 10
      break
    case 14:
      t = 5 * (level + 2)
      break
    case 15:
      t = 10 * (level + 10)
      break
    case 50:
    case 51:
      return -1
    default:
      if (formula < 200) return 0
      t = formula
  }
  return cap && cap < t ? cap : t
}

/** The level a spell's formula is evaluated at: the level of a class that can cast it. */
export function casterLevel(spell: Spell, character: CharacterSettings): number {
  let best = 0
  CLASS_NAMES.forEach((name, i) => {
    const lv = character.classLevels[name]
    const req = spell.classLevels[i]
    if (lv && req > 0 && req < 255 && lv >= req) best = Math.max(best, lv)
  })
  return best || character.level
}

export interface DurationInput {
  spell: Spell
  rank: number
  level: number
  tierPct: Record<SpellCategory, number>
  focusPct: number
  /** How the focus was arrived at, source by source, for the breakdown. */
  focusSteps?: string[]
  overrideSec?: number
}

/**
 * The duration model, checked against the in-game Spell window and a real EQL log (see README):
 *
 *   ticks = round(floor(formula ticks × (1 + focus%)) × (1 + tier% × rank))
 *
 * - The rank numeral is the tier count: an unranked spell has none, rank X has ten. Envenomed
 *   Bolt X's window reads 0:36 (0:54): 6 ticks × 1.5 = 9.
 * - Focus comes first and drops the fraction; the rank bonus comes last and rounds to the nearest
 *   tick. Dexterity IV (SHM 48, focus 62%): 630 × 1.62 = 1020.6 → 1020, × 1.4 = 1428 (2:22:48), where
 *   one rounding of 630 × 1.4 × 1.62 = 1428.84 would say 1429. Odium X 5 × 1.5 = 7.5 → 8 (0:48).
 * - Tier bonus and focus multiply: Spirit of the Puma X 10 × 1.605 = 16.05 → 16, × 2.0 = 32 (3:12), the focus
 *   being Spell Casting Reinforcement's 50% plus Extended Enhancement II's 15% decayed to 10.5% (see focus.ts).
 *   Puma VI's 16 × 1.6 = 25.6 → 26 is why the rank step rounds rather than drops the fraction.
 * - That is the Spell window's bracketed figure. The effect then runs into the partial tick it
 *   landed in, wearing off on its target's tick: between ticks × 6 and (ticks + 1) × 6 seconds
 *   after landing.
 */
export function computeDuration(input: DurationInput): DurationBreakdown {
  const { spell, rank, level, tierPct, focusPct, focusSteps, overrideSec } = input
  if (overrideSec && overrideSec > 0) {
    // Counted as the model counts: whole ticks plus the partial one it lands in, so a DoT's first tick
    // pins its end at the override (Odium X set to 48 s fades 48 s after its first tick, LT-515).
    const whole = Math.max(1, Math.round(overrideSec / 6))
    return {
      ticks: whole + 1,
      wholeTicks: whole,
      permanent: false,
      seconds: overrideSec,
      earliestSec: overrideSec,
      latestSec: overrideSec,
      spellWindowSec: overrideSec,
      baseSec: overrideSec,
      steps: [`Fixed duration set on this spell: ${overrideSec}s`]
    }
  }
  const base = formulaTicks(level, spell.formula, spell.cap)
  const steps: string[] = []
  if (base < 0) {
    return {
      ticks: -1,
      wholeTicks: -1,
      permanent: true,
      seconds: Infinity,
      earliestSec: Infinity,
      latestSec: Infinity,
      spellWindowSec: Infinity,
      baseSec: Infinity,
      steps: ['Permanent until removed']
    }
  }
  if (base === 0) {
    return { ticks: 0, wholeTicks: 0, permanent: false, seconds: 0, earliestSec: 0, latestSec: 0, spellWindowSec: 0, baseSec: 0, steps: ['Instant: no duration'] }
  }
  steps.push(`Formula ${spell.formula} at level ${level}${spell.cap ? `, capped at ${spell.cap}` : ''}: ${base} ticks (${clock(base * 6)})`)
  let ticks = base
  steps.push(...(focusSteps ?? []))
  if (focusPct) {
    const focused = base * (1 + focusPct / 100)
    ticks = Math.floor(focused + 1e-9)
    steps.push(`Focus ${focusPct > 0 ? '+' : ''}${round2(focusPct)}% in total → ${round2(focused)}${ticks !== focused ? `, fraction dropped: ${ticks}` : ''}`)
  }
  const tiers = Math.max(0, rank)
  const pct = tierPct[spell.category] ?? 0
  if (tiers > 0 && pct) {
    ticks *= 1 + (pct * tiers) / 100
    steps.push(`Rank ${rank}: ${tiers} tier${tiers === 1 ? '' : 's'} × ${pct}% (${CATEGORY_LABELS[spell.category]}) = +${pct * tiers}% → ${round2(ticks)}`)
  }
  const whole = Math.max(1, Math.round(ticks + 1e-9))
  if (whole !== ticks) steps.push(`Rounded: ${whole} ticks`)
  steps.push(`Spell window: ${clock(base * 6)} (${clock(whole * 6)})`)
  const total = whole + 1
  const earliest = whole * 6
  const latest = total * 6
  steps.push(`Plus the partial tick it lands in: wears off ${earliest}–${latest}s after landing`)
  return { ticks: total, wholeTicks: whole, permanent: false, seconds: earliest, earliestSec: earliest, latestSec: latest, spellWindowSec: whole * 6, baseSec: base * 6, steps }
}

/** The rank bonus as a multiplier: 1.4 for a rank IV buff at 10% a tier. */
export function tierMultiplier(spell: Spell, rank: number, tierPct: Record<SpellCategory, number>): number {
  return 1 + ((tierPct[spell.category] ?? 0) * Math.max(0, rank)) / 100
}

/**
 * The focus range, in percent, that makes the model predict a wear-off at `observedSec` after
 * landing, or null when no focus can. Inverts round(floor(base × (1 + focus)) × tier) = whole ticks.
 */
export function focusForObserved(baseTicks: number, tier: number, observedSec: number): [number, number] | null {
  if (baseTicks <= 0) return null
  const wholeTicks = Math.floor(observedSec / 6) // ticks before the partial one
  if (wholeTicks < 1) return null
  // The focused tick counts the rank step rounds to wholeTicks, then the focus that floors to them.
  const lo = Math.ceil((wholeTicks - 0.5) / tier - 1e-9)
  const hi = Math.ceil((wholeTicks + 0.5) / tier - 1e-9) - 1
  if (hi < lo) return null
  return [Math.round((lo / baseTicks - 1) * 100), Math.round(((hi + 1) / baseTicks - 1) * 100)]
}

/** Rounded to two decimal places, for the breakdown's figures. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function isBeneficialCategory(c: SpellCategory): boolean {
  return c === 'buff' || c === 'hot' || c === 'heal'
}
