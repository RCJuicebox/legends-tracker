import { STANDING_MAX, STANDING_MIN } from './core'
import { zoneKey } from './names'
import type { FactionPlan, PlanTarget } from './planTypes'
import type { FactionTrackGoal, FactionTrackView, TrackItem, TrackKind } from '../../shared/tracking'

// Following a faction plan while playing. The Plan tab hands the plan it shows to the main
// process, which keeps it per character and, as the log moves factions, works out which step is being
// worked on, how many kills or hand-ins it still wants, and when a step or an achievement is done, for
// the achievements overlay and its cues. It needs no planning of its own: a step is done when the
// achievements it is there for are (and the factions it brings back are at 0), and the steps after
// it are as the plan laid them out.

/** One step of a followed plan, as the tracker needs it. */
export interface FollowStep {
  /** The activity's id. */
  id: string
  kind: TrackKind
  title: string
  zone: string
  npc?: string
  /** What goes into one hand-in; none for a kill. */
  items?: TrackItem[]
  /** The achievements it finishes (by faction), and the factions it brings back to 0 or above. */
  finish: string[]
  lift: string[]
  /** Factions it raises to what a later step's NPC wants: the standing, and what to call it ("Miners Guild 628 for Miner's Cap"). */
  reach?: { faction: string; to: number; label: string }[]
  /** What one kill or hand-in does to each of those. */
  per: Record<string, number>
  /** As planned: kills or hand-ins, and seconds each (the trip there left out). */
  units: number
  unitSec: number
}

export interface FollowedPlan {
  /** When the Plan tab worked it out. */
  at: number
  steps: FollowStep[]
  /** Achievement names by faction, where they differ. */
  names: Record<string, string>
}

/** Where the player is in a followed plan, kept between reads. */
export interface FollowState {
  /** Steps done, by index. */
  done: number[]
  /** Achievements seen done since the plan was followed. */
  reached: string[]
  /** The step being worked on, and what it wanted when it became that step (for its progress). */
  active: number | null
  startUnits: Record<number, number>
  /**
   * What the log has moved factions the standings do not know (none in the export) since the plan was
   * followed: their standing, counted from 0 as the plan counted them, so their steps count down too.
   */
  drift: Record<string, number>
  /** False until the first read: what is done by then is where the player starts, not news. */
  synced: boolean
}

export const freshFollow = (): FollowState => ({ done: [], reached: [], active: null, startUnits: {}, drift: {}, synced: false })

/**
 * The state of a new plan, carried over from the one followed before. A plan searched again (a new
 * way read, a choice changed) keeps the step being worked on and its progress where that activity is
 * still in it, and what was done or said stays so. Steps are matched by activity, the n-th step of
 * an activity to its n-th step in the new plan.
 */
export function carryFollow(was: FollowedPlan, state: FollowState, next: FollowedPlan): FollowState {
  const keys = (p: FollowedPlan) => {
    const seen = new Map<string, number>()
    return p.steps.map((s) => {
      const n = seen.get(s.id) ?? 0
      seen.set(s.id, n + 1)
      return `${s.id}#${n}`
    })
  }
  const old = keys(was)
  const at = new Map(keys(next).map((k, i) => [k, i]))
  const moved = (i: number) => (old[i] === undefined ? undefined : at.get(old[i]))
  const done = state.done.flatMap((i) => {
    const j = moved(i)
    return j === undefined ? [] : [j]
  })
  const active = state.active === null ? undefined : moved(state.active)
  const keep = active !== undefined && !done.includes(active)
  const start = state.active === null ? undefined : state.startUnits[state.active]
  return {
    done: done.sort((a, b) => a - b),
    reached: [...state.reached],
    active: keep ? active : null,
    startUnits: keep && start !== undefined ? { [active]: start } : {},
    drift: { ...state.drift },
    synced: state.synced
  }
}

/** A step the player picked to work on now: the one followed from here, its progress counted afresh, until the faction lines go toward another. */
export const pickStep = (state: FollowState, index: number): FollowState => ({ ...state, active: index, startUnits: {} })

/** What a read finds worth saying: an achievement done, a step done (with the one to go on to). */
export type FollowEvent = { kind: 'achievement'; faction: string; name: string } | { kind: 'step'; index: number; step: FollowStep; next: FollowStep | null }

/** A plan as the Plan tab shows it, to follow. */
export function followedPlan(plan: FactionPlan, targets: PlanTarget[], at = Date.now()): FollowedPlan {
  const names: Record<string, string> = {}
  for (const t of targets) if (t.achievement !== t.faction) names[t.faction] = t.achievement
  return {
    at,
    names,
    steps: plan.steps.map((s) => {
      const a = s.activity
      const per: Record<string, number> = {}
      for (const f of [...s.finishes, ...s.lifts, ...s.reaches.map((r) => r.faction)]) if (a.hits[f]) per[f] = a.hits[f]
      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        zone: a.zone,
        ...(a.npc ? { npc: a.npc } : {}),
        ...(a.kind !== 'kill' && a.items?.length ? { items: a.items.map((it) => ({ name: it.name, count: it.count, ...(it.makes ? { makes: it.makes } : {}) })) } : {}),
        finish: s.finishes,
        lift: s.lifts,
        ...(s.reaches.length ? { reach: s.reaches.map((r) => ({ faction: r.faction, to: r.to, label: `${r.faction} for ${r.opens}` })) } : {}),
        per,
        units: s.units,
        unitSec: s.units > 0 ? Math.max(0, s.seconds - s.travel - s.swap) / s.units : 0
      }
    })
  }
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const strs = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.filter(isStr).slice(0, max) : [])
const finite = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0)

/** A followed plan as a page sent it, checked field by field; null when it is not one. */
export function sanitizeFollowedPlan(v: unknown): FollowedPlan | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.steps)) return null
  const steps: FollowStep[] = []
  for (const raw of o.steps.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const kind = s.kind === 'kill' || s.kind === 'turnin' || s.kind === 'quest' ? s.kind : null
    if (!isStr(s.id) || !kind || !isStr(s.title)) continue
    const per: Record<string, number> = {}
    if (s.per && typeof s.per === 'object') for (const [f, h] of Object.entries(s.per as Record<string, unknown>)) if (typeof h === 'number' && Number.isFinite(h) && h) per[f] = h
    const items = (Array.isArray(s.items) ? s.items : []).slice(0, 10).flatMap((r: unknown): TrackItem[] => {
      const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : null
      return o && isStr(o.name) && o.name
        ? [{ name: o.name.slice(0, 120), count: Math.max(1, Math.round(finite(o.count, 1, 1e6))), ...(isStr(o.makes) && o.makes ? { makes: o.makes.slice(0, 120) } : {}) }]
        : []
    })
    const reach = (Array.isArray(s.reach) ? s.reach : []).slice(0, 20).flatMap((r: unknown) => {
      const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : null
      return o && isStr(o.faction) && isStr(o.label) && typeof o.to === 'number' && Number.isFinite(o.to)
        ? [{ faction: o.faction.slice(0, 120), to: finite(o.to, STANDING_MIN, STANDING_MAX), label: o.label.slice(0, 300) }]
        : []
    })
    steps.push({
      id: s.id.slice(0, 300),
      kind,
      title: s.title.slice(0, 300),
      zone: isStr(s.zone) ? s.zone.slice(0, 120) : '',
      ...(isStr(s.npc) ? { npc: s.npc.slice(0, 120) } : {}),
      ...(items.length ? { items } : {}),
      finish: strs(s.finish),
      lift: strs(s.lift),
      ...(reach.length ? { reach } : {}),
      per,
      units: Math.round(finite(s.units, 0, 1e7)),
      unitSec: finite(s.unitSec, 0, 86_400)
    })
  }
  const names: Record<string, string> = {}
  if (o.names && typeof o.names === 'object') for (const [f, n] of Object.entries(o.names as Record<string, unknown>)) if (isStr(n)) names[f] = n.slice(0, 200)
  return { at: finite(o.at, 0, 1e15), steps, names }
}

/** Where the player is in a plan of `steps` steps, as a file kept it, checked field by field. */
export function sanitizeFollowState(v: unknown, steps: number): FollowState {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const step = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < steps
  const startUnits: Record<number, number> = {}
  if (o.startUnits && typeof o.startUnits === 'object')
    for (const [k, n] of Object.entries(o.startUnits as Record<string, unknown>))
      if (step(Number(k)) && typeof n === 'number' && Number.isFinite(n) && n > 0) startUnits[Number(k)] = n
  const drift: Record<string, number> = {}
  if (o.drift && typeof o.drift === 'object')
    for (const [f, n] of Object.entries(o.drift as Record<string, unknown>).slice(0, 500))
      if (f && f.length <= 120 && typeof n === 'number' && Number.isFinite(n) && n) drift[f] = finite(n, 2 * STANDING_MIN, 2 * STANDING_MAX)
  return {
    done: [...new Set(Array.isArray(o.done) ? o.done.filter(step) : [])].sort((a, b) => a - b),
    reached: strs(o.reached, 500),
    active: step(o.active) ? o.active : null,
    startUnits,
    drift,
    synced: o.synced === true
  }
}

/** A file of followed plans by character, each checked; what does not hold a plan is dropped. */
export function sanitizeFollows(v: unknown): Record<string, { plan: FollowedPlan; state: FollowState }> {
  const out: Record<string, { plan: FollowedPlan; state: FollowState }> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [character, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!character || character.length > 64 || !raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const plan = sanitizeFollowedPlan(r.plan)
    if (plan) out[character] = { plan, state: sanitizeFollowState(r.state, plan.steps.length) }
  }
  return out
}

/** What a read of the standings makes of a followed plan. */
export interface FollowRead {
  state: FollowState
  view: FactionTrackView
  events: FollowEvent[]
}

/**
 * Where the player is in a followed plan. `standings` are where the factions stand now; `done` the
 * achievements (by faction) known done whatever the standing (the achievements export, or the game
 * saying so). `zone` is where the player is and `moved` what the last faction lines did, so the step
 * worked on is the one the player is doing, not only the first one left.
 */
export function readFollow(
  plan: FollowedPlan,
  was: FollowState,
  standings: Record<string, number>,
  done: Set<string>,
  opts: { zone?: string; moved?: Record<string, number> } = {}
): FollowRead {
  const moved = opts.moved ?? {}
  // A faction with no standing known counts from what the log moved it since the plan was followed.
  const drift = { ...was.drift }
  for (const [f, n] of Object.entries(moved)) if (standings[f] === undefined && n) drift[f] = (drift[f] ?? 0) + n
  for (const f of Object.keys(drift)) if (standings[f] !== undefined) delete drift[f]
  const state: FollowState = { done: [...was.done], reached: [...was.reached], active: was.active, startUnits: { ...was.startUnits }, drift, synced: true }
  const events: FollowEvent[] = []
  const reached = new Set(state.reached)
  const standing = (f: string) => Math.max(STANDING_MIN, Math.min(STANDING_MAX, standings[f] ?? drift[f] ?? 0))
  const isDone = (f: string) => reached.has(f) || done.has(f) || standing(f) >= STANDING_MAX
  for (const s of plan.steps)
    for (const f of s.finish) {
      if (reached.has(f) || !isDone(f)) continue
      reached.add(f)
      if (was.synced) events.push({ kind: 'achievement', faction: f, name: plan.names[f] ?? f })
    }
  state.reached = [...reached]

  const doneSteps = new Set(state.done)
  // A faction a step brings back to 0 is one the steps before it lower: at 0 or above before they are
  // done, it has not been lowered yet, and the step is still to come.
  const complete = (s: FollowStep, i: number) =>
    s.finish.every(isDone) &&
    (!s.lift.length || plan.steps.every((_, j) => j >= i || doneSteps.has(j))) &&
    s.lift.every((f) => standing(f) >= 0) &&
    (s.reach ?? []).every((r) => standing(r.faction) >= r.to)
  plan.steps.forEach((s, i) => {
    if (doneSteps.has(i) || !complete(s, i)) return
    doneSteps.add(i)
  })
  const open = (i: number) => !doneSteps.has(i)
  const unitsLeft = (s: FollowStep) => {
    let n = 0
    for (const f of s.finish) if (!isDone(f) && s.per[f] > 0) n = Math.max(n, Math.ceil((STANDING_MAX - standing(f)) / s.per[f] - 1e-9))
    for (const f of s.lift) if (standing(f) < 0 && s.per[f] > 0) n = Math.max(n, Math.ceil(-standing(f) / s.per[f] - 1e-9))
    for (const r of s.reach ?? []) if (standing(r.faction) < r.to && s.per[r.faction] > 0) n = Math.max(n, Math.ceil((r.to - standing(r.faction)) / s.per[r.faction] - 1e-9))
    return n
  }

  // The step being worked on: the one the last faction lines went the way of, else the one worked on
  // before, else the first left here, else the first left. Where several steps' factions moved their
  // way, the one whose own amounts the lines match goes first (a hand-in moving three factions is the
  // step of that hand-in, not the first step wanting one of them), then the one worked on before, then
  // one in this zone, then the earliest.
  const here = opts.zone ? zoneKey(opts.zone) : ''
  const order = plan.steps.map((_, i) => i).filter(open)
  const inZone = (i: number) => !!here && zoneKey(plan.steps[i].zone) === here
  let active: number | null = null
  if (Object.keys(moved).length) {
    const fit = (s: FollowStep) => {
      let n = 0
      for (const [f, per] of Object.entries(s.per)) {
        const m = moved[f]
        if (!m || !per) continue
        if (Math.sign(m) !== Math.sign(per)) {
          n -= 2
          continue
        }
        // Lines since the last read may be several of the step's units.
        const units = m / per
        n += Math.abs(units - Math.round(units)) < 0.05 ? 3 : 1
      }
      return n
    }
    const rank = (i: number) => (i === was.active ? 0 : inZone(i) ? 1 : 2)
    const doing = order
      .map((i) => ({ i, fit: fit(plan.steps[i]) }))
      .filter((d) => d.fit > 0)
      .sort((a, b) => b.fit - a.fit || rank(a.i) - rank(b.i) || a.i - b.i)
    active = doing[0]?.i ?? null
  }
  if (active === null && state.active !== null && open(state.active)) active = state.active
  if (active === null) active = order.find(inZone) ?? order[0] ?? null

  // Steps done since the last read: said once, with the one to go on to.
  const newlyDone = [...doneSteps].filter((i) => !was.done.includes(i)).sort((a, b) => a - b)
  const nextOf = (i: number | null) => (i === null ? null : (order.find((j) => j > i) ?? order.find((j) => j !== i) ?? null))
  if (was.synced) for (const i of newlyDone) events.push({ kind: 'step', index: i, step: plan.steps[i], next: active !== null ? plan.steps[active] : null })
  state.done = [...doneSteps].sort((a, b) => a - b)

  let current: FactionTrackView['current'] = null
  let secondsLeft = 0
  if (active !== null) {
    const s = plan.steps[active]
    const left = unitsLeft(s)
    const start = Math.max(state.active === active ? (state.startUnits[active] ?? left) : left, left, 1)
    state.startUnits = { [active]: start }
    const goals: FactionTrackGoal[] = [
      ...s.finish.map((f) => ({ faction: f, ...(plan.names[f] ? { achievement: plan.names[f] } : {}), standing: standing(f), to: STANDING_MAX, done: isDone(f) })),
      ...s.lift.map((f) => ({ faction: f, standing: standing(f), to: 0, done: standing(f) >= 0 })),
      ...(s.reach ?? []).map((r) => ({ faction: r.faction, achievement: r.label, standing: standing(r.faction), to: r.to, done: standing(r.faction) >= r.to }))
    ]
    current = {
      index: active,
      id: s.id,
      kind: s.kind,
      title: s.title,
      zone: s.zone,
      ...(s.npc ? { npc: s.npc } : {}),
      ...(s.items?.length ? { items: s.items } : {}),
      unitsLeft: left,
      secondsLeft: left * s.unitSec,
      progress: Math.max(0, Math.min(1, 1 - left / start)),
      goals
    }
    secondsLeft += current.secondsLeft
  } else state.startUnits = {}
  state.active = active
  // Each step still to do at what it still wants, never more than planned; a step that brings factions
  // back from below 0 at what was planned, since the lowering comes first.
  for (const i of order) {
    const s = plan.steps[i]
    if (i !== active) secondsLeft += (s.lift.length ? s.units : Math.min(s.units, unitsLeft(s))) * s.unitSec
  }
  const n = nextOf(active)
  const ns = n === null ? null : plan.steps[n]
  const next =
    n === null || !ns ? null : { index: n, kind: ns.kind, title: ns.title, zone: ns.zone, ...(ns.npc ? { npc: ns.npc } : {}), ...(ns.items?.length ? { items: ns.items } : {}) }
  return { state, view: { steps: plan.steps.length, done: state.done.length, current, next, secondsLeft }, events }
}

/** A step said aloud: "the kill camp in West Freeport", "hand-ins to Mojax Hikspin in West Commonlands". */
export function sayStep(s: Pick<FollowStep, 'kind' | 'title' | 'zone' | 'npc'>): string {
  const where = s.zone ? ` in ${s.zone}` : ''
  if (s.kind === 'kill') return `the kill camp${where}`
  if (s.kind === 'turnin') return `hand-ins to ${s.npc ?? s.title}${where}`
  return `${s.title}${where}`
}
