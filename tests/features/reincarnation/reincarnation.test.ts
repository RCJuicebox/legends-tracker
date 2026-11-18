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
    // Drakkin left out: its AA does nothing anyone can see.
    expect(REINC_RACES).toHaveLength(16)
    expect(REINC_KEYS).toHaveLength(32)
  })

  it('are read from the names the game gives them', () => {
    expect(reincKeyOf('Class Reincarnation: Shadow Knight')).toBe('class:shd')
    expect(reincKeyOf('Race Reincarnation: Wood Elf')).toBe('race:Wood Elf')
    // The client's AAs for races no one plays, and every other AA, are not lines.
    expect(reincKeyOf('Race Reincarnation: Half Dark Elf')).toBe('race:Half Dark Elf')
    expect(reincKeyOf('Race Reincarnation: Race 18')).toBeNull()
    expect(reincKeyOf('Race Reincarnation: Race 18')).toBeNull()
    expect(reincKeyOf('Race Reincarnation: Drakkin')).toBeNull()
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

  it('reincarnates three classes and a race at the cap, then levels the anchor and two of them as that race', () => {
    const order = want(['class:mnk', 3], ['class:dru', 3], ['class:nec', 3], ['class:rng', 3], ['race:Ogre', 3], ['race:Gnome', 3])
    const stages = makePlan(input({ priority: order }))
    // First the levelling under way: the Wizard, Shadow Knight and Rogue as Erudite, from where they are.
    expect(stages[0].runs.map((r) => [r.classes.join('/'), r.race, r.raceLevels])).toEqual([['wiz/shd/rog', 'Erudite', true]])
    expect(stages[0].reinc).toMatchObject({ classes: ['mnk', 'dru', 'nec'], race: 'Ogre', extra: [] })
    expect(stages[0].reinc!.times).toEqual({ 'class:mnk': 1, 'class:dru': 1, 'class:nec': 1, 'race:Ogre': 1 })
    // Then trios as Ogre: the Wizard and two of the three (Monk for its stance), then the Wizard and Necromancer.
    expect(stages[1].runs.map((r) => [r.classes[0], r.levels.join('/'), r.race, r.penalty])).toEqual([
      ['wiz', 'mnk/dru', 'Ogre', 20],
      ['wiz', 'nec', 'Ogre', 20]
    ])
    expect(stages[1].runs[0].raceLevels).toBe(true)
    expect(stages.every((st) => st.runs.every((r) => r.classes[0] === 'wiz'))).toBe(true)
  })

  it('takes a trio and race to rank 3 before starting another (the player, 2026-11-18)', () => {
    const order = want(['class:mnk', 3], ['class:dru', 3], ['class:nec', 3], ['class:rng', 3], ['class:bst', 3], ['class:clr', 3], ['race:Ogre', 3], ['race:Gnome', 3])
    const reincs = makePlan(input({ priority: order })).flatMap((st) => (st.reinc ? [st.reinc] : []))
    expect(reincs.slice(0, 4).map((r) => `${r.classes.join('/')} ${r.race}`)).toEqual(['mnk/dru/nec Ogre', 'mnk/dru/nec Ogre', 'mnk/dru/nec Ogre', 'rng/bst/clr Gnome'])
    // The last reincarnation made goes on from where it is, ahead of the order.
    const going = makePlan(
      input({
        times: { ...held, 'class:pal': 1, 'class:shm': 1, 'class:ber': 1, 'race:Kerran': 1 },
        priority: order,
        capped: {},
        race: 'Kerran',
        raceCapped: true,
        last: { classes: ['pal', 'shm', 'ber'], race: 'Kerran' }
      })
    )
    expect(going[0]).toMatchObject({ runs: [], reinc: { classes: ['pal', 'shm', 'ber'], race: 'Kerran' } })
    // A class of it still below the cap levels first.
    const waits = makePlan(
      input({
        times: { ...held, 'class:pal': 1, 'class:shm': 1, 'class:ber': 1, 'race:Kerran': 1 },
        priority: order,
        capped: { ber: false },
        race: 'Kerran',
        raceCapped: true,
        last: { classes: ['pal', 'shm', 'ber'], race: 'Kerran' }
      })
    )
    expect(waits[0].runs.map((r) => r.levels)).toEqual([['ber']])
    expect(waits[0].reinc?.classes).toEqual(['pal', 'shm', 'ber'])
  })

  it('levels again first when too few classes are at the cap', () => {
    const below = Object.fromEntries(REINC_CLASSES.map((c) => [c.id, false]))
    const stages = makePlan(input({ times: {}, capped: { ...below, mnk: true, brd: true }, race: 'Human', raceCapped: true }))
    // Monk and Bard alone are at the cap (the Wizard is not, and may not be the most-reincarnated anyway).
    expect(stages[0].runs).toHaveLength(1)
    expect(stages[0].runs[0]).toMatchObject({ race: 'Human', raceLevels: false })
    expect(stages[0].reinc?.classes).toHaveLength(3)
  })

  it('picks the levelling pair with a stance: evasive, else defensive', () => {
    const atCap = input({ times: {}, capped: {}, race: 'Human', raceCapped: true })
    const evasive = makePlan({ ...atCap, priority: want(['class:war', 3], ['class:clr', 3], ['class:mnk', 3]) })
    expect(evasive[1].runs[0].classes).toEqual(['wiz', 'war', 'mnk'])
    const defensive = makePlan({ ...atCap, priority: want(['class:clr', 3], ['class:dru', 3], ['class:war', 3]) })
    expect(defensive[1].runs[0].classes).toEqual(['wiz', 'clr', 'war'])
  })

  it('spreads the reincarnations the races need, the anchor never the most-reincarnated', () => {
    const stages = makePlan(input({}))
    const reincs = stages.flatMap((st) => (st.reinc ? [st.reinc] : []))
    // Every class and race to rank 3: 46 reincarnations from the test character's two.
    expect(reincs).toHaveLength(46)
    const times: Record<string, number> = Object.fromEntries(REINC_CLASSES.map((c) => [c.id, held[`class:${c.id}`] ?? 0]))
    for (const r of reincs) {
      for (const c of r.classes) times[c]++
      if (r.classes.includes('wiz')) expect(times.wiz).toBeLessThanOrEqual(Math.max(...REINC_CLASSES.filter((c) => c.id !== 'wiz').map((c) => times[c.id])))
    }
    const counts = Object.values(times)
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it('ends with every class back at the cap, the anchor in each trio', () => {
    const stages = makePlan(input({}))
    const last = stages.at(-1)!
    expect(last.reinc).toBeNull()
    const atCap: Record<string, boolean> = Object.fromEntries(REINC_CLASSES.map((c) => [c.id, !['rog', 'shd', 'wiz'].includes(c.id)]))
    for (const st of stages) {
      for (const r of st.runs) for (const c of r.classes) atCap[c] = true
      for (const c of st.reinc?.classes ?? []) atCap[c] = false
    }
    expect(Object.entries(atCap).filter(([, v]) => !v)).toEqual([])
    // Two classes a trio beside the Wizard, all as the last race.
    expect(last.runs.length).toBeGreaterThan(1)
    expect(last.runs.every((r) => r.classes[0] === 'wiz' && r.race === stages.at(-2)!.reinc!.race)).toBe(true)
  })

  it('says when the race costs more than the classes', () => {
    const [stage] = makePlan(input({ times: { 'class:wiz': 1, 'race:Erudite': 3 } }))
    expect(stage.runs[0]).toMatchObject({ race: 'Erudite', penalty: 30, classPenalty: 10 })
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
    expect(sanitizePriority([{ key: 'race:Race 18', rank: 1 }])).toBeNull()
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
