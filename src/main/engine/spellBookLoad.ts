import { loadSpellBook } from '../game'
import { log } from '../log'
import type { SpellBook } from '../../core/spells'

// The game's spell files read for the engine (LT-638: out of the engine): the largest thing the app
// reads, so its cost is logged and a change to it shows (README, Measuring).

/** The spell book from the game folder, or why it could not be read. */
export async function readSpellBook(installDir: string): Promise<{ book: SpellBook } | { error: string }> {
  try {
    const heapBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const book = await loadSpellBook(installDir)
    log.info(
      `Spell data: ${book.size} spells in ${Math.round(performance.now() - started)} ms; the heap grew ${Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576)} MB reading it`
    )
    return { book }
  } catch (e) {
    log.error(`Could not load spells from ${installDir}:`, e)
    return { error: `Could not read the spell files: ${(e as Error).message}` }
  }
}
