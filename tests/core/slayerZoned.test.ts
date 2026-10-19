import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../src/core/achievements'
import { parseRaceTable } from '../../src/core/raceNames'
import { learnFromExport, SlayerRaces, slayerCounters, slayerCounts, type SlayerFacts, type SlayerKills } from '../../src/core/slayer'

// What play settled for one zone: New Sebilis Expedition's undead are Kylong Iksars, counted as
// Iksars (Mostly Kunzar and the playable races rose with them, 2026-10-14), while a skeleton anywhere
// else is a skeleton; and its failed experiments and Abominations of Ro are golems.

const GAME = parseRaceTable(
  ['60^11^Skeleton^0^', '60^12^Skeletons^0^', '128^11^Iksar^0^', '128^12^Iksars^0^', '17^11^Golem^0^', '17^12^Golems^0^', '1^11^Human^0^', '1^12^Humans^0^'].join('\r\n')
)
const counters = slayerCounters(
  parseAchievements(
    [
      'Slayer: Special',
      'I\tMostly Kunzar',
      'I\t\tIksars and Kylong Iksars of Veksar.\t100/1000',
      'I\tGooooooooooooooolem!',
      'I\t\tGingerbread Men, Golems, Muddites, and Statues.\t229/1000',
      'Slayer: Conquest',
      'I\tWe Are the Dead!',
      'I\t\tGhosts, Skeletons, and Zombies.\t10/10000',
      "I\tDoesn't Play Well With Others",
      'I\t\tThe playable races.\t6232/10000'
    ].join('\n')
  ).sections
)
const races = new SlayerRaces(counters, GAME)
const SEB = 'New Sebilis Expedition'
const noFacts: SlayerFacts = () => undefined
const row = (got: ReturnType<typeof slayerCounts>, name: string) => got.rows.find((r) => r.counter.name === name)!

describe('a race play settled for one zone', () => {
  it('places a mob by the zone it was killed in first, and the golems anywhere', () => {
    expect(races.place('a skeleton', null, SEB)).toEqual({ key: 'iksar', by: 'zone', sure: true })
    expect(races.place('a skeleton', null, 'Befallen').key).toBe('skeleton')
    expect(races.place('a skeleton', null).key).toBe('skeleton')
    expect(races.place('an iksar ghost', 'Ghost', SEB).key).toBe('iksar')
    expect(races.place('a failed experiment', null)).toMatchObject({ key: 'golem', by: 'play' })
    expect(races.place('Abomination of Ro', null).key).toBe('golem')
    expect(races.zoned('A Withering Skeleton')).toBe(true)
    expect(races.zoned('a failed experiment')).toBe(false)
  })

  it('counts each kill as its zone places it, what the exports settled of the name standing elsewhere only', () => {
    const kills: SlayerKills = new Map([
      ['a skeleton', { name: 'a skeleton', times: [1, 2, 3, 4, 5], zones: [SEB, SEB, SEB, 'Befallen', ''] }],
      ['a failed experiment', { name: 'a failed experiment', times: [6, 7], zones: [SEB, SEB] }]
    ])
    // An export once said a skeleton counts toward the playable races: true of New Seb's, not Befallen's.
    const facts: SlayerFacts = (mob, ach) => (mob === 'a skeleton' && ach === "doesn't play well with others" ? true : undefined)
    const got = slayerCounts(counters, races, kills, () => null, facts, new Set())
    expect(row(got, 'Mostly Kunzar')).toMatchObject({ since: 3, guessed: 0 })
    // New Seb's three as Iksars, playable; the other two by what the export settled of the name, and skeletons still.
    expect(row(got, "Doesn't Play Well With Others").since).toBe(5)
    expect(row(got, 'We Are the Dead!').since).toBe(2)
    expect(row(got, 'Gooooooooooooooolem!')).toMatchObject({ since: 2, guessed: 0 })
    // Without that export's word, Befallen's and the unknown zone's are skeletons, the dead.
    const plain = slayerCounts(counters, races, kills, () => null, noFacts, new Set())
    expect([row(plain, 'We Are the Dead!').since, row(plain, "Doesn't Play Well With Others").since]).toEqual([2, 3])
  })

  it('settles nothing by name of a mob play placed zone by zone', () => {
    const before = new Map(counters.map((c) => [c.name.toLowerCase(), c.count]))
    const after = counters.map((c) => ({ ...c, count: c.count + (c.name === "Doesn't Play Well With Others" ? 300 : 0) }))
    const got = learnFromExport(
      before,
      after,
      races,
      [
        { name: 'a skeleton', n: 300 },
        { name: 'a gnoll', n: 100 }
      ],
      () => null,
      noFacts
    )
    expect(got.some((f) => f.mob === 'a skeleton')).toBe(false)
    expect(got.find((f) => f.mob === 'a gnoll' && f.achievement === "doesn't play well with others")?.counts).toBe(false)
  })
})

describe('a faerie', () => {
  it('is a fairy by its name, the calling aside', () => {
    const fae = new SlayerRaces(
      slayerCounters(parseAchievements(['Slayer: Special', 'I\tShorter People', 'I\t\tBixies, Brownies, Dryads, Fairies, and Pixies.\t365/1000'].join('\n')).sections),
      parseRaceTable(['25^11^Fairy^0^', '25^12^Fairies^0^', '44^11^Guard^0^'].join('\r\n'))
    )
    expect(fae.place('a faerie guard', null)).toMatchObject({ key: 'fairy', by: 'name' })
    expect(fae.place('a faerie maiden', 'Fairy')).toMatchObject({ key: 'fairy', by: 'wiki' })
  })
})

describe('a panda', () => {
  it('is the Walrus Man its kin are on eqlwiki, a giant one too, never a Giant', () => {
    const zoo = new SlayerRaces(
      slayerCounters(parseAchievements(['Slayer: Conquest', 'I\tMight They Be Giants?', 'I\t\tGiants\t100/5000'].join('\n')).sections),
      parseRaceTable(['18^11^Giant^0^', '18^12^Giants^0^', '102^11^Walrus^0^', '102^12^Walruses^0^'].join('\r\n'))
    )
    expect(zoo.place('a giant panda', undefined)).toMatchObject({ key: 'walrus', by: 'name' })
    expect(zoo.place('a young panda', 'Walrus Man').key).toBe('walrus')
    expect(zoo.place('a hill giant', undefined).key).toBe('giant')
  })
})
