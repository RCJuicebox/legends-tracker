import { FRAGMENT_RANKS, MOTE_RANKS, fragmentWorth, moteWorth, type MoteCounts } from './motes'

// The item-upgrade rules, as the EQL mote guide and in-game upgrade previews (2026-11-12) have them:
//
// - An item at +N needs 2^N xp to reach +N+1.
// - A mote of rank R (Infinitesimal 1 … Infinite 10) works on any item below +R, for its item xp
//   (1, 1, 2, 4, 5 … 10): a Major mote on a +0 item gave 5 xp. Before the 11-12 patch only the
//   mote of rank N+1 worked on a +N item; the cheapest is still that one.
// - A Fragment of rank R works the same way, below +R, for its own item xp (FRAGMENT_RANKS). The
//   game hands back fragments the item cannot take any more.
// - XP past a level carries on into the next ones (a preview went +0 → +3 1/8 in one fragment).
// - Two motes of one rank combine into one of the next. Fragments do not combine.
//
// How the planner spends (Dan, 2026-11-13): motes first. A fragment gives a spell twice what it gives
// an item at the low levels, and every bit of it counts there, so on an item it is spent only when no
// mote can pay, and only one whose xp all lands before the level planned to: never one that goes past.

export interface PlannedItem {
  name: string
  /** The level it is at now: +lvl. */
  lvl: number
  /** XP already in its bar. */
  xp: number
  /** The level to plan up to. */
  to: number
}

interface Combine {
  /** Rank index combined from … */
  from: number
  /** … how many of them … */
  n: number
  /** … into this many of the next rank. */
  make: number
  to: number
}

/** Motes or fragments of one rank spent on the item. */
export interface PlanUse {
  kind: 'mote' | 'fragment'
  /** Rank index. */
  m: number
  n: number
}

interface PlanStep {
  from: number
  to: number
  /** XP the level takes in all … */
  need: number
  /** … and how much of it was already in the bar: the item's own, or carried over from the level below. */
  carried: number
  /** What is spent on the item at this level, in order. */
  uses: PlanUse[]
  /** Motes combined first to make some of those. */
  combos: Combine[]
  /** The lowest mote rank that works here: what `short` is counted in. */
  m: number
  /** No mote works here (+10 and up). */
  noMote?: boolean
  /** Motes of rank `m` still missing once the stock is spent. */
  short?: number
  /** Not planned because an earlier step could not be covered. */
  unsourced?: boolean
}

export interface Plan {
  steps: PlanStep[]
  /** Levels the stock covers, in order. */
  covered: number
  /** The motes left after the covered steps, by rank index … */
  after: number[] | null
  /** … and the fragments. */
  afterFragments: number[] | null
  reached: number
  /** XP in the bar at `reached` once the covered steps are done (carried past the last level). */
  xp: number
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

/** The cheapest mote for a +level item, by rank index: rank level+1; -1 when none works (+10 and up). */
export function moteForLevel(level: number): number {
  return level < 0 ? 0 : level < MOTE_RANKS.length ? level : -1
}

export function countsToArray(c: MoteCounts): number[] {
  return MOTE_RANKS.map((r) => c[r.key] ?? 0)
}

export function fragmentsToArray(c: MoteCounts): number[] {
  return FRAGMENT_RANKS.map((r) => c[r.key] ?? 0)
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
function planStep(inv: number[], m: number, count: number): { take: number; short: number; combos: Combine[] } {
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

/** What an item xp costs, in Infinitesimal motes' worth, spending a mote or fragment of a rank. */
const moteCost = (i: number) => moteWorth(i) / MOTE_RANKS[i].xp
const fragmentCost = (i: number) => fragmentWorth(i) / FRAGMENT_RANKS[i].xp

/**
 * The next thing to spend on a +t item with `room` xp left before the planned level. Motes first: the
 * one whose item xp costs least, counted in Infinitesimal motes' worth (what it would give a spell
 * instead), which is the lowest rank that works, made by combining lower motes when there is none on
 * hand, before any higher one. Only when no mote can pay, a fragment, the cheapest whose xp fits in
 * `room`. On a tie the lower rank goes first, since it stops working on the item sooner.
 */
function cheapest(inv: number[], frag: number[], t: number, room: number): { kind: 'mote' | 'fragment' | 'combine'; m: number } | null {
  let best: { kind: 'mote' | 'fragment' | 'combine'; m: number } | null = null
  let cost = Infinity
  const consider = (kind: 'mote' | 'fragment' | 'combine', m: number, c: number) => {
    if (c < cost - 1e-9) {
      best = { kind, m }
      cost = c
    }
  }
  for (let i = t; i < MOTE_RANKS.length; i++) if (inv[i] > 0) consider('mote', i, moteCost(i))
  if (inv[t] === 0 && t > 0 && makeable(inv, t) > 0) consider('combine', t, moteCost(t))
  if (best) return best
  for (let i = t; i < FRAGMENT_RANKS.length; i++) if (frag[i] > 0 && FRAGMENT_RANKS[i].xp <= room) consider('fragment', i, fragmentCost(i))
  return best
}

function addUse(uses: PlanUse[], kind: PlanUse['kind'], m: number): void {
  const last = uses[uses.length - 1]
  if (last && last.kind === kind && last.m === m) last.n++
  else uses.push({ kind, m, n: 1 })
}

/**
 * Plans the item from its level up to `to` with the stock: level by level, one at a time, the
 * cheapest mote that works there, or when none can, a fragment that does not go past `to` (see
 * cheapest); xp past a level carries on. Pass no fragments to plan with motes alone.
 */
export function plan(item: PlannedItem, stock: MoteCounts, fragments: MoteCounts = {}): Plan {
  const inv = countsToArray(stock)
  const frag = fragmentsToArray(fragments)
  const steps: PlanStep[] = []
  // XP counted from +0, so a use that goes past a level simply carries on.
  let total = 2 ** item.lvl - 1 + item.xp
  let covered = 0
  let blocked = false
  let after: number[] | null = null
  let afterFragments: number[] | null = null
  let doneTotal = total
  // No fragment's xp may go past the level planned to.
  const end = 2 ** item.to - 1
  for (let t = item.lvl; t < item.to; t++) {
    const base = 2 ** t - 1
    const top = 2 ** (t + 1) - 1
    const st: PlanStep = { from: t, to: t + 1, need: 2 ** t, carried: Math.max(0, Math.min(2 ** t, total - base)), uses: [], combos: [], m: moteForLevel(t) }
    steps.push(st)
    if (blocked) {
      st.unsourced = true
      continue
    }
    if (st.m < 0) {
      st.noMote = true
      blocked = true
      continue
    }
    while (total < top) {
      const pick = cheapest(inv, frag, t, end - total)
      if (!pick) {
        st.short = Math.ceil((top - total) / MOTE_RANKS[t].xp)
        blocked = true
        break
      }
      if (pick.kind === 'fragment') {
        frag[pick.m]--
        total += FRAGMENT_RANKS[pick.m].xp
        addUse(st.uses, 'fragment', pick.m)
        continue
      }
      if (pick.kind === 'combine') st.combos.push(...planStep(inv, pick.m, 1).combos)
      else inv[pick.m]--
      total += MOTE_RANKS[pick.m].xp
      addUse(st.uses, 'mote', pick.m)
    }
    if (blocked) continue
    covered++
    after = inv.slice()
    afterFragments = frag.slice()
    doneTotal = total
  }
  // Combines that made the same rank one at a time read better as one.
  for (const st of steps) st.combos = mergeCombos(st.combos)
  // Where the item ends up: a use past the last planned level can carry it further still.
  let reached = item.lvl
  if (covered) while (reached < MAX_LEVEL && doneTotal >= 2 ** (reached + 1) - 1) reached++
  const xp = covered ? doneTotal - (2 ** reached - 1) : item.xp
  return { steps, covered, after, afterFragments, reached, xp }
}

function mergeCombos(combos: Combine[]): Combine[] {
  const out: Combine[] = []
  for (const c of combos) {
    const same = out.find((x) => x.from === c.from && x.to === c.to)
    if (same) {
      same.n += c.n
      same.make += c.make
    } else out.push({ ...c })
  }
  return out.sort((a, b) => a.from - b.from)
}
