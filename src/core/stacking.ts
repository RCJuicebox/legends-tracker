// Whether two buffs can be on a character at once, by the spell file's own layout: EverQuest's
// classic rule (EQEmu's CheckStackConflict). A buff's effects sit in numbered slots; two buffs with
// the same effect in the same slot do not stack, and the stronger one holds. Some spells also carry
// stacking commands: SPA 148 blocks, and SPA 149 overwrites, any spell with effect `base` in slot
// `base2` (Temperance blocks the Symbols' HP in slot 3; Harnessing of Spirit blocks Strength and
// Dexterity's slot-1 STR and DEX). Placeholders (SPA 254, or 10 — CHA — at 0) take up a slot and
// count for nothing.
//
// Checked against the "did not take hold … (Blocked by …)" lines in a real Legends log (57 pairs).

import type { SpellEffect } from './spells'

export type StackEffect = Pick<SpellEffect, 'slot' | 'spa' | 'base' | 'base2'>

const COMMANDS = [148, 149]
const blank = (e: StackEffect) => e.spa === 254 || (e.spa === 10 && e.base === 0)

/** True when both can be on at once. The same spell never stacks with itself: casting it again refreshes it. */
export function stacks(a: StackEffect[], b: StackEffect[]): boolean {
  for (const [x, y] of [
    [a, b],
    [b, a]
  ]) {
    for (const c of x) if (COMMANDS.includes(c.spa) && y.some((e) => e.slot === c.base2 && e.spa === c.base && !blank(e))) return false
  }
  for (const e of a) {
    if (blank(e) || COMMANDS.includes(e.spa) || !e.slot) continue
    if (b.some((f) => f.slot === e.slot && f.spa === e.spa)) return false
  }
  return true
}

export interface StackItem {
  key: string
  value: number
  effects: StackEffect[]
  /** On already: preferred when two choices are worth the same. */
  keep: boolean
}

/** Branches searched at most; past this the best found so far stands (a few dozen buffs never get near). */
const SEARCH_LIMIT = 200_000

/**
 * The set of items worth the most that all stack with each other: a branch-and-bound search over
 * taking or leaving each item, most valuable first, cutting any branch that could not beat the best
 * set found even if it took everything left.
 */
export function bestStack(items: StackItem[]): Set<string> {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value || Number(b.keep) - Number(a.keep) || a.key.localeCompare(b.key))
  const n = list.length
  const clash = list.map((a, i) => list.map((b, j) => i !== j && (a.key === b.key || !stacks(a.effects, b.effects))))
  // What is left from each index on, for the bound.
  const rest = new Array<number>(n + 1).fill(0)
  for (let i = n - 1; i >= 0; i--) rest[i] = rest[i + 1] + list[i].value
  let best: number[] = []
  let bestValue = -1
  let bestKeep = -1
  let steps = 0
  const picked: number[] = []
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
    if (!picked.some((p) => clash[p][i])) {
      picked.push(i)
      go(i + 1, value + list[i].value, keep + Number(list[i].keep))
      picked.pop()
    }
    go(i + 1, value, keep)
  }
  go(0, 0, 0)
  return new Set(best.map((i) => list[i].key))
}
