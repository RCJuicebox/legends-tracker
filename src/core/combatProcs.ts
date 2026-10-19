import type { Entity, ProcOrigin } from '../shared/types'
import { nameKey } from './combatRoster'

// Procs, for the damage meter (LT-638: out of combatMeter.ts): a friend's spell effect with no cast
// line of theirs in the window was fired by something else (a weapon, a buff, an ability), and a
// lifetap's damage line and heal line are one firing, whichever comes first.

/**
 * A spell effect landing this long after its cast line is the cast; later, or with no cast line at
 * all, it was fired by something else: a weapon, a buff, an ability. Long casts run to ten seconds.
 */
export const CAST_WINDOW_MS = 20_000
/** Abilities the game lists as ones you press, whose effect prints like a proc. */
const ACTIVATED = new Set(['reaving strike', 'harm touch', 'leech touch', 'mend'])
/** Names kept in each map at most: a busy raid zone names hundreds (LT-382). */
const KEPT = 4000
/** A lifetap's damage and heal lines this close are one firing. */
const PAIR_MS = 1000

/** "Envenomed Bolt X" and "Envenomed Bolt" are one spell for matching a landing to its cast. */
export function spellBase(name: string): string {
  return name.replace(/ (?:[IVXL]+|\d+)$/, '').toLowerCase()
}

const capped = (m: Map<string, number>, k: string, v: number) => {
  m.set(k, v)
  if (m.size > KEPT) m.delete(m.keys().next().value!)
}

/** Who cast what when, and each proc's last damage and heal lines: what tells a proc from a cast, and one firing from two. */
export class ProcFirings {
  /** When each entity last began casting each spell: "kelwyn|envenomed bolt" → time. */
  private readonly lastCast = new Map<string, number>()
  /** When each entity's proc last did damage, by base name, so its heal line a moment later is the same firing. */
  private readonly lastProc = new Map<string, number>()
  /** A proc's heal line counted as its firing before its damage line came (same second): the damage line pairs with it. */
  private readonly healFiring = new Map<string, number>()

  clear(): void {
    this.lastCast.clear()
    this.lastProc.clear()
    this.healFiring.clear()
  }

  /** `source` began casting `spell`. */
  cast(source: string, spell: string, at: number): void {
    capped(this.lastCast, `${nameKey(source)}|${spellBase(spell)}`, at)
  }

  /** What fired a friend's spell effect: null when it is their own cast, else a proc of a spell or an ability. */
  origin(source: string, spell: string, at: number): ProcOrigin | null {
    const base = spellBase(spell)
    const cast = this.lastCast.get(`${nameKey(source)}|${base}`)
    if (cast !== undefined && at - cast <= CAST_WINDOW_MS && at >= cast) return null
    return ACTIVATED.has(base) ? 'ability' : 'spell'
  }

  /** A proc's damage line: whether it is a firing of its own (a lifetap whose heal line came first already counted it). */
  damage(source: string, spell: string, at: number): boolean {
    const k = `${nameKey(source)}|${spellBase(spell)}`
    const paired = Math.abs(at - (this.healFiring.get(k) ?? -Infinity)) <= PAIR_MS
    if (paired) this.healFiring.delete(k)
    capped(this.lastProc, k, at)
    return !paired
  }

  /** A proc's direct heal line: whether it is a firing of its own (not a lifetap's heal after its damage line). */
  heal(source: string, spell: string, at: number): boolean {
    const k = `${nameKey(source)}|${spellBase(spell)}`
    const firing = Math.abs(at - (this.lastProc.get(k) ?? -Infinity)) > PAIR_MS
    if (firing) capped(this.healFiring, k, at)
    return firing
  }
}

/**
 * Books one proc line. A lifetap's damage line carries the rank ("Lifebite III") and its heal line
 * may not ("Lifebite"): one proc, found by its base name and named as the damage line has it.
 */
export function bookProc(e: Entity, name: string, origin: ProcOrigin, damage: number, healed: number, firing: boolean): Entity['procs'][string] {
  const base = spellBase(name)
  const had = e.procs[name] ? name : Object.keys(e.procs).find((k) => spellBase(k) === base)
  let p = had ? e.procs[had] : undefined
  if (p && had !== name && damage > 0) {
    delete e.procs[had!]
    p.name = name
    e.procs[name] = p
  }
  p ??= e.procs[name] = { name, origin, count: 0, damage: 0, healed: 0 }
  if (firing) p.count++
  p.damage += damage
  p.healed += healed
  return p
}

/** A lifetap's later tick heals into the proc row its first firing opened, without counting another firing. */
export function tapTick(e: Entity, spell: string, healed: number): void {
  const base = spellBase(spell)
  const had = Object.keys(e.procs).find((k) => spellBase(k) === base)
  if (had) e.procs[had].healed += healed
}
