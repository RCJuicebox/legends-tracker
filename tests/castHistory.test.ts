import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CastHistory } from '../src/main/castHistory'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-casts-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const cast = (stamp: string, spell: string) => `[${stamp}] You begin casting ${spell}.\r\n`

describe('CastHistory', () => {
  it('reads only what the live log has gained, never a line twice, and starts over on a new log', async () => {
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    const cacheFile = join(dir, 'cast-history.json')
    const o = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Kelwyn_neriak', days: 0 }
    await fs.writeFile(logPath, cast('Thu Sep 24 16:00:00 2026', 'Envenomed Bolt X'))
    const h = new CastHistory(cacheFile)
    expect((await h.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1 })

    // A line still being written is not counted until it ends.
    await fs.appendFile(logPath, cast('Thu Sep 24 16:00:10 2026', 'Odium') + '[Thu Sep 24 16:00:20 2026] You begin casting Pla')
    expect((await h.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 1 })
    await fs.appendFile(logPath, 'gue.\r\n')
    expect((await h.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 1, Plague: 1 })

    // The counts and how far they go survive a restart.
    expect(existsSync(cacheFile)).toBe(true)
    expect(existsSync(cacheFile + '.tmp')).toBe(false)
    await fs.appendFile(logPath, cast('Thu Sep 24 16:01:00 2026', 'Odium'))
    expect((await new CastHistory(cacheFile).recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 2, Plague: 1 })

    // Archived away and a new log begun at the same path.
    await fs.rm(logPath)
    await fs.writeFile(logPath, cast('Thu Sep 24 17:00:00 2026', 'Plague'))
    expect((await h.recent(o)).counts).toEqual({ Plague: 1 })
  })
})
