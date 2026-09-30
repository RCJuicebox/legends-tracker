import { STANDING_MAX } from './core'
import type { PlanChoices, PlanSettings } from '../../shared/settings'
import type { PlanActivity } from './catalog'

// How long a kill or a hand-in takes (unitTime), and every way to raise a faction to 2000 with one
// activity alone (waysToRaise): the Standings tab lists them, and the plan's options are them. The
// assumptions they are reckoned with are kept in settings.json (shared/settings.ts); DEFAULT_SETTINGS
// are a player's who has changed none.

export const KEEP_MAXED = { off: 0, light: 0.1, strong: 0.5 } as const

export const DEFAULT_SETTINGS: PlanSettings = {
  travelMin: 10,
  killsPerHour: 80,
  namedRespawnMin: 20,
  handInSec: 3,
  gatherSec: 45,
  unknownSec: 60,
  keepMaxed: KEEP_MAXED.light,
  goal: 'fastest',
  positiveHours: 3,
  raceSwaps: true,
  swapMin: 5,
  unlocksFirst: false
}

/** Buying one item from a merchant, in stacks. */
const BUY_ITEM_SEC = 0.15

export const NO_CHOICES: PlanChoices = { locks: {}, excluded: [], perHour: {} }

export interface UnitTime {
  /** Seconds for one kill or hand-in, getting what goes in included. */
  seconds: number
  /** Seconds while what goes in is on hand: just the hand-in. */
  handSeconds: number
  from: 'yours' | 'log' | 'estimate'
}

/** How long one kill or hand-in takes, and where the figure comes from. */
export function unitTime(a: PlanActivity, s: PlanSettings, choices: PlanChoices = NO_CHOICES): UnitTime {
  const own = choices.perHour[a.id]
  if (own > 0) return { seconds: 3600 / own, handSeconds: 3600 / own, from: 'yours' }
  if (a.kind === 'kill') {
    const respawn = (n: number) => n * (60 / Math.max(1, s.namedRespawnMin))
    const pace = a.measured ?? (a.common ? s.killsPerHour : Math.min(s.killsPerHour, respawn(a.named || 1)))
    // A few spawns go at their respawn once killed, however quickly the log saw the first of them go.
    const perHour = a.few ? Math.min(pace, respawn(a.few)) : pace
    const sec = 3600 / Math.max(0.1, perHour)
    return { seconds: sec, handSeconds: sec, from: a.measured ? 'log' : 'estimate' }
  }
  const hand = (a.measured ? Math.max(0.05, 3600 / a.measured) : s.handInSec) * (a.handIns ?? 1)
  const from = a.measured ? 'log' : 'estimate'
  const items = a.items ?? []
  if (!items.length) return { seconds: Math.max(hand, s.unknownSec), handSeconds: hand, from }
  let get = 0
  for (const it of items) {
    if (it.sec) get += it.sec * it.count
    else if (it.how === 'bought' || it.how === 'vendor') get += BUY_ITEM_SEC * it.count
    else if (it.how === 'drop') get += (it.named ? (s.namedRespawnMin * 60) / it.named : s.gatherSec) * it.count
    else if (it.how === 'crafted') get += s.gatherSec * it.count
    else if (it.how === 'unknown') get += s.unknownSec
  }
  return { seconds: hand + get, handSeconds: hand, from }
}

/** The copper a hand-in's bought items cost, from what the character last paid. */
export const unitCopper = (a: PlanActivity) => (a.items ?? []).reduce((n, it) => n + (it.how === 'bought' ? (it.each ?? 0) * it.count : 0), 0)

export const EPS = 1e-9
/**
 * Whether the planner may use an activity: not ruled out and not once only, unless locked in. One whose
 * NPC does not take it yet is the planner's when it knows what the NPC wants (it may raise a faction to
 * get there, or swap race), or, without that, when another race opens it and `swaps` plans race swaps.
 */
export const plannable = (a: PlanActivity, choices: PlanChoices, swaps = false) => {
  const locked = Object.values(choices.locks).includes(a.id)
  return locked || (!a.once && !choices.excluded.includes(a.id) && (!a.blocked || !!a.gate?.length || (swaps && !!a.swap?.length)))
}

/** Seconds to swap race in Loadouts for an activity and back: one its own race's con keeps closed and another's opens, when swaps are planned; else 0. */
export const swapSeconds = (a: PlanActivity, s: PlanSettings) => (s.raceSwaps && a.blocked && a.swap?.length ? Math.max(0, s.swapMin) * 60 : 0)

/** One way to raise a faction to 2000 from where it stands, with this alone: how many, and how long with the trip there. */
export interface Way {
  activity: PlanActivity
  units: number
  seconds: number
  unitSeconds: number
  rateFrom: UnitTime['from']
}

/** A way to raise a faction by `h` a unit from `standing` to 2000: what the character holds goes first, as in the plan. */
export function wayFor(a: PlanActivity, h: number, standing: number, unit: UnitTime, travel: number): Way {
  const units = Math.max(0, Math.ceil((STANDING_MAX - standing) / h - EPS))
  const onHand = a.items?.length === 1 && a.items[0].have ? Math.min(units, Math.floor(a.items[0].have / a.items[0].count)) : 0
  return { activity: a, units, seconds: onHand * unit.handSeconds + (units - onHand) * unit.seconds + travel, unitSeconds: unit.seconds, rateFrom: unit.from }
}

/** Every way the catalog knows to raise a faction to 2000 from where it stands: the ones the planner may use first, quickest first. */
export function waysToRaise(activities: PlanActivity[], faction: string, standing: number, settings: PlanSettings, choices: PlanChoices = NO_CHOICES): Way[] {
  const ways = activities.flatMap((a) => {
    const h = a.hits[faction]
    return h > 0 ? [wayFor(a, h, standing, unitTime(a, settings, choices), settings.travelMin * 60 + swapSeconds(a, settings))] : []
  })
  const later = (w: Way) => (plannable(w.activity, choices, settings.raceSwaps) ? 0 : 1)
  return ways.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
}
