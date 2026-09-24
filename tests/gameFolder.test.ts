import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkGameFolder, isGameFolder, logIsIn, resolveGameFolder } from '../src/main/game'

describe('finding the game folder from what the player picked', () => {
  let root: string
  let game: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lt-game-'))
    game = join(root, 'Daybreak Game Company', 'Installed Games', 'EverQuest Legends')
    mkdirSync(join(game, 'Logs'), { recursive: true })
    writeFileSync(join(game, 'spells_us.txt'), '')
    writeFileSync(join(game, 'Logs', 'eqlog_Kelwyn_neriak.txt'), 'x')
    writeFileSync(join(game, 'Kelwyn_neriak-Inventory.txt'), '')
    writeFileSync(join(game, 'Kelwyn_neriak-Achievements.txt'), '')
    writeFileSync(join(game, 'Kelwyn_neriak_LO1.ini'), '')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('accepts the game folder, its Logs folder, or a folder above it', () => {
    expect(isGameFolder(game)).toBe(true)
    expect(resolveGameFolder(game)).toBe(game)
    expect(resolveGameFolder(join(game, 'Logs'))).toBe(game)
    expect(resolveGameFolder(join(root, 'Daybreak Game Company', 'Installed Games'))).toBe(game)
    expect(resolveGameFolder(root)).toBe(game)
  })

  it('rejects a folder with no game files', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'lt-other-'))
    expect(resolveGameFolder(elsewhere)).toBe('')
    rmSync(elsewhere, { recursive: true, force: true })
  })

  it('reports the logs, inventory and achievement files it holds', async () => {
    expect(await checkGameFolder(game)).toEqual({
      dir: game,
      exists: true,
      spells: true,
      logs: ['Kelwyn_neriak'],
      inventory: ['Kelwyn_neriak'],
      achievements: ['Kelwyn_neriak']
    })
    expect((await checkGameFolder(join(root, 'missing'))).exists).toBe(false)
  })

  it('knows when the chosen log belongs to a different folder', () => {
    expect(logIsIn(join(game, 'Logs', 'eqlog_Kelwyn_neriak.txt'), game)).toBe(true)
    expect(logIsIn('D:\\Old\\EverQuest Legends\\Logs\\eqlog_Kelwyn_neriak.txt', game)).toBe(false)
  })
})
