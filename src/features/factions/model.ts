import { STANDING_MAX, STANDING_MIN } from './core'
import { itemKey } from '../../core/inventory'
import type { PlanChoices, PlanSettings } from '../../shared/settings'
import { classSwapOf, zoneKey } from './names'
import { clamp, median, type PlanActivity } from './catalog'
import { EPS, swapSeconds, unitTime, type UnitTime } from './ways'
import type { PlanInput, PlanTarget } from './planTypes'

// The plan's model, built once a plan (planner.ts): the targets and every faction the plan counts, as
// numbers; each activity as an Act, with its time a unit, what it moves and what its NPC wants; the
// stock on hand; the race unlocks; and the pieces that move a State along an order of blocks and weigh
// where it ends. The search (search.ts) and the steps (steps.ts) work on it.

/** The cons an activity's NPC wants, as standings: each race's lowest and highest for each faction. */
export interface Gate {
  /** The factions (their index), and each con's word ("Amiable"). */
  i: Int32Array
  bands: string[]
  /** The standing race r needs with faction j, at least and at most: [r * needs + j]. */
  lo: Float64Array
  hi: Float64Array
  /** The other races to swap to, the ones its NPC likes best first. */
  order: Int32Array
}

export interface Act {
  a: PlanActivity
  /** Seconds a unit, and while its item is on hand. */
  unit: number
  hand: number
  /** Its one item's slot in the stock the character holds, or -1; how many a unit takes. */
  slot: number
  per: number
  /** What planning counts a second of it as: evidence from the log is trusted over the wiki's. */
  risk: number
  /** Its zone, as a number: the same number is the same place. */
  zone: number
  /** Factions it moves (the targets first, then the rest whose standing is known): index and amount a unit. */
  touch: { i: number; h: number }[]
  /** What its NPC wants, where the races' modifiers are known; null when it wants nothing. */
  gate: Gate | null
  /** Locked in: done whatever its NPC wants (the player says it can be). */
  locked: boolean
  /** Without the races' modifiers, as the catalog found it: 0 open, 1 open to another race, for `swap` seconds. */
  fixed: number
  swap: number
}

/** A faction a block raises to the standing another activity's NPC wants (`for`, that activity). */
export interface Reach {
  i: number
  v: number
  for: number
}

export interface Block {
  act: number
  /** Targets this block is there to finish. */
  finish: number[]
  /** Factions it is there to bring back to 0 or above (the 'positive' goal). */
  lift: number[]
  /** Factions it is there to raise to what a later block's NPC wants. */
  reach: Reach[]
}

/** A plan's state as it goes: standings, targets done, factions that have been at 2000, what is on hand, where the player is and as what. */
export interface State {
  s: Float64Array
  done: Uint8Array
  peak: Uint8Array
  stock: Float64Array
  zone: number
  /** The activity last worked on. */
  act: number
  /** The race it was done as (0 the character's own): going on as that race needs no new swap. */
  race: number
  /** The races the character can be, a bit each: its own always, others as they are unlocked. */
  races: number
  /** Race unlocks done, and when (seconds into the plan). */
  goal: Uint8Array
  goalAt: Float64Array
}

/** While race unlocks come first, the greedy build counts a point on one's factions this many times over. */
const UNLOCK_BOOST = 3
/** How much to trust a figure: the log's own, seen often, most; the wiki's guesses least. */
function riskOf(a: PlanActivity, choices: PlanChoices, locked: boolean): number {
  if (locked || choices.perHour[a.id] > 0) return 1
  if (a.source === 'log') return (a.seen ?? 0) >= 10 ? 1 : 1.15
  return a.guessed?.length ? 1.35 : 1.2
}

/** A way to open an activity no race the character can be may do yet: another activity that raises the faction its NPC wants more of. */
export interface Opening {
  /** The activity that opens it, how many of it, and the race each is done as. */
  j: number
  n: number
  r: number
  rk: number
  reach: Reach
  /** Seconds the opening takes, with the trip. */
  t: number
}

/** The model of a plan for these choices; `covered()` is the units the stock covered in the last `timeFor`. */
export function buildModel(input: PlanInput, settings: PlanSettings, choices: PlanChoices) {
  const { activities } = input
  const known = input.standings ?? {}
  // A race unlock's factions are to do too; nearly all of them are achievements anyway.
  const openGoals = (input.unlocks ?? []).filter((g) => g.factions.length > 0 || (g.anyOf?.length ?? 0) > 0)
  const targets: PlanTarget[] = [...input.targets]
  for (const g of openGoals)
    for (const f of g.factions) if (!targets.some((t) => t.faction === f)) targets.push({ faction: f, achievement: g.achievement, standing: known[f] ?? 0 })
  const travel = settings.travelMin * 60
  const T = targets.length
  /** One faction ending at 0 or above, in seconds; nothing when only time counts. */
  const W = settings.goal === 'positive' ? Math.max(0, settings.positiveHours) * 3600 : 0
  // Every faction whose standing is known: the targets first (index below T), then the rest, then the ones only an NPC's con wants.
  const names = targets.map((t) => t.faction)
  const index = new Map(names.map((f, i) => [f, i]))
  const add = (f: string) => {
    let i = index.get(f)
    if (i === undefined) {
      index.set(f, (i = names.length))
      names.push(f)
    }
    return i
  }
  const maxedNow = new Set(input.maxed)
  for (const f of [...Object.keys(known), ...input.maxed]) add(f)
  const races = input.races
  // The factions NPCs want a con with, of quests that raise an achievement: raising one may open a quicker way.
  const gateWanted = new Set<number>()
  if (races)
    for (const a of activities) {
      if (!a.gate?.length) continue
      const g = a.gate.map((n) => add(n.faction))
      if (Object.entries(a.hits).some(([f, h]) => h > 0 && (index.get(f) ?? T) < T)) g.forEach((i) => gateWanted.add(i))
    }
  const F = names.length
  const start = Float64Array.from(names, (f, i) => clamp(i < T ? targets[i].standing : (known[f] ?? (maxedNow.has(f) ? STANDING_MAX : 0)), STANDING_MIN, STANDING_MAX))
  const lockedIds = new Set(Object.values(choices.locks))

  // ---- races: the character's own (0), and the others it could be ----
  const raceNames = races
    ? [
        races.own,
        ...Object.keys(races.mods)
          .filter((r) => r !== races.own)
          .sort()
      ]
    : []
  const RN = raceNames.length
  const modOf = (r: number, f: string) => races?.mods[raceNames[r]]?.[f] ?? 0
  // The races it can be at the start: its own, and with swaps planned the ones it has unlocked and its own with another class.
  let races0 = 1
  if (races && settings.raceSwaps) for (let r = 1; r < RN; r++) if (races.unlocked === null || races.unlocked.includes(raceNames[r]) || classSwapOf(raceNames[r])) races0 |= 1 << r
  const swapSec = Math.max(0, settings.swapMin) * 60

  // What each activity does to the factions: one that raises an achievement still to do, one that
  // raises what a quest's NPC wants, and for the 'positive' goal one that raises any faction, to bring it back.
  const acts: Act[] = []
  const zones = new Map<string, number>()
  const slots = new Map<string, number>()
  const held: number[] = []
  const times = new Map<string, UnitTime>()
  const timeOf = (a: PlanActivity) => {
    let t = times.get(a.id)
    if (!t) times.set(a.id, (t = unitTime(a, settings, choices)))
    return t
  }
  for (const a of activities) {
    const locked = lockedIds.has(a.id)
    if (!locked && (a.once || choices.excluded.includes(a.id))) continue
    // Without the races' modifiers, as the catalog found it: closed unless another race opens it and swaps are planned.
    let fixed = 0
    if (!races && a.blocked && !locked) {
      if (!(settings.raceSwaps && a.swap?.length)) continue
      fixed = 1
    }
    const touch: { i: number; h: number }[] = []
    let raisesTarget = false
    let raisesAny = false
    let raisesGate = false
    for (const [f, h] of Object.entries(a.hits)) {
      const i = index.get(f)
      if (i === undefined || !h) continue
      touch.push({ i, h })
      if (h > 0) {
        raisesAny = true
        if (i < T) raisesTarget = true
        if (gateWanted.has(i)) raisesGate = true
      }
    }
    if (!raisesTarget && !raisesGate && !(W && raisesAny)) continue
    const time = timeOf(a)
    const item = a.items?.length === 1 && a.items[0].have ? a.items[0] : undefined
    let slot = -1
    if (item) {
      const key = itemKey(item.name)
      slot = slots.get(key) ?? -1
      if (slot < 0) {
        slots.set(key, (slot = held.length))
        held.push(item.have ?? 0)
      }
    }
    const zk = zoneKey(a.zone)
    if (!zones.has(zk)) zones.set(zk, zones.size)
    // What its NPC wants, as the standing each race needs: its con less the race's modifiers.
    let gate: Gate | null = null
    if (races && a.gate?.length) {
      const N = a.gate.length
      const i = new Int32Array(N)
      const lo = new Float64Array(RN * N)
      const hi = new Float64Array(RN * N)
      a.gate.forEach((n, j) => {
        i[j] = index.get(n.faction)!
        for (let r = 0; r < RN; r++) {
          const m = modOf(r, n.faction)
          lo[r * N + j] = n.min !== undefined && (n.min > 0 || n.real) ? n.min - m : -Infinity
          hi[r * N + j] = n.max !== undefined ? n.max - m : Infinity
        }
      })
      const liking = (r: number) => a.gate!.reduce((s, n) => s + modOf(r, n.faction), 0)
      const order = Int32Array.from(Array.from({ length: Math.max(0, RN - 1) }, (_, x) => x + 1).sort((p, q) => liking(q) - liking(p) || p - q))
      gate = { i, bands: a.gate.map((n) => n.band), lo, hi, order }
    }
    acts.push({
      a,
      unit: time.seconds,
      hand: time.handSeconds,
      slot,
      per: item?.count ?? 1,
      risk: riskOf(a, choices, locked),
      zone: zones.get(zk)!,
      touch,
      gate,
      locked,
      fixed,
      swap: fixed ? swapSeconds(a, settings) : 0
    })
  }
  const K = acts.length
  const stock0 = Float64Array.from(held)
  // Per-unit amounts, activity by activity: amt[k * F + i].
  const amt = new Float32Array(K * F)
  acts.forEach((x, k) => x.touch.forEach(({ i, h }) => (amt[k * F + i] = h)))
  const amount = (k: number, i: number) => amt[k * F + i]
  // Which activities raise each faction: to bring one back, or to open a quest.
  const raisers: number[][] = Array.from({ length: F }, () => [])
  acts.forEach((x, k) => x.touch.forEach(({ i, h }) => h > 0 && raisers[i].push(k)))

  const actIndex = new Map(acts.map((x, k) => [x.a.id, k]))
  // A lock holds when its activity is here and raises the achievement.
  const lockOf = Int32Array.from(targets, (t, i) => {
    const k = actIndex.get(choices.locks[t.faction] ?? '')
    return k !== undefined && amount(k, i) > 0 ? k : -1
  })
  const staleLocks = targets.filter((t, i) => choices.locks[t.faction] !== undefined && lockOf[i] < 0).map((t) => t.faction)
  const credits = (k: number, i: number) => lockOf[i] < 0 || lockOf[i] === k

  // ---- which race an activity is done as ----
  /** Whether race r is one the character can be at this point: its own, or one unlocked. */
  const can = (r: number, st: State) => r === 0 || ((st.races >>> r) & 1) === 1
  const meets = (g: Gate, r: number, s: Float64Array) => {
    const N = g.i.length
    for (let j = 0; j < N; j++) {
      const v = s[g.i[j]]
      if (v < g.lo[r * N + j] || v > g.hi[r * N + j]) return false
    }
    return true
  }
  /**
   * The race k is done as at this point: the character's own (0), one it swaps to, or -1 while no race
   * it can be meets what its NPC wants. A race already swapped to goes on, else the one its NPC likes best.
   */
  const raceFor = (k: number, st: State): number => {
    const x = acts[k]
    if (!races) return x.fixed
    const g = x.gate
    if (!g || meets(g, 0, st.s)) return 0
    if (st.race > 0 && can(st.race, st) && meets(g, st.race, st.s)) return st.race
    for (const r of g.order) if (can(r, st) && meets(g, r, st.s)) return r
    return x.locked ? 0 : -1
  }
  /** Starting on k as race r: the trip there from another zone, and a race swap there and back unless swapped to it already. */
  const setup = (k: number, st: State, r: number) =>
    (acts[k].zone === st.zone ? 0 : travel) + (r > 0 ? (races ? (st.race === r ? 0 : swapSec) : st.act === k ? 0 : acts[k].swap) : 0)

  // ---- race unlocks ----
  // Each is done once its factions have all been at 2000 (Half Elf's once one of its others is), and
  // its race is then one more the character can be. Those done by others go last, so one pass sees them.
  const goals = [...openGoals].sort((p, q) => (p.anyOf?.length ? 1 : 0) - (q.anyOf?.length ? 1 : 0))
  const G = goals.length
  const goalNames = goals.map((g) => g.achievement)
  const members = goals.map((g) => g.factions.map((f) => index.get(f)!))
  const anyOf = goals.map((g) => (g.anyOf ?? []).map((n) => goalNames.indexOf(n)))
  // One of its others that is not still to do is done: then so is this one.
  const anyDone = anyOf.map((xs) => xs.some((h) => h < 0))
  const goalRace = Int32Array.from(goals, (g) => raceNames.indexOf(g.race))
  const checkGoals = (st: State, t: number) => {
    for (let g = 0; g < G; g++) {
      if (st.goal[g]) continue
      let done = true
      if (anyOf[g].length) done = anyDone[g] || anyOf[g].some((h) => h >= 0 && st.goal[h] === 1)
      else
        for (const i of members[g])
          if (!st.peak[i]) {
            done = false
            break
          }
      if (!done) continue
      st.goal[g] = 1
      st.goalAt[g] = t
      if (goalRace[g] > 0 && settings.raceSwaps) st.races |= 1 << goalRace[g]
    }
  }

  const base: State = {
    s: Float64Array.from(start),
    done: new Uint8Array(T),
    peak: new Uint8Array(F),
    stock: Float64Array.from(stock0),
    zone: -1,
    act: -1,
    race: 0,
    races: races0,
    goal: new Uint8Array(G),
    goalAt: new Float64Array(G)
  }
  for (let i = 0; i < F; i++) {
    if (start[i] < STANDING_MAX) continue
    base.peak[i] = 1
    if (i < T) base.done[i] = 1
  }
  checkGoals(base, 0)
  const fresh = (): State => ({
    ...base,
    s: base.s.slice(),
    done: base.done.slice(),
    peak: base.peak.slice(),
    stock: base.stock.slice(),
    goal: base.goal.slice(),
    goalAt: base.goalAt.slice()
  })
  const reset = (st: State) => {
    st.s.set(base.s)
    st.done.set(base.done)
    st.peak.set(base.peak)
    st.stock.set(base.stock)
    st.goal.set(base.goal)
    st.goalAt.set(base.goalAt)
    st.zone = -1
    st.act = -1
    st.race = 0
    st.races = base.races
  }

  // Whether each activity can come to be done at all: open now to a race the character can be (or may
  // unlock in the plan), or opened by raising the one faction its NPC wants more of with an activity
  // that is open now.
  let hope = base.races
  if (settings.raceSwaps) for (let g = 0; g < G; g++) if (goalRace[g] > 0) hope |= 1 << goalRace[g]
  const openTo = (k: number, s: Float64Array, mask: number) => {
    const g = acts[k].gate
    if (!g || acts[k].locked) return true
    for (let r = 0; r < RN; r++) if ((mask >>> r) & 1 && meets(g, r, s)) return true
    return false
  }
  const mayOpen = acts.map((x, k) => {
    const g = x.gate
    if (!g || x.locked) return true
    const N = g.i.length
    for (let r = 0; r < RN; r++) {
      if (!((hope >>> r) & 1)) continue
      let short = -1
      let ok = true
      for (let j = 0; j < N && ok; j++) {
        const v = start[g.i[j]]
        if (v > g.hi[r * N + j]) ok = false
        else if (v < g.lo[r * N + j]) {
          if (short >= 0) ok = false
          short = j
        }
      }
      if (!ok) continue
      if (short < 0 || raisers[g.i[short]].some((j) => j !== k && openTo(j, start, hope))) return true
    }
    return false
  })

  // What a point on each achievement is worth: the seconds it takes with its quickest way.
  const worth = new Float64Array(T).fill(Infinity)
  for (let k = 0; k < K; k++) {
    if (!mayOpen[k]) continue
    for (const { i, h } of acts[k].touch) if (i < T && h > 0 && credits(k, i)) worth[i] = Math.min(worth[i], (acts[k].unit * acts[k].risk) / h)
  }
  const reachable = Array.from(worth, Number.isFinite)
  // A point a faction ends below 2000 after being there, in seconds.
  const maxedPoint = (median(Array.from(worth).filter(Number.isFinite)) || 1) * settings.keepMaxed

  // The race unlocks the plan can get done, and with race unlocks first, what each of their factions weighs.
  const doable = new Uint8Array(G)
  for (let g = 0; g < G; g++)
    if (!base.goal[g]) doable[g] = anyOf[g].length ? (anyOf[g].some((h) => h >= 0 && doable[h] === 1) ? 1 : 0) : members[g].every((i) => reachable[i] || base.peak[i]) ? 1 : 0
  const counted = goals.flatMap((_, g) => (doable[g] ? [g] : []))
  const first = settings.unlocksFirst && counted.length > 0
  const memberOf: number[][] = Array.from({ length: T }, () => [])
  for (const g of counted) for (const i of members[g]) memberOf[i].push(g)
  const boost = (i: number, st: State) => (first && memberOf[i].some((g) => !st.goal[g]) ? 1 + UNLOCK_BOOST : 1)

  /** Seconds for n units of k, taking what is on hand first; `take` uses the stock up. The units the stock covered are left in `covered`. */
  let covered = 0
  const timeFor = (k: number, n: number, stock: Float64Array, take: boolean) => {
    const x = acts[k]
    covered = 0
    if (x.slot >= 0) {
      const have = stock[x.slot]
      covered = Math.min(n, Math.floor(have / x.per))
      if (take) stock[x.slot] = have - covered * x.per
    }
    return covered * x.hand + (n - covered) * x.unit
  }
  /** n units of k: standings move; achievements that reach 2000 are done. How many were done by it. */
  const apply = (k: number, n: number, st: State) => {
    let newly = 0
    for (const { i, h } of acts[k].touch) {
      const v = clamp(st.s[i] + n * h, STANDING_MIN, STANDING_MAX)
      st.s[i] = v
      if (v >= STANDING_MAX) {
        st.peak[i] = 1
        if (i < T && !st.done[i]) {
          st.done[i] = 1
          newly++
        }
      }
    }
    return newly
  }
  /** Units a block runs: until the achievements it is there for are done, the factions it lifts are at 0 or above and the ones it raises for a quest are there; 0 when they already are. */
  const blockUnits = (b: Block, st: State) => {
    let n = 0
    for (const i of b.finish) if (!st.done[i]) n = Math.max(n, Math.ceil((STANDING_MAX - st.s[i]) / amount(b.act, i) - EPS))
    for (const i of b.lift) if (st.s[i] < 0) n = Math.max(n, Math.ceil(-st.s[i] / amount(b.act, i) - EPS))
    for (const q of b.reach) if (st.s[q.i] < q.v) n = Math.max(n, Math.ceil((q.v - st.s[q.i]) / amount(b.act, q.i) - EPS))
    return n
  }
  /** What the end of a plan is worth against its time: points off factions that were at 2000, and, for the 'positive' goal, the factions at 0 or above. */
  const ending = (st: State) => {
    let lost = 0
    let up = 0
    for (let i = 0; i < F; i++) {
      if (st.peak[i]) lost += STANDING_MAX - st.s[i]
      if (st.s[i] >= 0) up++
    }
    return lost * maxedPoint - W * up
  }

  // ---- greedy: the achievements ----
  /**
   * What n units of k do for the plan, in seconds of work: points on achievements still to do (a race
   * unlock's weigh more while they come first), less points taken off them and off factions that were
   * at 2000, and for the 'positive' goal factions crossing 0.
   */
  const valueOf = (k: number, n: number, st: State) => {
    let gain = 0
    let loss = 0
    let kept = 0
    let cross = 0
    for (const { i, h } of acts[k].touch) {
      const v = st.s[i]
      if (i < T && !st.done[i]) {
        if (h > 0 && credits(k, i)) gain += worth[i] * boost(i, st) * Math.min(STANDING_MAX - v, n * h)
        else if (h < 0 && reachable[i]) loss += worth[i] * boost(i, st) * Math.min(n * -h, v - STANDING_MIN)
        continue
      }
      const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
      if (st.peak[i]) kept += (v - after) * maxedPoint
      if (W) cross += ((after >= 0 ? 1 : 0) - (v >= 0 ? 1 : 0)) * W
    }
    return gain - loss - kept + cross
  }
  /** Units of k until the next achievement it is there for is done; Infinity when it serves none. */
  const toNext = (k: number, st: State) => {
    let n = Infinity
    for (const { i, h } of acts[k].touch) if (i < T && h > 0 && !st.done[i] && credits(k, i)) n = Math.min(n, Math.ceil((STANDING_MAX - st.s[i]) / h - EPS))
    return n
  }
  /** The quickest way to open k, which no race the character can be may do yet: raise the one faction its NPC wants more of with an activity open now. */
  const opening = (k: number, st: State): Opening | null => {
    const g = acts[k].gate
    if (!g) return null
    const N = g.i.length
    let best: Opening | null = null
    for (let r = 0; r < RN; r++) {
      if (!can(r, st)) continue
      let short = -1
      let ok = true
      for (let j = 0; j < N && ok; j++) {
        const v = st.s[g.i[j]]
        if (v > g.hi[r * N + j]) ok = false
        else if (v < g.lo[r * N + j]) {
          if (short >= 0) ok = false
          short = j
        }
      }
      if (!ok || short < 0) continue
      const i = g.i[short]
      const v = g.lo[r * N + short]
      for (const j of raisers[i]) {
        if (j === k) continue
        const rj = raceFor(j, st)
        if (rj < 0) continue
        const n = Math.ceil((v - st.s[i]) / amount(j, i) - EPS)
        if (n <= 0) continue
        const t = timeFor(j, n, st.stock, false) * acts[j].risk + setup(j, st, rj)
        if (!best || t < best.t) best = { j, n, r: rj, rk: r, reach: { i, v, for: k }, t }
      }
    }
    return best
  }

  return {
    activities,
    targets,
    travel,
    T,
    W,
    names,
    index,
    races,
    F,
    start,
    lockedIds,
    raceNames,
    modOf,
    swapSec,
    acts,
    timeOf,
    K,
    amount,
    raisers,
    actIndex,
    lockOf,
    staleLocks,
    credits,
    raceFor,
    setup,
    goalNames,
    checkGoals,
    base,
    fresh,
    reset,
    mayOpen,
    reachable,
    maxedPoint,
    counted,
    first,
    covered: () => covered,
    timeFor,
    apply,
    blockUnits,
    ending,
    valueOf,
    toNext,
    opening,
    settings,
    choices
  }
}

/** What the search and the steps work on. */
export type Model = ReturnType<typeof buildModel>
