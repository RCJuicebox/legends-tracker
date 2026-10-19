import { closeSync, copyFileSync, fsyncSync, openSync, promises as fs, readFileSync, renameSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_TIER_DURATION_PCT, type AppSettings } from '../shared/types'
import { DEFAULT_OVERLAYS } from '../shared/overlays'
import { log } from './log'
import { parseJson } from '../core/json'
import { characterKey } from '../core/validate'

// The pure half of the settings store: defaults, merging, and the JSON files themselves. No Electron
// import, so it can be tested.

export { DEFAULT_OVERLAYS } from '../shared/overlays'

export function defaultSettings(): AppSettings {
  return {
    installDir: '',
    logFile: '',
    logFolders: [],
    autoStart: true,
    autoRestartUpdates: false,
    characters: {},
    tracking: {
      enabled: true,
      selfBuffs: false,
      otherBuffs: false,
      groupBuffs: false,
      dots: true,
      debuffs: true,
      buffWarnSec: 12,
      dotWarnSec: 12,
      buffWarnSpeech: 'Recast {spell}',
      buffFadeSpeech: '{spell} down',
      dotWarnSpeech: 'Recast {spell}',
      dotFadeSpeech: '{spell} off',
      announceOtherBuffFades: false,
      tierDurationPct: { ...DEFAULT_TIER_DURATION_PCT }
    },
    audio: { deviceId: 'default', masterVolume: 1, speechVolume: 1, soundVolume: 0.8, voice: '', rate: 1, muted: false },
    archive: { autoEnabled: false, thresholdMB: 150, archiveDir: '' },
    overlays: DEFAULT_OVERLAYS.map((o) => ({ ...o })),
    overlaysOnlyWithGame: true,
    yieldToGame: true,
    uiScale: 1,
    theme: 'system',
    hotkeys: true,
    achievementCues: true,
    modules: {},
    combat: { fightGapSec: 10, historyMinutes: 60, newSessionOnZone: true, combinePet: true, charmPets: true },
    groupHealth: { enabled: false, belowPct: 25, speech: '{name} at {pct} percent' },
    factionPlan: { assumptions: {}, choices: {} },
    setup: { hidden: false, accepted: [], arranged: false }
  }
}

const hasId = (v: unknown): v is { id: string } => !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string'

/**
 * Deep-merges saved settings over the defaults, so settings saved by an older build gain new fields.
 *
 * Lists of things with an id (the overlays) merge item by item: a saved item gains the fields its
 * default has since grown. A default item missing from the saved list is added only when `addDefault`
 * says it is new to this install; otherwise the player deleted it and it stays gone.
 */
export function mergeDefaults<T>(base: T, saved: unknown, addDefault: (id: string) => boolean = () => false): T {
  if (Array.isArray(base)) {
    if (!Array.isArray(saved)) return base
    if (!base.length || !base.every(hasId) || !saved.every(hasId)) return saved as T
    const defaults = new Map(base.map((b) => [b.id, b]))
    const merged = saved.map((s) => (defaults.has(s.id) ? mergeDefaults(defaults.get(s.id), s, addDefault) : s))
    const have = new Set(saved.map((s) => s.id))
    const added = base.filter((b) => !have.has(b.id) && addDefault(b.id))
    return [...merged, ...added] as T
  }
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        out[k] = k in out ? mergeDefaults(out[k], v, addDefault) : v
      }
    }
    return out as T
  }
  return (saved === undefined ? base : saved) as T
}

/**
 * `unreadable`: the file is there but could not be opened (a virus scanner or backup tool holding it).
 * Its contents may be fine, so it is left where it is and must not be written over this run.
 */
export type ReadResult = { state: 'missing' } | { state: 'ok'; value: unknown; restoredFrom?: string } | { state: 'corrupt'; movedTo: string } | { state: 'unreadable' }

/**
 * Waits before trying a file again when another program (a virus scanner, a backup tool) holds it.
 * Reads happen at start-up only, so their waits block. Tests shorten both.
 */
export const retrySchedule = { readMs: [100, 300, 800], writeMs: [250, 750, 2000] }

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/**
 * Reads a JSON file. A file that is there but will not parse is moved aside to
 * `<name>.corrupt-<time>.json`, so it is neither lost nor overwritten by defaults. A file the app
 * ships (setAside: false) is only reported. A file that cannot be opened is tried a few times, then
 * reported unreadable and left alone: only a parse failure proves it is bad.
 */
export function readJsonFile(path: string, opts: { setAside?: boolean; now?: Date } = {}): ReadResult {
  const aside = (): ReadResult => (opts.setAside === false ? { state: 'corrupt', movedTo: '' } : setAside(path, opts.now ?? new Date()))
  const retries = retrySchedule.readMs
  let text: string
  for (let attempt = 0; ; attempt++) {
    try {
      text = readFileSync(path, 'utf8')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
      if (attempt < retries.length) {
        log.warn(`Could not read ${path}; trying again`, e)
        sleepSync(retries[attempt])
        continue
      }
      log.error(`Could not read ${path}; it is left as it is and not written this run`, e)
      return { state: 'unreadable' }
    }
  }
  try {
    return { state: 'ok', value: parseJson(text) }
  } catch (e) {
    log.error(`${path} is not valid JSON`, e)
    const moved = aside()
    // The copy kept before this run's first write (backup: true) stands in for a torn file (LT-599).
    if (opts.setAside === false) return moved
    const bak = path.replace(/\.json$/i, '') + '.bak.json'
    try {
      const value = parseJson(readFileSync(bak, 'utf8'))
      log.warn(`${bak} is used in its place`)
      return { state: 'ok', value, restoredFrom: bak }
    } catch {
      return moved
    }
  }
}

/** Every file set aside this run, the Store's and the features' side files alike (LT-612). */
const setAsideThisRun: string[] = []

/** The files set aside this run, where they were moved to: for the feed and diagnostics. */
export const filesSetAside = (): readonly string[] => setAsideThisRun

/** Moves a file that cannot be used aside to `<name>.corrupt-<time>.json` (or `.<why>-<time>`), kept and named to the player. */
export function setAside(path: string, now: Date = new Date(), why = 'corrupt'): ReadResult & { state: 'corrupt' } {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const movedTo = join(dirname(path), `${basename(path, '.json')}.${why}-${stamp}.json`)
  try {
    renameSync(path, movedTo)
    log.warn(`Moved ${path} aside to ${movedTo}`)
    setAsideThisRun.push(movedTo)
  } catch (e) {
    log.error(`Could not move ${path} aside`, e)
  }
  return { state: 'corrupt', movedTo }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface JsonFileOptions {
  /** How long after the last change it is written. Settings go quickly; files the log keeps changing wait. */
  delayMs?: number
  /** Indented for a person to read; files only the app reads are written compact. */
  pretty?: boolean
  /**
   * Keeps the file as this run found it in `<name>.bak.json`, copied before the run's first write: the
   * atomic write guards against a torn file, not against wrong content saved whole (LT-441); and a
   * file that will not read is read from the copy (LT-599).
   */
  backup?: boolean
  /** Written this long after the first unsaved change at the latest, however the changes keep coming (LT-599). */
  maxWaitMs?: number
}

/** A JSON file held in memory. Changes are written a little after the last one, or at flush(). */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private writing: Promise<void> = Promise.resolve()
  private frozen = ''
  private readonly delayMs: number
  private readonly maxWaitMs: number
  /** When the first unsaved change was made; 0 while nothing waits. */
  private dirtySince = 0
  private readonly pretty: boolean
  /** Still to copy the file as found to its .bak.json, before this run first writes it. */
  private backup: boolean

  constructor(
    readonly path: string,
    private value: T,
    opts: JsonFileOptions = {}
  ) {
    this.delayMs = opts.delayMs ?? 400
    this.maxWaitMs = opts.maxWaitMs ?? 60_000
    this.pretty = opts.pretty ?? true
    this.backup = opts.backup ?? false
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    this.dirty = true
    const now = Date.now()
    this.dirtySince ||= now
    if (this.timer) clearTimeout(this.timer)
    // After the last change, but a long busy stretch does not put the write off for good.
    this.timer = setTimeout(() => void this.flush(), Math.min(this.delayMs, Math.max(0, this.dirtySince + this.maxWaitMs - now)))
  }

  /** Counts the value as changed, to be written at the next flush, without a timed write of its own. */
  markDirty(): void {
    this.dirty = true
  }

  /** Changed since the last write that reached the disk. */
  get pending(): boolean {
    return this.dirty
  }

  /** Never writes the file again this run: it holds what a newer build saved, which this one must not overwrite. */
  freeze(reason: string): void {
    this.frozen = reason
  }

  /** Writes the file if anything changed since the last write. Never rejects; failures are logged. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // One write at a time, so two never share the .tmp file.
    this.writing = this.writing.then(() => this.write())
    return this.writing
  }

  /**
   * Writes the file now, on this thread, if anything changed: for Windows ending the session, which
   * waits for no promise (LT-508). A write under way is not waited for; the next sync write is whole.
   */
  flushSync(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty || this.frozen) return
    this.dirty = false
    this.dirtySince = 0
    if (this.backup) {
      this.backup = false
      try {
        copyFileSync(this.path, this.path.replace(/\.json$/i, '') + '.bak.json')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not keep a copy of ${this.path} before saving it`, e)
      }
    }
    try {
      const tmp = this.path + '.tmp'
      const fd = openSync(tmp, 'w')
      try {
        writeSync(fd, this.pretty ? JSON.stringify(this.value, null, 2) : JSON.stringify(this.value), null, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(tmp, this.path)
    } catch (e) {
      log.error(`Could not save ${this.path}`, e)
      this.dirty = true
    }
  }

  private async write(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    this.dirtySince = 0
    if (this.frozen) return
    if (this.backup) {
      this.backup = false
      await fs.copyFile(this.path, this.path.replace(/\.json$/i, '') + '.bak.json').catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') log.warn(`Could not keep a copy of ${this.path} before saving it`, e)
      })
    }
    try {
      await writeFileAtomic(this.path, this.pretty ? JSON.stringify(this.value, null, 2) : JSON.stringify(this.value))
    } catch (e) {
      log.error(`Could not save ${this.path}`, e)
      // Try again at the next change or flush.
      this.dirty = true
    }
  }
}

/**
 * Writes a file whole or not at all: to `<path>.tmp`, then renamed over it, tried again on the
 * retry schedule while another program (a virus scanner, a backup tool) holds either. Throws the last
 * error once the tries run out. Every file the app keeps is written this way, through JsonFile or not.
 */
export async function writeFileAtomic(path: string, text: string | Uint8Array): Promise<void> {
  const tmp = path + '.tmp'
  for (let attempt = 0; ; attempt++) {
    try {
      // Flushed to the disk before the rename: a power cut just after a save otherwise leaves a file of NULs (LT-599).
      const fh = await fs.open(tmp, 'w')
      try {
        await (typeof text === 'string' ? fh.writeFile(text, 'utf8') : fh.writeFile(text))
        await fh.sync()
      } finally {
        await fh.close()
      }
      await fs.rename(tmp, path)
      return
    } catch (e) {
      if (attempt >= retrySchedule.writeMs.length) throw e
      log.warn(`Could not save ${path}; trying again`, e)
      await pause(retrySchedule.writeMs[attempt])
    }
  }
}

export { characterKey }

/** A character's log in the game folder: `Kelwyn_neriak` → `<install>\Logs\eqlog_Kelwyn_neriak.txt`. */
function logFileFor(installDir: string, key: string): string {
  return join(installDir, 'Logs', `${logStem(key)}.txt`)
}

/**
 * A character's live log: for the character being played, the log being watched (which may have been
 * chosen from anywhere); for any other, its file in the game's Logs folder.
 */
export function characterLogFile(key: string, played: string, watched: string, installDir: string): string {
  return key === played && watched ? watched : logFileFor(installDir, key)
}

/** The name a character's log and its archives start with: `eqlog_Kelwyn_neriak`. */
export function logStem(key: string): string {
  return `eqlog_${key}`
}

/** `Kelwyn_neriak` → `Kelwyn` */
export function characterName(logFile: string): string {
  return characterKey(logFile).split('_')[0] ?? ''
}
