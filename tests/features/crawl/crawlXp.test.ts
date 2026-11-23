import { describe, expect, it } from 'vitest'
import { emptyXpTally, joinXp, readXpLine, runPerHour, runReward, runTime, tierOf, type XpTally } from '../../../src/features/crawl/xp'

// Motes › Crawl XP read from the log: a run from entering an instance on, its kills' experience added
// up, the completion's reward worked out, and what each level of mob is worth from a /con just before
// its kill. The lines are a real log's (Nagafen's Lair crawls, 2026-11-23), the character renamed.

const T0 = Date.UTC(2026, 10, 23, 10, 0, 0)
/** Lines a second apart from `at` seconds on, read into one tally. */
function read(lines: [number, string][], into: XpTally = emptyXpTally()): XpTally {
  for (const [s, text] of lines) readXpLine({ time: T0 + s * 1000, text }, into)
  return into
}

const crawl: [number, string][] = [
  [0, 'Player Kelwyn creating instance Nagafen’s Lair 4274.'.replace('’', "'")],
  [18, "You have entered Nagafen's Lair."],
  [38, 'A greater kobold scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 36)'],
  [50, 'You gain experience! (0.123%)'],
  [50, 'You have slain a greater kobold!'],
  [60, 'You gain experience! (0.068%)'],
  [60, 'You have slain a greater kobold!'],
  [70, 'A noxious spider - a rare creature - scowls at you, ready to attack -- it appears to be quite formidable. (Lvl: 45)'],
  [80, 'You gain experience! (0.597%)'],
  [81, 'You have slain a noxious spider!'],
  [1497, 'You gain experience! (0.146%)'],
  [1497, 'You have completed the Dungeon Crawl and earned reward loot!'],
  [1497, 'You gained reward experience from the Dungeon Crawl!'],
  [1498, 'You have gained a level! Welcome to level 49!'],
  [1498, 'You have slain a greater kobold!']
]

describe('a run in an instance', () => {
  it('starts on entering a base instance made just before, and adds up its kills', () => {
    const t = read([[-60, 'You have gained a level! Welcome to level 48!'], ...crawl])
    expect(t.inside).toBe(true)
    expect(t.open).toMatchObject({ zone: "Nagafen's Lair", tier: 0, startedAt: T0 + 18_000, kills: 4, xp: 0.934, doneAt: T0 + 1_497_000, xpDone: 0.934 })
    // The level comes with the logs joined: entered at 48, one gained in the run.
    const [run] = joinXp([t]).runs
    expect(run).toMatchObject({ level: 48, levels: 1 })
    expect(runReward(run)).toBe(0.187)
    expect(runTime(run)).toBe(1_479_000)
  })

  it('takes the difficulty from the instance’s name', () => {
    expect(tierOf("Nagafen's Lair 4 (Refined)")).toBe(4)
    expect(tierOf('Kedge Keep - Solo 1 (Awakened)')).toBe(1)
    expect(tierOf("Nagafen's Lair")).toBe(0)
    const t = read([[0, "You have entered Nagafen's Lair 1 (Awakened)."]])
    expect(t.open).toMatchObject({ tier: 1, kills: 0 })
  })

  it('does not count the open zone, and a new instance starts a new run', () => {
    const t = read([
      [0, "You have entered Nagafen's Lair."],
      [5, 'You gain experience! (0.5%)'],
      [6, "You have entered Nagafen's Lair 1 (Awakened)."],
      [7, 'You gain experience! (0.579%)'],
      [8, 'You have entered The Lavastorm Mountains.'],
      [9, 'You gain experience! (0.2%)'],
      [10, "You have entered Nagafen's Lair 1 (Awakened)."],
      [11, 'You gain experience! (0.579%)'],
      [12, 'Player Kelwyn creating instance Nagafen’s Lair 4309.'.replace('’', "'")],
      [13, "You have entered Nagafen's Lair 4 (Refined)."],
      [14, 'You gain experience! (0.737%)']
    ])
    // Out and back into the same instance went on with its run; the open zone and Lavastorm count for none.
    expect(t.runs).toEqual([expect.objectContaining({ zone: "Nagafen's Lair 1 (Awakened)", kills: 2, xp: 1.158 })])
    expect(t.open).toMatchObject({ zone: "Nagafen's Lair 4 (Refined)", tier: 4, kills: 1, xp: 0.737 })
  })

  it('goes on with a base instance stepped back into, but not once it is completed', () => {
    const t = read([
      [0, "Player Kelwyn creating instance Nagafen's Lair 1."],
      [1, "You have entered Nagafen's Lair."],
      [2, 'You gain experience! (0.1%)'],
      [3, 'You have entered The Lavastorm Mountains.'],
      [4, "You have entered Nagafen's Lair."],
      [5, 'You gain experience! (0.1%)'],
      [6, 'You have completed the Dungeon Crawl and earned reward loot!'],
      [7, 'You have entered The Lavastorm Mountains.'],
      [8, "You have entered Nagafen's Lair."],
      [9, 'You gain experience! (0.1%)']
    ])
    expect(t.open).toMatchObject({ kills: 2, xp: 0.2 })
    expect(t.inside).toBe(false)
  })

  it('leaves out a run that killed nothing when the next starts', () => {
    const t = read([
      [0, "You have entered Nagafen's Lair 1 (Awakened)."],
      [1, "Player Kelwyn creating instance Nagafen's Lair 2."],
      [2, "You have entered Nagafen's Lair 1 (Awakened)."]
    ])
    expect(t.runs).toEqual([])
    expect(t.open?.startedAt).toBe(T0 + 2000)
  })
})

describe('what a kill is worth', () => {
  it('keeps a kill /con’d just before it, at difficulty 0, by the level the player was', () => {
    const t = read([[-60, 'You have gained a level! Welcome to level 49!'], [0, "You have entered Nagafen's Lair 4 (Refined)."], ...crawl.slice(2)])
    // 0.123 at D4 is 0.0879 at D0; the kobold killed as the level was gained is the one before it (unconned here).
    expect(t.kills).toEqual([
      [T0 + 50_000, 36, 0.0879],
      [T0 + 80_000, 45, 0.4264]
    ])
    expect(joinXp([t]).values).toEqual({ 49: { 36: 0.0879, 45: 0.4264 } })
  })

  it('takes no /con older than a minute, nor one of another mob', () => {
    const t = read([
      [-60, 'You have gained a level! Welcome to level 48!'],
      [0, 'A greater kobold scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 36)'],
      [61, 'You gain experience! (0.123%)'],
      [61, 'You have slain a greater kobold!'],
      [70, 'A lava beetle scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 38)'],
      [71, 'You gain experience! (0.172%)'],
      [71, 'You have slain a sonic bat!']
    ])
    expect(t.kills).toEqual([])
  })

  it('takes the level from the player’s own /who, and 1 after a reincarnation', () => {
    const t = read([
      [0, "Player Kelwyn creating instance Nagafen's Lair 4274."],
      [1, '[50 RNG/MNK/WIZ] Aldric (Dark Elf) <Guild> ZONE: The Lavastorm Mountains (lavastorm)  '],
      [2, '[44 PAL/SHM/WIZ] Kelwyn (Dark Elf) <Guild> ZONE: The Lavastorm Mountains (lavastorm)  '],
      [3, "You have entered Nagafen's Lair."],
      [4, '[48 PAL/SHM/WIZ] Kelwyn (Dark Elf) <Guild> ZONE: Nagafen’s Lair (soldungb)  ']
    ])
    expect(t.levels).toEqual([
      [T0 + 2000, 44, 0],
      [T0 + 4000, 48, 0]
    ])
    expect(joinXp([t]).runs[0]).toBeUndefined()
    read([[5, 'You have improved Race Reincarnation: Ogre 2 at a cost of 0 ability points.']], t)
    expect(joinXp([t]).level).toBe(1)
  })

  it('leaves out the kill that gained a level: its experience is split across two', () => {
    // As the D3 run of 2026-11-23 had it: the level line first, then the kill's 0.657% (0.685% at 49, 0.794% at 50).
    const t = read([
      [-60, 'You have gained a level! Welcome to level 49!'],
      [0, "You have entered Nagafen's Lair 3 (Fused)."],
      [10, 'A lava duct crawler scowls at you, ready to attack -- it appears to be quite formidable. (Lvl: 45)'],
      [12, 'You have gained a level! Welcome to level 50!'],
      [12, 'You gain experience! (0.657%)'],
      [12, 'You have slain a lava duct crawler!'],
      [20, 'A lava duct crawler scowls at you, ready to attack -- it appears to be quite formidable. (Lvl: 45)'],
      [25, 'You gain experience! (0.794%)'],
      [25, 'You have slain a lava duct crawler!']
    ])
    expect(joinXp([t]).values).toEqual({ 50: { 45: 0.6108 } })
  })

  it('puts a level from another log to a kill, and none before any log said one', () => {
    const t = read([
      [0, 'A greater kobold scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 36)'],
      [1, 'You gain experience! (0.123%)'],
      [1, 'You have slain a greater kobold!']
    ])
    expect(joinXp([t]).values).toEqual({})
    // The level gained on another PC, in that PC's log.
    const other = read([[-5, 'You have gained a level! Welcome to level 48!']])
    expect(joinXp([t, other]).values).toEqual({ 48: { 36: 0.123 } })
  })

  it('counts a level gained on another PC in a run on this one, once', () => {
    const here = read(crawl.slice(0, 10))
    const other = read([
      [-60, 'You have gained a level! Welcome to level 47!'],
      [40, 'You have gained a level! Welcome to level 48!']
    ])
    expect(joinXp([here, other, other]).runs[0]).toMatchObject({ level: 47, levels: 1 })
  })
})

describe('runs over every stretch of log', () => {
  it('lists them newest first, once each, with the latest value of each kill', () => {
    const a = read([[-60, 'You have gained a level! Welcome to level 48!'], ...crawl])
    const b = read([
      [-60, 'You have gained a level! Welcome to level 48!'],
      [2000, "You have entered Nagafen's Lair 1 (Awakened)."],
      [2010, 'A greater kobold scowls at you, ready to attack -- looks kind of dangerous. (Lvl: 36)'],
      [2011, 'You gain experience! (0.1353%)'],
      [2011, 'You have slain a greater kobold!']
    ])
    const { runs, values } = joinXp([a, b, a])
    expect(runs.map((r) => r.zone)).toEqual(["Nagafen's Lair 1 (Awakened)", "Nagafen's Lair"])
    expect(values[48]).toEqual({ 36: 0.123, 45: 0.597 })
  })

  it('says a run’s experience per hour with its reward, and nothing for one under a minute', () => {
    const run = read([[-60, 'You have gained a level! Welcome to level 48!'], ...crawl]).open!
    expect(runPerHour(run)).toBeCloseTo(((0.934 + 0.187) * 3600) / 1479, 6)
    expect(runPerHour({ ...run, doneAt: run.startedAt + 30_000 })).toBeNull()
    expect(runReward({ ...run, doneAt: undefined })).toBe(0)
  })
})
