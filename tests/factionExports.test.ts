import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFactionExport } from '../src/features/factions/main'

// Finding a character's factions export in the game folder: the folder holds thousands of files and
// the Factions page asks every few seconds, so it is listed again only when its entries change, and a
// file is parsed again only when the game has written it again.

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'lt-fexport-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

const lines = (...rows: [number, string, number][]) => ['ID\tName\tStandingValue\tPointsToMax', ...rows.map(([id, n, v]) => `${id}\t${n}\t${v}\t${2000 - v}`)].join('\r\n')

/** Writes an export dated `minutesAgo` back, as the game would have written it then. */
async function write(file: string, text: string, minutesAgo: number): Promise<void> {
  await fs.writeFile(join(dir, file), text)
  const t = new Date(Date.now() - minutesAgo * 60_000)
  await fs.utimes(join(dir, file), t, t)
}

describe('the factions export', () => {
  it('is null for a folder that is not there, and for a character with none', async () => {
    expect(await readFactionExport(join(dir, 'nothing'), 'Kelwyn_neriak')).toBeNull()
    await write('Aldric_neriak-CLR-Factions.txt', lines([65, 'Brownies of Faydwer', 10]), 5)
    expect(await readFactionExport(dir, 'Kelwyn_neriak')).toBeNull()
  })

  it('lists the folder again only when its entries change, and takes the newest of a character’s exports', async () => {
    const readdir = vi.spyOn(fs, 'readdir')
    await write('Kelwyn_neriak-MNK-Factions.txt', lines([65, 'Brownies of Faydwer', 10]), 10)
    const first = await readFactionExport(dir, 'Kelwyn_neriak')
    expect(first?.file).toBe('Kelwyn_neriak-MNK-Factions.txt')
    expect(first?.standings).toEqual([{ id: 65, name: 'Brownies of Faydwer', value: 10, toMax: 1990 }])
    const listed = readdir.mock.calls.length
    await readFactionExport(dir, 'kelwyn_neriak')
    expect(readdir.mock.calls.length).toBe(listed)
    // Another class's export, newer: a new entry, so the folder is listed again and it is taken.
    await write('Kelwyn_neriak-SHD-Factions.txt', lines([65, 'Brownies of Faydwer', 40]), 2)
    const second = await readFactionExport(dir, 'Kelwyn_neriak')
    expect(readdir.mock.calls.length).toBeGreaterThan(listed)
    expect(second?.file).toBe('Kelwyn_neriak-SHD-Factions.txt')
    expect(second?.standings[0].value).toBe(40)
  })

  it('reads a file again once the game has written it again, and not before', async () => {
    const readFile = vi.spyOn(fs, 'readFile')
    await write('Kelwyn_neriak-MNK-Factions.txt', lines([65, 'Brownies of Faydwer', 10]), 10)
    await readFactionExport(dir, 'Kelwyn_neriak')
    const reads = readFile.mock.calls.length
    expect((await readFactionExport(dir, 'Kelwyn_neriak'))?.standings[0].value).toBe(10)
    expect(readFile.mock.calls.length).toBe(reads)
    await write('Kelwyn_neriak-MNK-Factions.txt', lines([65, 'Brownies of Faydwer', 25]), 1)
    expect((await readFactionExport(dir, 'Kelwyn_neriak'))?.standings[0].value).toBe(25)
    expect(readFile.mock.calls.length).toBe(reads + 1)
  })
})
