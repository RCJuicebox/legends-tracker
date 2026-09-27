import { shell } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { handle } from './handle'
import { listLogs } from '../game'
import type { AppContext } from '../context'

// The Log Files page: the character logs, their archives, and archiving.

/** Whether `path` is `dir` or somewhere inside it. */
export function isInside(dir: string, path: string): boolean {
  const r = relative(resolve(dir), resolve(path))
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

export function registerLogIpc(ctx: AppContext): void {
  const { engine } = ctx

  handle('logs:list', () => listLogs(ctx.installDir()))
  handle('logs:overview', () => engine.logsOverview())
  handle('logs:archive', (path) => engine.archiveNow(path))
  handle('logs:compress', (path) => engine.compressLoose(path))
  // Only a file in the game's Logs folder or the archive folder is shown; anything else opens the archive folder.
  handle('logs:reveal', (path) => {
    const installDir = ctx.installDir()
    const archive = engine.archiveDir()
    const allowed = typeof path === 'string' && !!path && ((!!installDir && isInside(join(installDir, 'Logs'), path)) || isInside(archive, path))
    if (allowed && existsSync(path)) return shell.showItemInFolder(path)
    void shell.openPath(archive)
  })
}
