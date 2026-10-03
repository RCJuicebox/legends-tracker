import { promises as fs } from 'node:fs'
import { writeFileAtomic } from './storeCore'
import { join } from 'node:path'
import { parseAchievements, type AchMarks, type AchSection } from '../core/achievements'
import type { AchievementsView } from '../shared/types'
import { log } from './log'
import { assertCharacterKey, isCharacterKey } from '../core/validate'
import { sources } from './sources/registry'
import { ExportWatch } from './exportWatch'

/** How long a just-written export is left before it is read. */
const EXPORT_SETTLE_MS = 1500

const EMPTY_MARKS: AchMarks = { ticks: [], broken: [] }

/** A character's achievements export as read: its file name, when the game wrote it, and what it lists. */
export interface AchievementsExport {
  file: string
  modified: number
  sections: AchSection[]
}

/**
 * Reads a character's achievements export straight from the game folder, and keeps the player's own
 * marks (hand ticks, Broken) beside it in the app's data. Typing /outputfile achievements in game
 * rewrites the export; a short poll notices and sends the new list. The Achievements page, the
 * achievements overlay and the Factions page all read the export here, so it is parsed once a write.
 */
export class AchievementFiles {
  private readonly watch: ExportWatch
  /** Each export read, by path, kept while the file is unchanged. */
  private readonly read = new Map<string, { modified: number; sections: AchSection[] }>()

  constructor(
    /** The app's data folder (userData): the player's marks go in its achievements folder. */
    private readonly dataDir: string,
    private readonly gameDir: () => string,
    send: (view: AchievementsView) => void,
    /** Whether a page could be showing the export: the main window is open. Hidden, the file is not looked at. */
    shown: () => boolean = () => true
  ) {
    this.watch = new ExportWatch(
      'Achievements',
      (c) => this.exportPath(c),
      gameDir,
      shown,
      async (c) => send(await this.load(c))
    )
  }

  private get marksDir(): string {
    return join(this.dataDir, 'achievements')
  }

  exportPath(character: string): string {
    return join(this.gameDir(), `${character}-Achievements.txt`)
  }

  async marks(character: string): Promise<AchMarks> {
    if (!isCharacterKey(character)) return { ...EMPTY_MARKS }
    const path = join(this.marksDir, `${character}.json`)
    try {
      const m = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<AchMarks>
      const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [])
      return { ticks: strings(m.ticks), broken: strings(m.broken), tracked: strings(m.tracked) }
    } catch (e) {
      // None saved yet is the usual case; anything else is worth knowing.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read achievement marks ${path}`, e)
      return { ...EMPTY_MARKS }
    }
  }

  async saveMarks(character: string, marks: AchMarks): Promise<void> {
    assertCharacterKey(character)
    const ok = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string')
    if (!marks || !ok(marks.ticks) || !ok(marks.broken) || (marks.tracked !== undefined && !ok(marks.tracked))) throw new Error('Achievement marks are not in the expected form.')
    await fs.mkdir(this.marksDir, { recursive: true })
    const path = join(this.marksDir, `${character}.json`)
    await writeFileAtomic(path, JSON.stringify(marks, null, 2))
  }

  /**
   * A character's achievements export, read again only once the game has written it again. Null when
   * there is none (or no game folder); a file that cannot be read throws.
   */
  async readExport(character: string): Promise<AchievementsExport | null> {
    if (!isCharacterKey(character) || !this.gameDir()) return null
    const file = `${character}-Achievements.txt`
    const path = this.exportPath(character)
    let modified: number
    try {
      modified = (await fs.stat(path)).mtimeMs
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    let kept = this.read.get(path)
    if (kept?.modified !== modified) {
      // Just written: left a moment first, as the factions and inventory exports are, so a read never
      // catches the game mid-write and counts a cut-off Progression section's tail as done (LT-417).
      const young = Math.min(EXPORT_SETTLE_MS, EXPORT_SETTLE_MS - (Date.now() - modified))
      if (young > 0) {
        await new Promise((r) => setTimeout(r, young))
        const again = (await fs.stat(path)).mtimeMs
        if (again !== modified) return this.readExport(character)
      }
      kept = { modified, sections: parseAchievements(await fs.readFile(path, 'utf8')).sections }
      if (this.read.size > 20) this.read.clear()
      this.read.set(path, kept)
    }
    return { file, modified, sections: kept.sections }
  }

  /** The export, for what only uses it (the overlay, the Factions page): one that cannot be read is logged, and null. */
  async exported(character: string): Promise<AchievementsExport | null> {
    try {
      return await this.readExport(character)
    } catch (e) {
      // Caught mid-write, or not an export: the next read tries again.
      log.warn(`Could not read ${character}'s achievements export:`, e)
      return null
    }
  }

  /** The export and marks for a character, and starts watching that export for a new one. */
  async load(character: string): Promise<AchievementsView> {
    this.watch.follow(isCharacterKey(character) ? character : '')
    if (!isCharacterKey(character)) {
      const named = typeof character === 'string' ? character : ''
      return { character: named, file: '', modified: 0, sections: [], marks: { ...EMPTY_MARKS }, error: named ? 'Not a character name.' : 'No character chosen.' }
    }
    const file = `${character}-Achievements.txt`
    const base: AchievementsView = { character, file, modified: 0, sections: [], marks: await this.marks(character), error: '' }
    try {
      const exp = await this.readExport(character)
      if (!exp) {
        sources.missing('exports', `No ${file} yet: type /outputfile achievements in game.`)
        return { ...base, error: 'missing' }
      }
      this.watch.seen(exp.modified)
      sources.ok('exports', `${file}, written ${new Date(exp.modified).toLocaleString()}`)
      return { ...base, modified: exp.modified, sections: exp.sections }
    } catch (e) {
      sources.fail('exports', e, file)
      return { ...base, error: (e as Error).message }
    }
  }

  stop(): void {
    this.watch.stop()
  }
}
