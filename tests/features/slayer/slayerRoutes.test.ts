import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../../src/core/achievements'
import { parseRaceTable } from '../../../src/core/raceNames'
import { SlayerRaces, slayerCounters } from '../../../src/core/slayer'
import {
  buildCamps,
  DEFAULT_CHOICES,
  emptyKillTallies,
  guideTip,
  spotTip,
  joinKillTallies,
  joinMoves,
  optionalSlayer,
  planSlayer,
  readKillLine,
  routeFinder,
  slayerGoals,
  slayerRaceLists,
  stepKills,
  type SlayerGoal,
  type SlayerPlanCamp
} from '../../../src/features/slayer/core'
import { zoneIndex, zoneTimings, type SpawnTables } from '../../../src/features/slayer/spawns'
import { SLAYER_GUIDE } from '../../../src/shared/game/slayerGuide'
import TAKP from '../../../src/shared/game/takpSpawns.json'

// The Slayer plan's travel (the log's own trips between zones), the Hunter named left on the way, and
// the camps TAKP's spawn tables pace: made-up logs, exports and tables.

const MIN = 60_000

describe('Slayer plan: the trips in the logs', () => {
  it('times crossing a zone, and leaving a camp, but not a death’s way home', () => {
    const t = emptyKillTallies()
    const at = (m: number, text: string) => readKillLine({ time: m * MIN, text }, t)
    at(0, 'You have entered Clan Crushbone.')
    at(1, 'You have slain an orc pawn!')
    at(5, 'You have slain an orc pawn!')
    // Two minutes from the last kill to the next zone; three across it, killing nothing.
    at(7, 'You have entered The Greater Faydark.')
    at(10, 'You have entered The Lesser Faydark.')
    // Back the same way, an instance being its zone: no trip.
    at(12, 'You have entered The Lesser Faydark 2 (Adaptive).')
    at(13, 'You have slain a brownie!')
    at(14, 'You have been slain by a brownie!')
    at(15, 'You have entered The Greater Faydark.')
    // An hour in a zone is no crossing of it.
    at(80, 'You have entered Butcherblock Mountains.')
    at(81, 'You died.')
    at(82, 'You have entered The Greater Faydark.')
    expect(t.moves).toEqual({
      'Clan Crushbone|The Greater Faydark': { pass: [], leave: [120] },
      'The Greater Faydark|The Lesser Faydark': { pass: [180], leave: [] },
      'The Greater Faydark|Butcherblock Mountains': { pass: [], leave: [] }
    })
    expect(t.zones['Clan Crushbone'].mobs['an orc pawn'].at).toBe(5 * MIN)
  })

  it('joins every stretch’s trips, the latest kept', () => {
    const a = emptyKillTallies()
    const b = emptyKillTallies()
    for (let i = 0; i < 12; i++) {
      readKillLine({ time: i * 10 * MIN, text: 'You have entered Kithicor Forest.' }, a)
      readKillLine({ time: (i * 10 + 1) * MIN, text: 'You have entered West Commonlands.' }, a)
      readKillLine({ time: i * 10 * MIN, text: 'You have entered Kithicor Forest.' }, b)
      readKillLine({ time: (i * 10 + 2) * MIN, text: 'You have entered West Commonlands.' }, b)
    }
    const [w] = joinMoves([a, b, { ...emptyKillTallies(), moves: undefined } as never]).filter((m) => m.from === 'Kithicor Forest')
    expect(w.pass).toHaveLength(15)
    expect(w.pass.at(-1)).toBe(120)
    expect(joinKillTallies([a]))
  })

  it('finds the quickest way the log knows: leaving the camp, then crossing each zone between', () => {
    const route = routeFinder([
      { from: 'Clan Crushbone', to: 'The Greater Faydark', pass: [], leave: [100, 120, 140] },
      { from: 'The Greater Faydark', to: 'The Lesser Faydark', pass: [200, 180], leave: [60] },
      // A gate home from the camp, and the way on from there: dearer.
      { from: 'Clan Crushbone', to: 'North Kaladim', pass: [], leave: [20] },
      { from: 'North Kaladim', to: 'The Lesser Faydark', pass: [900], leave: [] },
      // Crossed only, then left only: either stands in for the other.
      { from: 'The Lesser Faydark', to: 'The Estate of Unrest', pass: [300], leave: [] },
      { from: 'The Estate of Unrest', to: 'Kedge Keep', pass: [], leave: [50] },
      { from: 'Nowhere', to: 'Elsewhere', pass: [], leave: [] }
    ])
    // 120 to leave Crushbone, 190 across the Greater Faydark.
    expect(route('Clan Crushbone', 'The Lesser Faydark')).toEqual({ seconds: 310, via: ['The Greater Faydark'] })
    // Left from the Lesser Faydark, the crossing time stands in.
    expect(route('The Lesser Faydark', 'Kedge Keep')).toEqual({ seconds: 350, via: ['The Estate of Unrest'] })
    expect(route('Clan Crushbone 1 (Awakened)', 'The Greater Faydark')?.seconds).toBe(120)
    expect(route('Kedge Keep', 'Clan Crushbone')).toBeNull()
    expect(route('Nowhere', 'Elsewhere')).toBeNull()
  })
})

// The camps TAKP's tables pace, against the log's and play's.
const GAME = parseRaceTable(['18^11^Giant^0^', '18^12^Giants^0^', '54^11^Orc^0^', '54^12^Orcs^0^', '28^11^Dervish^0^', '28^12^Dervishes^0^'].join('\n'))
const sections = parseAchievements(
  ['Slayer: Conquest', 'I\tOrc Stomp!', 'I\t\tOrcs\t4900/5000', 'I\tMight They Be Giants?', 'I\t\tGiants\t4950/5000', 'I\tSpin Me Round', 'I\t\tDervishes\t0/100'].join('\n')
).sections
const counters = slayerCounters(sections)
const races = new SlayerRaces(counters, GAME)
const goals = slayerGoals(counters, new Map(), optionalSlayer(sections))
const gi = (name: string) => goals.findIndex((g) => g.name === name)
const TABLES: SpawnTables = {
  rathemtn: {
    id: 50,
    name: 'The Rathe Mountains',
    npcs: [
      ['a hill giant', 'Giant', 25, 30],
      ['an orc scout', 'Orc', 10, 12],
      ['a rare dervish', 'Dervish', 10, 12]
    ],
    // Thirty giant spots, ten orc spots on six minutes; a dervish a 1% roll.
    groups: [
      [360, [[0, 100]], Array.from({ length: 90 }, () => 0)],
      [
        360,
        [
          [1, 99],
          [2, 1]
        ],
        Array.from({ length: 30 }, () => 0)
      ]
    ]
  },
  unrest: {
    id: 63,
    name: 'The Estate of Unrest',
    npcs: [['lesser blade fiend', 'Dervish', 15, 20]],
    groups: [[960, [[0, 100]], [0, 0, 0]]]
  },
  crushbone: { id: 58, name: 'Clan Crushbone', npcs: [['an orc pawn', 'Orc', 1, 3]], groups: [[600, [[0, 100]], [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]]] },
  halas: { id: 29, name: 'Halas', npcs: [['a halas orc', 'Orc', 1, 3]], groups: [[600, [[0, 100]], [0, 0, 0]]] }
}
const place = (mob: string, race: string) => {
  const p = races.place(mob, race)
  return goals.flatMap((_, i) => (p.key !== null && races.keys[i].has(p.key) ? [i] : []))
}
const timings = zoneTimings(TABLES, [{ zone: 'The Estate of Unrest', name: 'lesser blade fiend', kills: 9, lastDeath: 0, pendingSince: 0, gaps: [467, 470, 480], shared: false }])

describe('Slayer plan: eqlwiki’s Slayer guide', () => {
  const camps = buildCamps(
    goals,
    races,
    { 'Clan Crushbone': { sec: 3600, kills: 10, last: 0, mobs: { 'an orc pawn': { name: 'an orc pawn', n: 10 } } } },
    (mob) => place(mob, mob.includes('orc') ? 'Orc' : ''),
    () => null,
    slayerRaceLists(sections, GAME),
    [],
    { tables: TABLES, timings, place, killSpeed: 100 },
    [
      { achievement: 'Orc Stomp!', tip: 'Crushbone, the Rathe, Halas', zones: ['Clan Crushbone', 'The Rathe Mountains', 'Halas'] },
      { achievement: 'Spin me round.', tip: 'The Rathe', zones: ['The Rathe Mountains'] },
      { achievement: 'Not Open Here', tip: 'Unrest', zones: ['The Estate of Unrest'] }
    ]
  )
  const ids = camps.map((c) => c.id)

  it('makes a camp of each zone it names for an open achievement, paced by the zone’s spawns, with its words for the spot', () => {
    const rathe = camps.find((c) => c.id === 'guide:rathemountains')!
    expect(rathe).toMatchObject({ source: 'play', zone: 'The Rathe Mountains', said: 'eqlwiki’s Slayer guide, 2026-10-12', limit: 'spawns' })
    expect(rathe.kinds.map((k) => [k.name, Math.round(k.perHour), k.goals])).toEqual([
      ['an orc scout', 99, [gi('Orc Stomp!')]],
      ['a rare dervish', 1, [gi('Spin Me Round')]]
    ])
    expect(rathe.note).toContain('froglok city')
    // The tables' own camp there keeps what the guide does not name: the giants.
    expect(camps.find((c) => c.id === 'spawns:rathemtn')?.kinds.map((k) => k.name)).toEqual(['a hill giant'])
  })

  it('leaves the log’s camp standing, never sends anyone to a city, and passes over what is done', () => {
    expect(ids).toContain('log:Clan Crushbone')
    expect(ids.filter((i) => i.startsWith('guide:'))).toEqual(['guide:rathemountains'])
  })

  it('says where in a zone players say to be, for the achievements they said it of alone', () => {
    expect(spotTip('The Lesser Faydark', 'Shorter People')).toContain('The faeries, all to the west of the map')
    expect(spotTip('Lesser Faydark', 'legendary creatures')).toContain('(the player, 2026-10-15)')
    expect(spotTip('The Lesser Faydark', 'Orc Stomp!')).toBeUndefined()
    expect(spotTip('The Rathe Mountains', 'Shorter People')).toBeUndefined()
  })

  it('says what it says of an achievement, however the game writes its name', () => {
    expect(guideTip('orc stomp!', [{ achievement: 'Orc Stomp!', tip: 'Crushbone', zones: [] }])).toBe('Crushbone')
    expect(guideTip('Three Letter Word for Dead…')).toBeUndefined()
    expect(guideTip('Three letter word for dead...')).toContain('Mistmoore')
  })

  it('names only zones the game has: in the spawn tables, or Legends’ own New Sebilis Expedition', () => {
    const known = zoneIndex(TAKP.zones as unknown as SpawnTables)
    const zones = [...new Set(SLAYER_GUIDE.flatMap((t) => t.zones))]
    expect(zones.filter((z) => !known(z) && z !== 'New Sebilis Expedition')).toEqual([])
    // One tip an achievement.
    expect(new Set(SLAYER_GUIDE.map((t) => t.achievement.toLowerCase())).size).toBe(SLAYER_GUIDE.length)
  })
})

describe('Slayer plan: the spawn tables’ camps', () => {
  const camps = buildCamps(
    goals,
    races,
    {
      // The log's own Crushbone, under half of what its four spots allow.
      'Clan Crushbone': { sec: 3600, kills: 10, last: 0, mobs: { 'an orc pawn': { name: 'an orc pawn', n: 10 } } },
      'The Estate of Unrest': { sec: 3600, kills: 15, last: 0, mobs: { 'lesser blade fiend': { name: 'lesser blade fiend', n: 7 }, 'a ghoul': { name: 'a ghoul', n: 8 } } }
    },
    (mob) => place(mob, mob.includes('fiend') ? 'Dervish' : mob.includes('orc') ? 'Orc' : ''),
    () => null,
    slayerRaceLists(sections, GAME),
    // Players name the Rathe for giants, no number.
    [{ zone: 'The Rathe Mountains', mobs: ['a hill giant'], races: ['giant'], note: 'Hill giants.', said: 'test' }],
    { tables: TABLES, timings, place, killSpeed: 100 }
  )
  const camp = (id: string) => camps.find((c) => c.id === id) as SlayerPlanCamp

  it('paces a camp players name without a number by the zone’s spawns, at no more than the player’s pace', () => {
    // Thirty spots on six minutes: 300 an hour, held to the player's 100.
    expect(camp('play:The Rathe Mountains|a hill giant')).toMatchObject({
      source: 'play',
      limit: 'you',
      ceiling: 300,
      kinds: [{ name: 'a hill giant', perHour: 100, goals: [gi('Might They Be Giants?')] }],
      note: 'Hill giants.'
    })
    expect(camp('play:The Rathe Mountains|a hill giant').assumed).toBeUndefined()
  })

  it('offers each zone of the tables for what nothing there feeds yet, never a city', () => {
    const rathe = camp('spawns:rathemtn')
    // The giants are play's there; the orcs and the dervish the tables' (a 1% roll on ten spots: one an hour).
    expect(rathe.kinds.map((k) => [k.name, Math.round(k.perHour), k.goals])).toEqual([
      ['an orc scout', 99, [gi('Orc Stomp!')]],
      ['a rare dervish', 1, [gi('Spin Me Round')]]
    ])
    expect(rathe).toMatchObject({ limit: 'spawns', note: 'classic timers: Legends has been as quick or quicker' })
    expect(camps.some((c) => c.id === 'spawns:halas')).toBe(false)
    // Crushbone and Unrest are the log's.
    expect(camps.some((c) => c.id === 'spawns:crushbone' || c.id === 'spawns:unrest')).toBe(false)
  })

  it('says what the log’s mobs’ spawns allow, and when the log’s pace is up against it', () => {
    const unrest = camp('log:The Estate of Unrest')
    // Timed on its own: one spot on 7:47, under eight an hour, and the log kept seven.
    expect(unrest.kinds[0]).toMatchObject({ name: 'lesser blade fiend', bound: true, spawn: { spots: 1, timerFrom: 'timed' } })
    expect(camp('log:Clan Crushbone').kinds[0]).toMatchObject({ name: 'an orc pawn', bound: false, spawn: { spots: 4, ceiling: 24 } })
  })

  it('plans the trips the log knows, the player’s minutes where it knows none', () => {
    const g = (name: string, count: number, max: number): SlayerGoal => ({ name, section: 'Slayer: Conquest', races: '', count, max, optional: false, tier: 4 })
    const plan = planSlayer(
      {
        goals: [g('A', 0, 60), g('B', 0, 120), g('C', 0, 60)],
        camps: [
          {
            id: 'log:A',
            zone: 'Clan Crushbone',
            kinds: [{ name: 'an orc pawn', perHour: 60, goals: [0], spawn: { name: 'an orc pawn' } as never }],
            source: 'log',
            pace: { 0: 60 }
          },
          { id: 'log:B', zone: 'The Lesser Faydark', kinds: [], source: 'log', pace: { 1: 60 } },
          // Another camp in the zone just left: no travel.
          { id: 'play:B', zone: 'The Lesser Faydark 2 (Adaptive)', kinds: [], source: 'play', pace: { 2: 30 } }
        ],
        moves: [
          { from: 'Clan Crushbone', to: 'The Greater Faydark', pass: [], leave: [120] },
          { from: 'The Greater Faydark', to: 'The Lesser Faydark', pass: [180], leave: [] }
        ]
      },
      DEFAULT_CHOICES
    )
    expect(plan.steps.map((s) => [s.camp.id, s.travel, s.via ?? null])).toEqual([
      ['log:A', 0, null],
      ['log:B', 300, ['The Greater Faydark']],
      ['play:B', 0, null]
    ])
    expect(stepKills(plan.steps[0], DEFAULT_CHOICES)[0].spawn).toEqual({ name: 'an orc pawn' })
    // Without the trips, the player's ten minutes.
    expect(planSlayer({ goals: [g('A', 0, 60), g('B', 0, 60)], camps: plan.steps.map((s) => s.camp).slice(0, 2) }, DEFAULT_CHOICES).steps[1].travel).toBe(600)
  })
})
