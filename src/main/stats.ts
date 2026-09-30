import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { acCapsOf, classFactorsOf, parseGameTables, skillCapsOf, type GameTableData } from '../core/gameTables'
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
