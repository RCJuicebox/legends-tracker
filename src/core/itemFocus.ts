// Focus effects on gear: what each one does, which of a character's spells it improves, and by how
// much, all read from the game's own spell file.
//
// A focus is a spell with one effect that does the work (124 spell damage, 127 casting speed, 128
// duration…) and limits that say which spells it touches: 134 a level cap with a decay past it, 137
// effects a spell must or must not carry, 138 beneficial or detrimental, 140 a minimum duration, 141
// instant only, 143 a minimum cast time, 136 target types, 139 spell ids, 411/414 bards' class and
// instrument. Foci that differ only in strength, level cap and minimum cast time are ranks of one
// line: Extended Enhancement III and Tavee's Greater Diuturnity are the same focus, both capped at 60.
// Only the best focus of a kind applies to a spell, so what counts is the best rank worn in each line.

import type { Spell } from './spells'
import { formulaTicks } from './durations'
import { CLASS_NUMBER, type ClassId } from './acModel'

export type FocusKind = 'damage' | 'healing' | 'haste' | 'duration' | 'range' | 'reagent' | 'mana' | 'pet' | 'instrument'

const KIND_OF_SPA: Record<number, FocusKind> = {
  124: 'damage', 125: 'healing', 127: 'haste', 128: 'duration', 129: 'range', 131: 'reagent', 132: 'mana', 167: 'pet', 413: 'instrument'
}

export const KIND_LABELS: Record<FocusKind, string> = {
  damage: 'Spell damage', healing: 'Healing', haste: 'Casting speed', duration: 'Spell duration', range: 'Spell range',
  reagent: 'Reagent use', mana: 'Mana cost', pet: 'Pet power', instrument: 'Instrument'
}

/** The order kinds are listed in. */
export const KIND_ORDER: FocusKind[] = ['damage', 'healing', 'haste', 'mana', 'duration', 'range', 'reagent', 'pet', 'instrument']

const LIMIT_SPAS = new Set([135, 136, 137, 138, 139, 140, 141, 142, 143, 411, 414])
/** Limits that make one rank of a line differ from another, not a different line. */
const RANK_LIMITS = new Set([142, 143])
/** Pets: magician-style summons, necromancer-style animations, beastlord warders. */
const PET_SPAS = [33, 71, 106]
const INSTRUMENTS: Record<number, string> = { 12: 'brass', 49: 'stringed', 54: 'wind', 70: 'percussion' }

export interface FocusSpec {
  name: string
  spellId: number
  kind: FocusKind
  /** Percent at full strength: the top of its range for one that rolls. */
  pct: number
  /** Spells above this level get less; 0 for no cap. */
  maxLevel: number
  /** Percent of itself lost per level over the cap; 0 means it stops working there. */
  decayPct: number
  limits: [number, number][]
  /** The line it is a rank of. */
  line: string
}

/** A focus spell's parts, or null for a spell that is no focus (a clicky, a proc). */
export function focusSpec(spell: Spell): FocusSpec | null {
  const main = spell.effects.find((e) => KIND_OF_SPA[e.spa])
  if (!main) return null
  const kind = KIND_OF_SPA[main.spa]
  const pct = [124, 125, 131, 132].includes(main.spa) ? Math.max(main.base, main.base2) : main.base
  const cap = spell.effects.find((e) => e.spa === 134)
  const limits = spell.effects.filter((e) => LIMIT_SPAS.has(e.spa)).map((e) => [e.spa, e.base] as [number, number])
  const lineLimits = limits
    .filter(([spa]) => !RANK_LIMITS.has(spa))
    .map(([spa, base]) => `${spa}:${base}`)
    .sort()
  return { name: spell.name, spellId: spell.id, kind, pct, maxLevel: cap?.base ?? 0, decayPct: cap?.base2 ?? 0, limits, line: [main.spa, ...lineLimits].join(' ') }
}

/** A spell the character can cast, at the lowest level one of their classes gets it. */
export interface CastSpell {
  spell: Spell
  level: number
}

/** Every spell the classes get by this level. */
export function castableSpells(all: Iterable<Spell>, classes: string[], level: number): CastSpell[] {
  const idx = classes.map((c) => CLASS_NUMBER[c as ClassId] - 1).filter((i) => i >= 0)
  const out: CastSpell[] = []
  for (const spell of all) {
    const levels = idx.map((i) => spell.classLevels[i]).filter((l) => l > 0 && l < 254 && l <= level)
    if (levels.length && spell.effects.length) out.push({ spell, level: Math.min(...levels) })
  }
  return out
}

/** The bit a class has in a focus's class limit (411), which the game stores shifted left by one. */
export function classBits(classes: string[]): number {
  return classes.reduce((bits, c) => bits | ((1 << (CLASS_NUMBER[c as ClassId] ?? 0)) & ~1), 0)
}

const hasDuration = (s: Spell) => s.formula !== 0 || s.cap !== 0

/** Whether a focus touches a spell at all, level cap aside. */
export function focusApplies(f: FocusSpec, cast: CastSpell, casterLevel: number, bits: number): boolean {
  const s = cast.spell
  const has = (spa: number) => s.effects.some((e) => e.spa === spa)
  const include = { effect: [] as number[], target: [] as number[], spell: [] as number[] }
  for (const [spa, base] of f.limits) {
    switch (spa) {
      case 137:
        if (base < 0) {
          if (has(-base)) return false
        } else include.effect.push(base)
        break
      case 136:
        if (base < 0) {
          if (s.targetType === -base) return false
        } else include.target.push(base)
        break
      case 139:
        if (base < 0) {
          if (s.id === -base) return false
        } else include.spell.push(base)
        break
      case 138:
        if ((base === 1) !== s.beneficial) return false
        break
      case 140: {
        const ticks = formulaTicks(casterLevel, s.formula, s.cap)
        if (ticks >= 0 && ticks < base) return false
        break
      }
      case 141:
        if ((base === 1) === hasDuration(s)) return false
        break
      case 143:
        if (s.castMs < base) return false
        break
      case 142:
        if (cast.level < base) return false
        break
      case 411:
        if (!(bits & base)) return false
        break
      case 414:
        if (s.skill !== base) return false
        break
    }
  }
  if (include.effect.length && !include.effect.some(has)) return false
  if (include.target.length && !include.target.includes(s.targetType)) return false
  if (include.spell.length && !include.spell.includes(s.id)) return false
  if (f.kind === 'pet' && !PET_SPAS.some(has)) return false
  return true
}

/** A focus's strength on a spell of this level: less past its cap, by its decay. */
export function effectivePct(f: FocusSpec, spellLevel: number): number {
  const over = f.maxLevel ? spellLevel - f.maxLevel : 0
  if (over <= 0) return f.pct
  return f.decayPct > 0 ? (f.pct * Math.max(0, 100 - f.decayPct * over)) / 100 : 0
}

export interface FocusLine {
  key: string
  kind: FocusKind
  /** "Casting speed · beneficial". */
  label: string
  /** The names its ranks go by, without the rank: "Extended Enhancement", "Tavee's Diuturnity". */
  families: string[]
  /** How many of the character's spells it improves. */
  spells: number
  /** A few of them, highest level first. */
  examples: string[]
  /** The highest level among them, where ranks are compared. */
  topLevel: number
}

export interface FocusInfo {
  name: string
  line: string
  kind: FocusKind
  pct: number
  maxLevel: number
  decayPct: number
  /** Its strength on the character's highest-level spell in its line. */
  eff: number
}

export interface FocusReport {
  lines: FocusLine[]
  foci: Record<string, FocusInfo>
}

/** "Tavee's Charm of Diuturnity" → "Tavee's Diuturnity"; "Improved Damage III" → "Improved Damage". */
export function familyName(name: string): string {
  return name
    .replace(/\s+(?:I|II|III|IV|V|VI)$/, '')
    .replace(/\s+\d+$/, '')
    .replace(/\b(?:Lesser|Greater|Superior|Major|Minor|Charm of)\s+/g, '')
    .trim()
}

function lineLabel(f: FocusSpec): string {
  const q: string[] = []
  const limit = (spa: number) => f.limits.filter(([s]) => s === spa).map(([, b]) => b)
  const type = limit(138)[0]
  if (type === 1) q.push('beneficial')
  if (type === 0) q.push('detrimental')
  if (limit(141)[0] === 1) q.push('instant')
  if (limit(140).length) q.push('over time')
  if (limit(136).includes(13)) q.push('lifetaps')
  if (limit(137).includes(33)) q.push('summoned pets')
  if (limit(137).includes(71)) q.push('undead pets')
  const skill = INSTRUMENTS[limit(414)[0]]
  if (skill) q.push(skill)
  return [KIND_LABELS[f.kind], ...q].join(' · ')
}

/**
 * Each focus's line and strength for this character, and each line's reach among their spells.
 * `specs` are the foci worth reporting (those on items); a line that touches none of the
 * character's spells still comes back, with `spells: 0`.
 */
export function focusReport(specs: FocusSpec[], spells: CastSpell[], classes: string[], level: number): FocusReport {
  const bits = classBits(classes)
  const byLine = new Map<string, FocusSpec[]>()
  for (const f of specs) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f])
  const lines: FocusLine[] = []
  const foci: Record<string, FocusInfo> = {}
  for (const [key, members] of byLine) {
    const touched = spells.filter((c) => members.some((f) => focusApplies(f, c, Math.max(level, c.level), bits)))
    touched.sort((a, b) => b.level - a.level || a.spell.name.localeCompare(b.spell.name))
    const topLevel = touched[0]?.level ?? level
    lines.push({
      key,
      kind: members[0].kind,
      label: lineLabel(members[0]),
      families: [...new Set(members.map((f) => familyName(f.name)))].sort(),
      spells: touched.length,
      examples: touched.slice(0, 6).map((c) => `${c.spell.name} (${c.level})`),
      topLevel
    })
    for (const f of members) {
      foci[f.name] = { name: f.name, line: key, kind: f.kind, pct: f.pct, maxLevel: f.maxLevel, decayPct: f.decayPct, eff: Math.round(effectivePct(f, topLevel) * 100) / 100 }
    }
  }
  lines.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.spells - a.spells || a.label.localeCompare(b.label))
  return { lines, foci }
}

/** What wearing a set of foci is worth: points for each wanted line, in proportion to its best rank. */
export interface FocusWorth {
  /** Points a wanted line is worth at the best rank there is. */
  points: number
  wanted: Set<string>
  /** Per line, the best strength there is to have. */
  best: Map<string, number>
  foci: Record<string, FocusInfo>
}

export function focusValue(w: FocusWorth, names: Iterable<string>): number {
  const top = new Map<string, number>()
  for (const n of names) {
    const f = w.foci[n]
    if (!f || !w.wanted.has(f.line)) continue
    top.set(f.line, Math.max(top.get(f.line) ?? 0, f.eff))
  }
  let v = 0
  for (const [line, eff] of top) {
    const best = w.best.get(line) || eff
    if (best > 0) v += w.points * Math.min(1, eff / best)
  }
  return v
}
