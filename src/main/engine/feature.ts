import type { LogLine } from '../../core/logLine'

/**
 * One part of what follows the log, as the engine sees it. The engine keeps an ordered list of these
 * and hands each of them every line, every tick and every change of character, in list order: that
 * order is part of the behaviour (the spell tracker sees a line before the triggers do, the meter
 * files a fight before the loot ledger looks for its session). Every hook is optional.
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
}
