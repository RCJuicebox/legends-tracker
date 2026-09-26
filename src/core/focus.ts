import type { Spell } from './spells'
import { formulaTicks, round2 } from './durations'
import { CLASS_NAMES, type CharacterSettings, type FocusSource } from '../shared/types'

// Effect ids (SPA) a duration focus spell is built from, e.g. Extended Enhancement II:
//   128 increase spell duration 15%, 134 max level 44 losing 5%/level over, 138 beneficial only,
//   140 at least 4 ticks long, 137 (negative) excludes spells carrying that effect.
const SPA_DURATION = 128
const SPA_LIMIT_MAX_LEVEL = 134
const SPA_LIMIT_EFFECT = 137
const SPA_LIMIT_TYPE = 138
const SPA_LIMIT_MIN_TICKS = 140

export function isDurationFocus(spell: Spell): boolean {
  return spell.effects.some((e) => e.spa === SPA_DURATION && e.base > 0)
}

/** Reads a focus spell's own limits, so the app applies it exactly as the game does. */
export function focusFromSpell(spell: Spell, kind: FocusSource['kind'], from: string): FocusSource {
  const effect = (spa: number) => spell.effects.find((e) => e.spa === spa)
  const type = effect(SPA_LIMIT_TYPE)
  return {
    id: `spell-${spell.id}-${Date.now().toString(36)}`,
    name: spell.name,
    kind,
    from,
    spellId: spell.id,
    pct: effect(SPA_DURATION)?.base ?? 0,
    appliesTo: type === undefined ? 'both' : type.base === 1 ? 'beneficial' : 'detrimental',
    maxLevel: effect(SPA_LIMIT_MAX_LEVEL)?.base ?? 0,
    decayPct: effect(SPA_LIMIT_MAX_LEVEL)?.base2 ?? 0,
    minTicks: effect(SPA_LIMIT_MIN_TICKS)?.base ?? 0,
    requireSpas: spell.effects.filter((e) => e.spa === SPA_LIMIT_EFFECT && e.base > 0).map((e) => e.base),
    excludeSpas: spell.effects.filter((e) => e.spa === SPA_LIMIT_EFFECT && e.base < 0).map((e) => -e.base),
    enabled: true
  }
}

/**
 * A focus's effect limits (SPA 137): a spell must carry at least one of the included effects, when
 * there are any, and none of the excluded ones. EQEmu reads positive 137s as any-of, not all-of.
 */
export function effectLimitsAllow(spell: Spell, include: readonly number[], exclude: readonly number[]): boolean {
  const has = (spa: number) => spell.effects.some((e) => e.spa === spa)
  if (exclude.some(has)) return false
  return !include.length || include.some(has)
}

/**
 * The level a spell counts as for focus limits: its level for a class the character plays (the
 * lowest, if several), else its lowest level for any class. Puma is SHM(50) in the Spell window.
 */
export function spellLevel(spell: Spell, character: CharacterSettings): number {
  const levels = (onlyMine: boolean) =>
    // 254 marks an ability rather than a level, so it sets no level for focus limits.
    spell.classLevels.filter((l, i) => l > 0 && l < 254 && (!onlyMine || character.classLevels[CLASS_NAMES[i]] !== undefined))
  const mine = levels(true)
  const any = mine.length ? mine : levels(false)
  return any.length ? Math.min(...any) : 0
}

export interface FocusResult {
  pct: number
  steps: string[]
}

/** A potion or clicky: no class has it as a spell (every class level is 255). */
export function isItemEffect(spell: Pick<Spell, 'classLevels'>): boolean {
  return !spell.classLevels.some((l) => l > 0 && l < 255)
}

/**
 * The total duration focus a spell gets, source by source.
 *
 * A focus loses `decayPct` percent of itself per spell level over its cap: Extended Enhancement II
 * (+15%, cap 44, 5%) on the level-50 Spirit of the Puma is 15% × 70% = +10.5%. Only the best item
 * focus applies, the usual EverQuest rule for focus effects of one kind; AAs add on top. Kelwyn's
 * Spirit of the Puma X, 10 × 2.0 × (1 + 0.50 + 0.105) = 32 ticks, is the Spell window's 3:12.
 *
 * An effect no class casts (a potion, a clicky) gets no focus at all: Elixir of Clarity VI is its
 * 30 minutes with or without Spell Casting Reinforcement, as observed in game.
 */
export function focusFor(spell: Spell, character: CharacterSettings, casterLevel: number): FocusResult {
  if (isItemEffect(spell)) return { pct: 0, steps: ['Cast from an item, not a spell book: focus effects do not apply'] }
  const level = spellLevel(spell, character)
  const baseTicks = formulaTicks(casterLevel, spell.formula, spell.cap)
  const steps: string[] = []
  const applied: { source: FocusSource; pct: number }[] = []
  for (const f of character.focusSources ?? []) {
    if (!f.enabled || !f.pct) continue
    if (f.appliesTo !== 'both' && (f.appliesTo === 'beneficial') !== spell.beneficial) continue
    if (f.minTicks && baseTicks >= 0 && baseTicks < f.minTicks) {
      steps.push(`${f.name}: not applied, the spell is under ${f.minTicks} ticks`)
      continue
    }
    if (!effectLimitsAllow(spell, f.requireSpas, f.excludeSpas)) {
      steps.push(`${f.name}: does not apply to this kind of spell`)
      continue
    }
    const over = f.maxLevel > 0 ? level - f.maxLevel : 0
    if (over > 0) {
      // With no decay figure, a focus simply stops working past its cap.
      const keep = f.decayPct > 0 ? Math.max(0, 100 - f.decayPct * over) : 0
      const pct = (f.pct * keep) / 100
      steps.push(`${f.name}: ${f.pct}% × ${keep}% (level ${level} spell, ${over} over its cap of ${f.maxLevel}) = +${round2(pct)}%`)
      if (pct > 0) applied.push({ source: f, pct })
    } else {
      steps.push(`${f.name}: +${f.pct}%`)
      applied.push({ source: f, pct: f.pct })
    }
  }
  const items = applied.filter((a) => a.source.kind === 'item')
  const bestItem = items.reduce<{ source: FocusSource; pct: number } | null>((best, a) => (!best || a.pct > best.pct ? a : best), null)
  if (items.length > 1 && bestItem) steps.push(`Item focus effects do not stack: ${bestItem.source.name} is the best`)
  const aa = applied.filter((a) => a.source.kind === 'aa').reduce((n, a) => n + a.pct, 0)
  const pct = round2((bestItem?.pct ?? 0) + aa)
  return { pct, steps }
}
