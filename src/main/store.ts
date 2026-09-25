import { app } from 'electron'
import type { MoteState } from '../core/motes'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_CHARACTER,
  DEFAULT_TIER_DURATION_PCT,
  type AppSettings,
  type CharacterSettings,
  type FocusSource,
  type MoteStock,
  type OverlayConfig,
  type SpellRule,
  type Trigger
} from '../shared/types'

export const DEFAULT_OVERLAYS: OverlayConfig[] = [
  { id: 'buffs', name: 'Buffs', kind: 'timers', x: 2040, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: 'targets', name: 'DoTs & Timers', kind: 'timers', x: 2400, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: 'alerts', name: 'Alerts', kind: 'alerts', x: 1220, y: 300, width: 1000, height: 220, opacity: 1, fontSize: 30, visible: true, groupByTarget: false }
]

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
    yieldToGame: true
  }
}

/** Deep-merges saved settings over the defaults, so settings saved by an older build gain new fields. */
function mergeDefaults<T>(base: T, saved: unknown): T {
  if (Array.isArray(base)) return (Array.isArray(saved) ? saved : base) as T
  if (base && typeof base === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
        out[k] = k in out ? mergeDefaults(out[k], v) : v
      }
    }
    return out as T
  }
  return (saved === undefined ? base : saved) as T
}

class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null
  constructor(
    readonly path: string,
    private value: T
  ) {}

  get(): T {
    return this.value
  }

  set(value: T): void {
    this.value = value
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 400)
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = this.path + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(this.value, null, 2), 'utf8')
    await fs.rename(tmp, this.path)
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export interface KnownCast {
  rankedName: string
  lastCast: number
  count: number
}

export class Store {
  readonly dir = app.getPath('userData')
  readonly settings: JsonFile<AppSettings>
  readonly triggers: JsonFile<Trigger[]>
  readonly rules: JsonFile<Record<string, SpellRule>>
  readonly casts: JsonFile<Record<string, KnownCast>>
  readonly motes: JsonFile<MoteState>
  readonly stock: JsonFile<MoteStock>
  /** True until mote history has been built from the logs once. */
  readonly motesFresh: boolean
  /** True on a first run, before any settings were saved. */
  readonly settingsFresh: boolean

  constructor(defaultTriggersPath: string) {
    const p = (f: string) => join(this.dir, f)
    const savedSettings = readJson(p('settings.json'))
    this.settingsFresh = savedSettings === undefined
    this.settings = new JsonFile(p('settings.json'), mergeDefaults(defaultSettings(), savedSettings))
    const firstRun = !existsSync(p('triggers.json'))
    const triggers = (readJson(firstRun ? defaultTriggersPath : p('triggers.json')) as Trigger[] | undefined) ?? []
    this.triggers = new JsonFile(p('triggers.json'), triggers)
    if (firstRun) this.triggers.set(triggers)
    this.rules = new JsonFile(p('spell-rules.json'), (readJson(p('spell-rules.json')) as Record<string, SpellRule>) ?? {})
    this.casts = new JsonFile(p('casts.json'), (readJson(p('casts.json')) as Record<string, KnownCast>) ?? {})
    const motes = readJson(p('motes.json')) as MoteState | undefined
    this.motesFresh = !motes
    this.motes = new JsonFile(p('motes.json'), motes ?? { active: null, sessions: [], daily: {} })
    this.stock = new JsonFile(
      p('mote-stock.json'),
      mergeDefaults<MoteStock>(
        { counts: {}, item: { name: '', lvl: 0, xp: 0, to: 1 }, autoAdd: true },
        readJson(p('mote-stock.json'))
      )
    )
  }

  characterOf(logFile: string): CharacterSettings {
    const s = this.settings.get()
    const c = mergeDefaults(DEFAULT_CHARACTER, s.characters[characterKey(logFile)])
    // A character saved with one flat focus figure keeps it, as a single source, until it is replaced.
    if (!c.focusSources.length && (c.beneficialFocusPct || c.detrimentalFocusPct)) {
      const legacy = (pct: number, appliesTo: FocusSource['appliesTo']): FocusSource => ({
        id: `legacy-${appliesTo}`, name: `${appliesTo === 'beneficial' ? 'Beneficial' : 'Detrimental'} duration focus`, kind: 'aa', from: 'earlier setting',
        pct, appliesTo, maxLevel: 0, decayPct: 0, minTicks: 0, requireSpas: [], excludeSpas: [], enabled: true
      })
      c.focusSources = [
        ...(c.beneficialFocusPct ? [legacy(c.beneficialFocusPct, 'beneficial')] : []),
        ...(c.detrimentalFocusPct ? [legacy(c.detrimentalFocusPct, 'detrimental')] : [])
      ]
    }
    delete c.beneficialFocusPct
    delete c.detrimentalFocusPct
    return c
  }

  async flushAll(): Promise<void> {
    await Promise.all([this.settings.flush(), this.triggers.flush(), this.rules.flush(), this.casts.flush(), this.motes.flush(), this.stock.flush()])
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
