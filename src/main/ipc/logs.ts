import { shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isInside } from '../../core/paths'
import { handle } from './handle'
import { listLogs, logsFolderOf } from '../game'
import type { AppContext } from '../context'
import type { LogFolderLook } from '../logFolders'
import { MAX_LOG_FOLDERS } from '../../shared/types'
import type { LogFolderView } from '../../shared/ipc'

// The Log Files page: the character logs, their archives, and archiving. Settings › Log files: other PCs'
// Logs folders.

const folderView = (l: LogFolderLook): LogFolderView => ({
  dir: l.dir,
  reachable: l.reachable,
  at: l.at,
  characters: [...new Set(l.logs.map((x) => x.character))],
  error: l.error
})

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function registerLogIpc(ctx: AppContext): void {
  const { engine } = ctx

  handle('logs:list', () => listLogs(ctx.installDir()))
  handle('logs:folders', async (again) => (await ctx.logFolders.lookAll(again === true)).map(folderView))
  // Another PC's Logs folder, picked (its game folder or Logs, often over the network) and checked; a page cannot add one any other way.
  handle('logs:addFolder', async () => {
    const r = await ctx.windows.openDialog({ title: "Choose the other PC's EverQuest Legends Logs folder", properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return { canceled: true, dir: '', problem: '' }
    const dir = logsFolderOf(r.filePaths[0])
    const s = ctx.store.settings.get()
    const own = ctx.installDir() && join(ctx.installDir(), 'Logs')
    if (own && samePath(dir, own)) return { canceled: false, dir, problem: "That is this PC's own Logs folder: its logs are read already." }
    if (s.logFolders.some((d) => samePath(d, dir))) return { canceled: false, dir, problem: 'That folder is on the list already.' }
    if (s.logFolders.length >= MAX_LOG_FOLDERS) return { canceled: false, dir, problem: `No more than ${MAX_LOG_FOLDERS} other folders.` }
    ctx.saveSettings({ ...s, logFolders: [...s.logFolders, dir] })
    // Looked at now, so the page shows what it holds; and the motes looted there come in.
    await ctx.logFolders.lookAll(true)
    void ctx.engine.checkOtherLogs()
    return { canceled: false, dir, problem: '' }
  })
  handle('logs:overview', () => engine.archives.overview())
  handle('logs:archive', (path) => engine.archives.archiveNow(path))
  handle('logs:compress', (path) => engine.archives.compressLoose(path))
  // Only a file in the game's Logs folder or the archive folder is shown; anything else opens the archive folder.
  handle('logs:reveal', (path) => {
    const installDir = ctx.installDir()
    const archive = engine.archives.archiveDir()
    const allowed = typeof path === 'string' && !!path && ((!!installDir && isInside(join(installDir, 'Logs'), path)) || isInside(archive, path))
    if (allowed && existsSync(path)) return shell.showItemInFolder(path)
    // openPath runs a file: only ever a folder.
    if (!statSync(archive, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`The archive folder ${archive} is not there yet: it is made when the first log is archived.`)
    void shell.openPath(archive)
  })
}
