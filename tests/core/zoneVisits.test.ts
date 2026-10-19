import { describe, expect, it } from 'vitest'
import { addZoneLine, joinZoneVisits, visitObjective, visitedSince, type ZoneVisits } from '../../src/core/zoneVisits'
import { parseAchievements } from '../../src/core/achievements'
import { achKey } from '../../src/core/achievements'
import { trackedAchievements } from '../../src/core/trackedAchievements'

// The zones a log has entered, for the Exploration achievements: "Befallen Traveler" wants "Visit
// Befallen", and the log ticks it before the next export says so (LT-732).

describe('zone visits', () => {
  it('keeps each place once, an instance as its zone, with when first and last entered', () => {
    const v: ZoneVisits = {}
    addZoneLine(v, 'You have entered Befallen.', 10)
    addZoneLine(v, 'You have entered Befallen 2 (Adaptive).', 30)
    addZoneLine(v, 'You have entered The Plane of Fear 4 (Refined).', 20)
    addZoneLine(v, 'You have entered an area where levitation effects do not function.', 25)
    addZoneLine(v, 'You have slain a bixie drone!', 26)
    expect(v).toEqual({
      befallen: { zone: 'Befallen', first: 10, last: 30 },
      planeoffear: { zone: 'The Plane of Fear 4 (Refined)', first: 20, last: 20 }
    })
  })

  it('joins the stretches, and says what was entered after the export', () => {
    const joined = joinZoneVisits([
      { befallen: { zone: 'Befallen', first: 10, last: 30 }, kedgekeep: { zone: 'Kedge Keep', first: 5, last: 5 } },
      { befallen: { zone: 'Befallen 1 (Awakened)', first: 40, last: 50 } }
    ])
    expect(joined).toEqual({ befallen: { zone: 'Befallen 1 (Awakened)', first: 10, last: 50 }, kedgekeep: { zone: 'Kedge Keep', first: 5, last: 5 } })
    expect(visitedSince(joined, 35)).toEqual({ befallen: 50 })
    expect(visitedSince(joined, 50)).toEqual({})
  })

  it('reads the place a "Visit X" objective wants, as the zone lines name it', () => {
    expect(visitObjective('Visit Befallen')).toBe('befallen')
    expect(visitObjective("Visit Ak'Anon")).toBe('akanon')
    expect(visitObjective('Visit The Plane of Fear')).toBe('planeoffear')
    expect(visitObjective('Kill a bixie')).toBeNull()
  })

  it('ticks a tracked Traveler achievement’s zone off the moment the log shows it entered since the export', () => {
    const sections = parseAchievements(
      ['EverQuest: Exploration', 'I\tBefallen Traveler', 'I\t\tVisit Befallen', 'I\tKedge Keep Traveler', 'I\t\tVisit Kedge Keep'].join('\n')
    ).sections
    const tracked = [achKey(sections[0], sections[0].ach[0]), achKey(sections[0], sections[0].ach[1])]
    const got = trackedAchievements(sections, { ticks: [], tracked }, { visited: { befallen: 50 } })
    expect(got[0]).toMatchObject({ name: 'Befallen Traveler', left: [], justDone: [{ name: 'Visit Befallen', at: 50 }], done: true })
    expect(got[1]).toMatchObject({ name: 'Kedge Keep Traveler', left: ['Visit Kedge Keep'], done: false })
  })
})
