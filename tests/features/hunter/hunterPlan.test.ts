import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../../src/core/achievements'
import { hunterHere, hunterLive, hunterMatch, hunterZones, namedWait, seenFromRecords, seenText } from '../../../src/features/hunter/core'
import type { MobSpawn } from '../../../src/features/slayer/spawns'

// Plan › Hunter: the named each Hunter achievement still wants, with what the spawn tables say of
// each, the quickest zones first. A made-up export and tables.

const MIN = 60_000
const sections = parseAchievements(
  [
    'EverQuest: Hunter',
    'I\tHunter of Befallen',
    'C\t\tSkeleton Grimfiend',
    'I\t\tSkeletal Orc',
    'I\t\tAndrew Pine',
    'I\t\tComplete the achievement "Hunter of the Commonlands"',
    'C\tHunter of Najena',
    'C\t\tRathyl',
    'I\tHunter of Kedge Keep',
    'I\t\tSeahorse Patriarch',
    'I\tHunter of The Ocean of Tears',
    'I\t\tBoog Mudtoe',
    'I\tConqueror of Befallen',
    'I\t\tSkeletal Orc'
  ].join('\n')
).sections

const spawn = (name: string, up: number, timer: number): MobSpawn => ({ name, race: '', lo: 1, hi: 1, spots: 1, up, timer, timerFrom: 'classic', ceiling: 0 })
const TABLES: Record<string, Map<string, MobSpawn>> = {
  befallen: new Map([
    ['skeletal orc', spawn('a skeletal orc', 1, 600)],
    ['andrew pine', spawn('Andrew Pine', 0.25, 600)]
  ]),
  'the ocean of tears': new Map([['boog mudtoe', spawn('Boog Mudtoe', 0.1, 147)]])
}

describe('Plan › Hunter', () => {
  it('lists the named each open Hunter achievement still wants, the quickest zones first', () => {
    // The orc was killed after the export was written, Andrew Pine before it.
    const killed: Record<string, number> = { 'skeletal orc': 10 * MIN, 'andrew pine': 1 }
    const zones = hunterZones(
      sections,
      (bare) => killed[bare] ?? 0,
      5 * MIN,
      (zone) => TABLES[zone.toLowerCase()] ?? null
    )
    expect(zones.map((z) => [z.zone, z.left.map((n) => n.name), z.total, z.since, z.wait])).toEqual([
      // A one-in-ten roll on a 2:27 timer: 1,470 seconds on average.
      ['The Ocean of Tears', ['Boog Mudtoe'], 1, [], 1470],
      // A one-in-four roll on ten minutes.
      ['Befallen', ['Andrew Pine'], 3, ['Skeletal Orc'], 2400],
      // Not in the tables: no time, after those with one.
      ['Kedge Keep', ['Seahorse Patriarch'], 1, [], null]
    ])
    expect(zones[1].left[0].spawn?.name).toBe('Andrew Pine')
    expect(hunterZones(sections, () => 0, 0).map((z) => z.zone)).toEqual(['Kedge Keep', 'The Ocean of Tears', 'Befallen'])
  })

  it('waits nothing for a named always up (the first kill is there; the next waits its timer), and its timer over its odds otherwise (LT-671)', () => {
    expect(namedWait(spawn('x', 2, 300))).toBe(0)
    expect(namedWait(spawn('x', 1, 300))).toBe(0)
    expect(namedWait(spawn('x', 0.5, 300))).toBe(600)
    expect(namedWait(spawn('x', 0, 300))).toBeGreaterThan(1e6)
  })

  it('finds the Hunter achievements of the zone the player is in, however the log names it', () => {
    const zones = hunterZones(sections, () => 0, 0)
    expect(hunterHere(zones, 'Befallen 2 (Adaptive)').map((z) => z.achievement)).toEqual(['Hunter of Befallen'])
    expect(hunterHere(zones, 'Ocean of Tears - Group').map((z) => z.achievement)).toEqual(['Hunter of The Ocean of Tears'])
    expect(hunterHere(zones, '')).toEqual([])
  })

  it('gives a named of Legends’ own, which the tables lack, the spots the player found', () => {
    const karana = parseAchievements(['EverQuest: Hunter', 'I\tHunter of The Western Plains of Karana', 'I\t\ta werewolf bandit'].join('\n')).sections
    const [z] = hunterZones(karana, () => 0, 0)
    expect(z.left).toEqual([{ name: 'a werewolf bandit', legends: { spots: 4, ph: ['a bandit'], said: 'the player, 2026-10-13' } }])
    expect(z.wait).toBeNull()
  })
})

describe('Plan › Hunter search', () => {
  const z = { zone: 'The Western Plains of Karana', achievement: 'Hunter of The Western Plains of Karana', left: [{ name: 'a werewolf bandit' }] }
  it('finds an achievement when every word typed is in its zone, its name or a named left', () => {
    expect(hunterMatch(z, '')).toBe(true)
    expect(hunterMatch(z, '  West  karana ')).toBe(true)
    expect(hunterMatch(z, 'werewolf')).toBe(true)
    expect(hunterMatch(z, 'north karana')).toBe(false)
  })
})

describe('Plan › Hunter: what the Respawns records say of a named (LT-670)', () => {
  const now = 100 * MIN
  it('says when it died and when it is back, timed by the log or by the tables, or that it is due', () => {
    expect(seenText(undefined, 600, now)).toBeUndefined()
    expect(seenText({ lastDeath: 0, pendingSince: 0, gaps: [] }, 600, now)).toBeUndefined()
    // Still down six minutes, timed at eight: back in two, as the log timed it.
    expect(seenText({ lastDeath: now - 6 * MIN, pendingSince: now - 6 * MIN, gaps: [480, 470] }, 600, now)).toBe('died 6 min ago; back in ~2 min as you timed it')
    // Nothing timed: the tables' ten minutes.
    expect(seenText({ lastDeath: now - 6 * MIN, pendingSince: now - 6 * MIN, gaps: [] }, 600, now)).toBe('died 6 min ago; back in ~4 min by the tables')
    expect(seenText({ lastDeath: now - 11 * MIN, pendingSince: now - 11 * MIN, gaps: [] }, 600, now)).toBe('down 11 min, due')
    expect(seenText({ lastDeath: now - 11 * MIN, pendingSince: now - 11 * MIN, gaps: [] }, undefined, now)).toBe('died 11 min ago, still down')
    // Seen again since it died.
    expect(seenText({ lastDeath: now - 40 * MIN, pendingSince: 0, gaps: [600] }, 600, now)).toBe('died 40 min ago, seen since')
  })

  it('finds a record by zone and name, a spawn point by any of the names it pops, and the page shows the words', () => {
    const records = {
      'befallen|andrew pine': { zone: 'Befallen', name: 'Andrew Pine', kills: 2, lastDeath: now - 6 * MIN, pendingSince: now - 6 * MIN, gaps: [480], shared: false },
      'befallen|the orc spot': {
        zone: 'Befallen',
        name: 'the orc spot',
        kills: 3,
        lastDeath: now - 2 * MIN,
        pendingSince: 0,
        gaps: [],
        shared: false,
        names: ['a skeletal orc', 'Skeletal Orc']
      }
    }
    const seenOf = seenFromRecords(records, now)
    expect(seenOf('Befallen 2 (Adaptive)', 'Andrew Pine', 600)).toBe('died 6 min ago; back in ~2 min as you timed it')
    expect(seenOf('Befallen', 'Skeletal Orc', 600)).toBe('died 2 min ago, seen since')
    expect(seenOf('Befallen', 'Nobody', 600)).toBeUndefined()
    const zones = hunterZones(
      sections,
      () => 0,
      0,
      (zone) => TABLES[zone.toLowerCase()] ?? null,
      seenOf
    )
    const befallen = zones.find((z) => z.zone === 'Befallen')!
    expect(befallen.left.map((n) => [n.name, n.seen])).toEqual([
      ['Skeletal Orc', 'died 2 min ago, seen since'],
      ['Andrew Pine', 'died 6 min ago; back in ~2 min as you timed it']
    ])
    // The orc is always up: it waits nothing, and the zone takes as long as Andrew Pine.
    expect(befallen.left[0].wait).toBe(0)
    expect(befallen.wait).toBe(2400)
  })
})

describe('the achievements overlay’s Hunter rows (hunterLive)', () => {
  const T0 = new Date(2026, 8, 30, 12, 0, 0).getTime()
  const befallen = parseAchievements(['EverQuest: Hunter', 'I\tHunter of Befallen', 'I\t\tSkeletal Orc', 'I\t\tAndrew Pine', 'C\t\tSkeleton Grimfiend'].join('\n')).sections
  const kills = new Map([['a skeletal orc', { name: 'a skeletal orc', times: [T0 + 1000] }]])

  it('are the named left in the zone the player is in: the export’s, less those killed since', () => {
    expect(
      hunterLive(
        befallen,
        T0,
        '',
        kills,
        () => undefined,
        () => false
      )
    ).toBeNull()
    expect(
      hunterLive(
        befallen,
        T0,
        'Befallen 2 (Adaptive)',
        kills,
        () => undefined,
        () => false
      )
    ).toEqual({
      zone: 'Befallen 2 (Adaptive)',
      rows: [{ achievement: 'Hunter of Befallen', left: ['Andrew Pine'], total: 3, since: ['Skeletal Orc'] }]
    })
    expect(
      hunterLive(
        befallen,
        T0,
        'Kedge Keep',
        kills,
        () => undefined,
        () => false
      )
    ).toBeNull()
  })

  it('say when a named left died, from the Respawns records (LT-670), and leave out the achievements said not to work', () => {
    const seenOf = seenFromRecords(
      { 'befallen|andrew pine': { zone: 'Befallen', name: 'Andrew Pine', kills: 1, lastDeath: T0, pendingSince: T0, gaps: [480], shared: false } },
      T0 + 6 * MIN
    )
    expect(hunterLive(befallen, T0, 'Befallen', kills, seenOf, () => false)).toMatchObject({
      rows: [{ left: ['Andrew Pine'], seen: { 'Andrew Pine': 'died 6 min ago; back in ~2 min as you timed it' } }]
    })
    expect(hunterLive(befallen, T0, 'Befallen', kills, seenOf, (a) => a === 'Hunter of Befallen')).toBeNull()
  })
})
