import { promises as fs, readFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_TIER_DURATION_PCT, type AppSettings } from '../shared/types'
import { DEFAULT_OVERLAYS } from '../shared/overlays'
import { log } from './log'

// The pure half of the settings store: defaults, merging, and the JSON files themselves. No Electron
// import, so it can be tested.

export { DEFAULT_METER_OPTIONS, DEFAULT_OVERLAYS } from '../shared/overlays'

export function defaultSettings(): AppSettings {
  return {
    installDir: '',
    logFile: '',
    autoStart: true,
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
    hotkeys: true,
    combat: { fightGapSec: 10, historyMinutes: 60, newSessionOnZone: true, combinePet: true, charmPets: true }
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

export type ReadResult = { state: 'missing' } | { state: 'ok'; value: unknown } | { state: 'corrupt'; movedTo: string }

/**
 * Reads a JSON file. A file that is there but will not parse is moved aside to
 * `<name>.corrupt-<time>.json`, so it is neither lost nor overwritten by defaults. A file the app
 * ships (setAside: false) is only reported.
 */
export function readJsonFile(path: string, opts: { setAside?: boolean; now?: Date } = {}): ReadResult {
  const aside = (): ReadResult => (opts.setAside === false ? { state: 'corrupt', movedTo: '' } : setAside(path, opts.now ?? new Date()))
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    log.error(`Could not read ${path}`, e)
    return aside()
  }
  try {
    return { state: 'ok', value: JSON.parse(text) }
  } catch (e) {
    log.error(`${path} is not valid JSON`, e)
    return aside()
  }
}

function setAside(path: string, now: Date): ReadResult {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const movedTo = join(dirname(path), `${basename(path, '.json')}.corrupt-${stamp}.json`)
  try {
    renameSync(path, movedTo)
    log.warn(`Moved ${path} aside to ${movedTo}`)
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
}

/** A write that fails (a virus scanner or backup tool holding the file) is tried again after these waits. */
const RETRY_MS = [250, 750, 2000]

/** A JSON file held in memory. Changes are written a little after the last one, or at flush(). */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private writing: Promise<void> = Promise.resolve()
  private frozen = ''
  private readonly delayMs: number
  private readonly pretty: boolean

  constructor(
    readonly path: string,
    private value: T,
    opts: JsonFileOptions = {}
  ) {
    this.delayMs = opts.delayMs ?? 400
    this.pretty = opts.pretty ?? true
  }

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), this.delayMs)
  }

  /** Counts the value as changed, to be written at the next flush, without a timed write of its own. */
  markDirty(): void {
    this.dirty = true
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

  private async write(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    if (this.frozen) return
    const text = this.pretty ? JSON.stringify(this.value, null, 2) : JSON.stringify(this.value)
    const tmp = this.path + '.tmp'
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.writeFile(tmp, text, 'utf8')
        await fs.rename(tmp, this.path)
        return
      } catch (e) {
        if (attempt < RETRY_MS.length) {
          log.warn(`Could not save ${this.path}; trying again`, e)
          await pause(RETRY_MS[attempt])
          continue
        }
        log.error(`Could not save ${this.path}`, e)
        // Try again at the next change or flush.
        this.dirty = true
        return
      }
    }
  }
}

/** `...\Logs\eqlog_Kelwyn_neriak.txt` → `Kelwyn_neriak` */
export function characterKey(logFile: string): string {
  const m = /eqlog_(.+)\.txt$/i.exec(logFile)
  return m ? m[1] : ''
}

/** A character's log in the game folder: `Kelwyn_neriak` → `<install>\Logs\eqlog_Kelwyn_neriak.txt`. */
export function logFileFor(installDir: string, key: string): string {
  return join(installDir, 'Logs', `${logStem(key)}.txt`)
}

/** The name a character's log and its archives start with: `eqlog_Kelwyn_neriak`. */
export function logStem(key: string): string {
  return `eqlog_${key}`
}

/** `Kelwyn_neriak` → `Kelwyn` */
export function characterName(logFile: string): string {
  return characterKey(logFile).split('_')[0] ?? ''
}
