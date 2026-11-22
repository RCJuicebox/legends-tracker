import { describe, expect, it } from 'vitest'
import ROUTES from '../../../src/shared/game/crawlRoutes.json'
import {
  campIsLow,
  campLetter,
  campLevels,
  campMarks,
  campSpots,
  crawlCue,
  crawlView,
  createdInstance,
  floorOf,
  isInstance,
  legFloors,
  legPieces,
  newRun,
  parseMapLines,
  rareCon,
  readRunLine,
  routeClimbs,
  routeMarks,
  routeOf,
  slainMob,
  stopStates,
  wayFloors,
  type CrawlCamp,
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
    // A base instance made from a Solo or Group entrance says so in its name; one made of the zone itself does not.
    expect(isInstance("Nagafen's Lair - Solo")).toBe(true)
    expect(isInstance('Kedge Keep - Group')).toBe(true)
    expect(createdInstance('Player Kelwyn creating instance Kedge Keep 1360.')).toBe('Kedge Keep')
    expect(createdInstance('Kelwyn has been removed from Kedge Keep.')).toBeNull()
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
    // A stop the way drops (or climbs) from says so: a height filter hides the line from there.
    expect(marks[5]).toBe('P 10.0000, 0.0000, 300.0000, 255, 90, 90, 3, 1_fierce_impaler_then_down')
    expect(marks[6]).toBe('P 10.0000, 0.0000, 50.0000, 255, 165, 30, 3, 2_Coralyn_Kelpmaiden_then_down')
    expect(marks[7]).toMatch(/3_Undertow\/tainted_seahorse$/)
  })

  it('says up or down where the way climbs or drops between stops', () => {
    // Along, a shaft down in two pieces, along, a short step up (too small to say), a slope too gentle to say, then up.
    const leg = [0, 0, 300, 40, 0, 300, 40, 0, 250, 44, 0, 100, 90, 0, 100, 90, 0, 116, 150, 0, 130, 150, 4, 190]
    const hilly: CrawlRoute = { ...route, stops: [{ ...route.stops[0], leg }] }
    expect(routeClimbs(hilly)).toEqual([
      { at: [40, 0, 300], up: false },
      { at: [150, 0, 130], up: true }
    ])
    expect(routeMarks(hilly).slice(-3)).toEqual([
      'P 10.0000, 0.0000, 300.0000, 255, 90, 90, 3, 1_fierce_impaler',
      'P 40.0000, 0.0000, 300.0000, 255, 90, 90, 2, down',
      'P 150.0000, 0.0000, 130.0000, 255, 165, 30, 2, up'
    ])
    // The first leg starts at the zone-in, which has no label of its own to say it on.
    expect(routeClimbs({ ...route, stops: [{ ...route.stops[0], leg: [0, 0, 300, 0, 0, 200] }] })).toEqual([{ at: [0, 0, 300], up: false }])
    expect(routeClimbs(route)).toEqual([
      { at: [10, 0, 300], up: false, from: 0 },
      { at: [10, 0, 50], up: false, from: 1 }
    ])
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

  it('says where to go as a run moves on, and nothing when a line changes nothing of that', () => {
    const start = newRun('Kedge Keep 1 (Awakened)', 500)
    expect(crawlCue(route, null, start)).toBe('Move to fierce impaler.')
    expect(crawlCue(route, start, start)).toBeNull()
    const one = follow(start, 'You have slain a fierce impaler!')
    expect(crawlCue(route, start, one)).toBe('Move to Coralyn Kelpmaiden.')
    // A rare of two stops dying visits no stop: nowhere new to go.
    expect(crawlCue(route, one, follow(one, 'Tainted seahorse has been slain by Jabartik!'))).toBeNull()
    // A rare a /con saw up at the stop just visited keeps the player there until it dies.
    const seen = follow(one, 'Tainted seahorse - a rare creature - scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 51)')
    const stay = follow(seen, 'You have slain Undertow!')
    expect(crawlCue(route, seen, stay)).toBeNull()
    const on = follow(stay, 'You have slain Tainted seahorse!')
    expect(crawlCue(route, stay, on)).toBe('Move to Cauldronboil.')
    const last = follow(on, 'You have slain Cauldronboil!')
    expect(crawlCue(route, on, last)).toBe('Last stop done.')
    // Completed: the game has said so itself.
    expect(crawlCue(route, last, follow(last, 'You have completed the Dungeon Crawl and earned reward loot!'))).toBeNull()
    // A run read back with every stop done has nothing to say.
    expect(crawlCue(route, null, last)).toBeNull()
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

describe('a place to sit', () => {
  const mob = (name: string, lo: number, hi: number, more: Partial<CrawlCamp['mobs'][number]> = {}) => ({ name, lo, hi, spots: 1, chance: 100, ...more })
  const low: CrawlCamp = {
    at: [10, 0, 300],
    spots: [
      [20, 0, 300, 10],
      [30, 0, 300, 20],
      [40, 0, 300, 30],
      [90, 0, 300, 80]
    ],
    small: [[10, 10, 300, 10]],
    close: 3,
    mobs: [mob('a lancer swordfish', 28, 32, { spots: 4 }), mob('a fierce impaler', 42, 42, { chance: 25, named: true }), mob('a cobalt sailfin', 1, 1, { small: true })],
    respawn: 1200,
    way: [0, 0, 300, 10, 0, 300],
    length: 10
  }
  const high: CrawlCamp = {
    at: [10, 40, -80],
    spots: [[10, 50, -80, 10]],
    over: [
      [10, 60, -80, 20],
      [10, 70, -80, 30],
      [10, 80, -80, 40]
    ],
    close: 4,
    mobs: [mob('a stingtooth piranha', 35, 37), mob('a swirlspine seahorse', 49, 51, { spots: 3 })],
    respawn: 1080,
    way: [0, 0, 300, 10, 0, 300, 10, 0, 50, 10, 40, -80],
    length: 396
  }
  const withCamps: CrawlRoute = { ...route, camps: [low, high], sitUnder: 40 }

  it('counts its spots, and is of the levels wanted when few of them hold mobs above those', () => {
    expect(campSpots(low)).toBe(4)
    expect(campSpots(high)).toBe(4)
    expect(campIsLow(low)).toBe(true)
    expect(campIsLow(high)).toBe(false)
    // One spot above the levels among four under them is still a place of those levels.
    expect(campIsLow({ ...low, over: [[0, 0, 300, 10]] })).toBe(true)
    expect(campIsLow({ ...low, over: [[0, 0, 300, 10]], spots: low.spots.slice(0, 3) })).toBe(false)
  })

  it('gives its levels without small fry and a named seldom up, and its letter', () => {
    expect(campLevels(low)).toEqual([28, 32])
    expect(campLevels(high)).toEqual([35, 51])
    // A place of named alone still has levels.
    expect(campLevels({ ...low, mobs: [mob('Undertow', 49, 49, { chance: 20, named: true })] })).toEqual([49, 49])
    expect([0, 1, 7].map(campLetter)).toEqual(['A', 'B', 'H'])
    expect(wayFloors(withCamps, high.way)).toEqual([0, 1, 2])
  })

  it('becomes the ways and lettered labels for a layer of the game’s map', () => {
    const marks = campMarks(withCamps)
    // The piece both ways share is drawn once.
    expect(marks.filter((m) => m.startsWith('L '))).toHaveLength(3)
    expect(marks).toContain('L 0.0000, 0.0000, 300.0000, 10.0000, 0.0000, 300.0000, 255, 90, 90')
    expect(marks).toContain('P 10.0000, 0.0000, 300.0000, 255, 90, 90, 3, Sit_A_4_spots_levels_28-32')
    expect(marks.at(-1)).toBe('P 10.0000, 40.0000, -80.0000, 235, 215, 40, 3, Sit_B_4_spots_levels_35-51')
    expect(campMarks(route)).toEqual([])
  })
})

describe('the shipped places to sit', () => {
  const routes = ROUTES.zones as unknown as CrawlRoutes
  it.each(Object.entries(routes).filter(([, r]) => r.camps?.length))(
    '%s: each sees four spots or more within a spell’s reach, and its way runs from the zone-in to it',
    (_short, r) => {
      const camps = r.camps!
      for (const c of camps) {
        expect(campSpots(c)).toBeGreaterThanOrEqual(4)
        for (const s of [...c.spots, ...(c.over ?? []), ...(c.small ?? [])]) expect(s[3]).toBeLessThanOrEqual(200)
        expect(c.close).toBeLessThanOrEqual(campSpots(c))
        expect(c.mobs.some((m) => !m.small)).toBe(true)
        expect(Math.hypot(c.way[0] - r.start[0], c.way[1] - r.start[1], c.way[2] - r.start[2])).toBeLessThan(30)
        expect(Math.hypot(c.way.at(-3)! - c.at[0], c.way.at(-2)! - c.at[1], c.way.at(-1)! - c.at[2])).toBeLessThan(30)
      }
      // Those of the levels wanted come first.
      const lows = camps.map(campIsLow)
      expect(lows.indexOf(false) < 0 || !lows.slice(lows.indexOf(false)).includes(true)).toBe(true)
    }
  )

  it('Kedge Keep’s start with the zone-in’s swordfish, under level 50, and none sees Phinigel Autropos', () => {
    const k = routes['kedge']
    expect(k.sitUnder).toBe(50)
    expect(campIsLow(k.camps![0])).toBe(true)
    expect(k.camps![0].mobs[0]).toMatchObject({ name: 'a lancer swordfish', lo: 28, hi: 32 })
    expect(k.camps!.flatMap((c) => c.mobs.map((m) => m.name))).not.toContain('Phinigel Autropos')
  })
})
