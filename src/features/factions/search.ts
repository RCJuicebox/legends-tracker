import { STANDING_MAX, STANDING_MIN } from './core'
import { clamp } from './catalog'
import { EPS } from './ways'
import type { PlanShape } from './planTypes'
import type { Block, Model, Opening, State } from './model'

// The plan is found in three passes. A greedy build takes, again and again, the activity that does
// most for the achievements still open per hour, counting points it takes off another open one as
// work to do again, and runs it until the next achievement it serves is done. It is built several
// times with a little noise and the quickest kept. Then a local search moves whole blocks earlier
// or later and gives an achievement to another activity, keeping any change that saves time. An
// achievement the player has locked to an activity is only ever finished by that activity.
//
// All three work on the plan's model (model.ts); the order found is laid out as steps in steps.ts.

/** A seeded random number, so a plan is the same every time for the same choices. */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

/** A plan that leaves an achievement undone. */
const MISSED = 1e9
/**
 * When two orders take as long, the one that finishes achievements sooner (the sum of when each is
 * done): quick ones first, so stopping part way leaves the most done. Small enough never to cost time.
 */
const FLOW_WEIGHT = 1e-6
/**
 * The local search's work, in blocks simulated over all its starts: the orders it may try is this over
 * the plan's length, so a long plan tries fewer. A third of a second for all 83 achievements, where ten
 * times as much finds a plan no more than 0.2% quicker.
 */
const SEARCH_WORK = 3_000_000
/** Steps the 'positive' goal may add to bring factions back to 0 or above. */
const LIFTS_MAX = 80
/** While race unlocks come first, a second sooner for the average race unlock is worth a second of play. */
const UNLOCK_WEIGHT = 1

/** The quickest order of blocks found, or the earlier plan's (`keep`) when it still finishes everything. */
export function search(m: Model, keep?: PlanShape): { best: { blocks: Block[]; cost: number }; kept: boolean } {
  const {
    targets,
    travel,
    T,
    W,
    index,
    races,
    F,
    start,
    swapSec,
    acts,
    K,
    amount,
    raisers,
    actIndex,
    lockOf,
    credits,
    raceFor,
    setup,
    checkGoals,
    base,
    fresh,
    reset,
    mayOpen,
    reachable,
    maxedPoint,
    below,
    counted,
    first,
    timeFor,
    apply,
    blockUnits,
    onHand,
    ending,
    valueOf,
    toNext,
    opening
  } = m

  function greedy(noise: number, random: () => number): Block[] {
    const st = fresh()
    for (let i = 0; i < T; i++) if (!reachable[i]) st.done[i] = 1
    const blocks: Block[] = []
    for (let guard = 0; guard < 1000 && st.done.includes(0); guard++) {
      let best = -Infinity
      let pick = -1
      let pickN = 0
      let pickR = 0
      let pickUse = false
      let opened: Opening | null = null
      for (let k = 0; k < K; k++) {
        if (!mayOpen[k]) continue
        const n = toNext(k, st)
        if (!Number.isFinite(n) || n <= 0) continue
        const jitter = 1 + noise * (random() - 0.5)
        const r = raceFor(k, st)
        if (r >= 0) {
          // As far as what the character holds goes, or on until the next achievement it serves is done.
          const have = onHand(k, st)
          for (const [u, use] of have > 0 && have < n
            ? ([
                [have, true],
                [n, false]
              ] as const)
            : ([[n, false]] as const)) {
            const time = Math.max(1, timeFor(k, u, st.stock, false) * acts[k].risk + setup(k, st, r))
            const score = (valueOf(k, u, st) / time) * jitter
            if (score > best) {
              best = score
              pick = k
              pickN = u
              pickR = r
              pickUse = use
              opened = null
            }
          }
          continue
        }
        // Its NPC does not take it yet: worth raising what it wants first, and then doing it?
        const o = opening(k, st)
        if (!o) continue
        const then = (acts[k].zone === acts[o.j].zone ? 0 : travel) + (o.rk > 0 && o.rk !== o.r ? swapSec : 0)
        const time = Math.max(1, o.t + timeFor(k, n, st.stock, false) * acts[k].risk + then)
        const score = ((valueOf(o.j, o.n, st) + valueOf(k, n, st)) / time) * jitter
        if (score > best) {
          best = score
          pick = o.j
          pickN = o.n
          pickR = o.r
          pickUse = false
          opened = o
        }
      }
      if (pick < 0) break
      const before = Uint8Array.from(st.done)
      timeFor(pick, pickN, st.stock, true)
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
      st.act = pick
      st.race = pickR
      checkGoals(st, 0)
      const finished: number[] = []
      for (let i = 0; i < T; i++) if (st.done[i] && !before[i] && credits(pick, i) && amount(pick, i) > 0) finished.push(i)
      const reach = opened ? [opened.reach] : []
      const last = blocks[blocks.length - 1]
      if (last && last.act === pick && !reach.length && !pickUse && !last.use) last.finish.push(...finished)
      else blocks.push({ act: pick, finish: finished, lift: [], reach, ...(pickUse ? { use: true } : {}) })
    }
    return blocks
  }

  /** The state at the end of an order of blocks. A block whose NPC no race the character can be then pleases is left out. */
  const run = (blocks: Block[], st: State) => {
    reset(st)
    let total = 0
    let flow = 0
    for (const b of blocks) {
      const n = blockUnits(b, st)
      if (n <= 0) continue
      const r = raceFor(b.act, st)
      if (r < 0) continue
      const x = acts[b.act]
      total += timeFor(b.act, n, st.stock, true) * x.risk + setup(b.act, st, r)
      st.zone = x.zone
      st.act = b.act
      st.race = r
      flow += apply(b.act, n, st) * total
      checkGoals(st, total)
    }
    return { total, flow }
  }

  // ---- simulate an order of blocks ----
  // A locked achievement another activity happened to finish on the way is in no block, so an order
  // that no longer finishes it on the way is as good as no plan.
  const sim = fresh()
  /** Whether a faction below 0 costs the goal's whole worth (the steps that bring factions back are in), or what bringing it back takes. */
  let strict = false
  function simulate(blocks: Block[]): number {
    const { total, flow } = run(blocks, sim)
    let missed = 0
    for (let i = 0; i < T; i++) if (reachable[i] && !sim.done[i]) missed += MISSED
    // Race unlocks first: when the average one is done counts too (one not done, as late as the plan ends).
    let soon = 0
    if (first) {
      for (const g of counted) soon += sim.goal[g] ? sim.goalAt[g] : total
      soon = (soon / counted.length) * UNLOCK_WEIGHT
    }
    return total + missed + flow * FLOW_WEIGHT + ending(sim, strict) + soon
  }

  // ---- the 'positive' goal: steps at the end that bring factions back to 0 or above ----
  // Each is one activity run until a faction below zero is back at 0, taken when the factions it
  // brings back are worth more than its time and what it costs the others: one it takes below 0 counts
  // what bringing that one back takes (a later step may), unless an earlier step here brought it back.
  // Once none is worth adding at the end, a step that would take another below 0 again is tried either
  // side of the step that brings that one back (see `around`).
  function addLifts(blocks: Block[]): Block[] {
    if (!W) return blocks
    let out = blocks.slice()
    const st = fresh()
    run(out, st)
    const lifted = new Uint8Array(F)
    for (let guard = 0; guard < LIFTS_MAX; guard++) {
      let best = 0
      let pick = -1
      let pickN = 0
      let pickI = -1
      let pickR = 0
      let pickSunk: number[] = []
      /** Ways that bring one back but take others below 0: worth trying before what brings those back. */
      const sinking: { k: number; i: number; sunk: number[] }[] = []
      for (let i = 0; i < F; i++) {
        if (st.s[i] >= 0) continue
        for (const k of raisers[i]) {
          const n = Math.ceil(-st.s[i] / amount(k, i) - EPS)
          if (n <= 0) continue
          const r = raceFor(k, st)
          if (r < 0) continue
          let up = 0
          let gain = 0
          let lost = 0
          const sunk: number[] = []
          for (const { i: j, h } of acts[k].touch) {
            const v = st.s[j]
            const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
            if (v < 0 && after >= 0) {
              up++
              gain += W
            } else if (after < 0) {
              gain -= v >= 0 && lifted[j] ? W : below(j, after) - below(j, v)
              if (v >= 0) sunk.push(j)
            }
            const peakAfter = st.peak[j] || after >= STANDING_MAX
            lost += ((peakAfter ? STANDING_MAX - after : 0) - (st.peak[j] ? STANDING_MAX - v : 0)) * maxedPoint[j]
          }
          if (up <= 0) continue
          if (sunk.length) sinking.push({ k, i, sunk })
          const value = gain - timeFor(k, n, st.stock, false) * acts[k].risk - setup(k, st, r) - lost
          if (value > best) {
            best = value
            pick = k
            pickN = n
            pickI = i
            pickR = r
            pickSunk = sunk
          }
        }
      }
      // Nothing worth adding at the end, or what is takes another below 0 again: either side of what
      // brings that one back may be better.
      const next = { act: pick, finish: [], lift: [pickI], reach: [] }
      const moved = !strict ? null : pick < 0 ? around(out, sinking) : pickSunk.length ? around(out, [{ k: pick, i: pickI, sunk: pickSunk }], simulate([...out, next])) : null
      if (moved) {
        out = moved.blocks
        lifted[moved.i] = 1
        run(out, st)
        continue
      }
      if (pick < 0) break
      out.push(next)
      timeFor(pick, pickN, st.stock, true)
      for (const { i: j, h } of acts[pick].touch) if (h > 0 && st.s[j] < 0 && st.s[j] + pickN * h >= 0) lifted[j] = 1
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
      st.act = pick
      st.race = pickR
      checkGoals(st, 0)
    }
    return out
  }

  /**
   * A way that brings a faction back but takes another below 0 that a step here brings back, tried
   * either side of that step, and kept where the whole plan is better for it (the best tried), else null:
   * - before it, raised past 0 as far as the steps after it take back: the clockworks for Dark Reflection
   *   while King Ak`Anon is still at -2000, where what they take off it is lost to the floor, to +800, and
   *   then the ales that bring King Ak`Anon back at 2 Dark Reflection each;
   * - after everything, that step raising its faction past 0 as far as this one takes back.
   * Better than `bar`: the plan as it is, or with the way added at the end.
   */
  function around(blocks: Block[], ways: { k: number; i: number; sunk: number[] }[], bar = simulate(blocks)): { blocks: Block[]; i: number } | null {
    let cost = bar
    let got: { blocks: Block[]; i: number } | null = null
    for (const { k, i, sunk } of ways) {
      for (let at = 0; at < blocks.length; at++) {
        const b = blocks[at]
        const j = sunk.find((f) => amount(b.act, f) > 0)
        if (!b.lift.length || j === undefined) continue
        for (const side of ['before', 'after'] as const) {
          // Raised past 0 by what the steps after took back, try after try.
          const f = side === 'before' ? i : j
          let v = 0
          for (let tries = 0; tries < 4; tries++) {
            const trial = blocks.slice()
            if (side === 'before') trial.splice(at, 0, { act: k, finish: [], lift: [i], reach: [], ...(v > 0 ? { above: [{ i, v }] } : {}) })
            else {
              if (v > 0) trial[at] = { ...b, above: [...(b.above ?? []).filter((q) => q.i !== j), { i: j, v }] }
              trial.push({ act: k, finish: [], lift: [i], reach: [] })
            }
            const c = simulate(trial)
            if (c < cost - 1e-6) {
              cost = c
              got = { blocks: trial, i }
            }
            const short = -sim.s[f]
            if (short <= 0 || v >= STANDING_MAX) break
            v = Math.min(STANDING_MAX, v + short)
          }
        }
      }
    }
    return got
  }

  /**
   * Drops each step that brings factions back whose plan is no better for it, counting a faction left
   * below 0 at the goal's whole worth: one that took another below 0 for a later step to bring back,
   * where that later step never came.
   */
  function prune(blocks: Block[]): Block[] {
    let out = blocks
    let cost = simulate(out)
    for (let j = out.length - 1; j >= 0; j--) {
      if (out[j].finish.length || !out[j].lift.length) continue
      const trial = out.filter((_, x) => x !== j)
      const c = simulate(trial)
      if (c < cost - 1e-6) {
        out = trial
        cost = c
      }
    }
    return out
  }

  // ---- local search: move blocks, drop a step that is only there for others, give an achievement to another way ----
  const alternatives = targets.map((_, i) => {
    const ways: { k: number; per: number }[] = []
    for (let k = 0; k < K; k++) if (mayOpen[k] && amount(k, i) > 0 && credits(k, i)) ways.push({ k, per: (acts[k].unit * acts[k].risk) / amount(k, i) })
    return ways
      .sort((p, q) => p.per - q.per)
      .slice(0, 6)
      .map((o) => o.k)
  })
  // For a way its NPC does not take at the start, the quickest way to open it there.
  const openers = acts.map((_, k) => (races && mayOpen[k] && raceFor(k, base) < 0 ? opening(k, base) : null))
  /**
   * Where a new block of these activities is worth trying in an order: first, last, where the block it
   * takes over from was (`at`), and beside a block in the same zone, where it needs no trip of its own.
   * The moves that follow put it anywhere else it is better.
   */
  const spots = (order: Block[], ks: number[], at: number) => {
    const out = new Set([0, order.length, Math.min(at, order.length)])
    order.forEach((b, j) => {
      if (!ks.some((k) => acts[k].zone === acts[b.act].zone)) return
      out.add(j)
      out.add(j + 1)
    })
    return [...out].sort((p, q) => p - q)
  }
  // A budget of orders tried, not of time: the same choices always give the same plan. Blocks are
  // not changed once made; a trial is a new list sharing the blocks it keeps.
  let tried = 0
  let budget = 0
  const within = () => tried < budget
  function improve(initial: Block[]): { blocks: Block[]; cost: number } {
    let blocks = initial
    let cost = simulate(blocks)
    const take = (trial: Block[]) => {
      tried++
      const c = simulate(trial)
      if (c < cost - 1e-6) {
        blocks = trial
        cost = c
        return true
      }
      return false
    }
    for (let pass = 0; pass < 8 && within(); pass++) {
      let better = false
      // Move one block elsewhere.
      for (let from = 0; from < blocks.length && within(); from++) {
        for (let to = 0; to < blocks.length; to++) {
          if (to === from) continue
          const trial = blocks.slice()
          const [b] = trial.splice(from, 1)
          trial.splice(to, 0, b)
          better = take(trial) || better
        }
      }
      // Move a block that opens a quest together with the quest's block, side by side: along the way
      // somewhere else, where its faction does not have to be raised back first.
      for (let from = 0; from < blocks.length && within(); from++) {
        const opens = blocks[from].reach.map((q) => q.for)
        const then = blocks.findIndex((b, j) => j > from && opens.includes(b.act))
        if (then < 0) continue
        const rest = blocks.filter((_, j) => j !== from && j !== then)
        for (let to = 0; to <= rest.length; to++) {
          if (to === from && then === from + 1) continue
          const trial = rest.slice()
          trial.splice(to, 0, blocks[from], blocks[then])
          better = take(trial) || better
        }
      }
      // Drop a step that finishes nothing (it brings factions back, or opens a quest), when it is not worth its time any more.
      for (let j = blocks.length - 1; j >= 0 && within(); j--) if (!blocks[j].finish.length) better = take(blocks.filter((_, x) => x !== j)) || better
      // Finish one achievement another way: in a block of that activity, or a new block anywhere, opened first where it must be.
      for (let i = 0; i < T && within(); i++) {
        if (lockOf[i] >= 0) continue
        const at = blocks.findIndex((b) => b.finish.includes(i))
        if (at < 0) continue
        for (const k of alternatives[i]) {
          if (k === blocks[at].act) continue
          const rest = blocks[at].finish.filter((x) => x !== i)
          const without = blocks.flatMap((b, j) => (j !== at ? [b] : rest.length || b.lift.length || b.reach.length ? [{ ...b, finish: rest }] : []))
          without.forEach((b, j) => {
            if (b.act !== k) return
            const t = without.slice()
            t[j] = { ...b, finish: [...b.finish, i] }
            better = take(t) || better
          })
          for (const pos of spots(without, [k], at)) {
            const t = without.slice()
            t.splice(pos, 0, { act: k, finish: [i], lift: [], reach: [] })
            better = take(t) || better
          }
          const o = openers[k]
          if (!o) continue
          for (const pos of spots(without, [o.j, k], at)) {
            const t = without.slice()
            t.splice(pos, 0, { act: o.j, finish: [], lift: [], reach: [o.reach] }, { act: k, finish: [i], lift: [], reach: [] })
            better = take(t) || better
          }
        }
      }
      if (!better) break
    }
    return { blocks, cost }
  }

  let best: { blocks: Block[]; cost: number } = { blocks: [], cost: Infinity }
  let kept = false
  const open = reachable.some((r, i) => r && start[i] < STANDING_MAX) || (W > 0 && Array.from(start).some((v, i) => v < 0 && raisers[i].length > 0))
  if (keep && open) {
    // The earlier order, less what is done and what is gone; kept when it still finishes everything.
    const blocks = keep.flatMap((b): Block[] => {
      const k = actIndex.get(b.act)
      if (k === undefined) return []
      const finish = b.finish.flatMap((f) => {
        const i = index.get(f)
        return i !== undefined && i < T && reachable[i] && start[i] < STANDING_MAX && credits(k, i) && amount(k, i) > 0 ? [i] : []
      })
      const lift = (b.lift ?? []).flatMap((f) => {
        const i = index.get(f)
        return i !== undefined && amount(k, i) > 0 ? [i] : []
      })
      const reach = (b.reach ?? []).flatMap((q) => {
        const i = index.get(q.faction)
        const to = actIndex.get(q.for)
        return i !== undefined && to !== undefined && amount(k, i) > 0 ? [{ i, v: q.to, for: to }] : []
      })
      const above = (b.above ?? []).flatMap((q) => {
        const i = index.get(q.faction)
        return i !== undefined && amount(k, i) > 0 ? [{ i, v: q.to }] : []
      })
      return finish.length || lift.length || reach.length || b.use ? [{ act: k, finish, lift, reach, ...(above.length ? { above } : {}), ...(b.use ? { use: true } : {}) }] : []
    })
    // Its steps that bring factions back are in it already.
    strict = true
    const cost = simulate(blocks)
    strict = false
    if (cost < MISSED) {
      best = { blocks, cost }
      kept = true
    }
  }
  if (!kept && K && open) {
    const random = rng(0x5eed + T * 31 + K)
    const tries: Block[][] = [addLifts(greedy(0, random))]
    for (let r = 0; r < 12; r++) tries.push(addLifts(greedy(0.35, random)))
    const ranked = tries.map((b) => ({ blocks: b, cost: simulate(b) })).sort((p, q) => p.cost - q.cost)
    const work = Math.max(5_000, Math.round(SEARCH_WORK / Math.max(10, ranked[0].blocks.length)))
    const starts = ranked.slice(0, 3)
    starts.forEach((cand, n) => {
      // Each start its share of what is left: one that settles early leaves the rest to the next.
      budget = tried + Math.ceil((work - tried) / (starts.length - n))
      const got = improve(cand.blocks)
      if (got.cost < best.cost) best = got
    })
    budget = work
    // The search may have left factions below zero that more steps would be worth bringing back. From
    // here a faction left below zero costs the goal's whole worth, so no step bringing one back is
    // dropped for the little it costs.
    if (W) {
      strict = true
      best = improve(prune(addLifts(best.blocks)))
    }
  }
  if (best.blocks.length) best = together(best)
  return { best, kept }

  /**
   * Puts a block that hands in what is held beside the later block of the same activity (the tails
   * held, then the tails still to gather), so they are one step, wherever that costs nothing.
   */
  function together(plan: { blocks: Block[]; cost: number }): { blocks: Block[]; cost: number } {
    let { blocks, cost } = plan
    let moves = 0
    for (let j = 0; j < blocks.length; j++) {
      if (!blocks[j].use) continue
      const later = blocks.findIndex((o, y) => y > j + 1 && o.act === blocks[j].act)
      if (later < 0) continue
      // The held ones moved down to the rest, or the rest moved up to the held ones.
      const down = blocks.slice()
      down.splice(later - 1, 0, down.splice(j, 1)[0])
      const up = blocks.slice()
      up.splice(j + 1, 0, up.splice(later, 1)[0])
      const best = [down, up].map((t) => ({ blocks: t, cost: simulate(t) })).sort((p, q) => p.cost - q.cost)[0]
      if (best.cost > cost + 1e-6) continue
      ;({ blocks, cost } = best)
      if (++moves > blocks.length) break
      j = -1
    }
    return { blocks, cost }
  }
}
