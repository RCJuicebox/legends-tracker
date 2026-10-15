import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../../src/core/achievements'
import { parseRaceTable } from '../../../src/core/raceNames'
import { SlayerRaces, slayerCounters } from '../../../src/core/slayer'
import {
  banestrikeTiers,
  buildCamps,
  campZone,
  DEFAULT_CHOICES,
  emptyKillTallies,
  goalsInPlay,
  joinKillTallies,
  optionalSlayer,
  planSlayer,
  killStretches,
  readKillLine,
  slayerGoals,
  slayerPlanView,
  slayerRaceLists,
  stepKills,
  type KillRun,
  type SlayerGoal,
  type SlayerPlanCamp
} from '../../../src/features/slayer/core'
import { sanitizeChoices } from '../../../src/features/slayer/main'

// Rows from the client's string table: race names (type 11) and plurals (type 12).
const GAME = parseRaceTable(
  [
    '2^11^Barbarian^0^',
    '2^12^Barbarians^0^',
    '18^11^Giant^0^',
    '18^12^Giants^0^',
    '34^11^Bat^0^',
    '49^11^Dragon^0^',
    '54^11^Orc^0^',
    '54^12^Orcs^0^',
    '103^11^Kedge^0^',
    '103^12^Kedge^0^'
  ].join('\n')
)

const EXPORT = [
  'Slayer: General',
  'I\tProgressive',
  'I\t\tComplete the achievement "Barbarous"',
  'I\t\tComplete the achievement "Re-Extinction"',
  'I\t\t(Optional) Complete the achievement "Sarnak Slayer"',
  'I\tHighly Decorated',
  // As the game writes some: another case, and a full stop inside the quotes.
  'I\t\tComplete the achievement "A giant problem."',
  'Slayer: Conquest',
  'I\tOrc Stomp!',
  'I\t\tOrcs and Wereorcs.\t4900/5000',
  'I\tMight They Be Giants?',
  'I\t\tGiants\t4950/5000',
  'Slayer: Special',
  'I\tA Giant Problem',
  'I\t\tGiants\t980/1000',
  'I\tDragonbane',
  'I\t\tTrue Dragons\t47/250',
  'Slayer: Skill',
  'I\tBarbarous',
  'I\t\tBarbarians\t90/100',
  'I\tRe-Extinction',
  'I\t\tKedge\t40/50',
  'I\tSarnak Slayer',
  'I\t\tSarnaks\t0/100'
].join('\n')

const sections = parseAchievements(EXPORT).sections
const counters = slayerCounters(sections)
const races = new SlayerRaces(counters, GAME)
const MIN = 60_000

describe('Slayer plan: the kills in the logs', () => {
  it('puts each kill the player’s side made to the zone it was in, and the time spent killing there', () => {
    const t = emptyKillTallies()
    const at = (m: number, text: string) => readKillLine({ time: m * MIN, text }, t)
    at(0, 'You have entered Clan Crushbone.')
    at(1, 'You have slain an orc pawn!')
    at(2, 'An orc centurion has been slain by Vonartik!')
    // A mob's kill of the player's side, and one by another mob: nobody's Slayer kill.
    at(3, 'Kelwyn has been slain by an orc pawn!')
    at(4, 'A bat has been slain by an orc pawn!')
    // Twenty minutes on: a new run, the gap not counted.
    at(24, 'You have slain an orc pawn!')
    at(25, 'You have entered The Permafrost Caverns - Solo.')
    at(26, 'You have slain a hill giant!')
    const z = t.zones['Clan Crushbone']
    expect(z.kills).toBe(3)
    expect(z.sec).toBe(60)
    expect(z.mobs['an orc pawn']).toEqual({ name: 'an orc pawn', n: 2, at: 24 * MIN })
    expect(z.mobs['an orc centurion'].n).toBe(1)
    // Each stretch of killing, with what died in it.
    expect(z.runs).toEqual([
      { sec: 60, mobs: { 'an orc pawn': 1, 'an orc centurion': 1 } },
      { sec: 0, mobs: { 'an orc pawn': 1 } }
    ])
    // An instance is its zone's camp.
    expect(t.zones['The Permafrost Caverns'].kills).toBe(1)
    expect(campZone('Befallen 1 (Awakened)')).toBe('Befallen')
  })

  it('joins the stretches of log, and the player’s other characters’', () => {
    const a = emptyKillTallies()
    const b = emptyKillTallies()
    readKillLine({ time: 0, text: 'You have entered Clan Crushbone.' }, a)
    readKillLine({ time: MIN, text: 'You have slain an orc pawn!' }, a)
    readKillLine({ time: 2 * MIN, text: 'You have slain an orc pawn!' }, a)
    readKillLine({ time: 0, text: 'You have entered Clan Crushbone.' }, b)
    readKillLine({ time: MIN, text: 'You have slain an orc pawn!' }, b)
    expect(joinKillTallies([a, b])['Clan Crushbone']).toMatchObject({ kills: 3, sec: 60, mobs: { 'an orc pawn': { n: 3 } } })
  })
})

describe('Slayer plan: the goals', () => {
  it('leaves out what the metas hold only as optional, and counts the kills since the export', () => {
    expect([...optionalSlayer(sections)]).toEqual(['sarnak slayer'])
    const goals = slayerGoals(counters, new Map([['orc stomp!', 30]]), optionalSlayer(sections))
    expect(goals.find((g) => g.name === 'Orc Stomp!')).toMatchObject({ count: 4930, max: 5000, optional: false })
    expect(goals.find((g) => g.name === 'Sarnak Slayer')?.optional).toBe(true)
    const names = (ids: number[]) => ids.map((i) => goals[i].name)
    expect(names(goalsInPlay(goals, DEFAULT_CHOICES))).not.toContain('Sarnak Slayer')
    expect(names(goalsInPlay(goals, { ...DEFAULT_CHOICES, included: ['sarnak slayer'], excluded: ['orc stomp!'] }))).toEqual([
      'Might They Be Giants?',
      'A Giant Problem',
      'Dragonbane',
      'Barbarous',
      'Re-Extinction',
      'Sarnak Slayer'
    ])
  })

  it('keeps only well-formed choices', () => {
    expect(sanitizeChoices({ excluded: ['a', 3], travelMin: 900, pace: 'x' })).toEqual({ ...DEFAULT_CHOICES, excluded: ['a'], travelMin: 120 })
    expect(sanitizeChoices(null)).toEqual(DEFAULT_CHOICES)
    // Shown on the overlay only when said so in so many words.
    expect(sanitizeChoices({ overlay: true }).overlay).toBe(true)
    expect(sanitizeChoices({ overlay: 'yes' }).overlay).toBe(false)
  })
})

describe('Slayer plan: a race’s pace is its own stretches’', () => {
  // The Stonebrunt Mountains: an hour of granitebacks and kobolds in September, then forty minutes
  // of nothing but kejekan (2026-10-15). Kejekan feed goal 0, granitebacks 1, kobolds 2, tigers 3.
  const goalsOf: Record<string, number[]> = { 'a kejekan mamluk': [0], 'a kejekan ghulam': [0], 'an elder graniteback': [1], 'a highland kobold': [2], 'a highland tiger': [3] }
  const mobs = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, n]) => [k, { name: k, n }]))
  const stonebrunt = {
    sec: 3600 + 2400,
    kills: 193 + 60,
    last: 0,
    mobs: mobs({ 'an elder graniteback': 70, 'a highland kobold': 63, 'a highland tiger': 16, 'an orc': 44, 'a kejekan mamluk': 30, 'a kejekan ghulam': 30 }),
    runs: [
      { sec: 3600, mobs: { 'an elder graniteback': 70, 'a highland kobold': 63, 'a highland tiger': 16, 'an orc': 44 } },
      { sec: 2400, mobs: { 'a kejekan mamluk': 30, 'a kejekan ghulam': 30 } }
    ] as KillRun[]
  }
  const place = (m: string) => goalsOf[m] ?? []

  it('splits a zone by what its killing was about, each its own kills over its own time', () => {
    const st = killStretches(stonebrunt, place)
    // The granitebacks' and kobolds' hour (each a third of it), then the kejekan's forty minutes;
    // the tigers, 8% of that hour, no stretch's: the zone's time as a whole, toward them alone.
    expect(st.map((x) => [x.sec, x.kills, x.about.sort(), x.whole ?? false])).toEqual([
      [3600, 193, [1, 2], false],
      [2400, 60, [0], false],
      [6000, 253, [3], true]
    ])
  })

  it('keeps a short stretch about something else out of a camp, and a camp of a few minutes from outbidding one of an hour', () => {
    // Two minutes of kobolds this morning: about kobolds alone, too short to be a camp; the September hour stands alone.
    const more = { ...stonebrunt, runs: [...stonebrunt.runs, { sec: 120, mobs: { 'a highland kobold': 11 } }] }
    expect(killStretches(more, place).map((x) => [x.sec, x.about.sort()])).toEqual([
      [3600, [1, 2]],
      [2400, [0]],
      [6000, [3]]
    ])
    // Seven minutes of kejekan somewhere: too little to say, the zone's time as a whole instead.
    expect(killStretches({ ...stonebrunt, runs: [{ sec: 420, mobs: { 'a kejekan mamluk': 17 } }] }, place).every((x) => x.whole)).toBe(true)
  })

  it('takes the zone as a whole for stretches too short to tell, or tallies kept before stretches were', () => {
    expect(killStretches({ ...stonebrunt, runs: [{ sec: 120, mobs: { 'a kejekan mamluk': 6 } }] }, place).map((x) => x.whole)).toEqual([true])
    expect(killStretches({ ...stonebrunt, runs: undefined }, place)).toEqual([expect.objectContaining({ sec: 6000, whole: true, about: expect.arrayContaining([0, 1, 2, 3]) })])
  })

  it('makes each a camp: kejekan at their own ninety an hour, not sixty over the zone’s hour and forty', () => {
    const g = (name: string): SlayerGoal => ({ name, section: 'Slayer: Special', races: '', count: 0, max: 1000, optional: false, tier: 1 })
    const camps = buildCamps(
      [g('Catnipped In the Bud'), g('Monkey Business'), g("Puttin' On The Dog"), g('Strange Weather')],
      races,
      { 'The Stonebrunt Mountains': stonebrunt },
      place,
      () => null,
      new Map(),
      [],
      undefined,
      []
    ).filter((c) => c.source === 'log')
    expect(camps.map((c) => [c.id, Math.round((c.hours ?? 0) * 60), Object.fromEntries(Object.entries(c.pace).map(([k, v]) => [k, Math.round(v)]))])).toEqual([
      ['log:The Stonebrunt Mountains', 60, { 1: 70, 2: 63, 3: 16 }],
      ['log:The Stonebrunt Mountains#2', 40, { 0: 90 }],
      ['log:The Stonebrunt Mountains#3', 100, { 3: 10 }]
    ])
  })
})

describe('Slayer plan: the camps', () => {
  const goals = slayerGoals(counters, new Map(), optionalSlayer(sections))
  const gi = (name: string) => goals.findIndex((g) => g.name === name)
  const byRace: Record<string, string> = { 'an orc pawn': 'orc', 'an orc centurion': 'orc', 'a hill giant': 'giant', 'a bat': 'bat', 'phinigel autropos': 'kedge' }
  const place = (mob: string) => goals.flatMap((_, i) => (races.keys[i].has(byRace[mob.toLowerCase()] ?? '') ? [i] : []))
  const zones = {
    'Clan Crushbone': {
      sec: 3600,
      kills: 160,
      last: 0,
      mobs: { 'an orc pawn': { name: 'an orc pawn', n: 150 }, 'an orc centurion': { name: 'an orc centurion', n: 5 }, 'a bat': { name: 'a bat', n: 10 } }
    },
    'The Permafrost Caverns': { sec: 1800, kills: 30, last: 0, mobs: { 'a hill giant': { name: 'a hill giant', n: 30 } } },
    // Phinigel, five a day on a lockout: no hourly camp, however quick the log made his kills look.
    'Kedge Keep': { sec: 3600, kills: 50, last: 0, mobs: { 'phinigel autropos': { name: 'Phinigel Autropos', n: 50 } } },
    // Too short a stay to set a pace by.
    Halas: { sec: 300, kills: 20, last: 0, mobs: {} }
  }
  const camps = buildCamps(
    goals,
    races,
    zones,
    place,
    (zone, mob) => (zone === 'Clan Crushbone' && mob === 'an orc pawn' ? { 'Clan Crushbone': 1, 'Kaladim Residents': -0.5 } : null),
    slayerRaceLists(sections, GAME),
    [
      { zone: 'Kedge Keep', mobs: ['Phinigel Autropos'], races: ['kedge'], perDay: 5, note: 'One a difficulty a day.', said: 'test' },
      // Players name a zone of giants and orcs with no number: each race half the assumed pace.
      { zone: 'The Rathe Mountains', mobs: ['a hill giant', 'an orc'], races: ['giant', 'orc'], note: '', said: 'test' },
      // One boss under two names: the client's race, and the achievement's.
      { zone: 'Permafrost Caverns', mobs: ['Lady Vox'], races: ['dragon', 'true dragon'], perDay: 5, note: '', said: 'test' },
      // The log has the pace for giants in the Permafrost: play's camp gives way.
      { zone: 'Permafrost Caverns', mobs: ['a hill giant'], races: ['giant'], perHour: 999, note: '', said: 'test' }
    ]
  )
  const camp = (id: string) => camps.find((c) => c.id === id) as SlayerPlanCamp

  it('takes the log’s pace where the player has hunted, a kill counting toward every achievement of its race', () => {
    expect(camp('log:Clan Crushbone').pace).toEqual({ [gi('Orc Stomp!')]: 155 })
    // Each mob a kind, most killed first; the bat counts toward nothing.
    expect(camp('log:Clan Crushbone').kinds).toEqual([
      { name: 'an orc pawn', perHour: 150, goals: [gi('Orc Stomp!')] },
      { name: 'an orc centurion', perHour: 5, goals: [gi('Orc Stomp!')] }
    ])
    expect(camp('log:The Permafrost Caverns').pace).toEqual({ [gi('Might They Be Giants?')]: 60, [gi('A Giant Problem')]: 60 })
    expect(camps.some((c) => c.id === 'log:Halas')).toBe(false)
    expect(camps.some((c) => c.id === 'log:Kedge Keep')).toBe(false)
    expect(camps.some((c) => c.id === 'play:Permafrost Caverns|a hill giant')).toBe(false)
    // What an hour there does to the factions, the worst first.
    expect(camp('log:Clan Crushbone').factions).toEqual([
      { faction: 'Kaladim Residents', perHour: -75 },
      { faction: 'Clan Crushbone', perHour: 150 }
    ])
  })

  it('adds the raid lockouts, and eqlwiki’s count where nothing else feeds a goal', () => {
    expect(camp('play:Kedge Keep|Phinigel Autropos')).toMatchObject({ daily: true, pace: { [gi('Re-Extinction')]: 5 } })
    expect(camp('play:The Rathe Mountains|a hill giant|an orc')).toMatchObject({
      assumed: true,
      kinds: [
        { name: 'giant', perHour: 0.5, goals: [gi('Might They Be Giants?'), gi('A Giant Problem')] },
        { name: 'orc', perHour: 0.5, goals: [gi('Orc Stomp!')] }
      ]
    })
    // Every kill of Lady Vox counts whole for Dragonbane: five a day, not half of them for each of her names.
    expect(camp('play:Permafrost Caverns|Lady Vox')).toMatchObject({ daily: true, pace: { [gi('Dragonbane')]: 5 } })
    const wiki = camps.filter((c) => c.source === 'wiki')
    expect(wiki.length).toBeGreaterThan(0)
    expect(
      wiki.every((c) =>
        Object.keys(c.pace)
          .map(Number)
          .every((g) => g === gi('Barbarous'))
      )
    ).toBe(true)
    // Named for the race eqlwiki counts there, which lists no mobs.
    expect(wiki[0].kinds.map((k) => k.name)).toEqual(['barbarian'])
    // Not Halas, where eqlwiki counts most: a city's barbarians are its people and guards.
    expect(wiki.map((c) => c.zone)).not.toContain('Halas')
    expect(wiki[0].zone).toBe('Lake Rathetear')
  })
})

describe('Slayer plan: the plan', () => {
  const g = (name: string, count: number, max: number, tier = 4): SlayerGoal => ({ name, section: 'Slayer: Conquest', races: '', count, max, optional: false, tier })
  const goals = [g('Orc Stomp!', 4900, 5000), g('Might They Be Giants?', 4950, 5000), g('A Giant Problem', 980, 1000), g('Re-Extinction', 40, 50)]
  const camps: SlayerPlanCamp[] = [
    { id: 'log:Clan Crushbone', zone: 'Clan Crushbone', kinds: [], source: 'log', pace: { 0: 100 } },
    { id: 'log:The Permafrost Caverns', zone: 'The Permafrost Caverns', kinds: [], source: 'log', pace: { 1: 60, 2: 60 } },
    { id: 'play:Kedge Keep', zone: 'Kedge Keep', kinds: [], source: 'play', pace: { 3: 5 }, daily: true }
  ]

  it('finishes the achievement that can be done soonest first, travel counted, every kill counting toward all its race feeds', () => {
    const plan = planSlayer({ goals, camps }, DEFAULT_CHOICES)
    // A Giant Problem is done in twenty minutes in the Permafrost, Orc Stomp! in an hour at Crushbone; then the giants
    // go on where they are (half an hour, no travel) before Crushbone: one visit to the Permafrost.
    expect(plan.steps.map((s) => [s.camp.id, Math.round(s.seconds), s.travel, s.finishes])).toEqual([
      ['log:The Permafrost Caverns', 3000, 0, [1, 2]],
      ['log:Clan Crushbone', 3600, 600, [0]]
    ])
    expect(Math.round(plan.seconds)).toBe(7200)
    // Ten kedge at five a day, beside the plan.
    expect(plan.daily.map((d) => [d.camp.id, d.days, d.goals])).toEqual([['play:Kedge Keep', 2, [3]]])
    expect(plan.unplanned).toEqual([])
  })

  it('shows the overlay the step in the zone the player is in, else the first to head to, and the one after', () => {
    const plan = planSlayer({ goals, camps }, DEFAULT_CHOICES)
    const away = slayerPlanView(plan, goals, DEFAULT_CHOICES, 'The Northern Plains of Karana')
    expect(away.steps).toBe(2)
    expect(away.goals).toBe(4)
    expect(Math.round(away.secondsLeft)).toBe(7200)
    expect(away.current).toMatchObject({ index: 0, zone: 'The Permafrost Caverns', here: false, tier: 'Not for Banestrike' })
    expect(away.current?.goals).toEqual([
      { name: 'Might They Be Giants?', count: 4950, max: 5000 },
      { name: 'A Giant Problem', count: 980, max: 1000 }
    ])
    expect(away.next).toMatchObject({ index: 1, zone: 'Clan Crushbone', travel: 600 })
    // At Crushbone (an instance of it counts): that step now, the Permafrost after it.
    const there = slayerPlanView(plan, goals, DEFAULT_CHOICES, 'Clan Crushbone - Solo')
    expect([there.current?.index, there.current?.here, there.next?.index]).toEqual([1, true, 0])
    // Nothing left to plan: no step.
    expect(slayerPlanView(planSlayer({ goals: [], camps }, DEFAULT_CHOICES), [], DEFAULT_CHOICES, '')).toMatchObject({ steps: 0, current: null, next: null })
  })

  it('says on the overlay what a step kills, most first, in whole kills', () => {
    const tiered = [g('Might They Be Giants?', 4950, 5000, 2), g('A Giant Problem', 980, 1000, 1)]
    const giants: SlayerPlanCamp = {
      id: 'log:P',
      zone: 'P',
      kinds: [
        { name: 'a frost giant', perHour: 15, goals: [0, 1] },
        { name: 'a hill giant', perHour: 45, goals: [0, 1] }
      ],
      source: 'log',
      pace: { 0: 60, 1: 60 }
    }
    const v = slayerPlanView(planSlayer({ goals: tiered, camps: [giants] }, DEFAULT_CHOICES), tiered, DEFAULT_CHOICES, 'P')
    expect(v.current?.tier).toBe('Highly Decorated')
    expect(v.current?.mobs).toEqual([
      { name: 'a hill giant', n: 15 },
      { name: 'a frost giant', n: 5 }
    ])
  })

  it('takes what rounding leaves of an achievement for done, and plans the rest of its tier', () => {
    // Monkey Business at 60.626… an hour leaves 5.7e-14 of a kill after its step: once, that brought the
    // plan back to the camp for it until its step limit ran out, and every later achievement went unplanned.
    const tiered = [g('Monkey Business', 104, 500, 1), g('Shorter People', 365, 1000, 1)]
    const plan = planSlayer(
      {
        goals: tiered,
        camps: [
          { id: 'log:Stonebrunt', zone: 'The Stonebrunt Mountains', kinds: [], source: 'log', pace: { 0: 60.62618595825426 } },
          { id: 'log:Lesser Faydark', zone: 'The Lesser Faydark', kinds: [], source: 'log', pace: { 1: 70 } }
        ]
      },
      DEFAULT_CHOICES
    )
    expect(plan.steps.map((s) => s.camp.id)).toEqual(['log:Stonebrunt', 'log:Lesser Faydark'])
    expect(plan.unplanned).toEqual([])
    expect(plan.steps[0].finishes).toEqual([0])
  })

  it('works through Banestrike’s tiers in turn, however much quicker a later one is', () => {
    // Orc Stomp! for Progressive, the giants for Highly Decorated: Crushbone first, slower as it is.
    const tiered = [g('Orc Stomp!', 4900, 5000, 0), g('Might They Be Giants?', 4950, 5000, 1), g('A Giant Problem', 980, 1000, 1)]
    const plan = planSlayer({ goals: tiered, camps: camps.slice(0, 2) }, DEFAULT_CHOICES)
    expect(plan.steps.map((s) => [s.camp.id, s.tier])).toEqual([
      ['log:Clan Crushbone', 0],
      ['log:The Permafrost Caverns', 1]
    ])
  })

  it('says what a step is there for, and what it kills: each kill once, however many achievements it counts toward', () => {
    // Giants for Highly Decorated's A Giant Problem; the same kills count toward A Force of Nature's Might They Be Giants?.
    const tiered = [g('Might They Be Giants?', 4950, 5000, 2), g('A Giant Problem', 980, 1000, 1)]
    const giants: SlayerPlanCamp = { id: 'log:P', zone: 'P', kinds: [{ name: 'a hill giant', perHour: 60, goals: [0, 1] }], source: 'log', pace: { 0: 60, 1: 60 } }
    const plan = planSlayer({ goals: tiered, camps: [giants] }, DEFAULT_CHOICES)
    const [first] = plan.steps
    expect(first.focus).toEqual([1])
    expect(first.kills).toEqual({ 0: 20, 1: 20 })
    // Twenty giants, not forty: one kill, two achievements.
    expect(stepKills(first, DEFAULT_CHOICES)).toEqual([{ name: 'a hill giant', n: 20, goals: [0, 1] }])
  })

  it('reads each achievement’s tier from the metas that name it', () => {
    const tiers = banestrikeTiers(sections)
    expect(Object.fromEntries(tiers)).toEqual({ barbarous: 0, 're-extinction': 0, 'sarnak slayer': 0, 'a giant problem': 1 })
    expect(slayerGoals(counters, new Map(), new Set(), tiers).map((x) => [x.name, x.tier])).toEqual([
      ['Orc Stomp!', 4],
      ['Might They Be Giants?', 4],
      ['A Giant Problem', 1],
      ['Dragonbane', 4],
      ['Barbarous', 0],
      ['Re-Extinction', 0],
      ['Sarnak Slayer', 0]
    ])
  })

  it('says what nothing feeds, and leaves out the camps ruled out', () => {
    const plan = planSlayer({ goals, camps }, { ...DEFAULT_CHOICES, outCamps: ['log:Clan Crushbone'] })
    expect(plan.unplanned).toEqual([0])
    expect(plan.steps.map((s) => s.camp.id)).toEqual(['log:The Permafrost Caverns'])
  })

  it('leaves a mob ruled out out of every camp, and finds its kills elsewhere', () => {
    const two: SlayerPlanCamp[] = [
      {
        id: 'log:WC',
        zone: 'WC',
        kinds: [
          { name: 'Duggin Scumber', perHour: 190, goals: [0] },
          { name: 'a puma', perHour: 5, goals: [0] }
        ],
        source: 'log',
        pace: { 0: 195 }
      },
      { id: 'log:Qeynos', zone: 'Qeynos', kinds: [{ name: 'a guard', perHour: 50, goals: [0] }], source: 'log', pace: { 0: 50 } }
    ]
    const goal = [g('What Keeps Mankind Alive?', 900, 1000)]
    expect(planSlayer({ goals: goal, camps: two }, DEFAULT_CHOICES).steps.map((s) => s.camp.id)).toEqual(['log:WC'])
    const plan = planSlayer({ goals: goal, camps: two }, { ...DEFAULT_CHOICES, outMobs: ['duggin scumber'] })
    // Without him the West Commonlands give five an hour: Qeynos's fifty win.
    expect(plan.steps.map((s) => [s.camp.id, Math.round(s.seconds)])).toEqual([['log:Qeynos', 7200]])
    // eqlwiki's guess stays out while a measured camp is quick, and stands in once its mob is ruled out.
    const guess: SlayerPlanCamp = { id: 'wiki:halas', zone: 'Halas', kinds: [{ name: 'barbarian', perHour: 116, goals: [0] }], source: 'wiki', pace: { 0: 116 } }
    expect(planSlayer({ goals: goal, camps: [...two, guess] }, DEFAULT_CHOICES).steps.map((s) => s.camp.id)).toEqual(['log:WC'])
    expect(planSlayer({ goals: goal, camps: [two[0], guess] }, { ...DEFAULT_CHOICES, outMobs: ['duggin scumber'] }).steps.map((s) => s.camp.id)).toEqual(['wiki:halas'])
    // A camp with nothing left is gone.
    expect(planSlayer({ goals: goal, camps: two }, { ...DEFAULT_CHOICES, outMobs: ['duggin scumber', 'a puma', 'a guard'] }).unplanned).toEqual([0])
  })

  it('takes the assumed pace where play gives none, shared among the camp’s races', () => {
    // Half the camp's kills are orcs: ten of the twenty an hour.
    const plan = planSlayer(
      { goals: [g('Orc Stomp!', 4990, 5000)], camps: [{ id: 'play:x', zone: 'x', kinds: [], source: 'play', pace: { 0: 0.5 }, assumed: true }] },
      { ...DEFAULT_CHOICES, pace: 20 }
    )
    expect(Math.round(plan.steps[0].seconds)).toBe(3600)
  })

  it('counts a lockout only toward what nothing else feeds, the lockouts that feed it together', () => {
    const lock = (id: string, pace: Record<number, number>): SlayerPlanCamp => ({ id, zone: id, kinds: [], source: 'play', pace, daily: true })
    const plan = planSlayer(
      {
        goals: [g('Dragonbane', 50, 250), g('Swordfishmermaid', 520, 5000)],
        // Fish die by the hundred elsewhere: Phinigel's five a day are no step of theirs.
        camps: [lock('Vox', { 0: 5 }), lock('Nagafen', { 0: 5 }), lock('Phinigel', { 1: 5 }), { id: 'log:OoT', zone: 'OoT', kinds: [], source: 'log', pace: { 1: 100 } }]
      },
      DEFAULT_CHOICES
    )
    expect(plan.daily.map((d) => [d.camp.id, d.days])).toEqual([
      ['Vox', 20],
      ['Nagafen', 20]
    ])
    expect(plan.steps.map((s) => s.camp.id)).toEqual(['log:OoT'])
  })
})
