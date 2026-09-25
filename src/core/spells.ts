import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { decodeCp1252 } from './logLine'
import { CLASS_NAMES, type SpellCategory, type SpellSummary } from '../shared/types'

/**
 * One record from the client's `spells_us.txt`, joined with its messages from `spells_us_str.txt`.
 *
 * Field positions were established against the EQL client (2026-09): 8 cast time (ms), 10 recast,
 * 11 duration formula, 12 duration cap in ticks, 28 beneficial flag, 36–51 class levels (255 = cannot
 * cast), 30 target type (13 lifetap), 32 casting skill (70 percussion…), 75 icon index, 172 effect
 * slots as `slot|spa|base|base2|formula|max` joined by `$`.
 */
export interface Spell {
  id: number
  name: string
  castMs: number
  recastMs: number
  formula: number
  cap: number
  beneficial: boolean
  classLevels: number[]
  /** The spell file's target type: 5 single, 6 self, 13 lifetap… */
  targetType: number
  /** The casting skill: 24 evocation, 49 stringed, 54 wind, 70 percussion… */
  skill: number
  icon: number
  effects: SpellEffect[]
  category: SpellCategory
  landSelf: string
  landOther: string
  fade: string
}

export interface SpellEffect {
  spa: number
  base: number
  base2: number
}

export interface RankedSpell {
  spell: Spell
  /** The rank numeral, which is also the number of upgrade tiers. 0 for an unranked spell. */
  rank: number
  rankedName: string
}

const F = { id: 0, name: 1, cast: 8, recast: 10, formula: 11, cap: 12, good: 28, target: 30, skill: 32, cls: 36, icon: 75, effects: 172 }

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15
}
const RANK_SUFFIX = /^(.*?) (?:Rk\. )?(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV)$/

// Effect ids (SPA) that decide a spell's category.
const SPA_HP = 0
const SPA_CHARM = 22
const SPA_MEZ = 31
const SPA_HOT = 100

export function categorize(beneficial: boolean, hasDuration: boolean, effects: SpellEffect[]): SpellCategory {
  const has = (spa: number, sign?: 1 | -1) =>
    effects.some((e) => e.spa === spa && (sign === undefined || Math.sign(e.base) === sign))
  if (beneficial) {
    if (!hasDuration) return 'heal'
    return has(SPA_HOT) || has(SPA_HP, 1) ? 'hot' : 'buff'
  }
  if (!hasDuration) return 'nuke'
  if (has(SPA_CHARM)) return 'charm'
  if (has(SPA_MEZ)) return 'mez'
  if (has(SPA_HP, -1)) return 'dot'
  return 'debuff'
}

export class SpellBook {
  private readonly byId = new Map<number, Spell>()
  private readonly byName = new Map<string, Spell>()

  static async load(installDir: string): Promise<SpellBook> {
    const [spells, strings] = await Promise.all([
      fs.readFile(join(installDir, 'spells_us.txt')),
      fs.readFile(join(installDir, 'spells_us_str.txt'))
    ])
    return SpellBook.parse(decodeCp1252(spells), decodeCp1252(strings))
  }

  static parse(spellsText: string, stringsText: string): SpellBook {
    const book = new SpellBook()
    const messages = new Map<number, string[]>()
    for (const line of stringsText.split('\n')) {
      if (!line || line[0] === '#') continue
      const f = line.replace(/\r$/, '').split('^')
      messages.set(+f[0], f)
    }
    for (const line of spellsText.split('\n')) {
      if (!line || line[0] === '#') continue
      const f = line.replace(/\r$/, '').split('^')
      if (f.length < 80) continue
      const id = +f[F.id]
      const formula = +f[F.formula]
      const cap = +f[F.cap]
      const beneficial = f[F.good] === '1'
      const effects = (f[F.effects] ?? '')
        .split('$')
        .map((e) => e.split('|'))
        .filter((e) => e.length > 2)
        .map((e) => ({ spa: +e[1], base: +e[2], base2: +(e[3] ?? 0) }))
      const msg = messages.get(id) ?? []
      const spell: Spell = {
        id,
        name: f[F.name],
        castMs: +f[F.cast],
        recastMs: +f[F.recast],
        formula,
        cap,
        beneficial,
        classLevels: f.slice(F.cls, F.cls + 16).map(Number),
        targetType: +f[F.target] || 0,
        skill: +f[F.skill] || 0,
        icon: +f[F.icon],
        effects,
        category: categorize(beneficial, formula !== 0 || cap !== 0, effects),
        // spells_us_str: id ^ caster-me ^ caster-other ^ cast-on-you ^ cast-on-other ^ spell-gone
        landSelf: msg[3] ?? '',
        landOther: msg[4] ?? '',
        fade: msg[5] ?? ''
      }
      book.byId.set(id, spell)
      const existing = book.byName.get(spell.name)
      if (!existing || (!castable(existing) && castable(spell))) book.byName.set(spell.name, spell)
    }
    return book
  }

  get size(): number {
    return this.byId.size
  }

  get(id: number): Spell | undefined {
    return this.byId.get(id)
  }

  named(name: string): Spell | undefined {
    return this.byName.get(name)
  }

  /**
   * Resolves a name as the log prints it. EQL ranks spells with a roman numeral suffix
   * (`Envenomed Bolt X`) that the spell file does not carry, so an exact match wins and otherwise
   * the suffix is read as the rank.
   */
  resolve(rankedName: string): RankedSpell | undefined {
    const exact = this.byName.get(rankedName)
    if (exact) return { spell: exact, rank: 0, rankedName }
    const m = RANK_SUFFIX.exec(rankedName)
    if (!m) return undefined
    const base = this.byName.get(m[1])
    return base ? { spell: base, rank: ROMAN[m[2]], rankedName } : undefined
  }

  /** Every spell, one per name. */
  all(): IterableIterator<Spell> {
    return this.byName.values()
  }

  /** Spells whose name contains `query`. Focus spells belong to items, not classes, so `anyone` includes them. */
  search(query: string, limit = 50, anyone = false): Spell[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: Spell[] = []
    for (const s of this.byName.values()) {
      if (s.name.toLowerCase().includes(q) && (anyone || castable(s))) {
        out.push(s)
        if (out.length >= limit) break
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }
}

function castable(s: Spell): boolean {
  return s.classLevels.some((l) => l > 0 && l < 255)
}

export function summarize(s: Spell): SpellSummary {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    beneficial: s.beneficial,
    icon: s.icon,
    castMs: s.castMs,
    formula: s.formula,
    cap: s.cap,
    // 254 marks an ability granted outside the spell book (Harm Touch), not a level.
    classes: s.classLevels
      .map((l, i) => (l > 0 && l < 255 ? `${CLASS_NAMES[i]} ${l === 254 ? '(ability)' : l}` : ''))
      .filter(Boolean)
      .join(', '),
    landSelf: s.landSelf,
    landOther: s.landOther,
    fade: s.fade
  }
}
