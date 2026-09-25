import type { Spell } from './spells'
import { CATEGORY_LABELS, CLASS_NAMES, type CharacterSettings, type DurationBreakdown, type SpellCategory } from '../shared/types'

export const TICK_MS = 6000

/**
 * The client's buff duration formulas, in ticks, as EQEmu reproduces them. `cap` is the spell's
 * duration field: when non-zero it caps the formula. -1 means permanent.
 */
export function formulaTicks(level: number, formula: number, cap: number): number {
  let t: number
  switch (formula) {
    case 0: return 0
    case 1: t = level > 3 ? Math.floor(level / 2) : 1; break
    case 2: t = level > 3 ? Math.floor(level / 2) + 5 : 6; break
    case 3: t = 30 * level; break
    case 4: t = 50; break
    case 5: t = 2; break
    case 6: t = Math.floor(level / 2) + 2; break
    case 7: t = level; break
    case 8: t = level + 10; break
    case 9: t = 2 * level + 10; break
    case 10: t = 3 * level + 10; break
    case 11: t = 30 * (level + 3); break
    case 12: t = level > 7 ? Math.floor(level / 4) : 1; break
    case 13: t = 4 * level + 10; break
    case 14: t = 5 * (level + 2); break
    case 15: t = 10 * (level + 10); break
    case 50:
    case 51: return -1
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
 *   ticks = round(formula ticks × (1 + tier% × rank) × (1 + focus%))
 *
 * - The rank numeral is the tier count: an unranked spell has none, rank X has ten. Envenomed
 *   Bolt X's window reads 0:36 (0:54): 6 ticks × 1.5 = 9.
 * - Rounded to the nearest tick: Odium X 5 × 1.5 = 7.5 → 8 (0:48); Plague X 13 × 1.5 = 19.5 → 20 (2:00).
 * - Tier bonus and focus multiply: Spirit of the Puma X 10 × 2.0 × 1.605 = 32.1 → 32 (3:12), the focus
 *   being Spell Casting Reinforcement's 50% plus Extended Enhancement II's 15% decayed to 10.5% (see focus.ts).
 * - That is the Spell window's bracketed figure. The effect then runs into the partial tick it
 *   landed in, wearing off on its target's tick: between ticks × 6 and (ticks + 1) × 6 seconds
 *   after landing.
 */
export function computeDuration(input: DurationInput): DurationBreakdown {
  const { spell, rank, level, tierPct, focusPct, focusSteps, overrideSec } = input
  if (overrideSec && overrideSec > 0) {
    const ticks = Math.ceil(overrideSec / 6)
    return {
      ticks,
      wholeTicks: Math.max(0, ticks - 1),
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
    return { ticks: -1, wholeTicks: -1, permanent: true, seconds: Infinity, earliestSec: Infinity, latestSec: Infinity, spellWindowSec: Infinity, baseSec: Infinity, steps: ['Permanent until removed'] }
  }
  if (base === 0) {
    return { ticks: 0, wholeTicks: 0, permanent: false, seconds: 0, earliestSec: 0, latestSec: 0, spellWindowSec: 0, baseSec: 0, steps: ['Instant: no duration'] }
  }
  steps.push(`Formula ${spell.formula} at level ${level}${spell.cap ? `, capped at ${spell.cap}` : ''}: ${base} ticks (${clock(base * 6)})`)
  let ticks = base
  const tiers = Math.max(0, rank)
  const pct = tierPct[spell.category] ?? 0
  if (tiers > 0 && pct) {
    ticks *= 1 + (pct * tiers) / 100
    steps.push(`Rank ${rank}: ${tiers} tier${tiers === 1 ? '' : 's'} × ${pct}% (${CATEGORY_LABELS[spell.category]}) = +${pct * tiers}% → ${round2(ticks)}`)
  }
  steps.push(...(focusSteps ?? []))
  if (focusPct) {
    ticks *= 1 + focusPct / 100
    steps.push(`Focus ${focusPct > 0 ? '+' : ''}${round2(focusPct)}% in total → ${round2(ticks)}`)
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

/** Ticks after the formula and rank bonus, before focus and rounding. */
export function tieredTicks(spell: Spell, rank: number, level: number, tierPct: Record<SpellCategory, number>): number {
  const base = formulaTicks(level, spell.formula, spell.cap)
  if (base <= 0) return base
  return base * (1 + ((tierPct[spell.category] ?? 0) * Math.max(0, rank)) / 100)
}

/**
 * The focus range, in percent, that makes the model predict a wear-off at `observedSec` after
 * landing, or null when no focus can. Inverts round(tiered × (1 + focus)) = whole ticks.
 */
export function focusForObserved(tiered: number, observedSec: number): [number, number] | null {
  if (tiered <= 0) return null
  const wholeTicks = Math.floor(observedSec / 6) // ticks before the partial one
  if (wholeTicks < 1) return null
  return [Math.round(((wholeTicks - 0.5) / tiered - 1) * 100), Math.round(((wholeTicks + 0.5) / tiered - 1) * 100)]
}

/** m:ss, the way the Spell window shows durations. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  const ss = String(Math.round(sec % 60)).padStart(2, '0')
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Rounded to two decimal places, for the breakdown's figures. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function isBeneficialCategory(c: SpellCategory): boolean {
  return c === 'buff' || c === 'hot' || c === 'heal'
}
