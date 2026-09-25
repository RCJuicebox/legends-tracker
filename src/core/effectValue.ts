// An effect's value at a caster level, from the spell file's own numbers. Kept apart from spells.ts,
// which reads files, so a page can use it.

import type { SpellEffect } from './spells'

/**
 * An effect's value at a caster level: EQEmu's CalcSpellEffectValue_formula for the level-scaled
 * formulas, capped at the effect's max. The spell file stores each effect as
 * slot|spa|base|base2|formula|max: Protection of Nature's HP is 150 by formula 103 (base + 2 × level)
 * capped at 250.
 */
export function effectValue(e: Pick<SpellEffect, 'base' | 'formula' | 'max'>, level: number): number {
  const b = e.base
  const sign = b < 0 ? -1 : 1
  const u = Math.abs(b)
  const t = Math.trunc
  let v: number
  switch (e.formula ?? 100) {
    case 100: v = u; break
    case 101: v = u + t(level / 2); break
    case 102: v = u + level; break
    case 103: v = u + level * 2; break
    case 104: v = u + level * 3; break
    case 105: v = u + level * 4; break
    case 109: v = u + t(level / 4); break
    case 110: v = u + t(level / 6); break
    case 111: v = u + 6 * Math.max(0, level - 16); break
    case 112: v = u + 8 * Math.max(0, level - 24); break
    case 113: v = u + 10 * Math.max(0, level - 34); break
    case 114: v = u + 15 * Math.max(0, level - 44); break
    case 115: v = u + (level > 15 ? 7 * (level - 15) : 0); break
    case 116: v = u + (level > 24 ? 10 * (level - 24) : 0); break
    case 117: v = u + (level > 34 ? 13 * (level - 34) : 0); break
    case 118: v = u + (level > 44 ? 20 * (level - 44) : 0); break
    case 119: v = u + t(level / 8); break
    case 121: v = u + t(level / 3); break
    default:
      // Formulas below 100 multiply the level; the rest (ticking and random ones) read as the base.
      v = e.formula !== undefined && e.formula < 100 ? u + level * e.formula : u
  }
  const cap = Math.abs(e.max ?? 0)
  if (cap && v > cap) v = cap
  return sign * v
}
