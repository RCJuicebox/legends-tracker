import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { OtherMotes } from '../../src/main/engine/otherMotes'
import { MoteTracker, type MoteSession, type MoteState } from '../../src/core/motes'
import { absorbOther } from '../../src/core/moteMerge'
import { tempDir } from '../tempDir'

// Motes looted on another PC: its log read on from where it was last read, motes handed over as they
// come and runs once they are over, never twice.

let dir: string
beforeEach(async () => {
  dir = tempDir('lt-other-motes-')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const lines = (...l: string[]) => l.map((x) => x + '\r\n').join('')
const ENTER = '[Thu Sep 24 11:06:56 2026] You have entered The Plane of Fear 4 (Refined).'
const TOAD = "[Thu Sep 24 11:08:17 2026] You looted a Mote of Major Potential from a turmoil toad's corpse and stored it in your currency"
const DONE = '[Thu Sep 24 12:14:06 2026] You have completed the Dungeon Crawl and earned reward loot!'
const CHEST = '[Thu Sep 24 12:14:06 2026] You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency'
const LATER = '[Thu Sep 24 12:20:00 2026] You have entered The Plane of Fear.'
const NEXT_DAY = "[Fri Sep 25 09:00:00 2026] You looted a Mote of Superior Potential from a boogeyman's corpse and stored it in your currency"

const empty = (): MoteState => ({ active: null, sessions: [], daily: {} })

function setUp(o: { quiet?: boolean } = {}) {
  const there = join(dir, 'there')
  const log = join(there, 'eqlog_Kelwyn_neriak.txt')
  const data = join(dir, 'data')
  const look = { reachable: true, modified: o.quiet ? Date.now() - 31 * 60_000 : Date.now() }
  const folders = { lookAll: async () => [{ dir: there, reachable: look.reachable, logs: [{ path: log, modified: look.modified }] }] }
  const motes = new MoteTracker(empty(), { onChange: () => {} })
  const state = { busy: false, changed: 0 }
  const make = () =>
    new OtherMotes(data, folders, {
      motes: () => motes,
      busy: () => state.busy,
      changed: () => state.changed++
    })
  return { there, log, data, look, motes, state, make }
}

describe("motes from another PC's log", () => {
  it('hands over its motes as they come and a run once it is over, each once', async () => {
    const s = setUp()
    await fs.mkdir(s.there, { recursive: true })
    await fs.mkdir(s.data, { recursive: true })
    await fs.writeFile(s.log, lines(ENTER, TOAD, DONE, CHEST))
    const others = s.make()
    await others.check()
    expect(s.motes.state.daily).toEqual({ '2026-09-24': { major: 5 } })
    // The crawl has only just ended: a chest may still be coming.
    expect(s.motes.state.sessions).toEqual([])

    await fs.appendFile(s.log, lines(LATER))
    await others.check()
    expect(s.motes.state.daily).toEqual({ '2026-09-24': { major: 5 } })
    expect(s.motes.state.sessions).toMatchObject([{ kind: 'crawl', name: 'The Plane of Fear 4 (Refined)', motes: { major: 5 } }])
    const changed = s.state.changed
    await others.check()
    expect(s.state.changed).toBe(changed)

    // The next start goes on from where this one got to.
    await fs.appendFile(s.log, lines(NEXT_DAY))
    await s.make().check()
    expect(s.motes.state.daily).toEqual({ '2026-09-24': { major: 5 }, '2026-09-25': { superior: 1 } })
    expect(s.motes.state.sessions).toHaveLength(1)
  })

  it('ends a run in a log long quiet: that PC has most likely closed the game', async () => {
    const s = setUp({ quiet: true })
    await fs.mkdir(s.there, { recursive: true })
    await fs.mkdir(s.data, { recursive: true })
    await fs.writeFile(s.log, lines(ENTER, TOAD))
    await s.make().check()
    expect(s.motes.state.sessions).toMatchObject([{ kind: 'instance', outcome: 'game closed', motes: { major: 1 } }])
    expect(s.motes.state.active).toBeNull()
  })

  it('hands nothing over while history is read, and reads it all next time', async () => {
    const s = setUp()
    await fs.mkdir(s.there, { recursive: true })
    await fs.mkdir(s.data, { recursive: true })
    await fs.writeFile(s.log, lines(ENTER, TOAD))
    const others = s.make()
    s.state.busy = true
    await others.check()
    expect(s.motes.state.daily).toEqual({})
    s.state.busy = false
    await others.check()
    expect(s.motes.state.daily).toEqual({ '2026-09-24': { major: 1 } })
  })

  it('gives a rebuild the logs that answer, a stand-in for one that does not, and goes on from where the rebuild read to', async () => {
    const s = setUp()
    await fs.mkdir(s.there, { recursive: true })
    await fs.mkdir(s.data, { recursive: true })
    await fs.writeFile(s.log, lines(ENTER, TOAD, DONE, CHEST, LATER))
    const others = s.make()
    expect((await others.forRebuild()).logs).toEqual([{ logPath: s.log, stem: 'eqlog_Kelwyn_neriak', archiveDir: join(s.there, 'archive') }])
    await others.check()

    // That PC off: what its log held stands in, so its motes stay in the days the rebuild covers.
    s.look.reachable = false
    const off = await others.forRebuild()
    expect(off.logs).toEqual([])
    expect(off.standIns).toMatchObject([{ logPath: s.log, state: { active: null, sessions: [], daily: { '2026-09-24': { major: 5 } } } }])

    // A rebuild read the log to its end: the next look counts only what follows.
    s.look.reachable = true
    const size = (await fs.stat(s.log)).size
    await others.rebuilt([{ logPath: s.log, stem: 'eqlog_Kelwyn_neriak', state: { active: null, sessions: [], daily: { '2026-09-24': { major: 5 } } }, lastTime: 0, end: size }])
    s.motes.state = empty()
    await fs.appendFile(s.log, lines(NEXT_DAY))
    await others.check()
    expect(s.motes.state.daily).toEqual({ '2026-09-25': { superior: 1 } })
  })
})

describe('absorbOther', () => {
  const run = (id: string, startedAt: number): MoteSession => ({
    id,
    kind: 'instance',
    name: 'Befallen 1 (Awakened)',
    startedAt,
    endedAt: startedAt + 60_000,
    outcome: 'abandoned',
    motes: { major: 1 },
    outsideSince: null,
    outsideMs: 0
  })

  it("adds another PC's motes to the days and its runs to the history, newest first, a run already there not twice", () => {
    const kept: MoteState = { active: null, sessions: [run('a', 1000)], daily: { '2026-09-24': { major: 2 } } }
    const next = absorbOther(kept, { '2026-09-24': { major: 1, superior: 1 }, '2026-09-25': { minor: 3 } }, [run('b', 5000), run('a', 1000)])
    expect(next.daily).toEqual({ '2026-09-24': { major: 3, superior: 1 }, '2026-09-25': { minor: 3 } })
    expect(next.sessions.map((x) => x.id)).toEqual(['b', 'a'])
    expect(kept.daily['2026-09-24']).toEqual({ major: 2 })
  })
})
