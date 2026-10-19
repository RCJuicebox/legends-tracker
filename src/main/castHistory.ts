import { localDay } from '../core/dates'
import type { LogLine } from '../core/logLine'
import { CAST_BY_YOU, MERGED_ITEM, RESISTED_YOUR } from '../core/phrases'
import { QUICK_BUFF, QUICK_BUFF_MS } from '../core/spellTracker'
import { everyStretch, type HistoryConsumer, type HistoryWhere, type LogHistory } from './sources/logHistory'

// What a character casts, and how often, counted from their logs: "You begin casting Envenomed Bolt X."
// Counts are kept per day so a window (the last two weeks) can be taken. The counting is LogHistory's:
// archives are read once, the live log only for what it has gained.

export type Days = Record<string, Record<string, number>>

/** Reads one log line into the day it belongs to. Made fresh for each stretch of log read, so it may keep state across lines. */
export type DayCounter = (line: LogLine, into: Days) => void

/** A buff Quick Buff can land: its landing texts (on you, on another), and the ranked name its cast counts as. */
export interface QuickBuffLanding {
  self: string
  other: string
  rankedName: string
}

/**
 * Casts by name: "You begin casting Envenomed Bolt X." Legends' Quick Buff prints no cast line, only
 * "You activate Quick Buff." and the landings; for a while after it, a landing of a buff the character
 * casts (`quick`, the newest rank of each) counts as one cast of it (LT-503).
 */
export const castCounter = (quick?: () => QuickBuffLanding[]): DayCounter => {
  let window: { until: number; buffs: QuickBuffLanding[]; counted: Set<string> } | null = null
  const count = (into: Days, time: number, name: string) => {
    const day = (into[localDay(time)] ??= {})
    day[name] = (day[name] ?? 0) + 1
  }
  return (line, into) => {
    const m = CAST_BY_YOU.exec(line.text)
    if (m) return count(into, line.time, m[1])
    if (!quick) return
    if (line.text === QUICK_BUFF) {
      const buffs = quick()
      window = buffs.length ? { until: line.time + QUICK_BUFF_MS, buffs, counted: new Set() } : null
      return
    }
    if (!window) return
    if (window.until < line.time) return void (window = null)
    const text = line.text
    const b = window.buffs.find((x) => (x.self && text === x.self) || (x.other && text.length > x.other.length && text.endsWith(x.other)))
    if (!b || window.counted.has(b.rankedName)) return
    window.counted.add(b.rankedName)
    count(into, line.time, b.rankedName)
  }
}

/**
 * Your spells resisted, by the name the log gives ("a ratman warrior resisted your Envenomed Bolt X!"):
 * beside the casts, the share of them a target shrugged off (LT-722). A proc of yours resisted counts
 * under its own name, which no cast of yours shares.
 */
export const resistCounter = (): DayCounter => (line, into) => {
  if (!line.text.includes(' resisted your ')) return
  const m = RESISTED_YOUR.exec(line.text)
  if (!m) return
  const day = (into[localDay(line.time)] ??= {})
  day[m[2]] = (day[m[2]] ?? 0) + 1
}

/**
 * A spell's rank bought with motes, by the ranked name the log gives: "You have successfully merged two
 * items together to create a new item: Drain Spirit VI" (LT-756). An item's merge ends "+N" and is left out.
 */
export const spellMergeCounter = (): DayCounter => (line, into) => {
  if (!line.text.startsWith('You have successfully merged ')) return
  const m = MERGED_ITEM.exec(line.text)
  if (!m || /\+\d+\s*$/.test(m[1])) return
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
  async recent(o: HistoryWhere & { days: number }): Promise<CastCounts> {
    // The live logs first (this PC's and any other's): archives are needed only when one of them does
    // not reach back far enough.
    const first = await this.history.get<Days>(this.key, o, () => false)
    const lives = [first.live, ...first.elsewhere.map((e) => e.value)]
    const newest =
      lives
        .flatMap((d) => Object.keys(d))
        .sort()
        .pop() ?? localDay(Date.now())
    const cutoff = o.days ? localDay(new Date(newest + 'T12:00:00').getTime() - (o.days - 1) * 86400_000) : ''
    let all: Days[] = lives
    if (!o.days || lives.some((d) => (Object.keys(d).sort()[0] ?? newest) > cutoff)) {
      all = everyStretch(await this.history.get<Days>(this.key, o, (_name, end) => !cutoff || !end || end >= cutoff))
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
