import { MOTE_RANKS, type MoteCounts, type MoteKey } from './motes'

// The item-upgrade rules, as the EQL mote guide and play have established them:
//
// - An item at +N needs 2^N xp to reach +N+1.
// - Only the mote of rank N+1 works on a +N item: Infinitesimal (rank 1) on +0 items … Infinite (rank 10)
//   on +9. Wu's Fist of Mastery +6 takes Mote of Superior Potential (rank 7) to reach +7.
// - Two motes of one rank combine into one of the next.
// - XP past the next level is assumed lost (unconfirmed), so a multi-level plan may slightly overcount.

export interface PlannedItem {
  name: string
  /** The level it is at now: +lvl. */
  lvl: number
  /** XP already in its bar. */
  xp: number
  /** The level to plan up to. */
  to: number
}

export interface Combine {
  /** Rank index combined from … */
  from: number
  /** … how many of them … */
  n: number
  /** … into this many of the next rank. */
  make: number
  to: number
}

export interface PlanStep {
  from: number
  to: number
  /** XP needed for this level. */
  need: number
  /** Rank index of the mote that works here, or -1 when none does (+10 and up). */
  m: number
  noMote?: boolean
  count?: number
  /** XP wasted by the last mote. */
  over?: number
  combos?: Combine[]
  /** Motes still missing after combining everything below. */
  short?: number
  /** Not planned because an earlier step could not be covered. */
  unsourced?: boolean
}

export interface Plan {
  steps: PlanStep[]
  /** Levels the stock covers, in order. */
  covered: number
  /** The stock left after the covered steps, by rank index. */
  after: number[] | null
  reached: number
}

export const MAX_LEVEL = 10

/** A loot line this much earlier than the one before it in the same pass is a clock change, not a replay. */
const CLOCK_STEP_MS = 5000

/**
 * Decides whether a loot line is new to the stock. Log times have one-second resolution and a reward
 * chest logs several loot lines in the same second, so "newer than the last counted line" is not
 * enough: the cursor also remembers how many loot lines in that second it has already counted, and
 * a replay (catching up after a restart) skips exactly those.
 *
 * Log times are local, so when the clocks go back (01:59:59 is followed by 01:00:00) the log steps
 * backwards. A line well behind the previous one in the same pass is taken as that, and the cursor
 * restarts from it rather than dropping the whole repeated hour.
 */
export class StockCursor {
  /** Loot lines seen in this pass at the cursor's second. */
  private sameSecond = 0
  /** The previous line's time in this pass, accepted or not. */
  private previous: number | null = null

  constructor(
    public seenUntil = 0,
    public seenAtSecond = 0
  ) {}

  accept(time: number): boolean {
    const previous = this.previous
    this.previous = time
    if (previous !== null && time < previous - CLOCK_STEP_MS) {
      this.seenUntil = time
      this.seenAtSecond = 1
      this.sameSecond = 1
      return true
    }
    if (time < this.seenUntil) return false
    if (time === this.seenUntil) {
      this.sameSecond++
      if (this.sameSecond <= this.seenAtSecond) return false
      this.seenAtSecond = this.sameSecond
      return true
    }
    this.seenUntil = time
    this.seenAtSecond = 1
    this.sameSecond = 1
    return true
  }
}

export function moteForLevel(level: number): number {
  return level < 0 ? 0 : level < MOTE_RANKS.length ? level : -1
}

export function countsToArray(c: MoteCounts): number[] {
  return MOTE_RANKS.map((r) => c[r.key] ?? 0)
}

export function arrayToCounts(a: number[]): MoteCounts {
  const out: MoteCounts = {}
  MOTE_RANKS.forEach((r, i) => (out[r.key as MoteKey] = a[i] ?? 0))
  return out
}

/** How many of rank `m` you could have, combining everything below it. */
export function makeable(inv: number[], m: number): number {
  let carry = 0
  for (let k = 0; k <= m; k++) {
    const avail = inv[k] + carry
    if (k === m) return avail
    carry = Math.floor(avail / 2)
  }
  return 0
}

/** Takes `count` motes of rank `m` from `inv` (mutated), combining up from lower ranks for any shortfall. */
export function planStep(inv: number[], m: number, count: number): { take: number; short: number; combos: Combine[] } {
  const take = Math.min(count, makeable(inv, m))
  let need = take
  const combos: Combine[] = []
  for (let k = m; k >= 0 && need > 0; k--) {
    const use = Math.min(inv[k], need)
    inv[k] -= use
    const short = need - use
    if (short && k > 0) combos.push({ from: k - 1, n: short * 2, make: short, to: k })
    need = short * 2
  }
  return { take, short: count - take, combos: combos.reverse() }
}

export function fixItem(d: Partial<Record<keyof PlannedItem, unknown>>): PlannedItem {
  const lvl = Math.max(0, Math.min(MAX_LEVEL, Math.floor(Number(d.lvl) || 0)))
  const xp = Math.max(0, Math.min(2 ** lvl - 1, Math.floor(Number(d.xp) || 0)))
  let to = Math.floor(Number(d.to) || 0)
  if (!(to > lvl)) to = lvl + 1
  to = Math.min(to, MAX_LEVEL + 1)
  return { name: String(d.name ?? ''), lvl, xp, to }
}

/** Reads "+6" off the end of a name, as the web calculator did. */
export function levelFromName(name: string): number | null {
  const m = /\+(\d+)\s*$/.exec(name)
  return m ? Number(m[1]) : null
}

export function plan(item: PlannedItem, stock: MoteCounts): Plan {
  const inv = countsToArray(stock)
  const steps: PlanStep[] = []
  let covered = 0
  let blocked = false
  let after: number[] | null = null
  for (let t = item.lvl; t < item.to; t++) {
    const need = 2 ** t - (t === item.lvl ? item.xp : 0)
    const m = moteForLevel(t)
    const st: PlanStep = { from: t, to: t + 1, need, m }
    if (m < 0) {
      st.noMote = true
      blocked = true
    } else {
      st.count = Math.ceil(need / MOTE_RANKS[m].xp)
      st.over = st.count * MOTE_RANKS[m].xp - need
      if (!blocked) {
        const p = planStep(inv, m, st.count)
        st.combos = p.combos
        st.short = p.short
        if (p.short) blocked = true
        else {
          covered++
          after = inv.slice()
        }
      } else st.unsourced = true
    }
    steps.push(st)
  }
  return { steps, covered, after, reached: item.lvl + covered }
}
