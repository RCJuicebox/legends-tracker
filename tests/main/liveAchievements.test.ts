import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../../src/main/context'
import type { AchievementTrack } from '../../src/shared/tracking'
import type { LogLine } from '../../src/core/logLine'

// When the achievements overlay reads: a moment after the lines that move something, each half for
// its own lines, never two reads at once, and everything every half minute only while something
// shows it. The reads themselves are stood in for; what they read is tested with each part.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => h.dir }))

h.dir = mkdtempSync(join(tmpdir(), 'eql-live-'))
process.env['EQL_USER_DATA'] = h.dir
const { LiveAchievements } = await import('../../src/main/liveAchievements')
const { DEFAULT_CHOICES } = await import('../../src/features/slayer/core')

type Read = 'readMarks' | 'readFaction' | 'readSlayer' | 'readSkills'
type Reads = Record<Read, (character: string) => Promise<void>> & { marks: { character: string; ticks: string[]; tracked: string[] } | null }

const T0 = new Date(2026, 8, 30, 12, 0, 0).getTime()
const FACTION = 'Your faction standing with Emerald Warriors has been adjusted by 5.'
const KILL = 'You have slain a bixie drone!'
const DONE = 'You have completed achievement: Emerald Warriors'
const SKILL = 'You have become better at Tiger Claw! (120)'

function setup() {
  const status = { zone: '', watching: true }
  const windows = { mainShown: true, toMain: () => {} }
  const who = { character: 'Tester_neriak' }
  const published: AchievementTrack[] = []
  const ctx = {
    store: { dir: h.dir, settings: { get: () => ({ achievementCues: false, overlays: [] }) } },
    characterKey: () => who.character,
    engine: { status },
    overlays: { isShown: false, achievements: (t: AchievementTrack) => void published.push(t) },
    windows
  } as unknown as AppContext
  const live = new LiveAchievements(ctx)
  const calls: string[] = []
  /** A read waits for this while set. */
  const hold: { faction: Promise<void> | null } = { faction: null }
  const reads = live as unknown as Reads
  for (const m of ['readMarks', 'readFaction', 'readSlayer', 'readSkills'] as const)
    vi.spyOn(reads, m).mockImplementation(async (character) => {
      calls.push(`${m}:${character}`)
      // As the real one does: the marks are what says whether they were read.
      if (m === 'readMarks') reads.marks = { character, ticks: [], tracked: [] }
      if (m === 'readFaction' && hold.faction) await hold.faction
    })
  const line = (text: string) => live.feature.line?.({ text } as LogLine)
  /** A tick this long after the start, and the reads it began finished. */
  const tick = async (ms: number) => {
    vi.setSystemTime(T0 + ms)
    live.feature.tick?.(T0 + ms)
    await new Promise((r) => setImmediate(r))
  }
  /** What was read since the last time asked. */
  const taken = () => calls.splice(0).map((c) => c.replace(/^read|:.*$/g, ''))
  return { live, status, windows, who, published, hold, line, tick, taken, calls }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LiveAchievements tells the Hunter named', () => {
  it('left in the zone the player is in: the export’s, less those killed since', () => {
    const { live } = setup()
    const inner = live as unknown as {
      character: string
      zone: string
      exported: unknown
      slayer: unknown
      hunterHere: () => unknown
    }
    inner.character = 'Tester_neriak'
    inner.exported = {
      character: 'Tester_neriak',
      file: 'x',
      modified: T0,
      sections: [{ cat: 'EverQuest', name: 'Hunter', ach: [{ n: 'Hunter of Befallen', c: [{ t: 'Skeletal Orc' }, { t: 'Andrew Pine' }, { t: 'Skeleton Grimfiend', d: true }] }] }]
    }
    inner.slayer = { kills: new Map([['a skeletal orc', { name: 'a skeletal orc', times: [T0 + 1000] }]]) }
    expect(inner.hunterHere()).toBeNull()
    inner.zone = 'Befallen 2 (Adaptive)'
    expect(inner.hunterHere()).toEqual({
      zone: 'Befallen 2 (Adaptive)',
      rows: [{ achievement: 'Hunter of Befallen', left: ['Andrew Pine'], total: 3, since: ['Skeletal Orc'] }]
    })
    inner.zone = 'Kedge Keep'
    expect(inner.hunterHere()).toBeNull()
    // Said not to work (Plan › Hunter): not shown.
    Object.assign((live as unknown as { ctx: object }).ctx, { hunter: { isBroken: (a: string) => a === 'Hunter of Befallen' } })
    inner.zone = 'Befallen'
    expect(inner.hunterHere()).toBeNull()
  })
})

describe('LiveAchievements makes the Slayer plan again', () => {
  const goal = (name: string, count: number, max: number) => ({ name, section: 'Slayer: Conquest', races: '', count, max, optional: false, tier: 0 })
  const data = (exportAt: number) => ({
    character: 'Tester_neriak',
    export: { file: 'x', modified: exportAt },
    goals: [goal('Orc Stomp!', 4900, 5000), goal('A Giant Problem', 900, 1000)],
    camps: [
      { id: 'log:Clan Crushbone', zone: 'Clan Crushbone', kinds: [{ name: 'an orc pawn', perHour: 100, goals: [0] }], source: 'log', pace: { 0: 100 } },
      { id: 'log:Permafrost', zone: 'The Permafrost Caverns', kinds: [{ name: 'a frost giant', perHour: 100, goals: [1] }], source: 'log', pace: { 1: 100 } }
    ],
    unplaced: [],
    pending: 0,
    moves: [],
    killSpeed: null,
    timings: [],
    hunter: []
  })

  it('from the counts as they are now, the step in the player’s zone first', async () => {
    const { live } = setup()
    const inner = live as unknown as {
      character: string
      zone: string
      slayer: unknown
      slayerView: unknown
      ctx: Record<string, unknown>
      slayerPlan: AchievementTrack['slayerPlan']
      readSlayerPlan: (c: string) => Promise<void>
    }
    const asked: number[] = []
    inner.ctx.slayer = { forOverlay: async (_c: unknown, _who: string, at: number) => (asked.push(at), { data: data(T0), choices: { ...DEFAULT_CHOICES, overlay: true } }) }
    inner.character = 'Tester_neriak'
    inner.slayer = { character: 'Tester_neriak' }
    // Ninety orcs since the export: ten to go, a quarter hour's kills, against the giants' hour.
    inner.slayerView = { exportAt: T0, rows: [{ name: 'Orc Stomp!', count: 4900, since: 90, done: false }] }
    await inner.readSlayerPlan('Tester_neriak')
    expect(asked).toEqual([T0])
    expect(inner.slayerPlan?.current).toMatchObject({ index: 0, zone: 'Clan Crushbone', here: false, goals: [{ name: 'Orc Stomp!', count: 4990, max: 5000 }] })
    expect(inner.slayerPlan?.current?.mobs).toEqual([{ name: 'an orc pawn', n: 10 }])
    expect(inner.slayerPlan?.next?.zone).toBe('The Permafrost Caverns')
    inner.zone = 'The Permafrost Caverns'
    await inner.readSlayerPlan('Tester_neriak')
    expect(inner.slayerPlan?.current).toMatchObject({ zone: 'The Permafrost Caverns', here: true })
    // The game said Orc Stomp! was done: only the giants are left.
    inner.slayerView = { exportAt: T0, rows: [{ name: 'Orc Stomp!', count: 4900, since: 0, done: true }] }
    await inner.readSlayerPlan('Tester_neriak')
    expect([inner.slayerPlan?.steps, inner.slayerPlan?.next]).toEqual([1, null])
    // Data for another export than the counts', or a character that does not show it: nothing.
    inner.slayerView = { exportAt: T0 + 1, rows: [] }
    await inner.readSlayerPlan('Tester_neriak')
    expect(inner.slayerPlan).toBeNull()
    inner.ctx.slayer = { forOverlay: async () => null }
    inner.slayerView = { exportAt: T0, rows: [] }
    await inner.readSlayerPlan('Tester_neriak')
    expect(inner.slayerPlan).toBeNull()
  })

  it('on entering a zone, and at once when the choices change', async () => {
    const s = setup()
    const made: string[] = []
    vi.spyOn(s.live as unknown as { readSlayerPlan: (c: string) => Promise<void> }, 'readSlayerPlan').mockImplementation(async (c) => void made.push(c))
    s.status.zone = 'Clan Crushbone'
    await s.tick(0)
    expect(made).toEqual(['Tester_neriak'])
    await s.tick(1000)
    expect(made).toHaveLength(1)
    s.live.slayerChoicesChanged('Someone_else')
    await s.tick(2000)
    expect(made).toHaveLength(1)
    s.live.slayerChoicesChanged('Tester_neriak')
    await s.tick(3000)
    expect(made).toHaveLength(2)
  })
})

describe('LiveAchievements reads', () => {
  it('nothing while nothing shows the track and no line moved anything', async () => {
    const s = setup()
    for (const ms of [0, 1000, 31_000, 61_000]) await s.tick(ms)
    expect(s.taken()).toEqual([])
    expect(s.published).toEqual([])
  })

  it('the standings a moment after a faction line, and only once', async () => {
    const s = setup()
    s.line(FACTION)
    await s.tick(500)
    expect(s.taken()).toEqual([])
    await s.tick(800)
    // The marks the first time, for the tracked achievements.
    expect(s.taken()).toEqual(['Marks', 'Faction'])
    expect(s.published.map((t) => t.character)).toEqual(['Tester_neriak'])
    await s.tick(5000)
    expect(s.taken()).toEqual([])
  })

  it('waits for a burst to settle: each line puts the read off again', async () => {
    const s = setup()
    s.line(FACTION)
    await s.tick(600)
    s.line(FACTION)
    await s.tick(1000)
    expect(s.taken()).toEqual([])
    await s.tick(1400)
    expect(s.taken()).toEqual(['Marks', 'Faction'])
  })

  it('each half for its own lines: kills the Slayer counts, a completion both, a skill-up the skills', async () => {
    const s = setup()
    s.line(KILL)
    // Kills settle five seconds: in an AoE grind they come a second or two apart (LT-383).
    await s.tick(800)
    expect(s.taken()).toEqual([])
    await s.tick(5000)
    expect(s.taken()).toEqual(['Marks', 'Slayer'])
    vi.setSystemTime(T0 + 6000)
    s.line('A bixie drone died.')
    await s.tick(11_000)
    expect(s.taken()).toEqual(['Slayer'])
    vi.setSystemTime(T0 + 12_000)
    s.line(DONE)
    await s.tick(12_800)
    expect(s.taken()).toEqual(['Faction', 'Slayer'])
    vi.setSystemTime(T0 + 13_000)
    s.line(SKILL)
    await s.tick(13_800)
    expect(s.taken()).toEqual(['Skills'])
    vi.setSystemTime(T0 + 14_000)
    s.line('You say, "Hail, Tracker Tildey"')
    await s.tick(14_800)
    expect(s.taken()).toEqual([])
  })

  it('reads kills that keep coming at least every fifteen seconds', async () => {
    const s = setup()
    s.taken()
    for (let t = 0; t <= 16_000; t += 2000) {
      vi.setSystemTime(T0 + t)
      s.line(KILL)
      await s.tick(t + 1)
      if (t < 15_000) expect(s.taken(), `at ${t}`).not.toContain('Slayer')
    }
    expect(s.taken()).toContain('Slayer')
  })

  it('not two at once: lines during a read are read after it', async () => {
    const s = setup()
    let release = () => {}
    s.hold.faction = new Promise<void>((r) => (release = r))
    s.line(FACTION)
    await s.tick(800)
    expect(s.taken()).toEqual(['Marks', 'Faction'])
    vi.setSystemTime(T0 + 900)
    s.line(FACTION)
    await s.tick(2000)
    expect(s.taken()).toEqual([])
    s.hold.faction = null
    release()
    await s.tick(2000)
    await s.tick(2000)
    expect(s.taken()).toEqual(['Faction'])
  })

  it('everything each half minute while a page shows the track, and not once it closed or the window is hidden', async () => {
    const s = setup()
    s.live.watch(true)
    await s.tick(0)
    expect(s.taken()).toEqual(['Marks', 'Faction', 'Slayer', 'Skills'])
    await s.tick(10_000)
    expect(s.taken()).toEqual([])
    await s.tick(30_000)
    expect(s.taken()).toEqual(['Marks', 'Faction', 'Slayer', 'Skills'])
    s.windows.mainShown = false
    await s.tick(60_000)
    expect(s.taken()).toEqual([])
    s.windows.mainShown = true
    s.live.watch(false)
    await s.tick(90_000)
    expect(s.taken()).toEqual([])
  })

  it('everything at once when a page opens, however recent the last sweep', async () => {
    const s = setup()
    s.live.watch(true)
    await s.tick(0)
    s.taken()
    s.live.watch(false)
    vi.setSystemTime(T0 + 5000)
    s.live.watch(true)
    await s.tick(5000)
    expect(s.taken()).toEqual(['Marks', 'Faction', 'Slayer', 'Skills'])
  })

  it('a page that stops saying it is open stops the sweep after a minute and a half', async () => {
    const s = setup()
    s.live.watch(true)
    await s.tick(0)
    await s.tick(60_000)
    expect(s.taken()).toEqual(['Marks', 'Faction', 'Slayer', 'Skills', 'Marks', 'Faction', 'Slayer', 'Skills'])
    await s.tick(90_000)
    expect(s.taken()).toEqual([])
  })

  it('the standings at once on entering a zone: the step worked on can be there', async () => {
    const s = setup()
    s.status.zone = 'Greater Faydark'
    await s.tick(0)
    expect(s.taken()).toEqual(['Marks', 'Faction'])
    await s.tick(1000)
    expect(s.taken()).toEqual([])
    s.status.zone = 'Kelethin'
    await s.tick(2000)
    expect(s.taken()).toEqual(['Faction'])
  })

  it('nothing while the log is not watched or no character is known, and what waited once it is', async () => {
    const s = setup()
    s.status.watching = false
    s.line(FACTION)
    await s.tick(1000)
    expect(s.taken()).toEqual([])
    s.status.watching = true
    s.who.character = ''
    await s.tick(2000)
    expect(s.taken()).toEqual([])
    s.who.character = 'Tester_neriak'
    await s.tick(3000)
    expect(s.taken()).toEqual(['Marks', 'Faction'])
  })

  it("for the character played: another one's read is not told, and the new one is read afresh", async () => {
    const s = setup()
    let release = () => {}
    s.hold.faction = new Promise<void>((r) => (release = r))
    s.line(FACTION)
    await s.tick(800)
    s.who.character = 'Tester_qeynos'
    await s.tick(900)
    s.hold.faction = null
    release()
    await s.tick(900)
    expect(s.published).toEqual([])
    s.line(FACTION)
    await s.tick(1800)
    expect(s.calls).toEqual(['readMarks:Tester_neriak', 'readFaction:Tester_neriak', 'readMarks:Tester_qeynos', 'readFaction:Tester_qeynos'])
    expect(s.published.map((t) => t.character)).toEqual(['Tester_qeynos'])
  })

  it('tells the overlay and the pages only what changed', async () => {
    const s = setup()
    s.line(FACTION)
    await s.tick(800)
    vi.setSystemTime(T0 + 1000)
    s.line(FACTION)
    await s.tick(1800)
    expect(s.taken()).toEqual(['Marks', 'Faction', 'Faction'])
    expect(s.published).toHaveLength(1)
    expect(s.live.view?.character).toBe('Tester_neriak')
  })
})

describe('LiveAchievements counts Slayer kills since the export', () => {
  it("in the character's log on another PC too: in time order, each log read on from where it got to, one out of reach left alone", async () => {
    const { live } = setup()
    const { promises: fs } = await import('node:fs')
    const root = mkdtempSync(join(tmpdir(), 'eql-slayer-'))
    const here = join(root, 'eqlog_Tester_neriak.txt')
    const there = join(root, 'there', 'Logs')
    const otherLog = join(there, 'eqlog_Tester_neriak.txt')
    await fs.mkdir(there, { recursive: true })
    const kill = (stamp: string) => `[${stamp}] You have slain a gnoll!\r\n`
    // Before the export, then after it on this PC and on the other in turn.
    await fs.writeFile(here, kill('Wed Sep 30 11:59:00 2026') + kill('Wed Sep 30 12:00:10 2026') + kill('Wed Sep 30 12:05:00 2026'))
    await fs.writeFile(otherLog, kill('Wed Sep 30 11:58:00 2026') + kill('Wed Sep 30 12:01:40 2026'))
    let answers = true
    Object.assign((live as unknown as { ctx: object }).ctx, {
      historyOf: () => ({
        logPath: here,
        archiveDir: join(root, 'archive'),
        stem: 'eqlog_Tester_neriak',
        elsewhere: [{ folder: there, logPath: otherLog, archiveDir: join(there, 'archive') }]
      }),
      logHistory: { reachable: async () => answers }
    })
    Object.assign((live as unknown as { ctx: { engine: object } }).ctx.engine, { meter: { kindOf: () => ({ kind: 'mob' }) } })
    const s = {
      character: 'Tester_neriak',
      exportAt: T0,
      logPath: here,
      readTo: -1,
      others: new Map<string, number>(),
      kills: new Map<string, { name: string; times: number[] }>(),
      pets: new Set<string>(),
      engaged: new Map<string, number>(),
      completed: new Map<string, number>(),
      counts: new Map<string, number>()
    }
    const readLog = (live as unknown as { readLog: (state: typeof s) => Promise<void> }).readLog.bind(live)
    const at = (hms: string) => new Date(`2026-09-30T${hms}`).getTime()
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toEqual([at('12:00:10'), at('12:01:40'), at('12:05:00')])
    expect(s.readTo).toBe((await fs.stat(here)).size)
    expect(s.others.get(otherLog.toLowerCase())).toBe((await fs.stat(otherLog)).size)

    await fs.appendFile(otherLog, kill('Wed Sep 30 12:06:40 2026'))
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(4)

    // That PC off: its log is not touched, and what it counted stands.
    answers = false
    await fs.appendFile(otherLog, kill('Wed Sep 30 12:08:00 2026'))
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(4)
    answers = true
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(5)
    await fs.rm(root, { recursive: true, force: true })
  })
})
