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

/** A spell the character casts, and its share of their casting. */
export interface SpellUse {
  name: string
  /** The level it counts as for a focus's level cap. */
  level: number
  casts: number
  /** Its casts over all their casts: 0 to 1. */
  share: number
}

export interface FocusLine {
  key: string
  kind: FocusKind
  /** "Casting speed · beneficial". */
  label: string
  /** The names its ranks go by, without the rank: "Extended Enhancement", "Tavee's Diuturnity". */
  families: string[]
  /** How many of the spells the character casts it touches. */
  spells: number
  /** Their share of the character's casting: 0 to 1. */
  share: number
  /** Those spells, most cast first: "Envenomed Bolt (151)". */
  examples: string[]
}

export interface FocusInfo {
  name: string
  line: string
  kind: FocusKind
  pct: number
  maxLevel: number
  decayPct: number
  /** Its strength on the spells it touches, averaged by how often each is cast. */
  eff: number
  /** Its strength on each spell cast that it touches, past its level cap's fade. */
  on: Record<string, number>
}

export interface FocusReport {
  lines: FocusLine[]
  foci: Record<string, FocusInfo>
  uses: SpellUse[]
  /** 'casts': judged on the spells the log shows being cast; 'spellbook': on every class spell alike, for want of casts. */
  basis: 'casts' | 'spellbook'
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
 * Each focus's line and strength for this character, judged on the spells they cast. `uses` are
 * those spells with their share of the casting; without any, every class spell counts alike.
 * `specs` are the foci worth reporting (those on items); a line that touches none of the spells
 * cast still comes back, with `share: 0`.
 */
export function focusReport(specs: FocusSpec[], classSpells: CastSpell[], classes: string[], level: number, casts: Record<string, number> = {}): FocusReport {
  const bits = classBits(classes)
  const byName = new Map(classSpells.map((c) => [c.spell.name, c]))
  let used = Object.entries(casts)
    .filter(([name, n]) => n > 0 && byName.has(name))
    .map(([name, n]) => ({ cast: byName.get(name)!, casts: n }))
  const basis: FocusReport['basis'] = used.length ? 'casts' : 'spellbook'
  if (!used.length) used = classSpells.map((cast) => ({ cast, casts: 1 }))
  const total = used.reduce((a, u) => a + u.casts, 0) || 1
  used.sort((a, b) => b.casts - a.casts || a.cast.spell.name.localeCompare(b.cast.spell.name))
  const uses: SpellUse[] = used.map((u) => ({ name: u.cast.spell.name, level: u.cast.level, casts: u.casts, share: u.casts / total }))

  const byLine = new Map<string, FocusSpec[]>()
  for (const f of specs) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f])
  const lines: FocusLine[] = []
  const foci: Record<string, FocusInfo> = {}
  for (const [key, members] of byLine) {
    const reach = new Map(members.map((f) => [f, used.filter((u) => focusApplies(f, u.cast, Math.max(level, u.cast.level), bits))]))
    const touched = used.filter((u) => members.some((f) => reach.get(f)!.includes(u)))
    lines.push({
      key,
      kind: members[0].kind,
      label: lineLabel(members[0]),
      families: [...new Set(members.map((f) => familyName(f.name)))].sort(),
      spells: touched.length,
      share: touched.reduce((a, u) => a + u.casts, 0) / total,
      examples: touched.map((u) => (basis === 'casts' ? `${u.cast.spell.name} (${u.casts})` : `${u.cast.spell.name} (level ${u.cast.level})`))
    })
    for (const f of members) {
      const on: Record<string, number> = {}
      let weighted = 0
      let casts = 0
      for (const u of reach.get(f)!) {
        const eff = Math.round(effectivePct(f, u.cast.level) * 100) / 100
        if (eff > 0) on[u.cast.spell.name] = eff
        weighted += eff * u.casts
        casts += u.casts
      }
      foci[f.name] = { name: f.name, line: key, kind: f.kind, pct: f.pct, maxLevel: f.maxLevel, decayPct: f.decayPct, eff: casts ? Math.round((weighted / casts) * 100) / 100 : 0, on }
    }
  }
  lines.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.share - a.share || a.label.localeCompare(b.label))
  return { lines, foci, uses, basis }
}

/**
 * How much each kind of focus counts, a percent of it against a percent of casting speed. A longer
 * reach or fewer reagents rarely decides anything, so they count for a quarter.
 */
export const KIND_WORTH: Record<FocusKind, number> = {
  damage: 1, healing: 1, haste: 1, duration: 1, mana: 1, pet: 1, instrument: 1, range: 0.25, reagent: 0.25
}

/** What wearing a set of foci is worth to one character. */
export interface FocusWorth {
  /** Points for a focus that made every spell they cast 10% better. */
  points: number
  wanted: Set<string>
  foci: Record<string, FocusInfo>
  /** Each spell's share of their casting. */
  shares: Record<string, number>
}

/**
 * Spell by spell, the best focus of each kind among those worn (the game applies only the best of a
 * kind), weighted by how often the spell is cast.
 */
export function focusValue(w: FocusWorth, names: Iterable<string>): number {
  const best = new Map<string, { kind: FocusKind; spell: string; eff: number }>()
  for (const n of names) {
    const f = w.foci[n]
    if (!f || !w.wanted.has(f.line)) continue
    for (const [spell, eff] of Object.entries(f.on)) {
      const k = `${f.kind}|${spell}`
      if (eff > (best.get(k)?.eff ?? 0)) best.set(k, { kind: f.kind, spell, eff })
    }
  }
  let v = 0
  for (const b of best.values()) v += (w.shares[b.spell] ?? 0) * (b.eff / 10) * KIND_WORTH[b.kind]
  return v * w.points
}
