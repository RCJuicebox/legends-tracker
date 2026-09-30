import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { acCapsOf, classFactorsOf, skillCapsOf, STAT_TABLES, type GameTable } from '../core/gameTables'
import type { SkillCapRow } from '../shared/ipc'
import { sources } from './sources/registry'

// The game's own tables, read from its Resources folder: the stat tables (skillcaps.txt,
// ACMitigation.txt, basedata.txt) and whatever else a feature registers as a GameTable (the factions'
// modifiers and achievement lists). What each holds, and the parsing, are in core/gameTables.ts and
// the features'; this reads the files, keeps each table until a file changes, and reports to the Data
// Sources page.

export type { SkillCapRow }

export class GameTables {
  /** Each table asked for, with what it was read from: the folder, the files' times and the generation. */
  private readonly read = new Map<GameTable<unknown>, { key: string; value: Promise<unknown> }>()
  /** Bumped by clear(), so every table is read again. */
  private generation = 0
  /** The folder the files below are in, and each file read (its path under Resources), with why it could not be ('' when it could). */
  private files = { dir: '', why: new Map<string, string>() }

  constructor(private readonly gameDir: () => string) {}

  /** Forgets the tables read, so the next question reads them again (a game patch). */
  clear(): void {
    this.generation++
  }

  /** Reads every table asked for so far again, and the stat tables: Refresh on the Data Sources page. */
  async refresh(): Promise<void> {
    this.clear()
    await Promise.all([...new Set<GameTable<unknown>>([STAT_TABLES, ...this.read.keys()])].map((t) => this.get(t)))
  }

  /** A table, read again only once one of its files has changed; each file empty without a game folder. */
  async get<T>(t: GameTable<T>): Promise<T> {
    const dir = this.gameDir()
    if (!dir) {
      sources.missing('tables', 'No game folder chosen.')
      return t.parse(t.files.map(() => ''))
    }
    const paths = t.files.map((f) => join(dir, 'Resources', f))
    const times = await Promise.all(
      paths.map((p) =>
        fs.stat(p).then(
          (st) => st.mtimeMs,
          () => 0
        )
      )
    )
    const key = `${this.generation}|${dir}|${times.join('|')}`
    let kept = this.read.get(t)
    if (kept?.key !== key) this.read.set(t, (kept = { key, value: this.load(dir, t, paths) }))
    return kept.value as Promise<T>
  }

  private async load<T>(dir: string, t: GameTable<T>, paths: string[]): Promise<T> {
    if (this.files.dir !== dir) this.files = { dir, why: new Map() }
    const why = this.files.why
    // In the tables' order on the card, whichever read finishes first.
    for (const f of t.files) if (!why.has(f)) why.set(f, '')
    const texts = await Promise.all(
      paths.map((p, i) =>
        fs.readFile(p, 'utf8').then(
          (text) => (why.set(t.files[i], ''), text),
          (e: unknown) => (why.set(t.files[i], (e as Error).message), '')
        )
      )
    )
    const failed = [...why].filter(([, e]) => e).map(([f, e]) => `${f}: ${e}`)
    if (failed.length) sources.fail('tables', new Error(failed.join('; ')))
    else sources.ok('tables', [...why.keys()].map((f) => basename(f)).join(', '))
    return t.parse(texts)
  }

  /** Every skill any of the classes has at this level, each at the best cap among them. */
  async skillCaps(classes: string[], level: number): Promise<SkillCapRow[]> {
    return skillCapsOf(await this.get(STAT_TABLES), classes, level)
  }

  /** Per class, the HP, mana and endurance factors at this level (basedata.txt). */
  async classFactors(classes: string[], level: number): Promise<Record<string, { hp: number; mana: number; end: number }>> {
    return classFactorsOf(await this.get(STAT_TABLES), classes, level)
  }

  /** Soft cap and post-cap multiplier per class at this level. */
  async acCaps(classes: string[], level: number): Promise<Record<string, { cap: number; mult: number }>> {
    return acCapsOf(await this.get(STAT_TABLES), classes, level)
  }
}
