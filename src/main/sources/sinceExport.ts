import { promises as fs } from 'node:fs'
import { EXPORT_SLACK_MS } from '../../core/phrases'
import { sameFile } from '../../core/fileIdentity'
import { identityOf, offsetBefore } from './logHistory'

// Where a log is read on from after an export, for the readers that count what came after one (the
// Slayer kills since the achievements export, the faction changes since the factions export). A kept
// position carries the file's identity: a log replaced at the same path while the app was closed (a
// new log, or this one cut short) and grown past the old offset is read again from the line before the
// export, not from the old offset into the wrong file (LT-625). The slack before the export is one
// figure for both readers.

/** How far a log was read for an export, and which file that was. */
export interface SincePosition {
  id: string
  readTo: number
}

/** Where to read on from: the file's identity now, the offset to start at, its size, and whether the read starts afresh. */
export interface SinceStart {
  id: string
  from: number
  size: number
  fresh: boolean
}

/**
 * Where to read a log on from after an export written at `exportAt`: from where the kept read got
 * to when the file is the one it read, else from the line before the export (0 when the whole log
 * is newer). Null for a log missing or empty.
 */
export async function sinceStart(logPath: string, kept: SincePosition | null, exportAt: number): Promise<SinceStart | null> {
  const st = await fs.stat(logPath, { bigint: true }).catch(() => null)
  const size = Number(st?.size ?? 0)
  if (!st || !size) return null
  const id = identityOf(st)
  if (kept && kept.readTo >= 0 && sameFile({ id: kept.id, size: kept.readTo }, { id, size })) return { id, from: kept.readTo, size, fresh: false }
  return { id, from: await offsetBefore(logPath, exportAt, { slackMs: EXPORT_SLACK_MS }), size, fresh: true }
}
