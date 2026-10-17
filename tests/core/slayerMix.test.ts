import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../src/core/achievements'
import { parseRaceTable } from '../../src/core/raceNames'
import { learnFromExport, mixCredits, SlayerRaces, slayerCounters, slayerCounts, type SlayerFacts, type SlayerKills } from '../../src/core/slayer'
import { raceMixer, type SpawnTables } from '../../src/features/slayer/spawns'

// A mob nothing places (no race on eqlwiki, none in its name) counts by the race mix TAKP's tables
// give its name in the zone it was killed in: classic's "a bandit" is Human, Half Elf or Barbarian.

const GAME = parseRaceTable(['1^11^Human^0^', '1^12^Humans^0^', '2^11^Barbarian^0^', '2^12^Barbarians^0^', '5^11^Half Elf^0^', '5^12^Half Elves^0^'].join('\r\n'))
const counters = slayerCounters(
  parseAchievements(
    ['Slayer: Conquest', 'I\tWhat Keeps Mankind Alive?', 'I\t\tBarbarians, Drakkin, Erudites, and Humans.\t945/1000', 'I\tNow .49999%', 'I\t\tHalf Elves\t10/100'].join('\n')
  ).sections
)
const races = new SlayerRaces(counters, GAME)
const noFacts: SlayerFacts = () => undefined

const TABLES: SpawnTables = {
  qey2hh1: {
    id: 12,
    name: 'The Western Plains of Karana',
    npcs: [
      ['a bandit', 'Human', 9, 11],
      ['a bandit', 'Half Elf', 10, 12],
      ['a bandit', 'Barbarian', 9, 11]
    ],
    groups: [
      // Two spots: Human 60%, Half Elf 20%, Barbarian 20%.
      [
        400,
        [
          [0, 60],
          [1, 20],
          [2, 20]
        ],
        [1, 1, 0, 2, 2, 0]
      ]
    ]
  },
  lakerathe: {
    id: 51,
    name: 'Lake Rathetear',
    npcs: [['a bandit', 'Half Elf', 10, 12]],
    groups: [[400, [[0, 100]], [5, 5, 0, 6, 6, 0]]]
  }
}
const mixOf = raceMixer(TABLES)

describe('a mob of several races under one name', () => {
  it('is each race by its share of the spawns in the zone, else in every zone that has it', () => {
    expect(mixOf('A Bandit', 'The Western Plains of Karana')).toEqual([
      { race: 'Human', share: 0.6 },
      { race: 'Half Elf', share: 0.2 },
      { race: 'Barbarian', share: 0.2 }
    ])
    expect(mixOf('a bandit', 'Lake Rathetear')).toEqual([{ race: 'Half Elf', share: 1 }])
    // Not known where it died: the four spots of every zone, two of them Lake Rathetear's half elves.
    expect(mixOf('a bandit', '')?.find((r) => r.race === 'Half Elf')?.share).toBeCloseTo(0.6)
    expect(mixOf('a bandit', 'Qeynos Hills')?.length).toBe(3)
    expect(mixOf('a gnoll', 'The Western Plains of Karana')).toBeNull()
  })

  it('counts each kill toward what its zone’s races feed, by their share: a guess, in whole kills', () => {
    expect(mixCredits('a bandit', ['The Western Plains of Karana', 'Lake Rathetear'], races, mixOf)).toEqual([0.8, 1.2])
    expect(mixCredits('Terror', [''], races, mixOf)).toBeNull()
    const kills: SlayerKills = new Map([
      ['a bandit', { name: 'a bandit', times: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], zones: Array.from({ length: 10 }, () => 'The Western Plains of Karana') }],
      ['terror', { name: 'Terror', times: [11] }]
    ])
    const got = slayerCounts(counters, races, kills, () => null, noFacts, new Set(), mixOf)
    expect(got.rows.map((r) => [r.counter.name, r.since, r.guessed, r.last])).toEqual([
      ['What Keeps Mankind Alive?', 8, 8, 10],
      ['Now .49999%', 2, 2, 10]
    ])
    // The bandit is placed, if only in part; Terror is not.
    expect(got.unplaced).toEqual([{ name: 'Terror', n: 1 }])
    // Without the tables, or an older count with no zones (every zone's mix), as before or near it.
    expect(slayerCounts(counters, races, kills, () => null, noFacts, new Set()).rows[0].since).toBe(0)
    const old: SlayerKills = new Map([['a bandit', { name: 'a bandit', times: [1, 2, 3, 4, 5] }]])
    expect(slayerCounts(counters, races, old, () => null, noFacts, new Set(), mixOf).rows.map((r) => r.since)).toEqual([2, 3])
    // What an export settled stands over the mix.
    const settled: SlayerFacts = (mob, ach) => (mob === 'a bandit' && ach === 'now .49999%' ? false : undefined)
    expect(slayerCounts(counters, races, kills, () => null, settled, new Set(), mixOf).rows.map((r) => r.since)).toEqual([8, 0])
  })

  it('is settled by an export like any other mob: Legends’ bandits in the Western Plains of Karana all counted', () => {
    const before = new Map([['what keeps mankind alive?', 945]])
    const after = counters.map((c) => ({ ...c, count: c.name === 'What Keeps Mankind Alive?' ? 975 : c.count }))
    const got = learnFromExport(before, after, races, [{ name: 'a bandit', n: 30 }], () => null, noFacts)
    expect(got).toEqual([{ mob: 'a bandit', achievement: 'what keeps mankind alive?', counts: true, kills: 30, rise: 30 }])
    // Settled, the bandit counts whole from then on.
    const kills: SlayerKills = new Map([['a bandit', { name: 'a bandit', times: [1, 2, 3, 4, 5], zones: Array.from({ length: 5 }, () => 'The Western Plains of Karana') }]])
    const settled: SlayerFacts = (mob, ach) => (mob === 'a bandit' && ach === 'what keeps mankind alive?' ? true : undefined)
    expect(slayerCounts(counters, races, kills, () => null, settled, new Set(), mixOf).rows[0]).toMatchObject({ since: 5, guessed: 0 })
  })
})

describe('a mob play settled is several races (the dervish cutthroats)', () => {
  const game = parseRaceTable(['1^11^Human^0^', '1^12^Humans^0^', '54^11^Orc^0^', '54^12^Orcs^0^', '100^11^Dervish^0^', '100^12^Dervishes^0^'].join('\r\n'))
  const cs = slayerCounters(
    parseAchievements(
      ['Slayer: Conquest', 'I\tOrc Stomp!', 'I\t\tOrcs and Wereorcs.\t3014/5000', "I\tDoesn't Play Well With Others", 'I\t\tThe playable races.\t9000/10000'].join('\n')
    ).sections
  )
  const r = new SlayerRaces(cs, game)
  const commons = raceMixer({
    commons: {
      id: 21,
      name: 'West Commonlands',
      npcs: [
        ['a Dervish Cutthroat', 'Human', 9, 11],
        ['a Dervish Cutthroat', 'Orc', 9, 11]
      ],
      groups: [
        [
          360,
          [
            [0, 75],
            [1, 25]
          ],
          [1, 1, 0]
        ]
      ]
    }
  })

  it('counts each by its zone’s mix, not as a Dervish by its name', () => {
    expect(r.place('a dervish cutthroat', 'Dervish')).toMatchObject({ key: null, by: 'play' })
    const kills: SlayerKills = new Map([
      ['a dervish cutthroat', { name: 'a dervish cutthroat', times: [1, 2, 3, 4], zones: ['West Commonlands', 'West Commonlands', 'West Commonlands', 'West Commonlands'] }]
    ])
    expect(slayerCounts(cs, r, kills, () => 'Dervish', noFacts, new Set(), commons).rows.map((x) => [x.counter.name, x.since, x.guessed])).toEqual([
      ['Orc Stomp!', 1, 1],
      ["Doesn't Play Well With Others", 3, 3]
    ])
  })

  it('is never ruled out of an achievement some of its races feed, though all of them would be more than the rise', () => {
    // 422 killed, Orc Stomp! up 53: a share of them orcs, not none.
    const before = new Map([
      ['orc stomp!', 3014],
      ["doesn't play well with others", 9000]
    ])
    const after = cs.map((c) => ({ ...c, count: c.count + (c.name === 'Orc Stomp!' ? 53 : 374) }))
    const got = learnFromExport(before, after, r, [{ name: 'a dervish cutthroat', n: 422 }], () => 'Dervish', noFacts, commons)
    expect(got.some((f) => f.mob === 'a dervish cutthroat' && f.achievement === 'orc stomp!')).toBe(false)
  })
})
