import { describe, expect, it } from 'vitest'
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXPORT_SETTLE_MS, gameFolderNames, SettledReads } from '../../src/main/exportFiles'
import { tempDir } from '../tempDir'

// The game's exports read one way (LT-633): once a write, and not while the write is fresh.

describe('SettledReads', () => {
  it('reads a file once a write, and again once the game writes it again', async () => {
    const dir = tempDir('lt-exports-')
    const path = join(dir, 'Kelwyn_neriak-Inventory.txt')
    let parsed = 0
    const reads = new SettledReads((t) => (parsed++, t.trim()))
    const old = new Date(Date.now() - 60_000)
    writeFileSync(path, 'one\n')
    utimesSync(path, old, old)
    expect((await reads.read(path)).value).toBe('one')
    expect((await reads.read(path)).value).toBe('one')
    expect(parsed).toBe(1)
    writeFileSync(path, 'two\n')
    const older = new Date(Date.now() - 30_000)
    utimesSync(path, older, older)
    expect((await reads.read(path)).value).toBe('two')
    expect(parsed).toBe(2)
  })

  it('waits out a fresh write before reading it', async () => {
    const dir = tempDir('lt-exports-')
    const path = join(dir, 'Kelwyn_neriak-Achievements.txt')
    writeFileSync(path, 'whole\n')
    const started = Date.now()
    const r = await new SettledReads((t) => t.trim()).read(path)
    expect(r.value).toBe('whole')
    expect(Date.now() - started).toBeGreaterThanOrEqual(EXPORT_SETTLE_MS - 100)
  })

  it('throws as the file system does for a file that is not there', async () => {
    await expect(new SettledReads((t) => t).read(join(tempDir('lt-exports-'), 'none.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('gameFolderNames', () => {
  it('lists the folder again only when its entries change', async () => {
    const dir = tempDir('lt-exports-')
    writeFileSync(join(dir, 'a.txt'), '')
    const first = await gameFolderNames(dir)
    expect(first).toEqual(['a.txt'])
    expect(await gameFolderNames(dir)).toBe(first)
    writeFileSync(join(dir, 'b.txt'), '')
    // An entry added: the folder's own time moves (set here, as a second write in the same tick may not).
    const later = new Date(Date.now() + 5000)
    utimesSync(dir, later, later)
    expect((await gameFolderNames(dir)).sort()).toEqual(['a.txt', 'b.txt'])
  })
})
