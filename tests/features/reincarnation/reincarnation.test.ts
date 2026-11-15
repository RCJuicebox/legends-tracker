import { describe, expect, it } from 'vitest'
import { parseAaLine } from '../../../src/core/aaHistory'
import {
  REINC_CLASSES,
  REINC_KEYS,
  REINC_RACES,
  classLevels,
  completionistRank,
  levelsSeen,
  loggedRanks,
  loggedReincarnations,
  makePlan,
  plannedReincs,
  rankedLines,
  reincTimes,
  rankOf,
  reincarnationsLeft,
  reincHistory,
  reincKeyOf,
  sanitizePriority,
  sanitizeReincCharacter,
  tokenCount,
  trioNotes,
  xpPenalty,
  type LineRank,
  type PlanInput,
  type PriorityEntry,
  type RankEvent,
  type ReincDone,
  type ReincKey
} from '../../../src/features/reincarnation/core'

// Goals › Reincarnation: the class and race AAs as the client names them, ranks from the log's AA lines
// and from the player, class levels, the plan made from a priority list, and a trio's stances and mana.

const T = Date.UTC(2026, 10, 11, 12)
const ranks = (r: Partial<Record<ReincKey, number>>): Partial<Record<ReincKey, LineRank>> =>
  Object.fromEntries(Object.entries(r).map(([k, n = 0]) => [k, { rank: n, from: 'log' as const, logged: n }]))
type Trio = ReincDone['classes']
const want = (...lines: [ReincKey, number][]): PriorityEntry[] => lines.map(([key, rank]) => ({ key, rank }))

describe('the Reincarnation AAs', () => {
  it('are one a class and one a playable race', () => {
    expect(REINC_CLASSES).toHaveLength(16)
    expect(REINC_RACES).toHaveLength(16)
    expect(REINC_KEYS).toHaveLength(32)
  })

  it('are read from the names the game gives them', () => {
    expect(reincKeyOf('Class Reincarnation: Shadow Knight')).toBe('class:shd')
    expect(reincKeyOf('Race Reincarnation: Wood Elf')).toBe('race:Wood Elf')
    // The client's AAs for races no one plays, and every other AA, are not lines.
    expect(reincKeyOf('Race Reincarnation: Half Dark Elf')).toBeNull()
    expect(reincKeyOf('Race Reincarnation: Race 18')).toBeNull()
    expect(reincKeyOf('Reincarnation: Completionist')).toBeNull()
    expect(reincKeyOf('Banestrike')).toBeNull()
  })

  it('say which classes have the stances and where their mana comes from', () => {
    const of = (id: string) => REINC_CLASSES.find((c) => c.id === id)!
    expect(REINC_CLASSES.filter((c) => c.stances.includes('defensive')).map((c) => c.id)).toEqual(['war', 'pal', 'shd'])
    expect(REINC_CLASSES.filter((c) => c.stances.includes('evasive')).map((c) => c.id)).toEqual(['rng', 'mnk', 'brd', 'rog', 'bst'])
    expect(REINC_CLASSES.filter((c) => c.mana === 'WIS').map((c) => c.id)).toEqual(['pal', 'rng', 'bst', 'clr', 'dru', 'shm'])
    expect(REINC_CLASSES.filter((c) => !c.mana).map((c) => c.id)).toEqual(['war', 'mnk', 'rog', 'ber'])
    expect(of('shd').mana).toBe('INT')
    expect(of('brd').mana).toBe('INT')
  })
})

describe('ranks', () => {
  // As the AA parser reads the game's lines (the wording of every AA rank, cost 0 for one the game gives).
  const ev = (text: string, at: number): RankEvent => {
    const p = parseAaLine(text)
    if (p?.kind !== 'rank') throw new Error(text)
    return { name: p.name, rank: p.rank, at }
  }

  it('come from the log, the newest line for each AA', () => {
    const got = loggedRanks([
      ev('You have gained the ability "Class Reincarnation: Rogue" at a cost of 0 ability points.', T),
      ev('You have improved Class Reincarnation: Rogue 2 at a cost of 0 ability points.', T + 1000),
      ev('You have gained the ability "Race Reincarnation: Dark Elf" at a cost of 0 ability points.', T),
      ev('You have improved Banestrike 3 at a cost of 0 ability points.', T)
    ])
    expect(got).toEqual({ 'class:rog': { rank: 2, at: T + 1000 }, 'race:Dark Elf': { rank: 1, at: T } })
  })

  it('take the player’s rank until the log says something newer', () => {
    expect(rankOf(undefined, undefined)).toEqual({ rank: 0, from: 'none', logged: 0 })
    expect(rankOf({ rank: 1, at: T }, undefined)).toEqual({ rank: 1, from: 'log', logged: 1 })
    expect(rankOf({ rank: 1, at: T }, { rank: 3, at: T + 1 })).toEqual({ rank: 3, from: 'hand', logged: 1 })
    expect(rankOf({ rank: 2, at: T + 2 }, { rank: 3, at: T + 1 })).toEqual({ rank: 2, from: 'log', logged: 2 })
  })

  it('give Completionist the rank every class has reached', () => {
    const all = (n: number) => Object.fromEntries(REINC_CLASSES.map((c) => [`class:${c.id}`, n])) as Partial<Record<ReincKey, number>>
    expect(completionistRank(ranks({}))).toBe(0)
    expect(completionistRank(ranks({ ...all(2), 'class:war': 1 }))).toBe(1)
    expect(completionistRank(ranks(all(3)))).toBe(3)
  })
})

describe('reincarnations from the log', () => {
  const at = (name: string, t: number, rank = 1): RankEvent => ({ name, rank, at: t })
  const seen = loggedReincarnations([
    at('Class Reincarnation: Rogue', T),
    at('Class Reincarnation: Shadow Knight', T),
    at('Class Reincarnation: Wizard', T + 1000),
    at('Race Reincarnation: Dark Elf', T + 1000),
    at('Banestrike', T + 5000),
    // A week later, another.
    at('Class Reincarnation: Monk', T + 7 * 86400_000),
    at('Class Reincarnation: Shaman', T + 7 * 86400_000),
    at('Class Reincarnation: Necromancer', T + 7 * 86400_000),
    at('Race Reincarnation: Dwarf', T + 7 * 86400_000)
  ])

  it('are the AA ranks given together', () => {
    expect(seen).toEqual([
      { at: T, classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf', by: 'log' },
      { at: T + 7 * 86400_000, classes: ['mnk', 'shm', 'nec'], race: 'Dwarf', by: 'log' }
    ])
  })

  it('show once in the history when the player said so too', () => {
    const said = [
      { at: T + 3600_000, classes: ['rog', 'shd', 'wiz'] as Trio, race: 'Dark Elf', by: 'hand' as const },
      { at: T + 2 * 86400_000, classes: ['war', 'clr', 'pal'] as Trio, race: '', by: 'hand' as const }
    ]
    expect(reincHistory(seen, said).map((h) => [h.by, h.classes[0]])).toEqual([
      ['log', 'mnk'],
      ['hand', 'war'],
      ['log', 'rog']
    ])
  })
})

describe('reincarnations left', () => {
  it('takes sixteen to finish every class from nothing', () => {
    expect(reincarnationsLeft(ranks({}))).toEqual({ classes: 16, races: 48 })
    expect(reincarnationsLeft(ranks({ 'class:rog': 1, 'class:shd': 1, 'class:wiz': 1 })).classes).toBe(15)
  })
})

describe('the XP penalty', () => {
  it('is 10% for the highest rank among the classes and race played, not their sum', () => {
    const r = ranks({ 'class:rog': 2, 'class:shd': 2, 'class:wiz': 2, 'race:Erudite': 2, 'class:war': 1 })
    expect(xpPenalty(r, ['rog', 'shd', 'wiz'], 'Erudite')).toBe(20)
    // Only what is played: a fresh trio and race carry none, one reincarnated class carries its own.
    expect(xpPenalty(r, ['mnk', 'clr', 'nec'], 'Dwarf')).toBe(0)
    expect(xpPenalty(r, ['war', 'clr', 'nec'], 'Dwarf')).toBe(10)
    expect(xpPenalty(r, ['war', 'clr', 'nec'], 'Erudite')).toBe(20)
    expect(xpPenalty(r, ['war', 'clr', 'nec'], '')).toBe(10)
  })
})

describe('class levels', () => {
  const reinc = (at: number, classes: Trio) => ({ at, classes })

  it('are what was last seen, unless a reincarnation came after', () => {
    const got = classLevels({ mnk: { capped: true, at: T, by: 'hand' }, rog: { capped: true, at: T, by: 'who' } }, [reinc(T + 1, ['rog', 'shd', 'wiz'])])
    expect(got.mnk).toEqual({ capped: true, from: 'hand' })
    expect(got.rog).toEqual({ capped: false, from: 'reincarnated' })
    expect(got.war).toEqual({ capped: null, from: 'none' })
  })

  it('keep what /who says of the classes played, but not the cap of one reincarnated since', () => {
    const seen = levelsSeen(
      {},
      [],
      [
        { id: 'mnk', level: 50 },
        { id: 'brd', level: 12 }
      ],
      T
    )
    expect(seen).toEqual({ mnk: { capped: true, at: T, by: 'who' }, brd: { capped: false, at: T, by: 'who' } })
    expect(levelsSeen(seen!, [], [{ id: 'mnk', level: 50 }], T + 5)).toBeNull()
    // Reincarnated after it was seen: the record's 50 may be from before, and below the cap is known already.
    const since = [reinc(T + 1, ['mnk', 'brd', 'enc'])]
    expect(levelsSeen(seen!, since, [{ id: 'mnk', level: 50 }], T + 5)).toBeNull()
    expect(levelsSeen(seen!, since, [{ id: 'mnk', level: 3 }], T + 5)).toBeNull()
    // Back at the cap after the player said it is not: kept.
    const said = { ...seen!, mnk: { capped: false, at: T + 2, by: 'hand' as const } }
    expect(levelsSeen(said, since, [{ id: 'mnk', level: 50 }], T + 5)!.mnk).toEqual({ capped: true, at: T + 5, by: 'who' })
  })
})

describe('the plan', () => {
  // The test character: Rogue, Shadow Knight and Wizard reincarnated twice as Erudites, levelling them now
  // (the race too); every other class and race is taken as at the cap.
  const held: PlanInput['times'] = { 'class:rog': 2, 'class:shd': 2, 'class:wiz': 2, 'race:Erudite': 2 }
  const input = (over: Partial<PlanInput>): PlanInput => ({
    times: held,
    priority: [],
    capped: { rog: false, shd: false, wiz: false },
    anchor: 'wiz',
    race: 'Erudite',
    raceCapped: false,
    ...over
  })
  const allAt = (n: number): PlanInput['times'] => Object.fromEntries(REINC_KEYS.map((k) => [k, n]))

  it('counts every reincarnation, past rank 3 too', () => {
    const history = [
      { classes: ['rog', 'shd', 'wiz'] as Trio, race: 'Erudite' },
      { classes: ['rog', 'shd', 'wiz'] as Trio, race: 'Erudite' },
      { classes: ['rog', 'mnk', 'wiz'] as Trio, race: 'Erudite' },
      { classes: ['rog', 'mnk', 'wiz'] as Trio, race: '' }
    ]
    const got = reincTimes(ranks({ 'class:rog': 3, 'class:war': 1 }), history)
    expect([got['class:rog'], got['class:wiz'], got['class:mnk'], got['class:war'], got['race:Erudite'], got['class:pal']]).toEqual([4, 4, 2, 1, 3, 0])
  })

  it('ranks every class and race: those on the list in its order, then the rest in the game’s', () => {
    const got = rankedLines(want(['class:mnk', 3], ['race:Ogre', 3], ['class:dru', 3], ['class:mnk', 1]))
    expect(got.classes.slice(0, 5)).toEqual(['mnk', 'dru', 'war', 'pal', 'shd'])
    expect(got.classes).toHaveLength(16)
    expect(got.races.slice(0, 2)).toEqual(['Ogre', 'Human'])
    expect(got.races).toHaveLength(16)
  })

  it('reincarnates the three highest-ranked classes below rank 3 together, and each race three times running', () => {
    const order = want(['class:mnk', 3], ['class:dru', 3], ['class:nec', 3], ['class:rng', 3], ['class:shm', 3], ['class:ber', 3], ['race:Ogre', 3], ['race:Gnome', 3])
    const got = plannedReincs(input({ priority: order }))
    expect(got.slice(0, 4).map((r) => [r.classes.join('/'), r.race])).toEqual([
      ['mnk/dru/nec', 'Ogre'],
      ['mnk/dru/nec', 'Ogre'],
      ['mnk/dru/nec', 'Ogre'],
      ['rng/shm/ber', 'Gnome']
    ])
    expect(got[2].times).toEqual({ 'class:mnk': 3, 'class:dru': 3, 'class:nec': 3, 'race:Ogre': 3 })
    // It runs on until every class and race is at rank 3: the races take the most.
    expect(got).toHaveLength(46)
  })

  it('keeps classes at different ranks moving without wasting a rank', () => {
    const got = plannedReincs(input({ priority: want(['class:war', 3], ['class:shd', 3], ['class:rog', 3], ['class:wiz', 3]) }))
    expect(got.slice(0, 2).map((r) => r.classes.join('/'))).toEqual(['war/shd/rog', 'war/wiz/pal'])
  })

  it('makes up a trio for the races from the classes reincarnated least, never the anchor while another will do', () => {
    // Every class at rank 3, reincarnated three times, but Monk five times and Bard four; the races are all to do.
    const times: PlanInput['times'] = { ...allAt(3), 'class:mnk': 5, 'class:brd': 4 }
    for (const r of REINC_RACES) times[`race:${r.race}`] = 0
    const got = plannedReincs(input({ times }))
    // At the cap first: Shadow Knight and Rogue are below it, so Ranger goes before them.
    expect(got[0]).toMatchObject({ classes: ['war', 'pal', 'rng'], race: 'Human', extra: ['class:war', 'class:pal', 'class:rng'] })
    // Spread: the next take classes not taken again yet; the Wizard comes last.
    expect(got[1].classes).toEqual(['ber', 'bst', 'clr'])
    expect(got.slice(0, 5).flatMap((r) => r.classes)).not.toContain('wiz')
    expect(got.slice(0, 5).flatMap((r) => r.classes)).not.toContain('mnk')
  })

  it('levels the race back after every reincarnation, as the race to reincarnate as', () => {
    // Monk, Druid and Necromancer first, all at the cap, as Ogre: the first needs nothing levelled.
    const stages = makePlan(input({ priority: want(['class:mnk', 3], ['class:dru', 3], ['class:nec', 3], ['race:Ogre', 3]) }))
    expect(stages[0].runs).toEqual([])
    // Then Ogre is at level 1 with the three: the Wizard keeps every trio; Monk is evasive.
    expect(stages[1].runs.map((r) => [r.classes.join('/'), r.levels.join('/'), r.race, r.raceLevels, r.penalty])).toEqual([
      ['wiz/mnk/dru', 'wiz/mnk/dru', 'Ogre', true, 20],
      // No evasive class: the Rogue, reincarnated twice and below the cap, adds nothing to the 20% the Wizard brings.
      ['wiz/nec/rog', 'nec/rog', 'Ogre', false, 20]
    ])
  })

  it('levels the race alone when the classes are at the cap', () => {
    const times = { ...allAt(3) }
    times['race:Ogre'] = 1
    const stages = makePlan(input({ times, race: 'Ogre', raceCapped: false, capped: {} }))
    expect(stages[0].runs).toHaveLength(1)
    expect(stages[0].runs[0]).toMatchObject({ race: 'Ogre', raceLevels: true, levels: [] })
    expect(stages[0].runs[0].classes[0]).toBe('wiz')
  })

  it('takes defensive stance when no evasive class fits under the penalty', () => {
    // Every evasive class reincarnated three times, the Wizard once.
    const evasive = ['rng', 'mnk', 'brd', 'rog', 'bst'] as const
    const times = { 'class:wiz': 1, ...Object.fromEntries(evasive.map((c) => [`class:${c}`, 3])) }
    const capped = { wiz: true, clr: false, dru: false, shm: false }
    const [stage] = makePlan(input({ times, priority: want(['class:clr', 3], ['class:dru', 3], ['class:shm', 3]), race: 'Human', raceCapped: true, capped }))
    expect(stage.runs.map((x) => [x.classes.join('/'), x.penalty])).toEqual([
      ['wiz/clr/dru', 10],
      ['wiz/shm/war', 10]
    ])
  })

  it('says when the race costs more than the classes', () => {
    // Every race at rank 3: the classes still need reincarnations, and Human (reincarnated three times) takes them.
    const times: PlanInput['times'] = Object.fromEntries(REINC_RACES.map((r) => [`race:${r.race}`, 3]))
    times['class:wiz'] = 1
    const [stage] = makePlan(input({ times }))
    expect(stage.runs[0]).toMatchObject({ penalty: 30, classPenalty: 10, race: 'Human' })
  })

  it('needs nothing when every class and race is at rank 3 and the cap', () => {
    expect(makePlan(input({ times: allAt(3), capped: {}, raceCapped: true }))).toEqual([])
  })
})

describe('a trio’s notes', () => {
  it('names its stances and its mana stats, and warns of WIS and INT mixed', () => {
    expect(trioNotes(['rog', 'shd', 'wiz'])).toEqual({ evasive: ['rog'], defensive: ['shd'], wis: [], int: ['shd', 'wiz'], mixed: false })
    expect(trioNotes(['mnk', 'shm', 'nec']).mixed).toBe(true)
    expect(trioNotes(['war', 'mnk', 'ber'])).toEqual({ evasive: ['mnk'], defensive: ['war'], wis: [], int: [], mixed: false })
  })
})

describe('what is kept', () => {
  it('takes a priority list of lines and ranks from 1 to 3', () => {
    expect(
      sanitizePriority([
        { key: 'class:rog', rank: 3 },
        { key: 'race:Erudite', rank: 1 }
      ])
    ).toEqual(want(['class:rog', 3], ['race:Erudite', 1]))
    expect(sanitizePriority([{ key: 'class:rog', rank: 4 }])).toBeNull()
    expect(sanitizePriority([{ key: 'class:rog', rank: 0 }])).toBeNull()
    expect(sanitizePriority([{ key: 'race:Half Dark Elf', rank: 1 }])).toBeNull()
    expect(sanitizePriority('nope')).toBeNull()
  })

  it('keeps what it can use of a file', () => {
    const got = sanitizeReincCharacter({
      hand: { 'class:rog': { rank: 2, at: T }, 'class:nope': { rank: 1, at: T }, 'race:Troll': { rank: 4, at: T } },
      priority: [
        { key: 'class:mnk', rank: 2 },
        { key: 'class:nope', rank: 1 }
      ],
      levels: { mnk: { capped: true, at: T, by: 'hand' }, nope: { capped: true, at: T, by: 'hand' }, war: { capped: 'yes', at: T, by: 'who' } },
      anchor: 'wiz',
      done: [{ at: T, classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf' }, { at: 'then' }]
    })
    expect(got).toEqual({
      hand: { 'class:rog': { rank: 2, at: T } },
      priority: want(['class:mnk', 2]),
      levels: { mnk: { capped: true, at: T, by: 'hand' } },
      anchor: 'wiz',
      done: [{ at: T, classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf', by: 'hand' }]
    })
    expect(sanitizeReincCharacter(null)).toEqual({ hand: {}, priority: [], levels: {}, anchor: '', done: [] })
  })

  it('turns the trios an older file planned into a priority list', () => {
    const trio = (classes: string[], race: string) => ({ id: 'p', classes, race, since: T })
    const got = sanitizeReincCharacter({ plans: [trio(['mnk', 'dru', 'nec'], 'Ogre'), trio(['mnk', 'dru', 'nec'], 'Ogre'), trio(['rng', 'shm', 'ber'], '')] })
    expect(got.priority).toEqual(want(['class:mnk', 2], ['class:dru', 2], ['class:nec', 2], ['race:Ogre', 2], ['class:rng', 1], ['class:shm', 1], ['class:ber', 1]))
  })
})

describe('tokens', () => {
  it('are counted wherever the inventory export lists them', () => {
    const item = (name: string, count = 1) => ({ location: 'General 4-Slot1', name, id: 181107, count, augs: [] })
    expect(
      tokenCount({ bags: [item('Token of Reincarnation'), item('Token of Reincarnation', 2), item('Bread')], bank: [], sharedBank: [], depot: [], keyRing: [] } as never)
    ).toBe(3)
  })
})
