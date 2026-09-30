import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CastHistory, castCounter, dayConsumer } from '../src/main/castHistory'
import { LogHistory } from '../src/main/sources/logHistory'

const casts = (cacheFile: string) => {
  const history = new LogHistory(cacheFile, { casts: dayConsumer(castCounter) })
  return { casts: new CastHistory(history, 'casts'), history }
}

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
    const cacheFile = join(dir, 'log-history.json')
    const o = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Kelwyn_neriak', days: 0 }
    await fs.writeFile(logPath, cast('Thu Sep 24 16:00:00 2026', 'Envenomed Bolt X'))
    const h = casts(cacheFile)
    expect((await h.casts.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1 })

    // A line still being written is not counted until it ends.
    await fs.appendFile(logPath, cast('Thu Sep 24 16:00:10 2026', 'Odium') + '[Thu Sep 24 16:00:20 2026] You begin casting Pla')
    expect((await h.casts.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 1 })
    await fs.appendFile(logPath, 'gue.\r\n')
    expect((await h.casts.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 1, Plague: 1 })

    // The counts and how far they go survive a restart (the cache is written at quit, or a while after a change).
    await h.history.flush()
    expect(existsSync(cacheFile)).toBe(true)
    expect(existsSync(cacheFile + '.tmp')).toBe(false)
    await fs.appendFile(logPath, cast('Thu Sep 24 16:01:00 2026', 'Odium'))
    expect((await casts(cacheFile).casts.recent(o)).counts).toEqual({ 'Envenomed Bolt X': 1, Odium: 2, Plague: 1 })

    // Archived away and a new log begun at the same path.
    await fs.rm(logPath)
    await fs.writeFile(logPath, cast('Thu Sep 24 17:00:00 2026', 'Plague'))
    expect((await h.casts.recent(o)).counts).toEqual({ Plague: 1 })
  })
})
