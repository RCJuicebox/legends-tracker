import { promises as fs } from 'node:fs'
import { decodeCp1252, parseLogLine } from './logLine'
import { computeDuration, focusForObserved, tieredTicks } from './durations'
import { SpellTracker } from './spellTracker'
import { TimerBoard, type BoardTimer } from './timers'
import type { Spell, SpellBook } from './spells'
import type { LogCheckRow, SpellCategory, TrackingSettings } from '../shared/types'

/**
 * A diagnostic, not a data source: replays recent log history through the same tracker the app
 * runs live, and compares each spell's real landing-to-fade time with what the duration model
 * calculates. When they disagree, the row says which focus percentage would make them agree —
 * the usual cause is a focus effect the settings do not include yet.
 */
export async function checkAgainstLog(opts: {
  logPath: string
  book: SpellBook
  megabytes: number
  level: (name: string) => number
  focusPct: (spell: Spell) => number
  tierPct: Record<SpellCategory, number>
}): Promise<LogCheckRow[]> {
  const { book } = opts
  const observed = new Map<string, number[]>()
  let now = 0
  const board = new TimerBoard({
    onChange: () => {},
    onNotify: () => {},
    onEnd: (t: BoardTimer, reason) => {
      if (reason !== 'faded' || t.meta?.joined) return
      const name = String(t.meta?.rankedName ?? t.label)
      observed.set(name, [...(observed.get(name) ?? []), (now - t.startedAt) / 1000])
    }
  })
  const everything: TrackingSettings = {
    enabled: true, selfBuffs: true, otherBuffs: true, groupBuffs: true, dots: true, debuffs: true,
    buffWarnSec: 0, dotWarnSec: 0, buffWarnSpeech: '', buffFadeSpeech: '', dotWarnSpeech: '', dotFadeSpeech: '',
    announceOtherBuffFades: false, tierDurationPct: opts.tierPct
  }
  const tracker = new SpellTracker(
    book,
    board,
    {
      tracking: everything,
      ruleFor: () => ({}),
      durationFor: (spell, rank) =>
        computeDuration({ spell, rank, level: opts.level(spell.name), tierPct: opts.tierPct, focusPct: opts.focusPct(spell) })
    },
    { notify: () => {}, feed: () => {} }
  )

  const handle = await fs.open(opts.logPath, 'r')
  try {
    const size = (await handle.stat()).size
    let pos = Math.max(0, size - opts.megabytes * 1048576)
    let partial = ''
    let first = pos > 0
    let ticked = -1
    const chunk = Buffer.alloc(4 << 20)
    while (pos < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - pos), pos)
      if (bytesRead <= 0) break
      pos += bytesRead
      const lines = (partial + decodeCp1252(chunk.subarray(0, bytesRead))).split('\n')
      partial = lines.pop() ?? ''
      if (first) {
        lines.shift()
        first = false
      }
      for (const raw of lines) {
        const line = parseLogLine(raw.replace(/\r$/, ''))
        if (!line) continue
        now = line.time
        tracker.handle(line)
        // The board is ticked once per second of log, after that second's first line: nothing a
        // later line in the same second starts or moves can expire within it, so ticking again
        // would change nothing.
        if (now !== ticked) board.tick((ticked = now))
      }
      await new Promise((r) => setImmediate(r))
    }
  } finally {
    await handle.close()
  }

  const rows: LogCheckRow[] = []
  for (const [rankedName, samples] of observed) {
    const r = book.resolve(rankedName)
    if (!r || samples.length < 2) continue
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const calc = computeDuration({
      spell: r.spell, rank: r.rank, level: opts.level(r.spell.name), tierPct: opts.tierPct, focusPct: opts.focusPct(r.spell)
    })
    if (calc.permanent || calc.wholeTicks <= 0) continue
    const fits = median >= calc.earliestSec - 1 && median <= calc.latestSec + 1
    const range = fits ? null : focusForObserved(tieredTicks(r.spell, r.rank, opts.level(r.spell.name), opts.tierPct), median)
    rows.push({
      rankedName,
      category: r.spell.category,
      samples: samples.length,
      observedMedianSec: Math.round(median),
      calculatedEarliestSec: calc.earliestSec,
      calculatedLatestSec: calc.latestSec,
      fits,
      impliedFocusPct: range ? Math.round((range[0] + range[1]) / 2) : null,
      impliedFocusRange: range
    })
  }
  return rows.sort((a, b) => b.samples - a.samples)
}
