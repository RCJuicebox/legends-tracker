import { baseZone, zoneKey } from './zones'

// One zone view across the three planners (FEAT-031): the faction plan followed, Plan › Slayer and the
// Hunter achievements each say where to go, and until now met only on the overlay as three sections.
// Grouped by zone, each zone says what all three want there and about how long it all takes; the
// zones that most of them want, and the longest, come first. It does not re-plan the route: each
// planner keeps its own order (the faction plan's steps, the Banestrike tiers).

export type RoutePlanner = 'faction' | 'slayer' | 'hunter'

/** One thing a planner wants done in a zone: a step, or a Hunter achievement's named left. */
export interface RoutePart {
  planner: RoutePlanner
  zone: string
  /** "Step 3: kill a gnoll pup", "Hunter of Befallen: 2 named". */
  title: string
  /** About how long it takes there; 0 when nothing says. */
  seconds: number
}

export interface RouteZone {
  zone: string
  /** What each planner wants there, in its own order. */
  parts: RoutePart[]
  /** How many of the planners want something there. */
  planners: number
  seconds: number
}

/** The zones the planners want, the most-wanted and longest first; `limit` keeps the first so many. */
export function routeByZone(parts: readonly RoutePart[], limit = 12): RouteZone[] {
  const by = new Map<string, RouteZone>()
  for (const p of parts) {
    const k = zoneKey(baseZone(p.zone))
    if (!k) continue
    const z = by.get(k) ?? { zone: baseZone(p.zone), parts: [], planners: 0, seconds: 0 }
    z.parts.push(p)
    z.seconds += p.seconds
    by.set(k, z)
  }
  for (const z of by.values()) z.planners = new Set(z.parts.map((p) => p.planner)).size
  return [...by.values()].sort((a, b) => b.planners - a.planners || b.seconds - a.seconds || a.zone.localeCompare(b.zone)).slice(0, limit)
}

/** The zone the player is in, among the route's; null when no planner wants anything there. */
export function routeHere(route: readonly RouteZone[], zone: string): RouteZone | null {
  const k = zoneKey(baseZone(zone))
  return (k && route.find((z) => zoneKey(z.zone) === k)) || null
}
