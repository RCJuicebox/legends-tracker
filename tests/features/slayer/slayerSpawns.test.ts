import { describe, expect, it } from 'vitest'
import { legendsSpawnsOf, mapMarks, mobSpawns, parseMap, spotsIn, spotsOf, waypoint, zoneIndex, zoneTimings, type SpawnTables } from '../../../src/features/slayer/spawns'
import type { RespawnRecord } from '../../../src/core/respawns'

// TAKP's spawn tables in Legends' terms: made-up zones in the tables' shape.

const TABLES: SpawnTables = {
  unrest: {
    id: 63,
    name: 'The Estate of Unrest',
    npcs: [
      ['a ghoul', 'Ghoul', 13, 17],
      ['lesser blade fiend', 'Dervish', 15, 20],
      ['Khrix Fritchoff', 'Gnome', 35, 35],
      ['a skeleton', 'Skeleton', 10, 12]
    ],
    groups: [
      // Two spots on 16 minutes: a ghoul nine times in ten, the fiend once in ten.
      [
        960,
        [
          [0, 90],
          [1, 10]
        ],
        [10, 20, 0, 30, 40, 5]
      ],
      [960, [[2, 100]], [50, 60, 1]],
      // A roamer: forty spots on a minute's timer, its cap unknown; and a group of no timer.
      [60, [[3, 100]], Array.from({ length: 120 }, (_, i) => i)],
      [0, [[3, 100]], [1, 2, 3]]
    ]
  },
  permafrost: {
    id: 73,
    name: 'Permafrost Keep',
    // Rolls past a hundred: each a share of the whole.
    npcs: [
      ['a goblin', 'Goblin', 20, 22],
      ['an ice giant', 'Giant', 30, 32]
    ],
    groups: [
      [
        600,
        [
          [0, 100],
          [1, 100]
        ],
        [1, 1, 1]
      ]
    ]
  }
}

const record = (zone: string, name: string, gaps: number[], extra: Partial<RespawnRecord> = {}): RespawnRecord => ({
  zone,
  name,
  kills: gaps.length + 1,
  lastDeath: 0,
  pendingSince: 0,
  gaps,
  shared: false,
  ...extra
})

describe('the spawn tables', () => {
  it('know a zone however the log names it', () => {
    const of = zoneIndex(TABLES)
    expect(of('The Estate of Unrest')).toBe('unrest')
    expect(of('The Estate of Unrest 2 (Adaptive)')).toBe('unrest')
    // The game's zone table calls it a keep; the zone line, the caverns.
    expect(of('The Permafrost Caverns - Solo 3 (Fused)')).toBe('permafrost')
    expect(of('Kedge Keep')).toBeNull()
  })

  it('learn each zone’s timers from the spawns the log timed', () => {
    const t = zoneTimings(TABLES, [
      record('The Estate of Unrest', 'Khrix Fritchoff', [441, 500, 470]),
      record('The Estate of Unrest', 'lesser blade fiend', [467, 480, 999]),
      // Shared, too few gaps, a zone the tables lack: none of them a timer.
      record('The Estate of Unrest', 'A ghoul', [40, 50, 60], { shared: true }),
      record('The Estate of Unrest', 'A skeleton', [100, 120]),
      record('Kedge Keep', 'A sailfin', [300, 300, 300]),
      // A spawn point of several names: any of them is its mob. A gap under half a minute is another mob.
      record('The Permafrost Caverns', 'the goblin spot', [10, 400, 420, 410], { names: ['a mystery', 'A goblin'] })
    ])
    const unrest = t.get('unrest')!
    // The fiend has two spots in the tables: its gaps were any of them, so it sets no timer.
    expect(unrest.timed.map((x) => [x.name, x.legends, x.classic])).toEqual([
      ['Khrix Fritchoff', 441, 960],
      ['lesser blade fiend', 467, null]
    ])
    expect(unrest.timer).toBe(441)
    const perma = t.get('permafrost')!
    expect(perma.timed.map((x) => x.name)).toEqual(['a mystery', 'A goblin'])
    expect(perma.timer).toBe(400)
    expect(t.has('kedge')).toBe(false)
  })

  it('take the middle of a zone’s timed spawns, and no timer where none is one spot', () => {
    const two = zoneTimings(TABLES, [record('The Permafrost Caverns', 'A goblin', [400, 400, 400]), record('The Permafrost Caverns', 'An ice giant', [500, 500, 500])])
    expect(two.get('permafrost')!.timer).toBe(450)
    const none = zoneTimings(TABLES, [record('The Estate of Unrest', 'A wanderer', [300, 300, 300])])
    expect(none.get('unrest')).toEqual({ timer: null, timed: [{ zone: 'The Estate of Unrest', name: 'A wanderer', legends: 300, classic: null }] })
  })

  it('say what each mob’s spawns allow, by its name without the article', () => {
    const classic = mobSpawns(TABLES.unrest)
    const ghoul = classic.get('ghoul')!
    expect(ghoul).toMatchObject({ race: 'Ghoul', spots: 2, timer: 960, timerFrom: 'classic' })
    expect(ghoul.up).toBeCloseTo(1.8, 5)
    expect(ghoul.ceiling).toBeCloseTo((1.8 * 3600) / 960, 5)
    // A roamer's spots count four at most, and a group of no timer not at all.
    const skel = classic.get('skeleton')!
    expect(skel.spots).toBe(40)
    expect(skel.ceiling).toBeCloseTo(4 * 60, 5)
    // Rolls past a hundred are shares of the whole.
    expect(mobSpawns(TABLES.permafrost).get('ice giant')!.up).toBeCloseTo(0.5, 5)
    // Timed in the zone: its timer for every spot, a quicker classic one kept; a mob timed on its own is one spot on its own timer.
    const timing = zoneTimings(TABLES, [
      record('The Estate of Unrest', 'Khrix Fritchoff', [441, 450, 460]),
      record('The Estate of Unrest', 'lesser blade fiend', [467, 470, 480])
    ]).get('unrest')
    const legends = mobSpawns(TABLES.unrest, timing)
    expect(legends.get('ghoul')).toMatchObject({ timer: 441, timerFrom: 'zone' })
    expect(legends.get('skeleton')).toMatchObject({ timer: 60, timerFrom: 'zone' })
    expect(legends.get('lesser blade fiend')).toMatchObject({ spots: 1, up: 1, timer: 467, timerFrom: 'timed', ceiling: 3600 / 467 })
  })

  it('find the spots a step’s mobs pop at', () => {
    const spots = spotsOf(TABLES.unrest, ['LESSER BLADE FIEND', 'Khrix Fritchoff'])
    expect(spots).toEqual([
      { x: 10, y: 20, z: 0, mobs: [{ name: 'lesser blade fiend', chance: 10 }], timer: 960 },
      { x: 30, y: 40, z: 5, mobs: [{ name: 'lesser blade fiend', chance: 10 }], timer: 960 },
      { x: 50, y: 60, z: 1, mobs: [{ name: 'Khrix Fritchoff', chance: 100 }], timer: 960 }
    ])
    expect(spotsOf(TABLES.permafrost, ['an ice giant'])[0].mobs).toEqual([{ name: 'an ice giant', chance: 50 }])
  })
})

describe('the game’s maps', () => {
  it('read lines and labels, heights dropped', () => {
    const map = parseMap(
      [
        'L -79.97, -491.81, -71.97, -67.97, -499.81, -71.97, 0, 0, 0',
        'L 1, 1, 0, 1, 1, 5, 0, 0, 0',
        'L 1, 2',
        'L a, b, c, d, e, f, 0, 0, 0',
        "P -325.7547, -50.1639, -0.8014, 150, 0, 200, 3, to_Dagnor's_Cauldron",
        'P x, y, 0, 0, 0, 0, 3, nowhere',
        'P 1, 2, 3, 0, 0, 0, 2, a,_b',
        ''
      ].join('\r\n')
    )
    expect(map.lines).toEqual([-80, -492, -68, -500])
    expect(map.labels).toEqual([
      { x: -325.7547, y: -50.1639, text: "to Dagnor's Cauldron" },
      { x: 1, y: 2, text: 'a, b' }
    ])
  })

  it('mark the plan’s spots and the Hunter named, as the game’s labels', () => {
    const lines = mapMarks(spotsOf(TABLES.unrest, ['a ghoul', 'lesser blade fiend']).slice(0, 1), spotsOf(TABLES.unrest, ['Khrix Fritchoff']))
    expect(lines).toEqual(['P 10.0000, 20.0000, 0.0000, 240, 40, 40, 2, a_ghoul_90%_or_lesser_blade_fiend_10%', 'P 50.0000, 60.0000, 1.0000, 0, 60, 220, 3, Khrix_Fritchoff'])
  })

  it('add Legends’ own spawns the tables lack, typed in as /waypoint takes them', () => {
    const karana = { id: 12, name: 'The Western Plains of Karana', npcs: [['a bandit', 'Human', 9, 11]], groups: [[400, [[0, 100]], [13792, 619, 0]]] } as SpawnTables[string]
    expect(legendsSpawnsOf('The Western Plains of Karana', ['A Werewolf Bandit']).map((s) => s.ph)).toEqual([['a bandit']])
    expect(legendsSpawnsOf('The Northern Plains of Karana', ['a werewolf bandit'])).toEqual([])
    const spots = spotsIn(karana, ['a bandit', 'a werewolf bandit'])
    // The bandit's spot from the tables, then the four the player found: /waypoint y, x is the map's -y, -x.
    expect(spots).toHaveLength(5)
    expect(spots[1]).toMatchObject({ x: 13825, y: 649, mobs: [{ name: 'a werewolf bandit', chance: 100 }], timer: 0 })
    expect(spots[2].where).toBe('the southern border of the zone')
    expect(waypoint(spots[1])).toBe('/waypoint -649, -13825')
    // The tables' spot comes back as the player found it there.
    expect(waypoint(spots[0])).toBe('/waypoint -619, -13792')
  })
})
