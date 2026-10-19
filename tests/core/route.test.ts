import { describe, expect, it } from 'vitest'
import { routeByZone, routeHere, type RoutePart } from '../../src/core/route'

describe('one zone view across the planners (FEAT-031)', () => {
  const parts: RoutePart[] = [
    { planner: 'faction', zone: 'Befallen', title: 'Faction step 1: kill a skeleton', seconds: 1200 },
    { planner: 'slayer', zone: 'Befallen 2 (Adaptive)', title: 'Slayer step 1: Bonecrusher', seconds: 3600 },
    { planner: 'hunter', zone: 'The Ocean of Tears', title: 'Hunter of The Ocean of Tears: 1 named', seconds: 1470 },
    { planner: 'slayer', zone: 'Neriak - Commons', title: 'Slayer step 2: Dark Elves', seconds: 7200 },
    { planner: 'hunter', zone: 'Befallen', title: 'Hunter of Befallen: 2 named', seconds: 2400 }
  ]

  it('groups by zone, instances folded in, the zones more planners want first, then the longest', () => {
    const route = routeByZone(parts)
    expect(route.map((z) => [z.zone, z.planners, z.seconds])).toEqual([
      ['Befallen', 3, 7200],
      ['Neriak - Commons', 1, 7200],
      ['The Ocean of Tears', 1, 1470]
    ])
    expect(routeByZone(parts, 1)).toHaveLength(1)
  })

  it('finds the zone the player is in, however the log names it', () => {
    const route = routeByZone(parts)
    expect(routeHere(route, 'Befallen 3 (Refined)')?.parts.map((p) => p.planner)).toEqual(['faction', 'slayer', 'hunter'])
    expect(routeHere(route, 'Qeynos Hills')).toBeNull()
  })
})
