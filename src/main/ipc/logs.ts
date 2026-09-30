import { shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { handle } from './handle'
import { listLogs } from '../game'
import type { AppContext } from '../context'

// The Log Files page: the character logs, their archives, and archiving.

/** Whether `path` is `dir` or somewhere inside it. */
export function isInside(dir: string, path: string): boolean {
  const r = relative(resolve(dir), resolve(path))
  // A step up is ".." itself or "..\…"; a file named "..notes.txt" is inside.
  return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r))
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
    // openPath runs a file: only ever a folder.
    if (!statSync(archive, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The archive folder ${archive} is not there yet: it is made when the first log is archived.`)
    void shell.openPath(archive)
  })
}
