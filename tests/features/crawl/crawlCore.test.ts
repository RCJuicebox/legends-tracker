import { describe, expect, it } from 'vitest'
import ROUTES from '../../../src/shared/game/crawlRoutes.json'
import {
  crawlView,
  floorOf,
  isInstance,
  legFloors,
  legPieces,
  newRun,
  parseMapLines,
  rareCon,
  readRunLine,
  routeMarks,
  routeOf,
  slainMob,
  stopStates,
  type CrawlRoute,
  type CrawlRoutes,
  type CrawlRun
} from '../../../src/features/crawl/core'

// A Dungeon Crawl route read: floors by height, the way as pieces a map draws, the marks for the
// game's map, and a run followed from the log's lines. A small route made here, and the shipped one
// (Kedge Keep, as scripts/crawl-routes.mjs wrote it) checked for what every route must be.

const rare = (name: string, more: Partial<CrawlRoute['stops'][number]['rares'][number]> = {}) => ({ name, why: 'hunter' as const, chance: 20, spots: 1, ...more })
const route: CrawlRoute = {
  name: 'Kedge Keep',
  start: [0, 0, 300],
  floors: [
    { name: 'Top', from: 200 },
    { name: 'Middle', from: 0 },
    { name: 'Bottom', from: null }
  ],
  stops: [
    { at: [10, 0, 300], rares: [rare('a fierce impaler')], spots: [[10, 0, 300]], leg: [0, 0, 300, 10, 0, 300], length: 10 },
    {
      at: [10, 0, 50],
      rares: [rare('Coralyn Kelpmaiden'), rare('tainted seahorse', { why: 'guess', chance: 8, far: true })],
      spots: [[10, 0, 50]],
      far: [[60, 0, 40]],
      leg: [10, 0, 300, 10, 0, 210, 10, 0, 50],
      length: 250
    },
    { at: [10, 40, -80], rares: [rare('Undertow'), rare('tainted seahorse', { why: 'guess', chance: 10 })], spots: [[10, 40, -80]], leg: [10, 0, 50, 10, 40, -80], length: 136 },
    { at: [90, 40, -80], rares: [rare('Cauldronboil')], spots: [[90, 40, -80]], leg: [10, 40, -80, 90, 40, -80], length: 80 }
  ],
  dist: [
    [0, 10, 260, 396, 476],
    [0, 0, 250, 386, 466],
    [0, 250, 0, 136, 216],
    [0, 386, 136, 0, 80],
    [0, 466, 216, 80, 0]
  ]
}

const follow = (run: CrawlRun, ...lines: string[]) => lines.reduce((r, text, i) => readRunLine(route, r, text, 1000 + i), run)

describe('a crawl route', () => {
  it('is found by its zone or an instance of it', () => {
    const routes: CrawlRoutes = { kedge: route }
    expect(routeOf(routes, 'Kedge Keep 1 (Awakened)')?.short).toBe('kedge')
    expect(routeOf(routes, 'Kedge Keep - Group 4 (Refined)')?.route).toBe(route)
    expect(routeOf(routes, 'Befallen')).toBeUndefined()
    expect(routeOf(routes, '')).toBeUndefined()
    expect(isInstance('Kedge Keep 1 (Awakened)')).toBe(true)
    expect(isInstance("Nagafen's Lair - Solo 4 (Refined)")).toBe(true)
    expect(isInstance('Kedge Keep')).toBe(false)
  })

  it('puts a height on its floor, and cuts the way into pieces by floor', () => {
    expect([300, 200, 199, 0, -1, -500].map((z) => floorOf(route, z))).toEqual([0, 0, 1, 1, 2, 2])
    expect(legPieces(route).map((p) => [p.stop, p.floor])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 2],
      [3, 2]
    ])
    expect(legFloors(route, 1)).toEqual([0, 1])
    // A short dip across a floor's edge mid-leg is no change of floor; the piece keeps its own floor's colour.
    const dip: CrawlRoute = { ...route, stops: [{ ...route.stops[0], leg: [0, 0, 100, 100, 0, 100, 100, 0, 5, 110, 0, -5, 120, 0, 5, 300, 0, 5] }] }
    expect(legFloors(dip, 0)).toEqual([1])
    expect(legPieces(dip).map((p) => [p.floor, p.level])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1],
      [1, 1]
    ])
    const deep: CrawlRoute = { ...route, stops: [{ ...route.stops[0], leg: [0, 0, 100, 100, 0, 100, 100, 0, -20, 110, 0, -30, 120, 0, 100, 300, 0, 100] }] }
    expect(legPieces(deep).map((p) => [p.floor, p.level])).toEqual([
      [1, 1],
      [1, 1],
      [2, 1],
      [1, 1],
      [1, 1]
    ])
    expect(legFloors(route, 3)).toEqual([2])
  })

  it('becomes lines and numbered labels for the game’s map, each floor in its colour', () => {
    const marks = routeMarks(route)
    expect(marks).toHaveLength(5 + 4)
    expect(marks[0]).toBe('L 0.0000, 0.0000, 300.0000, 10.0000, 0.0000, 300.0000, 255, 90, 90')
    expect(marks[2]).toMatch(/^L 10\.0000, 0\.0000, 210\.0000, 10\.0000, 0\.0000, 50\.0000, 255, 165, 30$/)
    // A label: the stop's number and its own rares, the long-odds ones left out, no article, no spaces.
    expect(marks[5]).toBe('P 10.0000, 0.0000, 300.0000, 255, 90, 90, 3, 1_fierce_impaler')
    expect(marks[6]).toBe('P 10.0000, 0.0000, 50.0000, 255, 165, 30, 3, 2_Coralyn_Kelpmaiden')
    expect(marks[7]).toMatch(/3_Undertow\/tainted_seahorse$/)
  })

  it('reads the game’s map lines with their heights', () => {
    expect(parseMapLines('L 1.4, 2.6, 3, 4, 5, 6, 0, 0, 0\r\nP 1, 2, 3, 0, 0, 0, 2, x\nL 1, 1, 1, 1, 1, 1, 0, 0, 0\nL a, 1, 1, 2, 1, 1, 0, 0, 0')).toEqual([1, 3, 3, 4, 5, 6])
  })
})

describe('a crawl run', () => {
  it('reads kills and rare /cons from the log’s lines', () => {
    expect(rareCon('Auraline - a rare creature - glares at you threateningly -- looks like quite a gamble. (Lvl: 50)')).toBe('Auraline')
    expect(rareCon('A lancer swordfish scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 30)')).toBeNull()
    expect(slainMob('You have slain Undertow!')).toBe('Undertow')
    expect(slainMob('Cauldronbubble has been slain by Jabartik!')).toBe('Cauldronbubble')
    expect(slainMob('You say, Undertow died.')).toBe('You say, Undertow')
    expect(slainMob('You begin casting Blade Dance')).toBeNull()
  })

  it('ticks a stop when a rare that pops nowhere else dies, and points at the next', () => {
    const start = newRun('Kedge Keep 1 (Awakened)', 500)
    expect(stopStates(route, start)).toEqual({ visitedAt: [0, 0, 0, 0], last: -1, next: 0 })
    // A common mob, and a line that says nothing: the same run back.
    expect(follow(start, 'You have slain a lancer swordfish!', 'You begin casting Blade Dance.')).toBe(start)
    const one = follow(start, 'You have slain a fierce impaler!')
    expect(stopStates(route, one)).toEqual({ visitedAt: [1000, 0, 0, 0], last: 0, next: 1 })
    // A rare of two stops says nothing of where it died: ticked by name, no stop visited.
    const two = follow(one, 'Tainted seahorse has been slain by Jabartik!')
    expect(two.killed).toEqual({ 'fierce impaler': 1000, 'tainted seahorse': 1000 })
    expect(stopStates(route, two).next).toBe(1)
    // Stop 2 passed over (nothing up there), stop 3 done: the next is 4, and 2 is listed as passed.
    const three = follow(two, 'You have slain Undertow!')
    const view = crawlView(route, three, three.instance)
    expect(view).toMatchObject({ route: 'Kedge Keep', stops: 4, visited: 2, rares: 5, killed: 3 })
    expect(view.next).toEqual({ n: 4, floor: 'Bottom', rares: [{ name: 'Cauldronboil' }], length: 80 })
    expect(view.ahead).toEqual([])
    expect(view.passed).toEqual([{ n: 2, floor: 'Middle', rares: [{ name: 'Coralyn Kelpmaiden' }], length: 250 }])
  })

  it('lists what is ahead, a rare a /con saw up, and one the route does not know', () => {
    const run = follow(
      newRun('Kedge Keep 1 (Awakened)', 500),
      'Tainted seahorse - a rare creature - scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 51)',
      'A golden haired mermaid - a rare creature - scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 40)'
    )
    const view = crawlView(route, run, run.instance)
    expect(view.next).toEqual({ n: 1, floor: 'Top', rares: [{ name: 'a fierce impaler' }], length: 10 })
    // A long-odds rare shows at its far stop only once a /con saw it up.
    expect(view.ahead.map((r) => r.rares)).toEqual([
      [{ name: 'Coralyn Kelpmaiden' }, { name: 'tainted seahorse', up: true }],
      [{ name: 'Undertow' }, { name: 'tainted seahorse', up: true }],
      [{ name: 'Cauldronboil' }]
    ])
    expect(view.also).toEqual(['golden haired mermaid'])
    // Killed: off the list of those up, and counted though the route does not know it.
    const after = follow(run, 'You have slain a golden haired mermaid!', 'You have slain a golden haired mermaid!')
    expect(crawlView(route, after, after.instance)).toMatchObject({ also: [], killed: 1 })
    // A rare conned again after it died stays dead.
    expect(follow(after, 'A golden haired mermaid - a rare creature - scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 40)')).toBe(after)
  })

  it('ends when the game says the crawl is completed, and with every stop visited has no next', () => {
    const run = follow(
      newRun('Kedge Keep 1 (Awakened)', 500),
      'You have slain a fierce impaler!',
      'You have slain Coralyn Kelpmaiden!',
      'You have slain Undertow!',
      'You have slain Cauldronboil!'
    )
    expect(crawlView(route, run, run.instance).next).toBeUndefined()
    const done = follow(run, 'You have completed the Dungeon Crawl and earned reward loot!')
    expect(crawlView(route, done, done.instance).done).toBe(true)
    expect(crawlView(route, null, 'Kedge Keep 1 (Awakened)')).toMatchObject({ visited: 0, killed: 0, next: { n: 1 } })
  })
})

describe('the shipped routes', () => {
  const routes = ROUTES.zones as unknown as CrawlRoutes
  it.each(Object.entries(routes))('%s: every leg starts where the one before ended and ends at its stop’s floor', (_short, r) => {
    expect(r.stops.length).toBeGreaterThan(0)
    expect(r.floors.at(-1)?.from).toBeNull()
    expect(r.dist).toHaveLength(r.stops.length + 1)
    let at = r.start
    r.stops.forEach((s, i) => {
      expect(s.leg.length % 3).toBe(0)
      // A leg starts within a few cells of where the last ended (points sit at cell centres).
      expect(Math.hypot(s.leg[0] - at[0], s.leg[1] - at[1], s.leg[2] - at[2])).toBeLessThan(30)
      expect(Math.hypot(s.leg.at(-3)! - s.at[0], s.leg.at(-2)! - s.at[1], s.leg.at(-1)! - s.at[2])).toBeLessThan(30)
      expect(s.rares.some((x) => !x.far)).toBe(true)
      expect(r.dist[i][i + 1]).toBeGreaterThan(0)
      at = s.at
    })
  })

  it('Kedge Keep’s has the game’s Hunter list among its rares', () => {
    const names = routes['kedge'].stops.flatMap((s) => s.rares.map((x) => x.name))
    for (const n of [
      'Cauldronboil',
      'Coralyn Kelpmaiden',
      'a ferocious hammerhead',
      'a fierce impaler',
      'a frenzied cauldron shark',
      'a seahorse matriarch',
      'a seahorse patriarch',
      'Shellara Ebbhunter',
      'Undertow'
    ])
      expect(names).toContain(n)
  })
})
