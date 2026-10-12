import { describe, expect, it } from 'vitest'
import { parseAchievements } from '../../../src/core/achievements'
import { hunterHere, hunterZones, namedWait } from '../../../src/features/hunter/core'
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

  it('waits a timer for a named always up, and its timer over its odds otherwise', () => {
    expect(namedWait(spawn('x', 2, 300))).toBe(300)
    expect(namedWait(spawn('x', 0.5, 300))).toBe(600)
    expect(namedWait(spawn('x', 0, 300))).toBeGreaterThan(1e6)
  })

  it('finds the Hunter achievements of the zone the player is in, however the log names it', () => {
    const zones = hunterZones(sections, () => 0, 0)
    expect(hunterHere(zones, 'Befallen 2 (Adaptive)').map((z) => z.achievement)).toEqual(['Hunter of Befallen'])
    expect(hunterHere(zones, 'Ocean of Tears - Group').map((z) => z.achievement)).toEqual(['Hunter of The Ocean of Tears'])
    expect(hunterHere(zones, '')).toEqual([])
  })
})
