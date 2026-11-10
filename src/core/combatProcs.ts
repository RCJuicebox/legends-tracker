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
  /** When anyone last began casting each spell, by base name. */
  private readonly lastCastAny = new Map<string, number>()
  /** When each entity's proc last did damage, by base name, so its heal line a moment later is the same firing. */
  private readonly lastProc = new Map<string, number>()
  /** A proc's heal line counted as its firing before its damage line came (same second): the damage line pairs with it. */
  private readonly healFiring = new Map<string, number>()

  clear(): void {
    this.lastCast.clear()
    this.lastCastAny.clear()
    this.lastProc.clear()
    this.healFiring.clear()
  }

  /** `source` began casting `spell`. */
  cast(source: string, spell: string, at: number): void {
    capped(this.lastCast, `${nameKey(source)}|${spellBase(spell)}`, at)
    capped(this.lastCastAny, spellBase(spell), at)
  }

  /** Someone, whoever it was, began casting `spell` in the window before `at`: its landing is that cast. */
  castByAnyone(spell: string, at: number): boolean {
    const cast = this.lastCastAny.get(spellBase(spell))
    return cast !== undefined && at - cast <= CAST_WINDOW_MS && at >= cast
  }

  /** `spell` landed on an enemy: whoever cast it aimed it there, so it explains no landing on your side. */
  landedOnEnemy(spell: string, at: number): void {
    if (this.castByAnyone(spell, at)) this.lastCastAny.delete(spellBase(spell))
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

/** An enemy's effect landing this long after its blow on the same target came from that blow. */
const STRUCK_MS = 1000

/** One firing of an enemy's proc on someone: the spells it may be, and the row it was booked under. */
interface InFiring {
  at: number
  spells: string[]
  key: string
  /** The line it was booked from: a firing is at most one message and one damage line. */
  line: 'message' | 'damage'
  paired?: boolean
}

/**
 * Enemies' procs on your side (incoming): who last struck whom, so an effect landing with no damage
 * line ("You feel very dispelled.") can be put down to the enemy whose blow fired it, and each firing
 * once, though it may print a message and a damage line both ("Lady Vox hit you for 600 points of cold
 * damage by Frost Breath." then "Your body freezes as the frost hits you.", whoever bit you last).
 */
export class IncomingFirings {
  /** The enemy that last landed a blow on each of your side, by the target's name key. */
  private readonly struck = new Map<string, { source: string; at: number }>()
  /** The last firing on each target, by the target's name key. */
  private readonly last = new Map<string, InFiring>()
  /** The last firing booked from a message alone, by the target's name key: a lifetap's heal may take it back. */
  private readonly message = new Map<string, InFiring>()

  clear(): void {
    this.struck.clear()
    this.last.clear()
    this.message.clear()
  }

  /** `source`, an enemy, landed a blow on `target`. */
  strike(source: string, target: string, at: number): void {
    this.struck.set(nameKey(target), { source, at })
    if (this.struck.size > KEPT) this.struck.delete(this.struck.keys().next().value!)
  }

  /** The enemy whose blow on `target` a moment ago fired what landed on them now, if any. */
  striker(target: string, at: number): string | null {
    const s = this.struck.get(nameKey(target))
    return s && at >= s.at && at - s.at <= STRUCK_MS ? s.source : null
  }

  /**
   * The row an earlier line of the same firing was booked under, if this line is part of it: the other
   * of its message and its damage line, on the same target, within a second, and the same spell. Else
   * this line is a firing of its own, remembered under `key`. Two messages are two firings: Phinigel
   * Autropos's dispel can land twice in a second.
   */
  firing(target: string, spells: string[], key: string, line: InFiring['line'], at: number): string | null {
    const k = nameKey(target)
    const prev = this.last.get(k)
    const bases = new Set(spells.map(spellBase))
    if (prev && !prev.paired && prev.line !== line && at - prev.at <= PAIR_MS && prev.spells.some((s) => bases.has(spellBase(s)))) {
      prev.paired = true
      return prev.key
    }
    this.last.set(k, { at, spells, key, line })
    if (this.last.size > KEPT) this.last.delete(this.last.keys().next().value!)
    return null
  }

  /** A firing booked from its message alone, which a heal by one of its spells may yet show to be a lifetap's. */
  fromMessage(target: string, spells: string[], key: string, at: number): void {
    this.message.set(nameKey(target), { at, spells, key, line: 'message' })
    if (this.message.size > KEPT) this.message.delete(this.message.keys().next().value!)
  }

  /**
   * A heal on `target` by `spell`: when a message on them a moment ago was that spell's, it was a
   * lifetap's own (your Harm Touch's drain prints "Your life force drains away." and then heals you by
   * Leech Touch I), not an enemy's proc. The row to take its firing back from, if so.
   */
  retract(target: string, spell: string, at: number): string | null {
    const k = nameKey(target)
    const m = this.message.get(k)
    if (!m || at - m.at > PAIR_MS || !m.spells.some((s) => spellBase(s) === spellBase(spell))) return null
    this.message.delete(k)
    if (this.last.get(k)?.key === m.key) this.last.delete(k)
    return m.key
  }
}

/** How many of a shared message's spells a row keeps, to name in its hint. */
const SPELLS_NAMED = 6

/**
 * Books an enemy's proc on `e`, the one it landed on. `firing` false adds the damage of a line that
 * belongs to a firing already counted. A message several spells share is booked under the message.
 */
export function bookProcIn(e: Entity, name: string, source: string, spells: string[], damage: number, firing: boolean): string {
  const key = `${name}|${nameKey(source)}`
  e.procsIn ??= {}
  const p = (e.procsIn[key] ??= { name, source, count: 0, damage: 0, ...(spells.length > 1 ? { spells: spells.slice(0, SPELLS_NAMED) } : {}) })
  if (firing) p.count++
  p.damage += damage
  return key
}

/** Adds a later line's damage to a firing already booked under `key`. */
export function addProcInDamage(e: Entity, key: string, damage: number): void {
  const p = e.procsIn?.[key]
  if (p) p.damage += damage
}

/** Takes back a firing booked under `key`, and its row when that leaves it empty. */
export function unbookProcIn(e: Entity, key: string): void {
  const p = e.procsIn?.[key]
  if (!p) return
  p.count--
  if (p.count <= 0 && p.damage === 0) delete e.procsIn![key]
}
