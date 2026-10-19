import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AchievementHistory, completionsConsumer, snapshotOf } from '../../src/main/achievementHistory'
import { LogHistory } from '../../src/main/sources/logHistory'
import { parseAchievements } from '../../src/core/achievements'
import { tempDir } from '../tempDir'

// Progress over time (FEAT-032): the log's completions, and a snapshot of each new export.

let dir: string
beforeEach(() => {
  dir = tempDir('lt-ach-history-')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

const sections = (done: boolean, kills: number) =>
  parseAchievements(
    [
      'Slayer: Conquest',
      `${done ? 'C' : 'I'}\tPuttin' on the Dog`,
      `${done ? 'C' : 'I'}\t\tKill gnolls\t${kills}/100`,
      'General: Skills',
      'C\tShaman Proficiency',
      'C\t\tReach it'
    ].join('\n')
  ).sections

describe('achievements over time (FEAT-032)', () => {
  it('keeps an export small: done by section and the Slayer counts', () => {
    const s = snapshotOf(sections(false, 40), 5)
    expect(s.at).toBe(5)
    expect(s.total).toBe(1)
    expect(s.done).toEqual({ 'General › Skills': 1 })
    expect(s.slayer).toEqual({ "Puttin' on the Dog": 40 })
  })

  it('keeps each newer export that says something new, and reads the completions from the log', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(
      logPath,
      ["[Mon Oct 19 12:00:00 2026] You have completed achievement: Puttin' on the Dog.", '[Mon Oct 19 12:05:00 2026] You have completed achievement: Shaman Proficiency', ''].join(
        '\r\n'
      )
    )
    const h = new AchievementHistory(dir, new LogHistory(join(dir, 'log-history.json'), { completions: completionsConsumer }), 'completions')
    h.add('Kelwyn_neriak', sections(false, 40), 100)
    h.add('Kelwyn_neriak', sections(false, 40), 100)
    // The same counts in a later export: nothing new to keep.
    h.add('Kelwyn_neriak', sections(false, 40), 200)
    h.add('Kelwyn_neriak', sections(true, 100), 300)
    const p = await h.progress(
      'Kelwyn_neriak',
      { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Kelwyn_neriak' },
      Promise.resolve({ '2026-10-19': { 'Guards of Qeynos': 5 } })
    )
    expect(p.snapshots.map((s) => [s.at, s.total])).toEqual([
      [100, 1],
      [300, 2]
    ])
    expect(p.completions.map((c) => c.name)).toEqual(["Puttin' on the Dog", 'Shaman Proficiency'])
    expect(p.factionDays).toEqual({ '2026-10-19': { 'Guards of Qeynos': 5 } })
    await h.flush()
    expect(JSON.parse(await fs.readFile(join(dir, 'achievements-history.json'), 'utf8')).Kelwyn_neriak).toHaveLength(2)
  })
})
