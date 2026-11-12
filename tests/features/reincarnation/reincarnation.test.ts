import { describe, expect, it } from 'vitest'
import { parseAaLine } from '../../../src/core/aaHistory'
import {
  REINC_CLASSES,
  REINC_KEYS,
  REINC_RACES,
  completionistRank,
  loggedRanks,
  loggedReincarnations,
  openPlans,
  poolLeft,
  rankOf,
  reincarnationsLeft,
  reincHistory,
  reincKeyOf,
  sanitizePlans,
  sanitizeReincCharacter,
  tokenCount,
  trioNotes,
  type LineRank,
  type RankEvent,
  type ReincKey,
  type ReincPlan
} from '../../../src/features/reincarnation/core'

// Goals › Reincarnation: the class and race AAs as the client names them, ranks from the log's AA lines
// and from the player, the plan's pool, and a trio's stances and mana.

const T = Date.UTC(2026, 10, 11, 12)
const ranks = (r: Partial<Record<ReincKey, number>>): Partial<Record<ReincKey, LineRank>> =>
  Object.fromEntries(Object.entries(r).map(([k, n = 0]) => [k, { rank: n, from: 'log' as const, logged: n }]))
const plan = (id: string, classes: ReincPlan['classes'], race = '', since = 0): ReincPlan => ({ id, classes, race, since })

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

  it('take the plans they made off, one each, only those planned before', () => {
    const plans = [plan('a', ['wiz', 'rog', 'shd'], 'Dark Elf', T - 1), plan('b', ['mnk', 'shm', 'nec'], '', T + 8 * 86400_000), plan('c', ['war', 'clr', 'pal'])]
    const { open, done } = openPlans(plans, seen)
    expect(done.map((p) => p.id)).toEqual(['a'])
    expect(open.map((p) => p.id)).toEqual(['b', 'c'])
    // A plan with another race is not the one made.
    expect(openPlans([plan('d', ['rog', 'shd', 'wiz'], 'Troll')], seen).done).toEqual([])
  })

  it('show once in the history when the player said so too', () => {
    const said = [
      { at: T + 3600_000, classes: ['rog', 'shd', 'wiz'] as ReincPlan['classes'], race: 'Dark Elf', by: 'hand' as const },
      { at: T + 2 * 86400_000, classes: ['war', 'clr', 'pal'] as ReincPlan['classes'], race: '', by: 'hand' as const }
    ]
    expect(reincHistory(seen, said).map((h) => [h.by, h.classes[0]])).toEqual([
      ['log', 'mnk'],
      ['hand', 'war'],
      ['log', 'rog']
    ])
  })
})

describe('the plan’s pool', () => {
  it('is each class and race three times, less ranks held and plans made', () => {
    const pool = poolLeft(ranks({ 'class:rog': 1, 'race:Iksar': 3 }), [plan('a', ['rog', 'shd', 'wiz'], 'Dark Elf'), plan('b', ['rog', 'war', 'clr'])])
    expect(pool.classes.rog).toBe(0)
    expect(pool.classes.shd).toBe(2)
    expect(pool.classes.mnk).toBe(3)
    expect(pool.races['Dark Elf']).toBe(2)
    expect(pool.races.Iksar).toBe(0)
    // Planned once too often: below zero.
    expect(poolLeft(ranks({ 'class:rog': 3 }), [plan('a', ['rog', 'shd', 'wiz'])]).classes.rog).toBe(-1)
  })

  it('takes sixteen reincarnations to finish from nothing', () => {
    expect(reincarnationsLeft(ranks({}))).toEqual({ classes: 16, races: 48 })
    expect(reincarnationsLeft(ranks({ 'class:rog': 1, 'class:shd': 1, 'class:wiz': 1 })).classes).toBe(15)
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
  it('takes plans of three different classes and a playable race, or none', () => {
    expect(sanitizePlans([{ id: 'a', classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf', since: T }])).toEqual([plan('a', ['rog', 'shd', 'wiz'], 'Dark Elf', T)])
    expect(sanitizePlans([{ id: 'a', classes: ['rog', 'shd', 'wiz'], race: '' }])).toEqual([plan('a', ['rog', 'shd', 'wiz'])])
    expect(sanitizePlans([{ id: 'a', classes: ['rog', 'rog', 'wiz'], race: '' }])).toBeNull()
    expect(sanitizePlans([{ id: 'a', classes: ['rog', 'shd'], race: '' }])).toBeNull()
    expect(sanitizePlans([{ id: 'a', classes: ['rog', 'shd', 'wiz'], race: 'Half Dark Elf' }])).toBeNull()
    expect(sanitizePlans([{ id: '../x', classes: ['rog', 'shd', 'wiz'], race: '' }])).toBeNull()
    expect(sanitizePlans([plan('a', ['rog', 'shd', 'wiz']), plan('a', ['war', 'clr', 'pal'])])).toBeNull()
    expect(sanitizePlans('nope')).toBeNull()
  })

  it('keeps what it can use of a file', () => {
    const got = sanitizeReincCharacter({
      hand: { 'class:rog': { rank: 2, at: T }, 'class:nope': { rank: 1, at: T }, 'race:Troll': { rank: 4, at: T } },
      plans: [plan('a', ['rog', 'shd', 'wiz']), { id: 'b', classes: ['x'] }],
      done: [{ at: T, classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf' }, { at: 'then' }]
    })
    expect(got).toEqual({
      hand: { 'class:rog': { rank: 2, at: T } },
      plans: [plan('a', ['rog', 'shd', 'wiz'])],
      done: [{ at: T, classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf', by: 'hand' }]
    })
    expect(sanitizeReincCharacter(null)).toEqual({ hand: {}, plans: [], done: [] })
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
