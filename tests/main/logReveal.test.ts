import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../../src/main/context'

// The handler is caught as registerLogIpc hands it to ipcMain; the shell only records what it was asked to show.
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
const shown: string[] = []
const opened: string[] = []
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => void handlers.set(channel, fn) },
  shell: {
    showItemInFolder: (p: string) => void shown.push(p),
    openPath: async (p: string) => {
      opened.push(p)
      return ''
    }
  }
}))

const { registerLogIpc } = await import('../../src/main/ipc/logs')
const { isInside } = await import('../../src/core/paths')
const { rendererUrl } = await import('../../src/main/push')

const root = mkdtempSync(join(tmpdir(), 'lt-reveal-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const game = join(root, 'EverQuest Legends')
const logs = join(game, 'Logs')
const archive = join(root, 'profile', 'log-archive')
const elsewhere = join(root, 'elsewhere')
for (const d of [logs, archive, elsewhere, join(game, 'LogsOld')]) mkdirSync(d, { recursive: true })
const file = (...parts: string[]) => {
  const p = join(...parts)
  writeFileSync(p, 'x')
  return p
}
const liveLog = file(logs, 'eqlog_Tester_neriak.txt')
const zipped = file(archive, 'eqlog_Tester_neriak_2026-09-01_to_2026-09-10.zip')
const outside = file(elsewhere, 'secret.txt')
const gameFile = file(game, 'eqclient.ini')
const lookalike = file(game, 'LogsOld', 'eqlog_Tester_neriak.txt')

describe('isInside', () => {
  it('holds for the folder itself and anything under it', () => {
    expect(isInside(logs, logs)).toBe(true)
    expect(isInside(logs, liveLog)).toBe(true)
    expect(isInside(logs, join(logs, 'deeper', 'still', 'x.txt'))).toBe(true)
  })

  it('does not hold for a parent, a sibling or a folder whose name only starts the same', () => {
    expect(isInside(logs, game)).toBe(false)
    expect(isInside(logs, gameFile)).toBe(false)
    expect(isInside(logs, lookalike)).toBe(false)
    expect(isInside(logs, outside)).toBe(false)
  })

  it('sees through .. in the path', () => {
    expect(isInside(logs, join(logs, '..', 'eqclient.ini'))).toBe(false)
    expect(isInside(logs, `${logs}/../../elsewhere/secret.txt`)).toBe(false)
    expect(isInside(logs, join(logs, 'sub', '..', 'eqlog_Tester_neriak.txt'))).toBe(true)
  })

  it.runIf(process.platform === 'win32')('treats letter case alike and another drive as outside, on Windows', () => {
    expect(isInside('C:\\Games\\EQ\\Logs', 'c:\\games\\eq\\logs\\eqlog_Tester_neriak.txt')).toBe(true)
    expect(isInside('C:\\Games\\EQ\\Logs', 'D:\\Games\\EQ\\Logs\\eqlog_Tester_neriak.txt')).toBe(false)
  })

  it('holds for a file in the folder whose name starts with two dots', () => {
    expect(isInside(logs, join(logs, '..notes.txt'))).toBe(true)
  })
})

describe('logs:reveal', () => {
  let installDir = game
  const ctx = {
    installDir: () => installDir,
    engine: { archives: { archiveDir: () => archive } }
  } as unknown as AppContext
  registerLogIpc(ctx)
  // The app's main window, from its own renderer folder.
  const event = { senderFrame: { url: rendererUrl() + 'index.html' } }
  const reveal = (path: unknown) => handlers.get('logs:reveal')!(event, path)

  beforeEach(() => {
    installDir = game
    shown.length = 0
    opened.length = 0
  })

  it('shows a log in the game’s Logs folder', async () => {
    await reveal(liveLog)
    expect(shown).toEqual([liveLog])
    expect(opened).toEqual([])
  })

  it('shows an archive in the archive folder', async () => {
    await reveal(zipped)
    expect(shown).toEqual([zipped])
  })

  it('refuses a file anywhere else and opens the archive folder instead', async () => {
    for (const p of [outside, gameFile, lookalike, join(logs, '..', 'eqclient.ini')]) await reveal(p)
    expect(shown).toEqual([])
    expect(opened).toEqual([archive, archive, archive, archive])
  })

  it('opens the archive folder for an allowed path that does not exist', async () => {
    await reveal(join(logs, 'eqlog_Nobody_neriak.txt'))
    expect(shown).toEqual([])
    expect(opened).toEqual([archive])
  })

  it('opens the archive folder for anything that is not a path', async () => {
    for (const p of ['', undefined, null, 42, { path: liveLog }, [liveLog]]) await reveal(p)
    expect(shown).toEqual([])
    expect(opened.length).toBe(6)
  })

  it('allows only the archive folder while no game folder is set', async () => {
    installDir = ''
    await reveal(liveLog)
    await reveal(zipped)
    expect(shown).toEqual([zipped])
    expect(opened).toEqual([archive])
  })

  it('answers nothing to a page that is not the app’s own', async () => {
    await expect(handlers.get('logs:reveal')!({ senderFrame: { url: 'https://example.com/' } }, liveLog)).rejects.toThrow('Not allowed.')
    expect(shown).toEqual([])
    expect(opened).toEqual([])
  })
})
