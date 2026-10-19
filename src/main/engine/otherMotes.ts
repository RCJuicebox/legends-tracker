import { createReadStream, promises as fs, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { localDay } from '../../core/dates'
import { sameFile } from '../../core/fileIdentity'
import { readLines } from '../../core/logReading'
import { absorbOther, type CharacterScan, type OtherMoteMark } from '../../core/moteMerge'
import { MOTE_RANKS, MoteTracker, type MoteCounts, type MoteSession, type MoteState } from '../../core/motes'
import { log } from '../log'
import { identityOf } from '../sources/logHistory'
import { otherArchiveDir } from '../logFolders'
import type { OtherLogFolders } from './contracts'

// Motes looted on another PC (Settings › Log files). That PC's character logs are read on from where they
// were last read, each by a mote tracker of its own, and what they add goes to the history kept here:
// the motes per day as they come, and each run once it is over. mote-others.json keeps how far each
// log was read and the run it is in. The stock on the Upgrade planner is not topped up from them: it
// counts this PC's log as it is written, and is read from the screen anyway.

/** A run that ended this long before the newest line read is over for good: no reward chest can still come. */
const SETTLED_MS = 60_000
/** Another PC's log quiet this long: its game has most likely closed, and an open run ends at its last line. */
const QUIET_MS = 30 * 60_000

interface MarksFile {
  version: 1
  /** By lower-cased log path. */
  logs: Record<string, OtherMoteMark>
}

const emptyState = (): MoteState => ({ active: null, sessions: [], daily: {} })

interface Hooks {
  motes: () => MoteTracker
  /** History is being read (a catch-up or a rebuild): nothing is handed over meanwhile. */
  busy: () => boolean
  /** The history changed: written, and the page told. */
  changed: (state: MoteState) => void
}

export class OtherMotes {
  private readonly file: string
  private marks: Record<string, OtherMoteMark> | null = null
  /** Each log's tracker, kept between looks so a run's loose ends (a reward chest after the completion line) stay with it. */
  private readonly trackers = new Map<string, { tracker: MoteTracker; added: Record<string, MoteCounts> }>()
  private running: Promise<void> | null = null

  constructor(
    dataDir: string,
    private readonly folders: OtherLogFolders | undefined,
    private readonly hooks: Hooks
  ) {
    this.file = join(dataDir, 'mote-others.json')
  }

  /** Reads what other PCs' logs gained since the last look; one look at a time, none while history is read. */
  check(now = Date.now()): Promise<void> {
    if (this.running) return this.running
    if (!this.folders || this.hooks.busy()) return Promise.resolve()
    this.running = this.checkNow(now)
      .catch((e: unknown) => log.warn("Reading motes from other PCs' logs failed:", e))
      .finally(() => (this.running = null))
    return this.running
  }

  /** A look in progress has finished. */
  async idle(): Promise<void> {
    await this.running
  }

  private async checkNow(now: number): Promise<void> {
    const looks = await this.folders!.lookAll()
    const marks = this.load()
    const added: Record<string, MoteCounts> = {}
    const runs: MoteSession[] = []
    let moved = false
    for (const look of looks) {
      if (!look.reachable) continue
      for (const l of look.logs) {
        try {
          moved = (await this.readOn(marks, l.path, now - l.modified > QUIET_MS, added, runs)) || moved
        } catch (e) {
          // Its PC went away part way: this log's tracker starts again from its mark next time.
          this.trackers.delete(l.path.toLowerCase())
          log.warn(`Motes: could not read ${l.path}:`, e)
        }
      }
    }
    if (!moved) return
    if (this.hooks.busy()) {
      // History began to be read meanwhile: this look is forgotten, and the next one reads it again.
      this.marks = null
      this.trackers.clear()
      return
    }
    this.save()
    if (!Object.keys(added).length && !runs.length) return
    const motes = this.hooks.motes()
    motes.state = absorbOther(motes.state, added, runs)
    this.hooks.changed(motes.state)
    const n = Object.values(added).reduce((sum, c) => sum + MOTE_RANKS.reduce((m, r) => m + (c[r.key] ?? 0), 0), 0)
    log.info(`Motes from other PCs: ${n} mote${n === 1 ? '' : 's'} and ${runs.length} run${runs.length === 1 ? '' : 's'} added`)
  }

  /**
   * One log read on from its mark into its tracker; runs that are over and the motes it added go into
   * `added` and `runs`. Whether anything about it changed.
   */
  private async readOn(marks: Record<string, OtherMoteMark>, path: string, quiet: boolean, added: Record<string, MoteCounts>, runs: MoteSession[]): Promise<boolean> {
    const k = path.toLowerCase()
    const st = await fs.stat(path, { bigint: true }).catch(() => null)
    if (!st) return false
    const id = identityOf(st)
    const size = Number(st.size)
    let mark = marks[k]
    // A new file at the path (that PC archived it), or the same one cut short: read from its top.
    if (!mark || !sameFile({ id: mark.id, size: mark.offset }, { id, size })) {
      mark = marks[k] = { id, offset: 0, state: emptyState(), lastTime: 0 }
      this.trackers.delete(k)
    }
    let t = this.trackers.get(k)
    if (!t) {
      const counted: Record<string, MoteCounts> = {}
      const tracker = new MoteTracker(structuredClone(mark.state), {
        onChange: () => {},
        onLoot: (loot, _run, time) => {
          const day = (counted[localDay(time)] ??= {})
          day[loot.rank] = (day[loot.rank] ?? 0) + loot.count
        }
      })
      this.trackers.set(k, (t = { tracker, added: counted }))
    }
    let changed = false
    if (size > mark.offset) {
      let last = mark.lastTime
      const read = await readLines(
        createReadStream(path, { start: mark.offset }),
        (line) => {
          t.tracker.handle(line)
          last = line.time
        },
        { flushLast: false }
      )
      mark.offset += read
      mark.lastTime = last
      changed = read > 0
    }
    const state = t.tracker.state
    // Quiet a long while: its game is most likely closed, and the run it was in ended at its last line.
    if (quiet && state.active && state.active.kind !== 'manual' && mark.lastTime) {
      t.tracker.gameClosed(mark.lastTime)
      changed = true
    }
    const over = state.sessions.filter((s) => s.endedAt !== null && (quiet || mark.lastTime - s.endedAt > SETTLED_MS))
    if (over.length) {
      runs.push(...over)
      state.sessions = state.sessions.filter((s) => !over.includes(s))
      changed = true
    }
    for (const [day, counts] of Object.entries(t.added)) {
      const into = (added[day] ??= {})
      for (const r of MOTE_RANKS) if (counts[r.key]) into[r.key] = (into[r.key] ?? 0) + counts[r.key]!
      delete t.added[day]
    }
    mark.state = structuredClone(state)
    return changed
  }

  /**
   * For a rebuild of the whole history: the other PCs' logs that answer, to be read with this PC's
   * (each with that PC's archive folder), and for each log out of reach what it was last read to hold,
   * standing in for it so its motes are not lost from the days it shares with the logs read.
   */
  async forRebuild(): Promise<{ logs: { logPath: string; stem: string; archiveDir: string }[]; standIns: CharacterScan[] }> {
    if (!this.folders) return { logs: [], standIns: [] }
    const looks = await this.folders.lookAll()
    const marks = this.load()
    const logs: { logPath: string; stem: string; archiveDir: string }[] = []
    const standIns: CharacterScan[] = []
    for (const look of looks) {
      if (look.reachable) {
        for (const l of look.logs) logs.push({ logPath: l.path, stem: basename(l.path, '.txt'), archiveDir: otherArchiveDir(look.dir) })
        continue
      }
      for (const l of look.logs) {
        const m = marks[l.path.toLowerCase()]
        if (m) standIns.push({ logPath: l.path, stem: basename(l.path, '.txt'), state: { active: null, sessions: [], daily: m.state.daily }, lastTime: m.lastTime, end: 0 })
      }
    }
    return { logs, standIns }
  }

  /** A rebuild read these other PCs' logs to `end`: each goes on from there, with what the rebuild counted in it. */
  async rebuilt(scans: CharacterScan[]): Promise<void> {
    const marks = this.load()
    for (const c of scans) {
      const st = await fs.stat(c.logPath, { bigint: true }).catch(() => null)
      if (!st) continue
      const k = c.logPath.toLowerCase()
      // The rebuild closed any run still open, as of the log's last line.
      marks[k] = { id: identityOf(st), offset: c.end, state: { active: null, sessions: [], daily: c.state.daily }, lastTime: c.lastTime }
      this.trackers.delete(k)
    }
    this.save()
  }

  private load(): Record<string, OtherMoteMark> {
    if (this.marks) return this.marks
    try {
      const f = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<MarksFile>
      this.marks = f.version === 1 && f.logs && typeof f.logs === 'object' ? f.logs : {}
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Ignoring ${this.file}:`, e)
      this.marks = {}
    }
    return this.marks
  }

  /** Written at once, before the history it was handed to: a crash between loses those motes rather than counting them twice. */
  private save(): void {
    const file: MarksFile = { version: 1, logs: this.marks ?? {} }
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify(file), 'utf8')
      renameSync(this.file + '.tmp', this.file)
    } catch (e) {
      log.warn(`Could not save ${this.file}:`, e)
    }
  }
}
