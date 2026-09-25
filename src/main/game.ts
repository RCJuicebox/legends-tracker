import { HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, isProcessRunning, registryString } from './win32'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArchiveInfo, GameFolderCheck, LogFileInfo } from '../shared/types'
import { parseLogLine, zoneEntered } from '../core/logLine'
import { log } from './log'

const INSTALL_SUFFIXES = [
  '\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Program Files (x86)\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Program Files\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\EverQuest Legends'
]

/** A game folder has the spell data the tracker reads; that is the one file it cannot work without. */
export function isGameFolder(dir: string): boolean {
  return !!dir && existsSync(join(dir, 'spells_us.txt'))
}

/**
 * The game folder for a folder someone picked: the folder itself, the one above it when they picked
 * Logs or another folder inside the game, or EverQuest Legends inside it when they picked the
 * Daybreak "Installed Games" folder or one above that.
 */
export function resolveGameFolder(dir: string): string {
  if (!dir) return ''
  const inside = ['EverQuest Legends', join('Installed Games', 'EverQuest Legends'), join('Daybreak Game Company', 'Installed Games', 'EverQuest Legends')]
  for (const d of [dir, ...inside.map((s) => join(dir, s))]) if (isGameFolder(d)) return d
  let up = dir
  for (let i = 0; i < 2; i++) {
    const parent = dirname(up)
    if (parent === up) break
    up = parent
    if (isGameFolder(up)) return up
  }
  return ''
}

/**
 * The folder the game's own uninstaller is in, as Windows records it for Add or Remove Programs,
 * read from the registry directly.
 */
function fromUninstallEntry(): string {
  const entry = String.raw`Microsoft\Windows\CurrentVersion\Uninstall\DGC-EverQuest Legends`
  const keys: [number, string][] = [
    [HKEY_CURRENT_USER, 'Software\\' + entry],
    [HKEY_LOCAL_MACHINE, 'Software\\' + entry],
    [HKEY_LOCAL_MACHINE, 'Software\\WOW6432Node\\' + entry]
  ]
  for (const [hkey, key] of keys) {
    for (const name of ['InstallLocation', 'UninstallString', 'DisplayIcon']) {
      const value = registryString(hkey, key, name).replace(/^"|"$/g, '').replace(/,\d+$/, '')
      if (!value) continue
      const dir = name === 'InstallLocation' ? value : dirname(value)
      if (isGameFolder(dir)) return dir
    }
  }
  return ''
}

/** Looks for EverQuest Legends: Windows' record of the install first, then the usual folders on every drive. */
export async function findInstall(): Promise<string> {
  const registered = fromUninstallEntry()
  if (registered) return registered
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const suffix of INSTALL_SUFFIXES) {
      const p = `${drive}:${suffix}`
      if (isGameFolder(p)) return p
    }
  }
  return ''
}

/** What the tracker can use in a game folder: spell data, character logs, inventory and achievement exports. */
export async function checkGameFolder(dir: string): Promise<GameFolderCheck> {
  const empty: GameFolderCheck = { dir, exists: false, spells: false, logs: [], inventory: [], achievements: [] }
  if (!dir) return empty
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (e) {
    quietIfMissing(e, `Could not list the game folder ${dir}:`)
    return empty
  }
  const characters = (re: RegExp) => names.map((n) => re.exec(n)?.[1]).filter((c): c is string => !!c).sort()
  return {
    dir,
    exists: true,
    spells: names.some((n) => n.toLowerCase() === 'spells_us.txt'),
    logs: (await listLogs(dir)).map((l) => l.character),
    inventory: characters(/^(.+)-Inventory\.txt$/i),
    achievements: characters(/^(.+)-Achievements\.txt$/i)
  }
}

/** Whether a log file lives in this game folder's Logs. */
export function logIsIn(logFile: string, dir: string): boolean {
  return !!logFile && !!dir && dirname(logFile).toLowerCase() === join(dir, 'Logs').toLowerCase()
}

export async function listLogs(installDir: string): Promise<LogFileInfo[]> {
  const dir = join(installDir, 'Logs')
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (e) {
    quietIfMissing(e, `Could not list the logs in ${dir}:`)
    return []
  }
  const out: LogFileInfo[] = []
  for (const name of names) {
    const m = /^eqlog_(.+)\.txt$/i.exec(name)
    if (!m) continue
    // A log archived or deleted since the folder was listed is simply left out.
    const st = await fs.stat(join(dir, name)).catch(() => null)
    if (!st) continue
    out.push({ path: join(dir, name), name, character: m[1], size: st.size, modified: st.mtimeMs })
  }
  return out.sort((a, b) => b.modified - a.modified)
}

export async function listArchives(archiveDir: string): Promise<ArchiveInfo[]> {
  let names: string[]
  try {
    names = await fs.readdir(archiveDir)
  } catch (e) {
    quietIfMissing(e, `Could not list the archives in ${archiveDir}:`)
    return []
  }
  const out: ArchiveInfo[] = []
  for (const name of names) {
    if (name.startsWith('.staging-') || name.endsWith('.partial')) continue
    const lower = name.toLowerCase()
    if (!lower.endsWith('.zip') && !lower.endsWith('.txt')) continue
    const st = await fs.stat(join(archiveDir, name)).catch(() => null)
    if (!st) continue
    out.push({ path: join(archiveDir, name), name, size: st.size, modified: st.mtimeMs, loose: lower.endsWith('.txt') })
  }
  return out.sort((a, b) => b.modified - a.modified)
}

/** A folder that is not there yet is normal; anything else is worth a line in the diagnostic log. */
function quietIfMissing(e: unknown, what: string): void {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(what, e)
}

export async function isGameRunning(): Promise<boolean> {
  return isProcessRunning('eqgame.exe')
}

/**
 * The client announces the zone once and never repeats it, so a tool attached mid-session reads
 * backwards from the end of the log to find it, a chunk at a time, up to 64 chunks.
 */
export async function lastZone(logPath: string, step = 1 << 20): Promise<string> {
  let handle
  try {
    handle = await fs.open(logPath, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not open ${logPath} to find the zone:`, e)
    return ''
  }
  try {
    const size = (await handle.stat()).size
    // The first piece of each chunk may be the end of a line begun in the chunk before it; it is
    // carried back and joined to that chunk's last piece.
    let carry = ''
    for (let end = size; end > 0 && size - end < 64 * step; end -= step) {
      const start = Math.max(0, end - step)
      const buf = Buffer.alloc(end - start)
      await handle.read(buf, 0, buf.length, start)
      const lines = (buf.toString('latin1') + carry).split('\n')
      carry = start > 0 ? (lines.shift() ?? '') : ''
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('] You have entered ')) continue
        const line = parseLogLine(lines[i].replace(/\r$/, ''))
        const zone = line && zoneEntered(line.text)
        if (zone) return zone
      }
    }
    return ''
  } catch (e) {
    log.warn(`Could not read ${logPath} to find the zone:`, e)
    return ''
  } finally {
    await handle.close()
  }
}
