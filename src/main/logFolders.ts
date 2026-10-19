import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LogFileInfo } from '../shared/types'
import { listLogsIn } from './game'
import { sources } from './sources/registry'

// Other PCs' Logs folders (Settings › Log files): read for the record, never followed live or written to.
// Most are network shares, and a look at a share whose PC is off can take the network's timeout (half
// a minute or more), holding one of Node's four file threads all that time. So each folder has one
// look at a time, no more often than every LOOK_MS, and nobody waits on a look longer than WAIT_MS:
// a folder that has not answered by then counts as out of reach, and its logs as they were last read.

const LOOK_MS = 30_000
/** A folder out of reach is looked at less often: most likely its PC is off. */
const AWAY_MS = 120_000
const WAIT_MS = 2_000

export interface LogFolderLook {
  dir: string
  /** Its logs could be listed at the last look, and that look is recent. */
  reachable: boolean
  /** When the last look ended; 0 before the first. */
  at: number
  /** The character logs it held at the last look that answered. */
  logs: LogFileInfo[]
  /** Why the last look failed; '' when it answered. */
  error: string
}

/** Where another PC's character keeps its archives, if that PC runs the tracker with the archive folder left as it is. */
export const otherArchiveDir = (dir: string): string => join(dir, 'archive')

export class LogFolders {
  private readonly looks = new Map<string, LogFolderLook>()
  private readonly pending = new Map<string, Promise<LogFolderLook>>()

  constructor(
    private readonly dirs: () => string[],
    private readonly list: (dir: string) => Promise<LogFileInfo[]> = listLogsIn,
    private readonly timing = { lookMs: LOOK_MS, awayMs: AWAY_MS, waitMs: WAIT_MS }
  ) {}

  /** The folders the settings name. */
  folders(): string[] {
    return this.dirs()
  }

  /** The folder as of its newest look, looking again when the last one is old, or when told to. */
  async look(dir: string, again = false): Promise<LogFolderLook> {
    const k = dir.toLowerCase()
    const last = this.looks.get(k)
    if (!again && last && Date.now() - last.at < (last.reachable ? this.timing.lookMs : this.timing.awayMs) && !this.pending.has(k)) return last
    let run = this.pending.get(k)
    if (!run) {
      run = this.lookNow(dir).finally(() => this.pending.delete(k))
      this.pending.set(k, run)
    }
    let timer: NodeJS.Timeout | undefined
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.timing.waitMs)
    })
    const got = await Promise.race([run, late])
    clearTimeout(timer)
    // Still looking: out of reach for now. What it held at the last answer is kept for the page.
    return got ?? { dir, reachable: false, at: last?.at ?? 0, logs: last?.logs ?? [], error: 'Not answering' }
  }

  /** Whether `dir` (one of the folders) can be read now. */
  async reachable(dir: string): Promise<boolean> {
    return (await this.look(dir)).reachable
  }

  /** Every folder the settings name, looked at; with `again`, now, however recent the last look. */
  async lookAll(again = false): Promise<LogFolderLook[]> {
    const looks = await Promise.all(this.dirs().map((d) => this.look(d, again)))
    report(looks)
    return looks
  }

  /** The character logs in every folder that answers, each with the folder it is in. */
  async logs(): Promise<(LogFileInfo & { folder: string })[]> {
    return (await this.lookAll()).flatMap((l) => (l.reachable ? l.logs.map((x) => ({ ...x, folder: l.dir })) : []))
  }

  private async lookNow(dir: string): Promise<LogFolderLook> {
    const k = dir.toLowerCase()
    let look: LogFolderLook
    try {
      // listLogsIn says nothing of a folder it cannot list: look at the folder itself first.
      await fs.access(dir)
      look = { dir, reachable: true, at: Date.now(), logs: await this.list(dir), error: '' }
    } catch (e) {
      const was = this.looks.get(k)
      look = { dir, reachable: false, at: Date.now(), logs: was?.logs ?? [], error: (e as NodeJS.ErrnoException).code ?? (e as Error).message }
    }
    // Taken off the settings while it was being looked at: not kept.
    if (this.dirs().some((d) => d.toLowerCase() === k)) this.looks.set(k, look)
    return look
  }
}

/** The Data Sources row: what each folder answered. */
function report(looks: LogFolderLook[]): void {
  if (!looks.length) return sources.missing('logFolders', 'None chosen (Settings › Log files).')
  const out = looks.filter((l) => !l.reachable)
  const n = looks.reduce((sum, l) => sum + (l.reachable ? l.logs.length : 0), 0)
  const logs = `${n} character log${n === 1 ? '' : 's'}`
  if (!out.length) return sources.ok('logFolders', `${looks.length === 1 ? 'The folder answered' : `All ${looks.length} answered`}: ${logs}`)
  const which = out.length === looks.length ? (looks.length === 1 ? 'The folder' : 'None of them') : `${out.length} of ${looks.length}`
  sources.missing('logFolders', `${which} not answering (is that PC on?); what was read from ${out.length === 1 ? 'it' : 'them'} before still counts. ${logs} read now.`)
}
