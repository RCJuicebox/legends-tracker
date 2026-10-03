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

h.dir = mkdtempSync(join(tmpdir(), 'eql-live-'))
process.env['EQL_USER_DATA'] = h.dir
const { LiveAchievements } = await import('../../src/main/liveAchievements')

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
