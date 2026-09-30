import type { LogLine } from '../../core/logLine'
import type { SpellBook } from '../../core/spells'

/**
 * One part of what follows the log, as the engine sees it. The engine keeps an ordered list of these
 * and hands each of them every line, every tick, every change of character and of settings, in list
 * order: that order is part of the behaviour (the spell tracker sees a line before the triggers do,
 * the meter files a fight before the loot ledger looks for its session). Every hook is optional. A
 * part pushes its own views through `EngineOutputs.push`, on its own channel.
 */
export interface EngineFeature {
  /** A short name, for reading the list. */
  readonly id: string
  /** A line from the watched log. */
  line?(line: LogLine): void
  /** Every lap of the engine's clock (a fifth of a second), with the time now. */
  tick?(now: number): void
  /** Another character is being watched: nothing the last one had running applies any more. */
  reset?(): void
  /** The tailer has given every line up to `end` of `logFile`. */
  linesRead?(logFile: string, end: number): void
  /** Watching starts on `logFile`: the same character's log again, or another's (after `reset`). */
  watching?(logFile: string, now: number): void
  /** The spell data was read, or read again. */
  spellsLoaded?(book: SpellBook): void
  /** The settings changed. */
  reconfigure?(): void
}
