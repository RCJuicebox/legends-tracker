import { promises as fs } from 'node:fs'
import { latestAas, type AaSummary } from './aa'
import { decodeCp1252 } from './logLine'

// The AAs a log's latest /alternateadv list names, read back from the end of the log.

/**
 * The newest /alternateadv list dump in a log, read from the end backwards in widening windows so a
 * large log costs little. A dump found right at the start of a window might be cut off, so the window
 * widens again before trusting it. The window stops at 64 MB: a dump further back than that is
 * reported as not found, and a fresh /alternateadv list is the answer.
 */
export async function readAasFromLog(
  logFile: string,
  opts: { firstSpan?: number; maxSpan?: number; warn?: (message: string, e: unknown) => void } = {}
): Promise<AaSummary | null> {
  const warn = opts.warn ?? (() => {})
  const maxSpan = opts.maxSpan ?? 64 << 20
  let handle
  try {
    handle = await fs.open(logFile, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warn(`Could not open ${logFile} to read AAs:`, e)
    return null
  }
  try {
    const size = (await handle.stat()).size
    for (let span = Math.min(opts.firstSpan ?? 4 << 20, maxSpan); ; span = Math.min(span * 4, maxSpan)) {
      const start = Math.max(0, size - span)
      const buf = Buffer.alloc(size - start)
      await handle.read(buf, 0, buf.length, start)
      const text = decodeCp1252(buf)
      const found = latestAas(text)
      const safe = start === 0 || (found && text.indexOf(`[${found.when}] Ability #`) > 256 * 1024)
      if (found && safe) return found
      if (start === 0) return found
      if (span >= maxSpan) return null
    }
  } catch (e) {
    warn(`Could not read AAs from ${logFile}:`, e)
    return null
  } finally {
    await handle.close()
  }
}
