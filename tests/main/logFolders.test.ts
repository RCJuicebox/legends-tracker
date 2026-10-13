import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogFolders } from '../../src/main/logFolders'
import { listLogsIn, logsFolderOf } from '../../src/main/game'
import type { LogFileInfo } from '../../src/shared/types'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-folders-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const quick = { lookMs: 1000, awayMs: 1000, waitMs: 50 }

describe("other PCs' Logs folders", () => {
  it('lists the character logs in a folder that answers, and calls one that is not there out of reach', async () => {
    const there = join(dir, 'Logs')
    await fs.mkdir(there)
    await fs.writeFile(join(there, 'eqlog_Kelwyn_neriak.txt'), 'x')
    await fs.writeFile(join(there, 'notes.txt'), 'x')
    const missing = join(dir, 'Gone')
    const folders = new LogFolders(() => [there, missing], listLogsIn, quick)
    const [a, b] = await folders.lookAll()
    expect(a).toMatchObject({ dir: there, reachable: true, error: '' })
    expect(a.logs.map((l) => l.character)).toEqual(['Kelwyn_neriak'])
    expect(b).toMatchObject({ dir: missing, reachable: false, logs: [] })
    expect(await folders.logs()).toMatchObject([{ character: 'Kelwyn_neriak', folder: there }])
  })

  it('looks no more often than it should, and again when told to', async () => {
    let looks = 0
    const folders = new LogFolders(
      () => [dir],
      async () => {
        looks++
        return []
      },
      quick
    )
    await folders.look(dir)
    await folders.look(dir)
    expect(looks).toBe(1)
    await folders.lookAll(true)
    expect(looks).toBe(2)
  })

  it('does not wait on a folder that does not answer: out of reach, keeping what it held, with one look at a time', async () => {
    const held: LogFileInfo = { path: join(dir, 'eqlog_Kelwyn_neriak.txt'), name: 'eqlog_Kelwyn_neriak.txt', character: 'Kelwyn_neriak', size: 1, modified: 1 }
    let hang = false
    let looks = 0
    const folders = new LogFolders(
      () => [dir],
      async () => {
        looks++
        // A network share whose PC has gone: the look never ends while the test runs.
        if (hang) await new Promise(() => {})
        return [held]
      },
      { lookMs: 0, awayMs: 0, waitMs: 50 }
    )
    expect(await folders.reachable(dir)).toBe(true)
    hang = true
    const started = Date.now()
    const look = await folders.look(dir)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(look).toMatchObject({ reachable: false, logs: [held], error: 'Not answering' })
    // Still looking: asking again starts no second look.
    expect(await folders.reachable(dir)).toBe(false)
    expect(looks).toBe(2)
  })

  it('keeps no look of a folder taken off the list while it was being looked at', async () => {
    let dirs = [dir]
    const folders = new LogFolders(
      () => dirs,
      async () => [],
      quick
    )
    const pending = folders.look(dir)
    dirs = []
    await pending
    expect(await folders.lookAll()).toEqual([])
  })
})

describe('the Logs folder of a folder picked', () => {
  it("takes a game folder's Logs, and any other folder as it is", async () => {
    const game = join(dir, 'EverQuest Legends')
    await fs.mkdir(join(game, 'Logs'), { recursive: true })
    await fs.writeFile(join(game, 'spells_us.txt'), '')
    expect(logsFolderOf(game)).toBe(join(game, 'Logs'))
    expect(logsFolderOf(join(game, 'Logs'))).toBe(join(game, 'Logs'))
    expect(logsFolderOf(join(dir, 'SharedLogs'))).toBe(join(dir, 'SharedLogs'))
  })
})
