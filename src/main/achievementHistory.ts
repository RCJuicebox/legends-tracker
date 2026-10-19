import { join } from 'node:path'
import { COMPLETED_ACHIEVEMENT } from '../core/phrases'
import { localDay } from '../core/dates'
import { JsonFile, readJsonFile } from './storeCore'
import { newerBuildWrote } from './schema'
import { everyStretch, type HistoryConsumer, type HistoryWhere, type LogHistory } from './sources/logHistory'
import type { AchSection } from '../shared/character'
import type { AchievementProgress, ExportSnapshot } from '../shared/ipc'

// Progress over time (FEAT-032). Nothing kept a time series: each export replaced the last, and the
// faction tallies keep twenty changes a faction. Two records now: the log's "You have completed
// achievement: X" lines, read with everything else LogHistory counts, and a snapshot of each new
// achievements export (done by section, the Slayer counts) in achievements-history.json. The Factions
// feature counts its standings' moves per day beside them.

/** The completions kept per stretch of log, newest last: enough for years of play. */
const COMPLETIONS_KEPT = 5000
/** Snapshots kept per character: one an export, so hundreds of exports. */
const SNAPSHOTS_KEPT = 400

export interface Completion {
  name: string
  at: number
}

/** "You have completed achievement: X", with its time, as a LogHistory consumer. */
export const completionsConsumer: HistoryConsumer<Completion[]> = {
  version: 1,
  empty: () => [],
  reader: () => (line, into) => {
    if (!line.text.startsWith('You have completed achievement')) return
    const m = COMPLETED_ACHIEVEMENT.exec(line.text)
    if (!m) return
    into.push({ name: m[1], at: line.time })
    if (into.length > COMPLETIONS_KEPT) into.splice(0, into.length - COMPLETIONS_KEPT)
  }
}

/** What an export says, kept small: done counts by section, and each Slayer achievement's count. */
export function snapshotOf(sections: readonly AchSection[], at: number): ExportSnapshot {
  const done: Record<string, number> = {}
  const slayer: Record<string, number> = {}
  let total = 0
  for (const s of sections) {
    const key = s.cat ? `${s.cat} › ${s.name}` : s.name
    const n = s.ach.filter((a) => a.d).length
    total += n
    if (n) done[key] = n
    if (!/slayer/i.test(s.cat) && !/slayer/i.test(s.name)) continue
    for (const a of s.ach) {
      const p = a.c.find((c) => c.p)?.p
      if (p) slayer[a.n] = a.d ? p[1] : p[0]
    }
  }
  return { at, total, done, slayer }
}

type HistoryFile = Record<string, ExportSnapshot[]>

export class AchievementHistory {
  private readonly file: JsonFile<HistoryFile>

  constructor(
    dir: string,
    private readonly history: LogHistory,
    private readonly key: string
  ) {
    const path = join(dir, 'achievements-history.json')
    const read = readJsonFile(path)
    this.file = new JsonFile(path, read.state === 'ok' ? sanitizeHistory(read.value) : {}, { delayMs: 2000, pretty: false, backup: true })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  /** A character's export as read: kept when it is newer than the last snapshot, and says something new. */
  add(character: string, sections: readonly AchSection[], modified: number): void {
    const all = this.file.get()
    const list = all[character] ?? []
    const last = list[list.length - 1]
    if (last && modified <= last.at) return
    const snap = snapshotOf(sections, modified)
    if (last && JSON.stringify({ ...last, at: 0 }) === JSON.stringify({ ...snap, at: 0 })) return
    this.file.set({ ...all, [character]: [...list, snap].slice(-SNAPSHOTS_KEPT) })
  }

  /** The completions the logs saw, oldest first, and the snapshots of the character's exports. */
  async progress(character: string, where: HistoryWhere, factionDays: Promise<Record<string, Record<string, number>>>): Promise<AchievementProgress> {
    const slice = await this.history.get<Completion[]>(this.key, where)
    const seen = new Set<string>()
    const completions = everyStretch(slice)
      .flat()
      .sort((a, b) => a.at - b.at)
      // The same line read from a log and its archive's overlap counts once.
      .filter((c) => {
        const k = `${c.name}|${c.at}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
    return { completions, snapshots: this.file.get()[character] ?? [], factionDays: await factionDays.catch(() => ({})), today: localDay(Date.now()) }
  }
}

/** achievements-history.json as read back: lists of snapshots by character, each with its numbers. */
function sanitizeHistory(v: unknown): HistoryFile {
  if (!v || typeof v !== 'object') return {}
  const out: HistoryFile = {}
  const nums = (x: unknown): Record<string, number> =>
    x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, n]) => typeof n === 'number' && Number.isFinite(n))) : {}
  for (const [character, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    out[character] = list
      .filter((s): s is ExportSnapshot => !!s && typeof s === 'object' && typeof (s as ExportSnapshot).at === 'number')
      .map((s) => ({ at: s.at, total: typeof s.total === 'number' ? s.total : 0, done: nums(s.done), slayer: nums(s.slayer) }))
      .slice(-SNAPSHOTS_KEPT)
  }
  return out
}
