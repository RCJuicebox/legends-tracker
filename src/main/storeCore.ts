import { promises as fs, readFileSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DEFAULT_TIER_DURATION_PCT, type AppSettings, type MeterOverlayOptions, type OverlayConfig } from '../shared/types'
import { log } from './log'

// The pure half of the settings store: defaults, merging, and the JSON files themselves. No Electron
// import, so it can be tested.

export const DEFAULT_METER_OPTIONS: MeterOverlayOptions = { mode: 'damage', span: 'fight', scope: 'everyone', rows: 8, combinePet: true, header: true }

export const DEFAULT_OVERLAYS: OverlayConfig[] = [
  { id: 'buffs', name: 'Buffs', kind: 'timers', x: 2040, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: 'targets', name: 'DoTs & Timers', kind: 'timers', x: 2400, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: 'alerts', name: 'Alerts', kind: 'alerts', x: 1220, y: 300, width: 1000, height: 220, opacity: 1, fontSize: 30, visible: true, groupByTarget: false },
  {
    id: 'meter', name: 'Damage meter', kind: 'meter', x: 40, y: 560, width: 380, height: 300, opacity: 1, fontSize: 13, visible: true, groupByTarget: false,
    meter: { ...DEFAULT_METER_OPTIONS }
  },
  { id: 'respawns', name: 'Respawns', kind: 'timers', x: 2040, y: 960, width: 340, height: 260, opacity: 1, fontSize: 15, visible: true, groupByTarget: false }
]

/** The default overlays every install had before new ones were tracked; an install without a record has seen these. */
export const LEGACY_OVERLAY_IDS = ['buffs', 'targets', 'alerts']

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
    combat: { fightGapSec: 10, historyMinutes: 60, newSessionOnZone: true, combinePet: true }
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

/** A JSON file held in memory. Changes are written 400 ms after the last one, or at flush(). */
export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    private value: T
  ) {}

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 400)
  }

  /** Counts the value as changed, to be written at the next flush, without a timed write of its own. */
  markDirty(): void {
    this.dirty = true
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
    const text = JSON.stringify(this.value, null, 2)
    const tmp = this.path + '.tmp'
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.writeFile(tmp, text, 'utf8')
        await fs.rename(tmp, this.path)
        return
      } catch (e) {
        // A virus scanner or backup tool holding the file (EBUSY, EPERM) usually lets go quickly.
        if (attempt < 2) {
          log.warn(`Could not save ${this.path}; trying again`, e)
          await pause(250)
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

/** `Kelwyn_neriak` → `Kelwyn` */
export function characterName(logFile: string): string {
  return characterKey(logFile).split('_')[0] ?? ''
}
