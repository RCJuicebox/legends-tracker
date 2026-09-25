// Whether a buff lands on a character who has another, by the client's own rules (as EQEmu's
// Mob::CheckStackConflict reproduces them from the RoF2 client). A buff's effects sit in numbered
// slots; two buffs with the same effect in the same slot do not stack, and the stronger one holds:
// the new one is blocked when weaker, and overwrites the old one otherwise. Some effects never count
// (see-invisible, levitate, "HP when cast", focus limits, the stacking commands themselves), and
// some spells carry stacking commands: SPA 148 blocks, and SPA 149 overwrites, any spell whose slot
// `base2` holds effect `base` below `max`. Values are worked out at the caster's level, so a level
// 50 Strength (+67) is not overwritten by Harnessing of Spirit ("overwrite slot-1 STR below 67") and
// the two stay on together, but only when Harnessing lands second: Strength cast over it is blocked
// ("block slot-1 STR below 1067"). Order matters, and the best combination says so.
//
// Checked against every "did not take hold … (Blocked by …)" pair in a real Legends log since the
// 2026-08-24 spell data. Before a mid-August patch the game also blocked equal buffs (Spirit of
// Bih`Li over Spirit of Wolf, both 55% run speed) and recasts of the same spell; it no longer does.

import { effectValue } from './effectValue'
import type { SpellEffect } from './spells'

export type StackEffect = Pick<SpellEffect, 'slot' | 'spa' | 'base' | 'base2' | 'formula' | 'max'>

export interface StackSpell {
  effects: StackEffect[]
  /** False for a DoT or debuff; a DoT blocks a regeneration buff. Beneficial when left out. */
  beneficial?: boolean
  /** A group spell holds against its single-target twin. */
  group?: boolean
}

const BLOCK = 148
const OVERWRITE = 149
const BLANK = 254
const CHA = 10
const AC = 1
const AC2 = 416
const HASTE = 11
const HASTE2 = 98
const MOVE = 3
const HP = 0
const COMPLETE_HEAL = 26

/** Effects the client leaves out of stacking (EQEmu's IsEffectIgnoredInStacking). */
export const IGNORED_SPAS = new Set([
  13, 35, 36, 39, 57, 65, 66, 79, 116, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144,
  148, 149, 167, 220, 235, 254, 286, 287, 296, 297, 302, 303, 310, 311, 335, 340, 348, 369, 374, 382, 385, 391, 392, 393, 394, 395, 396, 411,
  412, 413, 415, 418, 420, 421, 422, 423, 424, 425, 476, 479, 480, 483, 484, 485, 486, 490, 491, 492, 493, 495, 500, 501, 511, 512
])

/** A placeholder: SPA 254, charisma at 0 with the flat formula, or a stacking command. */
const blank = (e: StackEffect | undefined): boolean =>
  !e || e.spa === BLANK || (e.spa === CHA && e.base === 0 && (e.formula ?? 100) === 100) || e.spa === BLOCK || e.spa === OVERWRITE

const SLOTS = 12
const bySlot = (s: StackSpell): (StackEffect | undefined)[] => {
  const out: (StackEffect | undefined)[] = new Array(SLOTS + 1)
  for (const e of s.effects) if (e.slot && e.slot <= SLOTS) out[e.slot] = e
  return out
}

/**
 * What happens when `nu`, a different spell, is cast on someone with `old` on: -1 it does not take
 * hold, 1 it replaces `old`, 0 both stay. (The same spell cast again refreshes itself.)
 */
export function checkStack(old: StackSpell, oldLevel: number, nu: StackSpell, newLevel: number): -1 | 0 | 1 {
  const a = bySlot(old)
  const b = bySlot(nu)
  const oldGood = old.beneficial !== false
  const newGood = nu.beneficial !== false

  // Two spells with the same effect in every slot are one line: their stacking commands are skipped.
  let sameLine = true
  for (let i = 1; i <= SLOTS; i++) if ((a[i]?.spa ?? BLANK) !== (b[i]?.spa ?? BLANK)) sameLine = false

  if (!sameLine) {
    for (let i = 1; i <= SLOTS; i++) {
      const e1 = a[i]
      const e2 = b[i]
      if (e2?.spa === OVERWRITE) {
        const at = a[e2.base2]
        if (at && at.spa === e2.base && effectValue(at, oldLevel) < (e2.max ?? 0)) return 1
      } else if (e1?.spa === BLOCK) {
        const at = b[e1.base2]
        if (at && at.spa === e1.base && effectValue(at, newLevel) < (e1.max ?? 0) && newGood) return -1
      }
    }
  }

  let overwrites = false
  let equal = true
  for (let i = 1; i <= SLOTS; i++) {
    const e1 = a[i]
    const e2 = b[i]
    if (!e1 || !e2 || blank(e1) || blank(e2) || e1.spa !== e2.spa) continue
    const spa = e1.spa
    if (IGNORED_SPAS.has(spa)) continue
    // A negative AC effect (a debuff) never clashes with an AC buff.
    if ((spa === AC || spa === AC2) && e2.base < 0) continue
    if (spa === COMPLETE_HEAL) return -1
    if (spa === HP && oldGood !== newGood) {
      // A DoT does not overwrite regeneration but blocks it.
      if (oldGood) continue
      return -1
    }
    if (spa === HP && !oldGood && !newGood) continue
    let v1 = effectValue(e1, oldLevel)
    let v2 = effectValue(e2, newLevel)
    if (spa === MOVE) {
      // A snare holds against run speed; run speed gives way to a snare.
      if (v1 < 0 && v2 > 0) return -1
      if (v2 < 0 && v1 > 0) continue
    }
    if (spa === HASTE || spa === HASTE2) {
      v1 -= 100
      v2 -= 100
    }
    v1 = Math.abs(v1)
    v2 = Math.abs(v2)
    if (v2 < v1) return -1
    if (v2 !== v1) equal = false
    overwrites = true
  }
  if (overwrites) {
    // The single-target twin of a group buff does not replace it (Temperance over Blessing of Temperance).
    if (equal && sameLine && !nu.group && !!old.group) return -1
    return 1
  }
  return 0
}

export type Order = 'any' | 'a-first' | 'b-first'

/** Whether both can be on at once, and in what order they must land for it: null when they cannot. */
export function coexist(a: StackSpell, aLevel: number, b: StackSpell, bLevel: number): Order | null {
  const ab = checkStack(a, aLevel, b, bLevel) === 0
  const ba = checkStack(b, bLevel, a, aLevel) === 0
  return ab && ba ? 'any' : ab ? 'a-first' : ba ? 'b-first' : null
}

export interface StackItem {
  key: string
  value: number
  spell: StackSpell
  /** The caster's level, which the values are worked out at. */
  level: number
  /** On already: it landed first, and it is preferred when two choices are worth the same. */
  keep: boolean
}

/**
 * Whether two items can be on together, and the order they must land in. What is on already has
 * landed: the other must be able to land over it. Two buffs on already are on, whatever the rules say.
 */
export function pairOrder(a: StackItem, b: StackItem): Order | null {
  if (a.key === b.key) return null
  if (a.keep && b.keep) return 'any'
  if (a.keep) return checkStack(a.spell, a.level, b.spell, b.level) === 0 ? 'a-first' : null
  if (b.keep) return checkStack(b.spell, b.level, a.spell, a.level) === 0 ? 'b-first' : null
  return coexist(a.spell, a.level, b.spell, b.level)
}

export interface BestStack {
  chosen: Set<string>
  /** For each chosen key, the chosen buffs that must be on before it lands. */
  after: Map<string, string[]>
}

/** Branches searched at most; past this the best found so far stands (a few dozen buffs never get near). */
const SEARCH_LIMIT = 200_000

/**
 * The set of items worth the most that can all be on at once: a branch-and-bound search over taking
 * or leaving each item, most valuable first, cutting any branch that could not beat the best set
 * found even if it took everything left. A set is possible when every pair can be on together and
 * the orders that calls for do not go round in a circle.
 */
export function bestStack(items: StackItem[]): BestStack {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || Number(b.keep) - Number(a.keep) || a.key.localeCompare(b.key))
  const n = list.length
  const order = list.map((a) => list.map((b) => (a === b ? null : pairOrder(a, b))))
  // before[i][j]: i must be on before j.
  const before = (i: number, j: number) => order[i][j] === 'a-first'
  // What is left from each index on, for the bound.
  const rest = new Array<number>(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) rest[i] = rest[i + 1] + list[i].value
  let best: number[] = []
  let bestValue = -1
  let bestKeep = -1
  let steps = 0
  const picked: number[] = []
  /** True when the order constraints among these have no cycle. */
  const consistent = (set: number[]): boolean => {
    const state = new Map<number, 1 | 2>()
    const visit = (i: number): boolean => {
      const s = state.get(i)
      if (s === 2) return true
      if (s === 1) return false
      state.set(i, 1)
      for (const j of set) if (j !== i && before(i, j) && !visit(j)) return false
      state.set(i, 2)
      return true
    }
    return set.every(visit)
  }
  const go = (i: number, value: number, keep: number) => {
    if (++steps > SEARCH_LIMIT) return
    if (i === n) {
      if (value > bestValue || (value === bestValue && keep > bestKeep)) {
        best = [...picked]
        bestValue = value
        bestKeep = keep
      }
      return
    }
    if (value + rest[i] < bestValue) return
    if (picked.every((p) => order[p][i] !== null)) {
      picked.push(i)
      if (consistent(picked)) go(i + 1, value + list[i].value, keep + Number(list[i].keep))
      picked.pop()
    }
    go(i + 1, value, keep)
  }
  go(0, 0, 0)
  const after = new Map<string, string[]>()
  for (const j of best) {
    const must = best.filter((i) => i !== j && before(i, j)).map((i) => list[i].key)
    if (must.length) after.set(list[j].key, must)
  }
  return { chosen: new Set(best.map((i) => list[i].key)), after }
}
