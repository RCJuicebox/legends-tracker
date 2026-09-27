import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addProgressLine,
  emptyProgress,
  joinProgress,
  parseProgressLine,
  progressionView,
  RATE_MIN_MS,
  SESSION_GAP_MS,
  type ProgressTally
} from '../src/core/progression'
import { progressionConsumer, ProgressionHistory } from '../src/main/progression'
import { factionConsumer } from '../src/main/factions'
import { LogHistory } from '../src/main/sources/logHistory'

const T0 = Date.UTC(2026, 8, 27, 12, 0, 0)
const MIN = 60_000

const level = (n: number) => `You have gained a level! Welcome to level ${n}!`
const skill = (name: string, n: number) => `You have become better at ${name}! (${n})`
const point = (total: number) => `You have gained an ability point!  You now have ${total} ability points.`
const points = (n: number, total: number) => `You have gained ${n} ability point(s)!  You now have ${total} ability point(s).`
const improved = (name: string, rank: number, cost: number) => `You have improved ${name} ${rank} at a cost of ${cost} ability point${cost === 1 ? '' : 's'}.`
const XP = 'You gain experience!'
const PARTY = 'You gain party experience!'

/** A stretch of log's tally from [time, text] pairs. */
function tally(lines: [number, string][]): ProgressTally {
  const into = emptyProgress()
  for (const [time, text] of lines) addProgressLine(into, { time, text })
  return into
}

/** The same lines, one a second from `start`. */
const seconds = (texts: string[], start = T0): [number, string][] => texts.map((t, i) => [start + i * 1000, t])

describe('parseProgressLine', () => {
  it('reads both level wordings and a level lost', () => {
    expect(parseProgressLine(level(44))).toEqual({ kind: 'level', level: 44, lost: false })
    expect(parseProgressLine('You have reached level 12.')).toEqual({ kind: 'level', level: 12, lost: false })
    expect(parseProgressLine('You LOST a level! You are now level 43!')).toEqual({ kind: 'level', level: 43, lost: true })
  })

  it('reads a skill-up, a name with spaces kept whole', () => {
    expect(parseProgressLine(skill('Hand to Hand', 154))).toEqual({ kind: 'skill', skill: 'Hand to Hand', value: 154 })
    expect(parseProgressLine(skill('1H Slashing', 9))).toEqual({ kind: 'skill', skill: '1H Slashing', value: 9 })
  })

  it('reads every form of ability points gained', () => {
    expect(parseProgressLine(point(11))).toEqual({ kind: 'points', gained: 1, total: 11 })
    expect(parseProgressLine('You have gained an ability point!  You now have 1 ability point.')).toEqual({ kind: 'points', gained: 1, total: 1 })
    expect(parseProgressLine(points(2, 4))).toEqual({ kind: 'points', gained: 2, total: 4 })
  })

  it('reads a rank bought and a first rank bought by name', () => {
    expect(parseProgressLine(improved('Burst of Power', 2, 6))).toEqual({ kind: 'aa', name: 'Burst of Power', rank: 2, cost: 6 })
    expect(parseProgressLine(improved('Innate Regeneration', 2, 1))).toEqual({ kind: 'aa', name: 'Innate Regeneration', rank: 2, cost: 1 })
    expect(parseProgressLine('You have gained the ability "Burst of Power" at a cost of 3 ability points.')).toEqual({ kind: 'aa', name: 'Burst of Power', rank: null, cost: 3 })
  })

  it('reads experience with and without a percentage, and its sources', () => {
    expect(parseProgressLine(XP)).toEqual({ kind: 'xp', source: 'solo', pct: null })
    expect(parseProgressLine('You gain experience! (0.051%)')).toEqual({ kind: 'xp', source: 'solo', pct: 0.051 })
    expect(parseProgressLine('You gain party experience! (4.799%)')).toEqual({ kind: 'xp', source: 'party', pct: 4.799 })
    expect(parseProgressLine('You gained reward experience from the Dungeon Crawl!')).toEqual({ kind: 'xp', source: 'reward', pct: null })
    expect(parseProgressLine('You receive no experience for defeating this creature as you are in a raid.')).toEqual({ kind: 'noXp' })
  })

  it('reads the two AA cap lines', () => {
    expect(parseProgressLine('You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.')).toEqual({ kind: 'aaCap' })
    expect(parseProgressLine('You must spend some of your ability points. You will no longer gain ability points.')).toEqual({ kind: 'aaCap' })
  })

  it('passes over everything else', () => {
    expect(parseProgressLine('You have entered Neriak Commons.')).toBeNull()
    expect(parseProgressLine('You have gained the ability to use Double Attack.')).toBeNull()
    expect(parseProgressLine('You experience chaotic weightlessness.')).toBeNull()
    expect(parseProgressLine('You gain a rune for 40 points of absorption.')).toBeNull()
    expect(parseProgressLine("Tester tells you, 'You gain experience!'")).toBeNull()
    expect(parseProgressLine("You say, 'You have gained a level! Welcome to level 60!'")).toBeNull()
  })
})

describe('progress tallies', () => {
  it('keeps each skill\'s last value, how many ups and when', () => {
    const t = tally(seconds([skill('Dual Wield', 150), skill('Offense', 20), skill('Dual Wield', 151), skill('dual wield', 152)]))
    expect(t.skills['dual wield']).toEqual({ name: 'dual wield', value: 152, ups: 3, first: T0, last: T0 + 3000 })
    expect(t.skills['offense']).toMatchObject({ value: 20, ups: 1 })
  })

  it('keeps levels, purchases and the last points total', () => {
    const t = tally(seconds([level(12), point(3), improved('Fear Resistance', 2, 4), points(2, 2), 'You LOST a level! You are now level 11!']))
    expect(t.levels).toEqual([
      { at: T0, level: 12, lost: false },
      { at: T0 + 4000, level: 11, lost: true }
    ])
    expect(t.purchases).toEqual([{ at: T0 + 2000, name: 'Fear Resistance', rank: 2, cost: 4 }])
    expect(t.points).toEqual({ at: T0 + 3000, total: 2 })
  })

  it('splits sessions at a gap of 30 minutes, and counts what each recorded', () => {
    const t = tally([
      [T0, 'You have entered Neriak Commons.'],
      [T0 + 1000, XP],
      [T0 + 2000, 'You gain party experience! (1.5%)'],
      [T0 + 3000, 'You gain experience! (0.25%)'],
      [T0 + 4000, point(5)],
      [T0 + 20 * MIN, skill('Offense', 21)],
      // 29 minutes later: still the same session.
      [T0 + 49 * MIN, level(13)],
      [T0 + 49 * MIN + SESSION_GAP_MS, 'You gained reward experience from the Dungeon Crawl!'],
      [T0 + 49 * MIN + SESSION_GAP_MS + 1000, improved('Burst of Power', 2, 6)]
    ])
    expect(t.sessions).toHaveLength(2)
    expect(t.sessions[0]).toEqual({
      start: T0, end: T0 + 49 * MIN, solo: 2, party: 1, reward: 0, pctLines: 2, pct: 1.75, noXp: 0, aaPoints: 1, aaBought: 0, aaSpent: 0, levels: 1, skillUps: 1
    })
    expect(t.sessions[1]).toMatchObject({ start: T0 + 49 * MIN + SESSION_GAP_MS, solo: 0, reward: 1, aaBought: 1, aaSpent: 6, levels: 0 })
  })

  it('keeps a line stamped a little earlier in the session it follows', () => {
    const t = tally([
      [T0, XP],
      [T0 + 5000, XP],
      [T0 + 3000, XP]
    ])
    expect(t.sessions).toHaveLength(1)
    expect(t.sessions[0]).toMatchObject({ start: T0, end: T0 + 5000, solo: 3 })
  })
})

describe('joinProgress', () => {
  const lines: [number, string][] = [
    [T0, level(20)],
    [T0 + MIN, XP],
    [T0 + 2 * MIN, skill('Offense', 30)],
    [T0 + 3 * MIN, point(4)],
    [T0 + 40 * MIN, PARTY],
    [T0 + 41 * MIN, improved('Burst of Power', 2, 3)],
    [T0 + 42 * MIN, skill('Offense', 31)],
    [T0 + 43 * MIN, level(21)],
    [T0 + 44 * MIN, 'You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.'],
    [T0 + 90 * MIN, points(2, 3)],
    [T0 + 91 * MIN, 'You gain experience! (2.5%)']
  ]

  it('gives what reading the stretches as one would, wherever they are cut', () => {
    const whole = progressionView(tally(lines), T0 + 100 * MIN)
    for (const cuts of [[1], [3], [4], [5], [8], [9], [10], [2, 6], [1, 4, 7, 9]]) {
      const edges = [0, ...cuts, lines.length]
      const parts = edges.slice(1).map((end, i) => tally(lines.slice(edges[i], end)))
      expect(progressionView(joinProgress(parts), T0 + 100 * MIN), `cut at ${cuts.join(', ')}`).toEqual(whole)
    }
  })

  it('leaves the stretches it joins as they were', () => {
    const a = tally(lines.slice(0, 4))
    const before = structuredClone(a)
    joinProgress([a, tally(lines.slice(4))])
    expect(a).toEqual(before)
  })

  it('is empty with nothing seen', () => {
    expect(joinProgress([])).toEqual(emptyProgress())
  })
})

describe('progressionView', () => {
  it('groups level-ups into runs, one class each most likely, with the newest first', () => {
    // One class to 35, a second from 11, then the first again.
    const t = tally(seconds([level(34), level(35), level(11), level(12), level(36), level(13), level(11)]))
    const v = progressionView(t, T0)
    expect(v.highest).toBe(36)
    expect(v.runs.map((r) => [r.from, r.to, r.count])).toEqual([
      [11, 11, 1],
      [11, 13, 3],
      [34, 36, 3]
    ])
    expect(v.levels.map((l) => [l.level, v.runs[l.run].from, v.runs[l.run].to])).toEqual([
      [11, 11, 11],
      [13, 11, 13],
      [36, 34, 36],
      [12, 11, 13],
      [11, 11, 13],
      [35, 34, 36],
      [34, 34, 36]
    ])
  })

  it('steps a run back for a level lost', () => {
    const v = progressionView(tally(seconds([level(20), level(21), 'You LOST a level! You are now level 20!'])), T0)
    expect(v.runs).toEqual([{ from: 20, to: 20, first: T0, last: T0 + 2000, count: 2 }])
    expect(v.highest).toBe(21)
  })

  it('takes purchases since the last points total off it, and says when the pool is full', () => {
    const t = tally(seconds([points(2, 13), improved('Finishing Blow', 2, 4), improved('Finishing Blow', 3, 6)]))
    expect(progressionView(t, T0).points).toEqual({ total: 13, at: T0, spentSince: 10, unspent: 3, atCap: false })
    const full = tally(seconds([point(40), 'You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.']))
    expect(progressionView(full, T0).points).toMatchObject({ unspent: 40, atCap: true })
    const spent = tally(seconds(['You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.', point(40), improved('Offense Mastery', 1, 5)]))
    expect(progressionView(spent, T0).points).toMatchObject({ unspent: 35, atCap: false })
    expect(progressionView(tally(seconds([XP])), T0).points).toBeNull()
  })

  it('gives rates per hour only for a session long enough', () => {
    const long = tally([
      [T0, XP],
      [T0 + 15 * MIN, PARTY],
      [T0 + 30 * MIN - 1, point(1)]
    ])
    // Half an hour, give or take a millisecond: two messages and a point.
    const [s] = progressionView(long, T0).sessions
    expect(s.xp).toBe(2)
    expect(s.xpPerHour).toBeCloseTo(4, 3)
    expect(s.aaPerHour).toBeCloseTo(2, 3)
    const short = tally([
      [T0, XP],
      [T0 + RATE_MIN_MS - 1000, XP]
    ])
    expect(progressionView(short, T0).sessions[0]).toMatchObject({ xp: 2, xpPerHour: null, aaPerHour: null })
  })

  it('lists sessions, skills and purchases newest first, and adds up the last seven days', () => {
    const DAY = 86_400_000
    const t = tally([
      [T0 - 9 * DAY, skill('Offense', 10)],
      [T0 - 9 * DAY + 1000, XP],
      [T0 - 2 * DAY, skill('Defense', 5)],
      [T0 - 2 * DAY + 1000, improved('Burst of Power', 2, 3)],
      [T0 - DAY, XP],
      [T0 - DAY + 1000, PARTY],
      [T0 - DAY + 2000, skill('Offense', 11)],
      [T0 - DAY + 3000, level(30)],
      [T0 - DAY + 4000, points(2, 2)]
    ])
    const v = progressionView(t, T0)
    expect(v.sessions.map((s) => s.start)).toEqual([T0 - DAY, T0 - 2 * DAY, T0 - 9 * DAY])
    expect(v.skills.map((s) => [s.name, s.value, s.ups])).toEqual([
      ['Offense', 11, 2],
      ['Defense', 5, 1]
    ])
    expect(v.purchases.map((p) => p.name)).toEqual(['Burst of Power'])
    expect(v.week).toEqual({ sessions: 2, xp: 2, aaPoints: 2, levels: 1, skillUps: 2 })
  })

  it('is empty with nothing seen', () => {
    expect(progressionView(emptyProgress(), T0)).toEqual({
      levels: [],
      runs: [],
      highest: null,
      skills: [],
      purchases: [],
      points: null,
      sessions: [],
      week: { sessions: 0, xp: 0, aaPoints: 0, levels: 0, skillUps: 0 }
    })
  })
})

describe('ProgressionHistory over a real log', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'lt-progression-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const line = (stamp: string, text: string) => `[${stamp}] ${text}\r\n`

  it('joins the archives and the live log, and picks up new lines', async () => {
    const archiveDir = join(dir, 'archive')
    await fs.mkdir(archiveDir)
    await fs.writeFile(
      join(archiveDir, 'eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-10.txt'),
      line('Tue Sep 01 20:00:00 2026', level(49)) + line('Tue Sep 01 20:10:00 2026', skill('Offense', 200)) + line('Tue Sep 01 20:20:00 2026', XP)
    )
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(
      logPath,
      line('Sun Sep 27 12:00:00 2026', 'You have entered Neriak Commons.') +
        line('Sun Sep 27 12:05:00 2026', 'You gain party experience! (3.5%)') +
        line('Sun Sep 27 12:10:00 2026', level(50)) +
        line('Sun Sep 27 12:15:00 2026', points(2, 6))
    )
    const ph = new ProgressionHistory(new LogHistory(join(dir, 'log-history.json'), { progression: progressionConsumer }), 'progression')
    const where = { logPath, archiveDir, stem: 'eqlog_Kelwyn_neriak' }
    const now = new Date(2026, 8, 27, 13, 0, 0).getTime()

    const first = await ph.view(where, now)
    expect(first.highest).toBe(50)
    expect(first.runs.map((r) => [r.from, r.to])).toEqual([[49, 50]])
    expect(first.sessions).toHaveLength(2)
    expect(first.sessions[0]).toMatchObject({ party: 1, pct: 3.5, levels: 1, aaPoints: 2 })
    expect(first.points).toMatchObject({ total: 6, unspent: 6 })
    expect(first.skills).toMatchObject([{ name: 'Offense', value: 200, ups: 1 }])

    await fs.appendFile(logPath, line('Sun Sep 27 12:20:00 2026', improved('Burst of Power', 2, 4)) + line('Sun Sep 27 12:25:00 2026', skill('Offense', 201)))
    const second = await ph.view(where, now)
    expect(second.sessions).toHaveLength(2)
    expect(second.sessions[0]).toMatchObject({ aaBought: 1, aaSpent: 4, skillUps: 1, end: new Date(2026, 8, 27, 12, 25, 0).getTime() })
    expect(second.points).toMatchObject({ total: 6, spentSince: 4, unspent: 2 })
    expect(second.skills).toMatchObject([{ name: 'Offense', value: 201, ups: 2 }])
    expect(second.week).toMatchObject({ sessions: 1, levels: 1, skillUps: 1 })
  })

  it('reads the archives again for progression when the cache was written without it', async () => {
    const archiveDir = join(dir, 'archive')
    await fs.mkdir(archiveDir)
    await fs.writeFile(join(archiveDir, 'eqlog_Tester_neriak_2026-09-01_to_2026-09-10.txt'), line('Tue Sep 01 20:00:00 2026', skill('Defense', 40)))
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    await fs.writeFile(logPath, line('Sun Sep 27 12:00:00 2026', skill('Defense', 41)))
    const where = { logPath, archiveDir, stem: 'eqlog_Tester_neriak' }
    const cache = join(dir, 'log-history.json')

    // An older build: factions only.
    await new LogHistory(cache, { factions: factionConsumer }).get('factions', where)
    const ph = new ProgressionHistory(new LogHistory(cache, { factions: factionConsumer, progression: progressionConsumer }), 'progression')
    expect((await ph.view(where)).skills).toMatchObject([{ name: 'Defense', value: 41, ups: 2 }])
  })

  it('is empty for a log with no lines', async () => {
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    await fs.writeFile(logPath, '')
    const ph = new ProgressionHistory(new LogHistory(join(dir, 'log-history.json'), { progression: progressionConsumer }), 'progression')
    expect(await ph.view({ logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Tester_neriak' }, T0)).toEqual(progressionView(emptyProgress(), T0))
  })
})
