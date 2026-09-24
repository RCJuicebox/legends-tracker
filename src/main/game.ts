import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArchiveInfo, GameFolderCheck, LogFileInfo } from '../shared/types'

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

/** The folder the game's own uninstaller is in, as Windows records it for Add or Remove Programs. */
function fromUninstallEntry(): Promise<string> {
  const entry = 'Microsoft\\Windows\\CurrentVersion\\Uninstall\\DGC-EverQuest Legends'
  const keys = [`HKCU\\Software\\${entry}`, `HKLM\\Software\\${entry}`, `HKLM\\Software\\WOW6432Node\\${entry}`]
  const query = (key: string) =>
    new Promise<string>((resolve) => {
      execFile('reg', ['query', key], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve('')
        for (const name of ['InstallLocation', 'UninstallString', 'DisplayIcon']) {
          const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'mi').exec(stdout)
          const value = m?.[1].replace(/^"|"$/g, '').replace(/,\d+$/, '') ?? ''
          if (!value) continue
          const dir = name === 'InstallLocation' ? value : dirname(value)
          if (isGameFolder(dir)) return resolve(dir)
        }
        resolve('')
      })
    })
  return keys.reduce<Promise<string>>(async (found, key) => (await found) || query(key), Promise.resolve(''))
}

/** Looks for EverQuest Legends: Windows' record of the install first, then the usual folders on every drive. */
export async function findInstall(): Promise<string> {
  const registered = await fromUninstallEntry()
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
  } catch {
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
  } catch {
    return []
  }
  const out: LogFileInfo[] = []
  for (const name of names) {
    const m = /^eqlog_(.+)\.txt$/i.exec(name)
    if (!m) continue
    const st = await fs.stat(join(dir, name))
    out.push({ path: join(dir, name), name, character: m[1], size: st.size, modified: st.mtimeMs })
  }
  return out.sort((a, b) => b.modified - a.modified)
}

export async function listArchives(archiveDir: string): Promise<ArchiveInfo[]> {
  let names: string[]
  try {
    names = await fs.readdir(archiveDir)
  } catch {
    return []
  }
  const out: ArchiveInfo[] = []
  for (const name of names) {
    if (name.startsWith('.staging-') || name.endsWith('.partial')) continue
    const lower = name.toLowerCase()
    if (!lower.endsWith('.zip') && !lower.endsWith('.txt')) continue
    const st = await fs.stat(join(archiveDir, name))
    out.push({ path: join(archiveDir, name), name, size: st.size, modified: st.mtimeMs, loose: lower.endsWith('.txt') })
  }
  return out.sort((a, b) => b.modified - a.modified)
}

export function isGameRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq eqgame.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, stdout) => {
      resolve(!err && stdout.toLowerCase().includes('eqgame.exe'))
    })
  })
}

/**
 * The client announces the zone once and never repeats it, so a tool attached mid-session reads
 * backwards from the end of the log to find it.
 */
export async function lastZone(logPath: string): Promise<string> {
  let handle
  try {
    handle = await fs.open(logPath, 'r')
  } catch {
    return ''
  }
  try {
    const size = (await handle.stat()).size
    const step = 1 << 20
    for (let end = size; end > 0 && size - end < 64 * step; end -= step) {
      const start = Math.max(0, end - step)
      const buf = Buffer.alloc(end - start)
      await handle.read(buf, 0, buf.length, start)
      const lines = buf.toString('latin1').split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = /\] You have entered (.+)\.\r?$/.exec(lines[i])
        if (m && !/^an? (?:area|Arena)/i.test(m[1])) return m[1]
      }
    }
    return ''
  } finally {
    await handle.close()
  }
}
