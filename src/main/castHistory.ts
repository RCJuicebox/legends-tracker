import { localDay } from '../core/dates'
import type { LogLine } from '../core/logLine'
import { CAST_BY_YOU } from '../core/phrases'
import type { HistoryConsumer, LogHistory } from './sources/logHistory'

// What a character casts, and how often, counted from their logs: "You begin casting Envenomed Bolt X."
// Counts are kept per day so a window (the last two weeks) can be taken. The counting is LogHistory's:
// archives are read once, the live log only for what it has gained.

export type Days = Record<string, Record<string, number>>

/** Reads one log line into the day it belongs to. Made fresh for each stretch of log read, so it may keep state across lines. */
export type DayCounter = (line: LogLine, into: Days) => void

/** Casts by name: "You begin casting Envenomed Bolt X." */
export const castCounter = (): DayCounter => (line, into) => {
  const m = CAST_BY_YOU.exec(line.text)
  if (!m) return
  const day = (into[localDay(line.time)] ??= {})
  day[m[1]] = (day[m[1]] ?? 0) + 1
}

/** A day-by-day count as a LogHistory consumer. */
export function dayConsumer(counter: () => DayCounter, version = 1): HistoryConsumer<Days> {
  return { version, empty: () => ({}), reader: () => counter() }
}

export interface CastCounts {
  /** Casts by the name the log gives ("Envenomed Bolt X"). */
  counts: Record<string, number>
  total: number
  /** The first and last day counted, "2026-09-10". */
  from: string
  to: string
}

/** One day-by-day consumer of a LogHistory, as windows of days: casts, or the melee tally. */
export class CastHistory {
  constructor(
    private readonly history: LogHistory,
    private readonly key: string
  ) {}

  /** Counts over the last `days` days of play (0 for all of it), ending at the newest day counted. */
  async recent(o: { logPath: string; archiveDir: string; stem: string; days: number }): Promise<CastCounts> {
    // The live log first: archives are needed only when it does not reach back far enough.
    const first = await this.history.get<Days>(this.key, o, () => false)
    const newest = Object.keys(first.live).sort().pop() ?? localDay(Date.now())
    const cutoff = o.days ? localDay(new Date(newest + 'T12:00:00').getTime() - (o.days - 1) * 86400_000) : ''
    const oldestLive = Object.keys(first.live).sort()[0] ?? newest
    const all: Days[] = [first.live]
    if (!o.days || oldestLive > cutoff) {
      const withArchives = await this.history.get<Days>(this.key, o, (_name, end) => !cutoff || !end || end >= cutoff)
      all.push(...withArchives.archives.map((a) => a.value))
    }

    const counts: Record<string, number> = {}
    let total = 0
    let from = ''
    let to = ''
    for (const days of all) {
      for (const [day, casts] of Object.entries(days)) {
        if (cutoff && day < cutoff) continue
        if (!from || day < from) from = day
        if (!to || day > to) to = day
        for (const [name, n] of Object.entries(casts)) {
          counts[name] = (counts[name] ?? 0) + n
          total += n
        }
      }
    }
    return { counts, total, from, to }
  }
}
