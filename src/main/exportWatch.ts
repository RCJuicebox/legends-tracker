import { promises as fs } from 'node:fs'
import { log } from './log'

/**
 * Watches the export a page shows (a character's achievements or inventory) for the game to write it
 * again, as typing /outputfile in game does: a look every few seconds while the main window is open,
 * and a call back once the new file has settled.
 */
export class ExportWatch {
  private character = ''
  /** When the export last read was written: the file is new once it says otherwise. */
  private modified = 0
  private timer: NodeJS.Timeout | null = null
  /** A look under way: a slow read (a stalled wiki behind it) must not pile up another. */
  private polling = false

  constructor(
    /** What the export is, for the log: "Achievements". */
    private readonly what: string,
    private readonly path: (character: string) => string,
    private readonly gameDir: () => string,
    /** Whether a page could be showing the export: the main window is open. Hidden, the file is not looked at. */
    private readonly shown: () => boolean,
    /** Reads the export again and sends it to the page. */
    private readonly changed: (character: string) => Promise<void>
  ) {}

  /** Watches this character's export from now on ('' for none), and starts looking if not already. */
  follow(character: string): void {
    this.character = character
    this.modified = 0
    this.timer ??= setInterval(() => void this.poll(), 4000)
  }

  /** The export was just read, as written at this time: no call back for it. */
  seen(modified: number): void {
    this.modified = modified
  }

  /** One look: calls back when the export has been written again, at least a moment and a half ago. */
  async poll(): Promise<void> {
    const character = this.character
    if (!character || !this.gameDir() || this.polling || !this.shown()) return
    this.polling = true
    try {
      const st = await fs.stat(this.path(character))
      // The game writes the file in one go, but give it a moment before reading a fresh one.
      if (st.mtimeMs !== this.modified && Date.now() - st.mtimeMs > 1500) await this.changed(character)
    } catch (e) {
      // Not there (yet): nothing to send.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${this.what} poll failed`, e)
    } finally {
      this.polling = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
