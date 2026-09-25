import { describe, expect, it } from 'vitest'
import { AchievementBook, parseAchievements, sourceFromName, type AchMarks } from '../src/core/achievements'
import { HUNT } from '../src/core/achievementHunt'

const EXPORT = [
  'EverQuest: Hunter',
  'I\tHunter of The Lair of the Splitpaw',
  'C\t\tan ancient mob',
  'I\t\ta shared named',
  'I\tHunter of The Southern Plains of Karana',
  'I\t\ta shared named',
  'I\t\tsomeone else',
  'I\tHunter of Crushbone',
  'I\t\tEmperor Crush',
  'I\tHunter of Norrath',
  'I\t\tComplete the achievement "Hunter of Crushbone".',
  'I\t\tComplete the achievement "Hunter of The Lair of the Splitpaw".',
  'EverQuest: Keys',
  'I\tKey to Sky',
  'I\t\tFind the key',
  'I\t\t(Optional) Say thanks\t2/5',
  'General: Keys',
  'I\tKey to Sky',
  'I\t\tFind the key',
  'I\t\t(Optional) Say thanks\t2/5',
  ''
].join('\r\n')

const none: AchMarks = { ticks: [], broken: [] }

describe('reading the achievements export', () => {
  it('reads sections, statuses, optional objectives and progress', () => {
    const { sections, stats } = parseAchievements(EXPORT)
    expect(stats).toMatchObject({ sections: 3, ach: 6, achDone: 0, comp: 11, compDone: 1 })
    expect(sections[1]).toMatchObject({ cat: 'EverQuest', name: 'Keys' })
    expect(sections[1].ach[0].c[1]).toEqual({ t: 'Say thanks', o: true, p: [2, 5] })
    expect(sourceFromName('Kelwyn_neriak-Achievements.txt')).toEqual({ character: 'Kelwyn', server: 'neriak' })
  })

  it('refuses a file with no achievements in it', () => {
    expect(() => parseAchievements('just some text')).toThrow(/No achievements/)
  })
})

describe('the rules across achievements', () => {
  const { sections } = parseAchievements(EXPORT)

  it('an objective naming another achievement follows it, and completes with it', () => {
    let marks = none
    const book = new AchievementBook(sections, marks)
    expect(book.link([0, 3, 0])).toEqual([0, 2])
    expect(book.state([0, 3])).toBe('open')
    marks = book.withTick([0, 2, 0], true, marks)
    const after = new AchievementBook(sections, marks)
    expect(after.achDone([0, 2])).toBe(true)
    expect(after.objDone([0, 3, 0])).toBe(true)
  })

  it('a kill in zones that share it ticks in both', () => {
    const book = new AchievementBook(sections, none)
    const marks = book.withTick([0, 0, 1], true, none)
    const after = new AchievementBook(sections, marks)
    expect(after.objDone([0, 1, 0])).toBe(true)
    // Splitpaw is now complete: its other named was already recorded by the game.
    expect(after.achDone([0, 0])).toBe(true)
  })

  it('twins listed in two sections tick together; optional objectives do not count', () => {
    const book = new AchievementBook(sections, none)
    expect(book.twinsOf([1, 0])).toEqual([
      [1, 0],
      [2, 0]
    ])
    const after = new AchievementBook(sections, book.withTick([1, 0, 0], true, none))
    expect(after.achDone([2, 0])).toBe(true)
    expect(after.counts([2, 0])).toMatchObject({ req: 1, done: 1, opt: 1, optDone: 0 })
  })

  it('a broken achievement stops counting and blocks what needs it', () => {
    const book = new AchievementBook(sections, none)
    const marks = book.withBroken([0, 2], true, none)
    let after = new AchievementBook(sections, marks)
    expect(after.state([0, 2])).toBe('broken')
    // Norrath still needs Splitpaw, so it is open, not blocked.
    expect(after.state([0, 3])).toBe('open')
    after = new AchievementBook(sections, after.withTick([0, 0, 1], true, marks))
    expect(after.state([0, 3])).toBe('blocked')
    const t = after.sectionStats(0)
    expect(t).toMatchObject({ ach: 4, ign: 1, blocked: 1, trackable: 3 })
  })

  it('cannot untick what the game recorded, and drops ticks a new export has caught up with', () => {
    const book = new AchievementBook(sections, none)
    expect(book.fromGame([0, 0, 0])).toBe(true)
    const stale: AchMarks = { ticks: ['EverQuest: Hunter > hunter of the lair of the splitpaw > an ancient mob', 'x > y > z'], broken: [] }
    expect(book.prune(stale).ticks).toEqual(['x > y > z'])
  })
})

describe('references from an older export', () => {
  const { sections } = parseAchievements(EXPORT)

  it('read as nothing instead of throwing', () => {
    const book = new AchievementBook(sections, none)
    expect(book.has([0, 0])).toBe(true)
    expect(book.has([0, 0, 9])).toBe(false)
    expect(book.has([9, 0])).toBe(false)
    expect(book.ach([9, 9]).c).toEqual([])
    expect(book.fromGame([0, 9, 0])).toBe(false)
    expect(book.ticks([9, 0, 0])).toBe(false)
    expect(book.objDone([0, 0, 9])).toBe(false)
    expect(book.isBroken([9, 0])).toBe(false)
    expect(book.achDone([9, 0])).toBe(false)
    expect(book.state([9, 0])).toBe('open')
    expect(book.counts([9, 0])).toEqual({ req: 0, done: 0, opt: 0, optDone: 0, ign: 0 })
    expect(book.withTick([9, 0, 0], true, none)).toEqual(none)
    expect(book.withBroken([9, 0], true, none)).toEqual(none)
  })
})

describe('Slayer hunting grounds', () => {
  it('lists zones with a count and, where known, a level range that runs low to high', () => {
    for (const [key, zones] of Object.entries(HUNT)) {
      expect(key).toBe(key.toLowerCase())
      for (const [zone, n, lo, hi] of zones) {
        expect(zone.length).toBeGreaterThan(0)
        expect(n).toBeGreaterThan(0)
        if (lo !== undefined && hi !== undefined) expect(lo).toBeLessThanOrEqual(hi)
      }
      // Most NPCs of the race first.
      expect(zones.map((z) => z[1])).toEqual([...zones.map((z) => z[1])].sort((a, b) => b - a))
    }
  })
})
