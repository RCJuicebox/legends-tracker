import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseAchievements, type AchMarks } from '../core/achievements'
import type { AchievementsView } from '../shared/types'
import { log } from './log'
import { isCharacterKey } from './validate'

const EMPTY_MARKS: AchMarks = { ticks: [], broken: [] }

/**
 * Reads a character's achievements export straight from the game folder, and keeps the player's own
 * marks (hand ticks, Broken) beside it in the app's data. Typing /outputfile achievements in game
 * rewrites the export; a short poll notices and sends the new list.
 */
export class AchievementFiles {
  private watched = ''
  private watchedMtime = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly gameDir: () => string,
    private readonly send: (view: AchievementsView) => void
  ) {}

  private get marksDir(): string {
    return join(app.getPath('userData'), 'achievements')
  }

  exportPath(character: string): string {
    return join(this.gameDir(), `${character}-Achievements.txt`)
  }

  async marks(character: string): Promise<AchMarks> {
    if (!isCharacterKey(character)) return { ...EMPTY_MARKS }
    const path = join(this.marksDir, `${character}.json`)
    try {
      const m = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<AchMarks>
      return { ticks: Array.isArray(m.ticks) ? m.ticks : [], broken: Array.isArray(m.broken) ? m.broken : [] }
    } catch (e) {
      // None saved yet is the usual case; anything else is worth knowing.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not read achievement marks ${path}`, e)
      return { ...EMPTY_MARKS }
    }
  }

  async saveMarks(character: string, marks: AchMarks): Promise<void> {
    if (!isCharacterKey(character)) return
    const ok = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === 'string')
    if (!marks || !ok(marks.ticks) || !ok(marks.broken)) throw new Error('Achievement marks are not in the expected form.')
    await fs.mkdir(this.marksDir, { recursive: true })
    const path = join(this.marksDir, `${character}.json`)
    await fs.writeFile(path + '.tmp', JSON.stringify(marks, null, 2), 'utf8')
    await fs.rename(path + '.tmp', path)
  }

  /** The export and marks for a character, and starts watching that export for a new one. */
  async load(character: string): Promise<AchievementsView> {
    this.watch(character)
    const file = `${character}-Achievements.txt`
    if (!isCharacterKey(character)) {
      const named = typeof character === 'string' ? character : ''
      return { character: named, file: '', modified: 0, sections: [], marks: { ...EMPTY_MARKS }, error: named ? 'Not a character name.' : 'No character chosen.' }
    }
    const base: AchievementsView = { character, file, modified: 0, sections: [], marks: await this.marks(character), error: '' }
    try {
      const path = this.exportPath(character)
      const [text, st] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)])
      this.watchedMtime = st.mtimeMs
      return { ...base, modified: st.mtimeMs, sections: parseAchievements(text).sections }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code !== 'ENOENT') log.warn(`Could not read ${file}`, e)
      return { ...base, error: err.code === 'ENOENT' ? 'missing' : err.message }
    }
  }

  private watch(character: string): void {
    this.watched = isCharacterKey(character) ? character : ''
    this.watchedMtime = 0
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), 4000)
  }

  private async poll(): Promise<void> {
    if (!this.watched || !this.gameDir()) return
    try {
      const st = await fs.stat(this.exportPath(this.watched))
      // The game writes the file in one go, but give it a moment before reading a fresh one.
      if (st.mtimeMs !== this.watchedMtime && Date.now() - st.mtimeMs > 1500) this.send(await this.load(this.watched))
    } catch (e) {
      // Not there (yet): nothing to send.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Achievements poll failed', e)
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
