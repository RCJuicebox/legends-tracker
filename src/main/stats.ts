import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { latestAas, type AaSummary } from '../core/aa'
import { decodeCp1252 } from '../core/logLine'
import { acCapsOf, classFactorsOf, parseGameTables, skillCapsOf, type GameTableData } from '../core/gameTables'
import { log } from './log'
import type { SkillCapRow } from '../shared/ipc'
import { sources } from './sources/registry'

// The game's own tables (skillcaps.txt, ACMitigation.txt, basedata.txt), read from its Resources
// folder. What each holds, and the parsing, are in core/gameTables.ts; this reads the files, keeps
// the tables for the folder read and reports to the Data Sources page.

interface Tables extends GameTableData {
  dir: string
}

export type { SkillCapRow }

export class GameTables {
  private tables: Tables | null = null

  constructor(private readonly gameDir: () => string) {}

  /** Forgets the tables read, so the next question reads them again (a game patch). */
  clear(): void {
    this.tables = null
  }

  private async load(): Promise<Tables> {
    const dir = this.gameDir()
    if (this.tables?.dir === dir) return this.tables
    const failed: string[] = []
    const read = (f: string) =>
      fs.readFile(join(dir, 'Resources', f), 'utf8').catch((e: unknown) => {
        failed.push(`${f}: ${(e as Error).message}`)
        return ''
      })
    const [skills, ac, base] = await Promise.all([read('skillcaps.txt'), read('ACMitigation.txt'), read('basedata.txt')])
    if (!dir) sources.missing('tables', 'No game folder chosen.')
    else if (failed.length) sources.fail('tables', new Error(failed.join('; ')))
    else sources.ok('tables', 'skillcaps.txt, ACMitigation.txt and basedata.txt')
    const t: Tables = { dir, ...parseGameTables({ skillcaps: skills, acMitigation: ac, basedata: base }) }
    this.tables = t
    return t
  }

  /** Every skill any of the classes has at this level, each at the best cap among them. */
  async skillCaps(classes: string[], level: number): Promise<SkillCapRow[]> {
    return skillCapsOf(await this.load(), classes, level)
  }

  /** Per class, the HP, mana and endurance factors at this level (basedata.txt). */
  async classFactors(classes: string[], level: number): Promise<Record<string, { hp: number; mana: number; end: number }>> {
    return classFactorsOf(await this.load(), classes, level)
  }

  /** Soft cap and post-cap multiplier per class at this level. */
  async acCaps(classes: string[], level: number): Promise<Record<string, { cap: number; mult: number }>> {
    return acCapsOf(await this.load(), classes, level)
  }
}

/**
 * The newest /alternateadv list dump in a log, read from the end backwards in widening windows so a
 * large log costs little. A dump found right at the start of a window might be cut off, so the window
 * widens again before trusting it. The window stops at 64 MB: a dump further back than that is
 * reported as not found, and a fresh /alternateadv list is the answer.
 */
export async function readAasFromLog(logFile: string, opts: { firstSpan?: number; maxSpan?: number } = {}): Promise<AaSummary | null> {
  const maxSpan = opts.maxSpan ?? 64 << 20
  let handle
  try {
    handle = await fs.open(logFile, 'r')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not open ${logFile} to read AAs:`, e)
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
    log.warn(`Could not read AAs from ${logFile}:`, e)
    return null
  } finally {
    await handle.close()
  }
}
