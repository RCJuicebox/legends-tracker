import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AchievementFiles } from '../../src/main/achievements'
import { log } from '../../src/main/log'
import { sources } from '../../src/main/sources/registry'

// The one reader of a character's achievements export, for the Achievements page, the achievements
// overlay and the Factions page: read once each time the game writes it, and what the page shows when
// it is not there or cannot be read.

const EXPORT = ['EverQuest: Progression', 'I\tCrimson Hands', 'I\t\tCrimson Hands', 'Untapped Potential: Races', 'I\tRace Unlock - Wood Elf'].join('\r\n')

describe('AchievementFiles, reading the achievements export', () => {
  const row = () => sources.list().find((r) => r.id === 'exports')
  let files: AchievementFiles | null = null
  function setup(folder: string) {
    files = new AchievementFiles(
      mkdtempSync(join(tmpdir(), 'lt-ach-data-')),
      () => folder,
      () => {}
    )
    return files
  }

  afterEach(() => {
    files?.stop()
    vi.restoreAllMocks()
  })

  it('reads the export once each time the game writes it', async () => {
    const game = mkdtempSync(join(tmpdir(), 'lt-ach-game-'))
    const files = setup(game)
    const path = join(game, 'Tester_neriak-Achievements.txt')

    // None yet: the page asks for one.
    expect(await files.exported('Tester_neriak')).toBeNull()
    expect(await files.load('Tester_neriak')).toMatchObject({ character: 'Tester_neriak', file: 'Tester_neriak-Achievements.txt', sections: [], error: 'missing' })
    expect(row()).toMatchObject({ status: 'missing', detail: 'No Tester_neriak-Achievements.txt yet: type /outputfile achievements in game.' })

    writeFileSync(path, EXPORT)
    const first = await files.exported('Tester_neriak')
    expect(first?.file).toBe('Tester_neriak-Achievements.txt')
    expect(first?.sections.length).toBeGreaterThan(0)
    const view = await files.load('Tester_neriak')
    expect(view).toMatchObject({ error: '', modified: first?.modified, marks: { ticks: [], broken: [] } })
    // The same parse, not a second one.
    expect(view.sections).toBe(first?.sections)
    expect(row()?.status).toBe('ok')

    // Written again: read again.
    writeFileSync(path, EXPORT.split('\r\n').slice(0, 3).join('\r\n'))
    const later = new Date(Date.now() + 60_000)
    utimesSync(path, later, later)
    const again = await files.exported('Tester_neriak')
    expect(again?.sections).not.toBe(first?.sections)
    expect(again?.modified).toBe(later.getTime())
  })

  it('says why when there is no export to read', async () => {
    const game = mkdtempSync(join(tmpdir(), 'lt-ach-game-'))
    // No game folder chosen.
    expect(await setup('').exported('Tester_neriak')).toBeNull()
    const files = setup(game)
    expect(await files.readExport('../x')).toBeNull()
    expect(await files.load('../x')).toMatchObject({ character: '../x', error: 'Not a character name.' })
    expect(await files.load('')).toMatchObject({ character: '', error: 'No character chosen.' })

    // Not a file the game wrote: the page shows why, and what only uses it logs it and goes on.
    mkdirSync(join(game, 'Tester_qeynos-Achievements.txt'))
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const view = await files.load('Tester_qeynos')
    expect(view.error).not.toBe('')
    expect(view.sections).toEqual([])
    expect(row()).toMatchObject({ status: 'error', detail: 'Tester_qeynos-Achievements.txt' })
    await expect(files.readExport('Tester_qeynos')).rejects.toThrow()
    expect(await files.exported('Tester_qeynos')).toBeNull()
    expect(warn).toHaveBeenCalledWith("Could not read Tester_qeynos's achievements export:", expect.any(Error))
  })
})
