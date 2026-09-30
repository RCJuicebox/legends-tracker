import { STANDING_MAX, STANDING_MIN } from './core'
import { clamp } from './catalog'
import { EPS, plannable, swapSeconds, unitCopper, wayFor } from './ways'
import type { FactionPlan, PlanOption, PlanShape, PlanStep, Unplanned } from './planTypes'
import type { Block, Model } from './model'

// The plan as the Plan tab shows it (planner.ts): the order the search found (search.ts) as steps,
// each with how many, how long, what it finishes and what it moves on the way; what is left undone and
// why; and every way to raise each achievement still open.

/** The steps of the order found, and all the plan says around them. */
export function planSteps(m: Model, best: { blocks: Block[]; cost: number }, kept: boolean): FactionPlan {
  const {
    activities,
    targets,
    travel,
    T,
    names,
    index,
    races,
    F,
    start,
    lockedIds,
    raceNames,
    modOf,
    acts,
    timeOf,
    lockOf,
    staleLocks,
    credits,
    raceFor,
    setup,
    goalNames,
    checkGoals,
    fresh,
    mayOpen,
    covered,
    timeFor,
    apply,
    blockUnits,
    settings,
    choices
  } = m

  const steps: PlanStep[] = []
  const st = fresh()
  {
    for (const b of best.blocks) {
      const n = blockUnits(b, st)
      if (n <= 0) continue
      const r = raceFor(b.act, st)
      if (r < 0) continue
      const x = acts[b.act]
      const raises: Record<string, number> = {}
      const lowers: Record<string, number> = {}
      const maxedLowered: Record<string, number> = {}
      const lifts: string[] = []
      const sinks: string[] = []
      for (const { i, h } of x.touch) {
        const f = names[i]
        const v = st.s[i]
        const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
        if (i < T && !st.done[i]) {
          if (h > 0) raises[f] = Math.min(STANDING_MAX - v, n * h)
          else if (h < 0) lowers[f] = Math.min(n * -h, v - STANDING_MIN)
          continue
        }
        if (h < 0 && v >= STANDING_MAX) maxedLowered[f] = v - after
        if (v < 0 && after >= 0) lifts.push(f)
        else if (v >= 0 && after < 0) sinks.push(f)
      }
      // Done as another race: what the character's own would con there, with the first thing its NPC wants that it falls short of.
      let why: PlanStep['why']
      if (r > 0 && x.gate) {
        const g = x.gate
        for (let j = 0; j < g.i.length && !why; j++) {
          const v = st.s[g.i[j]]
          if (v < g.lo[j] || v > g.hi[j]) why = { faction: names[g.i[j]], band: g.bands[j], con: Math.round(v + modOf(0, names[g.i[j]])) }
        }
      }
      const before = Uint8Array.from(st.done)
      const goalsBefore = st.goal.slice()
      const move = x.zone === st.zone ? 0 : travel
      const swap = setup(b.act, st, r) - move
      const t = timeFor(b.act, n, st.stock, true)
      const fast = covered()
      apply(b.act, n, st)
      checkGoals(st, 0)
      const finishes = targets.flatMap((tg, i) => (st.done[i] && !before[i] ? [tg.faction] : []))
      const unlocks = goalNames.filter((_, g) => st.goal[g] && !goalsBefore[g])
      const reaches = b.reach.map((q) => {
        const g = acts[q.for].gate
        const j = g ? g.i.indexOf(q.i) : -1
        return { faction: names[q.i], to: Math.ceil(q.v - EPS), band: g && j >= 0 ? g.bands[j] : '', opens: acts[q.for].a.title }
      })
      const race = r > 0 ? (races ? raceNames[r] : x.a.swap?.[0]) : undefined
      st.zone = x.zone
      st.act = b.act
      st.race = r
      const last = steps[steps.length - 1]
      if (last && last.activity.id === x.a.id) {
        last.units += n
        last.seconds += t
        last.fromStock += fast
        last.copper += (n - fast) * unitCopper(x.a)
        last.finishes.push(...finishes)
        last.unlocks.push(...unlocks)
        last.reaches.push(...reaches)
        last.restores &&= !b.finish.length && !b.reach.length
        for (const [f, v] of Object.entries(raises)) last.raises[f] = (last.raises[f] ?? 0) + v
        for (const [f, v] of Object.entries(lowers)) last.lowers[f] = (last.lowers[f] ?? 0) + v
        for (const [f, v] of Object.entries(maxedLowered)) last.maxedLowered[f] = (last.maxedLowered[f] ?? 0) + v
        last.lifts = [...new Set([...last.lifts.filter((f) => !sinks.includes(f)), ...lifts])]
        last.sinks = [...new Set([...last.sinks.filter((f) => !lifts.includes(f)), ...sinks])]
      } else {
        steps.push({
          activity: x.a,
          units: n,
          seconds: t + move + swap,
          travel: move,
          swap,
          fromStock: fast,
          copper: (n - fast) * unitCopper(x.a),
          finishes,
          unlocks,
          reaches,
          raises,
          lowers,
          maxedLowered,
          lifts,
          sinks,
          restores: !b.finish.length && !b.reach.length,
          locked: [],
          onTheWay: {},
          ...(race ? { race } : {}),
          ...(why ? { why } : {})
        })
      }
    }
    const at = new Map(targets.map((t, i) => [t.faction, i]))
    for (const step of steps) {
      step.locked = step.finishes.filter((f) => choices.locks[f] === step.activity.id)
      for (const f of step.finishes) {
        const i = at.get(f)
        const k = i === undefined ? -1 : lockOf[i]
        if (k >= 0 && acts[k].a.id !== step.activity.id) step.onTheWay[f] = acts[k].a.title
      }
    }
  }
  const seconds = steps.reduce((n, step) => n + step.seconds, 0)
  // What nothing the planner may use gets done, as the plan stands.
  const unplanned = targets.filter((_, i) => start[i] < STANDING_MAX && !st.done[i]).map((t) => t.faction)
  const unplannedWhy: Record<string, Unplanned> = {}
  targets.forEach((t, i) => {
    if (start[i] >= STANDING_MAX || st.done[i]) return
    const ways = activities.filter((a) => (a.hits[t.faction] ?? 0) > 0)
    const usable = ways.filter((a) => lockedIds.has(a.id) || (!a.once && !choices.excluded.includes(a.id)))
    const opens = acts.some((x, k) => mayOpen[k] && credits(k, i) && x.touch.some((u) => u.i === i && u.h > 0))
    unplannedWhy[t.faction] = !ways.length
      ? 'nothing known'
      : !usable.length
        ? ways.some((a) => choices.excluded.includes(a.id))
          ? 'ruled out'
          : 'once only'
        : opens
          ? 'not reached'
          : 'gated'
  })
  let maxedLost = 0
  let belowNow = 0
  let belowAfter = 0
  for (let i = 0; i < F; i++) {
    if (st.peak[i]) maxedLost += STANDING_MAX - st.s[i]
    if (start[i] < 0) belowNow++
    if (st.s[i] < 0) belowAfter++
  }
  const shape: PlanShape = best.blocks.map((b) => ({
    act: acts[b.act].a.id,
    finish: b.finish.map((i) => names[i]),
    ...(b.lift.length ? { lift: b.lift.map((i) => names[i]) } : {}),
    ...(b.reach.length ? { reach: b.reach.map((q) => ({ faction: names[q.i], to: q.v, for: acts[q.for].a.id })) } : {})
  }))

  // ---- every way to raise each achievement still open ----
  // (the same reckoning as waysToRaise, with what the plan made of each)
  const chosenFor = new Map<string, string>()
  for (const step of steps) for (const f of step.finishes) if (!chosenFor.has(f)) chosenFor.set(f, step.activity.id)
  const used = new Set(steps.map((step) => step.activity.id))
  const stillOpen = new Set(targets.filter((_, i) => start[i] < STANDING_MAX).map((t) => t.faction))
  const options: Record<string, PlanOption[]> = {}
  for (const t of targets) if (stillOpen.has(t.faction)) options[t.faction] = []
  for (const a of activities) {
    const raised = Object.entries(a.hits).filter(([f, h]) => h > 0 && stillOpen.has(f))
    if (!raised.length) continue
    const unit = timeOf(a)
    const lowered = Object.entries(a.hits)
      .filter(([f, h]) => h < 0 && stillOpen.has(f))
      .map(([f]) => f)
    for (const [f, h] of raised)
      options[f].push({
        ...wayFor(a, h, start[index.get(f)!], unit, travel + swapSeconds(a, settings)),
        lowersOpen: lowered,
        chosen: chosenFor.get(f) === a.id,
        used: used.has(a.id)
      })
  }
  // Ways the planner may use first, quickest first; one-time and ruled-out ones after.
  const later = (o: PlanOption) => (plannable(o.activity, choices, settings.raceSwaps) ? 0 : 1)
  for (const list of Object.values(options)) list.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
  return { steps, seconds, targets, unplanned, unplannedWhy, options, staleLocks, maxedLost, belowZero: { now: belowNow, after: belowAfter }, shape, kept }
}
