// Which worn item to merge next: the stat value each item's next +1 would add, against the motes it
// costs, so the best boost per mote goes first.
//
// The next level of a +N item takes 2^N xp from motes of rank N+1 (Infinitesimal on +0 … Infinite on
// +9), and two motes of a rank make one of the next, so a mote of rank index i is worth 2^i
// Infinitesimal motes: the cost of a step is its mote count × that worth. The gain is the finder's
// own score of the item's stats at +N+1 less at +N, with the same weights, so a Tank sees AC and
// HP, a Caster mana and wisdom.

import { mergeLevel, scaledStats, type InvItem, type ItemStats } from './inventory'
import { countsToArray, makeable, MAX_LEVEL, moteForLevel } from './moteCalc'
import { MOTE_RANKS, moteWorth, type MoteCounts } from './motes'
import { score, statValues, type WeightKey, type Weights } from './upgrades'

export interface MergeOption {
  item: InvItem
  /** The level it is at now, and the one the step reaches. */
  level: number
  next: number
  /** What the step adds, in the weights' units (the finder's score). */
  gain: number
  /** The stat changes behind the gain, for showing: only stats with a weight, only those that move. */
  deltas: Partial<Record<WeightKey, number>>
  /** XP the step needs, after any xp already in the bar. */
  need: number
  /** The mote that works on it: a rank index into MOTE_RANKS. */
  mote: number
  /** How many of them. */
  motes: number
  /** The combine value of those motes, in Infinitesimal motes. */
  cost: number
  /** Gain per 100 Infinitesimal motes' worth: the number to sort by. */
  rate: number
  /** How many of that mote the stock could make, combining up from the ranks below. */
  canMake: number
  affordable: boolean
}

export interface MergeInput {
  worn: InvItem[]
  /** An item's base (unmerged) stats, from the wiki; null when unknown. */
  baseStatsOf: (item: InvItem) => ItemStats | null
  weights: Weights
  /** Motes on hand, for what is affordable now. */
  stock?: MoteCounts
  /** The planner's item, whose xp bar is partly filled. */
  planned?: { name: string; lvl: number; xp: number } | null
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

/** The next merge of every worn item the wiki knows, best boost per mote first. Items at +10 have none. */
export function mergeOptions(o: MergeInput): MergeOption[] {
  const inv = countsToArray(o.stock ?? {})
  const out: MergeOption[] = []
  for (const item of o.worn) {
    const level = mergeLevel(item.name)
    if (level >= MAX_LEVEL) continue
    const base = o.baseStatsOf(item)
    if (!base) continue
    const mote = moteForLevel(level)
    if (mote < 0) continue
    const now = statValues(scaledStats(base, level))
    const then = statValues(scaledStats(base, level + 1))
    const deltas: Partial<Record<WeightKey, number>> = {}
    for (const k of Object.keys(o.weights) as WeightKey[]) {
      const d = round(then[k] - now[k], 2)
      if (d && o.weights[k]) deltas[k] = d
    }
    const gain = round(score(scaledStats(base, level + 1), o.weights) - score(scaledStats(base, level), o.weights), 2)
    const inBar = o.planned && o.planned.name === item.name && o.planned.lvl === level ? o.planned.xp : 0
    const need = Math.max(1, 2 ** level - inBar)
    const motes = Math.ceil(need / MOTE_RANKS[mote].xp)
    const cost = motes * moteWorth(mote)
    const canMake = makeable(inv, mote)
    out.push({ item, level, next: level + 1, gain, deltas, need, mote, motes, cost, rate: round((gain / cost) * 100, 2), canMake, affordable: canMake >= motes })
  }
  return out.sort((a, b) => b.rate - a.rate || b.gain - a.gain || a.cost - b.cost)
}
