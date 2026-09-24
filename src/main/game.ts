import { execFile } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { ArchiveInfo, LogFileInfo } from '../shared/types'

const INSTALL_SUFFIXES = [
  '\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Users\\Public\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Program Files (x86)\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\Program Files\\Daybreak Game Company\\Installed Games\\EverQuest Legends',
  '\\EverQuest Legends'
]

export function findInstall(): string {
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const suffix of INSTALL_SUFFIXES) {
      const p = `${drive}:${suffix}`
      if (existsSync(join(p, 'spells_us.txt'))) return p
    }
  }
  return ''
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
