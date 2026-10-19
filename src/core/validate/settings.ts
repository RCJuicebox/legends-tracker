import {
  CLASS_NAMES,
  MAX_LOG_FOLDERS,
  type AppSettings,
  type CharacterSettings,
  type FocusSource,
  type AchievementOverlayOptions,
  type MeterOverlayOptions,
  type OverlayConfig,
  type PlanChoices,
  type PlanSettings
} from '../../shared/types'
import { DEFAULT_ACHIEVEMENT_OPTIONS, DEFAULT_METER_OPTIONS, minOpacity } from '../../shared/overlays'
import { Obj, isCharacterKey, isFullPath, isObj, isRecordKey, stringsArg } from './args'

// settings.json: every page's settings, the character records and the faction plan's choices, and the field checks the other files share.

/** A character log as the game writes it, by its full path; '' is none chosen. Anything else keeps what was set. */
export function logFilePath(v: unknown, fb: string): string {
  if (v === '') return ''
  if (!isFullPath(v)) return fb
  const m = /[\\/]eqlog_([^\\/]+)\.txt$/i.exec(v)
  return m && isCharacterKey(m[1]) ? v : fb
}

/** Other PCs' Logs folders: full paths, each once whatever its case or a trailing slash, at most MAX_LOG_FOLDERS. */
export function logFolders(v: unknown, fb: string[]): string[] {
  if (!Array.isArray(v)) return fb
  const out: string[] = []
  for (const x of v) {
    if (!isFullPath(x) || x.length > 260) continue
    // "E:\" keeps its slash: "E:" alone is a drive's current folder.
    const dir = x.length > 3 ? x.replace(/[\\/]+$/, '') : x
    if (!out.some((d) => d.toLowerCase() === dir.toLowerCase())) out.push(dir)
  }
  return out.slice(0, MAX_LOG_FOLDERS)
}

export function str(v: unknown, fb: string): string {
  return typeof v === 'string' ? v : fb
}

export function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb
}

export function num(v: unknown, fb: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fb
  return Math.max(min, Math.min(max, n))
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return allowed.includes(v as T) ? (v as T) : fb
}

export function numbers(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []
}

/** The optional modules turned on or off: a page id to a switch, nothing else. */
export function modules(v: unknown, fb: Record<string, boolean>): Record<string, boolean> {
  if (!isObj(v)) return fb
  const out: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(v).slice(0, 50)) if (typeof on === 'boolean' && /^[a-z][a-z0-9-]{0,39}$/.test(id)) out[id] = on
  return out
}

/** Same kind of value as the fallback: for fields this file does not know by name. */
export function sameKind(v: unknown, fb: unknown): boolean {
  if (fb === undefined || v === undefined) return false
  if (Array.isArray(fb)) return Array.isArray(v)
  if (fb === null) return v === null
  return typeof v === typeof fb && Array.isArray(v) === Array.isArray(fb)
}

/**
 * Builds an object from `known` (checked fields) plus any other field of `v` that the fallback also
 * has, with the same kind of value. Fields neither side knows are dropped.
 */
export function shape<T>(v: Obj, fb: T, known: Partial<Record<keyof T, unknown>>): T {
  const out: Obj = { ...(fb as Obj) }
  for (const [k, x] of Object.entries(v)) if (!(k in known) && sameKind(x, (fb as Obj)[k])) out[k] = x
  for (const [k, x] of Object.entries(known)) if (x !== undefined) out[k] = x
  return out as T
}

export const LEVEL_MAX = 255

/** The faction plan's numbers, held to what their inputs on the Plan tab allow. */
export const PLAN_RANGES: Partial<Record<keyof PlanSettings, [number, number]>> = {
  travelMin: [0, 120],
  killsPerHour: [1, 1000],
  namedRespawnMin: [1, 600],
  handInSec: [0, 600],
  gatherSec: [0, 3600],
  unknownSec: [0, 3600],
  keepMaxed: [0, 1],
  positiveHours: [0, 100],
  swapMin: [0, 120]
}

/**
 * The faction plan's assumptions: only those the player changed are kept, so a default improved in a
 * later build reaches them. One not sent stays unset; a bad one keeps what was there.
 */
export function planAssumptions(v: unknown, fb: Partial<PlanSettings>): Partial<PlanSettings> {
  if (!isObj(v)) return fb
  const out: Record<string, unknown> = {}
  const was = fb as Record<string, unknown>
  for (const [k, [lo, hi]] of Object.entries(PLAN_RANGES)) {
    const x = v[k]
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = Math.max(lo, Math.min(hi, x))
    else if (k in v && typeof was[k] === 'number') out[k] = was[k]
  }
  if (v.goal === 'fastest' || v.goal === 'positive' || v.goal === 'cities') out.goal = v.goal
  else if ('goal' in v && fb.goal) out.goal = fb.goal
  for (const k of ['raceSwaps', 'unlocksFirst'] as const) {
    if (typeof v[k] === 'boolean') out[k] = v[k]
    else if (k in v && fb[k] !== undefined) out[k] = fb[k]
  }
  return out as Partial<PlanSettings>
}

/** Locks, rule-outs or paces a page may keep for one character: about the size of every faction's ways. */
export const PLAN_CHOICES_MAX = 5000
export const ACTIVITY_ID_MAX = 300

/** A character's locks, rule-outs and paces on the Plan tab; null when there are none. */
export function planChoices(v: unknown): PlanChoices | null {
  if (!isObj(v)) return null
  const locks: Record<string, string> = {}
  if (isObj(v.locks))
    for (const [faction, id] of Object.entries(v.locks).slice(0, PLAN_CHOICES_MAX)) {
      if (isRecordKey(faction) && typeof id === 'string' && id.length > 0 && id.length <= ACTIVITY_ID_MAX) locks[faction] = id
    }
  const excluded = [...new Set(stringsArg(v.excluded, PLAN_CHOICES_MAX, ACTIVITY_ID_MAX))]
  const perHour: Record<string, number> = {}
  if (isObj(v.perHour))
    for (const [id, n] of Object.entries(v.perHour).slice(0, PLAN_CHOICES_MAX)) {
      if (isRecordKey(id, ACTIVITY_ID_MAX) && typeof n === 'number' && Number.isFinite(n) && n > 0) perHour[id] = Math.min(n, 100_000)
    }
  return Object.keys(locks).length || excluded.length || Object.keys(perHour).length ? { locks, excluded, perHour } : null
}

export function focusSource(v: unknown): FocusSource | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  const fb: FocusSource = {
    id: v.id,
    name: '',
    kind: 'item',
    from: '',
    pct: 0,
    appliesTo: 'both',
    maxLevel: 0,
    decayPct: 0,
    minTicks: 0,
    requireSpas: [],
    excludeSpas: [],
    enabled: true
  }
  return shape(v, fb, {
    name: str(v.name, ''),
    kind: oneOf(v.kind, ['item', 'aa'] as const, 'item'),
    from: str(v.from, ''),
    spellId: typeof v.spellId === 'number' && Number.isFinite(v.spellId) ? v.spellId : undefined,
    pct: num(v.pct, 0, -1000, 1000),
    appliesTo: oneOf(v.appliesTo, ['beneficial', 'detrimental', 'both'] as const, 'both'),
    maxLevel: num(v.maxLevel, 0, 0, LEVEL_MAX),
    decayPct: num(v.decayPct, 0, 0, 100),
    minTicks: num(v.minTicks, 0, 0, 1_000_000),
    requireSpas: numbers(v.requireSpas),
    excludeSpas: numbers(v.excludeSpas),
    enabled: bool(v.enabled, true)
  })
}

export function sanitizeCharacter(v: unknown, fb: CharacterSettings): CharacterSettings | null {
  if (!isObj(v)) return null
  const classLevels: CharacterSettings['classLevels'] = {}
  if (isObj(v.classLevels)) {
    // In the order given: the first class is the player's main one.
    for (const [c, n] of Object.entries(v.classLevels)) {
      if ((CLASS_NAMES as readonly string[]).includes(c) && typeof n === 'number' && Number.isFinite(n)) classLevels[c as keyof typeof classLevels] = num(n, 1, 1, LEVEL_MAX)
    }
  }
  const out = shape(v, fb, {
    level: num(v.level, fb.level, 1, LEVEL_MAX),
    classLevels: isObj(v.classLevels) ? classLevels : fb.classLevels,
    race: typeof v.race === 'string' ? v.race.slice(0, 40) : fb.race,
    deity: typeof v.deity === 'string' ? v.deity.slice(0, 40) : fb.deity,
    focusSources: Array.isArray(v.focusSources) ? v.focusSources.map(focusSource).filter((f) => f !== null) : fb.focusSources
  })
  // The old flat figures are read once and then dropped; keep them only as numbers.
  for (const k of ['beneficialFocusPct', 'detrimentalFocusPct'] as const) {
    if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k] as number
    else delete out[k]
  }
  return out
}

export function meterOptions(v: unknown, fb: MeterOverlayOptions | undefined): MeterOverlayOptions | undefined {
  if (!isObj(v)) return fb
  const base = fb ?? DEFAULT_METER_OPTIONS
  return {
    mode: oneOf(v.mode, ['damage', 'incoming', 'healing'] as const, base.mode),
    span: oneOf(v.span, ['fight', 'session'] as const, base.span),
    scope: oneOf(v.scope, ['everyone', 'group', 'you'] as const, base.scope),
    rows: num(v.rows, base.rows, 1, 50),
    combinePet: bool(v.combinePet, base.combinePet),
    header: bool(v.header, base.header)
  }
}

export function achievementOptions(v: unknown, fb: AchievementOverlayOptions | undefined): AchievementOverlayOptions {
  const base = fb ?? DEFAULT_ACHIEVEMENT_OPTIONS
  return isObj(v) ? { factionPlan: bool(v.factionPlan, base.factionPlan), hunter: bool(v.hunter, base.hunter ?? true) } : { ...base }
}

export function overlay(v: unknown, fb: OverlayConfig | undefined): OverlayConfig | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  const base: OverlayConfig = fb ?? {
    id: v.id,
    name: v.id,
    kind: 'timers',
    x: 100,
    y: 100,
    width: 340,
    height: 420,
    opacity: 1,
    fontSize: 15,
    visible: true,
    groupByTarget: true
  }
  const kind = oneOf(v.kind, ['timers', 'alerts', 'meter', 'achievements'] as const, base.kind)
  const meter = kind === 'meter' ? (meterOptions(v.meter, base.meter) ?? { ...DEFAULT_METER_OPTIONS }) : undefined
  const achievements = kind === 'achievements' ? achievementOptions(v.achievements, base.achievements) : undefined
  return shape(v, base, {
    id: v.id,
    name: str(v.name, base.name),
    kind,
    meter,
    achievements,
    x: num(v.x, base.x, -100_000, 100_000),
    y: num(v.y, base.y, -100_000, 100_000),
    width: num(v.width, base.width, 40, 20_000),
    height: num(v.height, base.height, 40, 20_000),
    opacity: num(v.opacity, base.opacity, minOpacity(kind), 1),
    fontSize: num(v.fontSize, base.fontSize, 6, 200),
    visible: bool(v.visible, base.visible),
    groupByTarget: bool(v.groupByTarget, base.groupByTarget)
  })
}

/**
 * The settings a page asks to save, checked field by field against the current settings (`fb`).
 * Null when it is not an object at all.
 */
export function sanitizeSettings(v: unknown, fb: AppSettings): AppSettings | null {
  if (!isObj(v)) return null
  const t = isObj(v.tracking) ? v.tracking : {}
  const a = isObj(v.audio) ? v.audio : {}
  const ar = isObj(v.archive) ? v.archive : {}

  const tierDurationPct = { ...fb.tracking.tierDurationPct }
  if (isObj(t.tierDurationPct)) {
    for (const k of Object.keys(tierDurationPct) as (keyof typeof tierDurationPct)[]) tierDurationPct[k] = num(t.tierDurationPct[k], tierDurationPct[k], 0, 1000)
  }
  const tracking = shape(t, fb.tracking, {
    enabled: bool(t.enabled, fb.tracking.enabled),
    selfBuffs: bool(t.selfBuffs, fb.tracking.selfBuffs),
    otherBuffs: bool(t.otherBuffs, fb.tracking.otherBuffs),
    groupBuffs: bool(t.groupBuffs, fb.tracking.groupBuffs),
    dots: bool(t.dots, fb.tracking.dots),
    debuffs: bool(t.debuffs, fb.tracking.debuffs),
    buffWarnSec: num(t.buffWarnSec, fb.tracking.buffWarnSec, 0, 3600),
    dotWarnSec: num(t.dotWarnSec, fb.tracking.dotWarnSec, 0, 3600),
    buffWarnSpeech: str(t.buffWarnSpeech, fb.tracking.buffWarnSpeech),
    buffFadeSpeech: str(t.buffFadeSpeech, fb.tracking.buffFadeSpeech),
    dotWarnSpeech: str(t.dotWarnSpeech, fb.tracking.dotWarnSpeech),
    dotFadeSpeech: str(t.dotFadeSpeech, fb.tracking.dotFadeSpeech),
    announceOtherBuffFades: bool(t.announceOtherBuffFades, fb.tracking.announceOtherBuffFades),
    tierDurationPct
  })

  const audio = shape(a, fb.audio, {
    deviceId: str(a.deviceId, fb.audio.deviceId),
    masterVolume: num(a.masterVolume, fb.audio.masterVolume, 0, 1),
    speechVolume: num(a.speechVolume, fb.audio.speechVolume, 0, 1),
    soundVolume: num(a.soundVolume, fb.audio.soundVolume, 0, 1),
    voice: str(a.voice, fb.audio.voice),
    rate: num(a.rate, fb.audio.rate, 0.5, 2),
    muted: bool(a.muted, fb.audio.muted)
  })

  const archive = shape(ar, fb.archive, {
    autoEnabled: bool(ar.autoEnabled, fb.archive.autoEnabled),
    thresholdMB: num(ar.thresholdMB, fb.archive.thresholdMB, 1, 100_000),
    archiveDir: str(ar.archiveDir, fb.archive.archiveDir)
  })

  const cb = isObj(v.combat) ? v.combat : {}
  const combat = shape(cb, fb.combat, {
    fightGapSec: num(cb.fightGapSec, fb.combat.fightGapSec, 2, 600),
    historyMinutes: num(cb.historyMinutes, fb.combat.historyMinutes, 0, 1440),
    newSessionOnZone: bool(cb.newSessionOnZone, fb.combat.newSessionOnZone),
    combinePet: bool(cb.combinePet, fb.combat.combinePet),
    charmPets: bool(cb.charmPets, fb.combat.charmPets)
  })

  const gh = isObj(v.groupHealth) ? v.groupHealth : {}
  const groupHealth = shape(gh, fb.groupHealth, {
    enabled: bool(gh.enabled, fb.groupHealth.enabled),
    belowPct: Math.round(num(gh.belowPct, fb.groupHealth.belowPct, 5, 80)),
    speech: str(gh.speech, fb.groupHealth.speech).slice(0, 200)
  })

  let overlays = fb.overlays
  if (Array.isArray(v.overlays)) {
    const seen = new Set<string>()
    overlays = []
    for (const o of v.overlays) {
      const clean = overlay(
        o,
        fb.overlays.find((x) => isObj(o) && x.id === o.id)
      )
      if (!clean || seen.has(clean.id)) continue
      seen.add(clean.id)
      overlays.push(clean)
    }
  }

  let characters = fb.characters
  if (isObj(v.characters)) {
    characters = {}
    for (const [key, c] of Object.entries(v.characters)) {
      const clean = sanitizeCharacter(c, fb.characters[key] ?? { level: 50, classLevels: {}, focusSources: [] })
      if (clean) characters[key] = clean
    }
  }

  const fp = isObj(v.factionPlan) ? v.factionPlan : {}
  let choices = fb.factionPlan.choices
  if (isObj(fp.choices)) {
    choices = {}
    for (const [key, c] of Object.entries(fp.choices)) {
      const clean = isCharacterKey(key) ? planChoices(c) : null
      if (clean) choices[key] = clean
    }
  }
  const factionPlan = { assumptions: planAssumptions(fp.assumptions, fb.factionPlan.assumptions), choices }

  const su = isObj(v.setup) ? v.setup : {}
  const setup = shape(su, fb.setup, {
    hidden: bool(su.hidden, fb.setup.hidden),
    accepted: Array.isArray(su.accepted) ? [...new Set(stringsArg(su.accepted, 20, 40))] : fb.setup.accepted,
    arranged: bool(su.arranged, fb.setup.arranged)
  })

  return shape(v, fb, {
    installDir: str(v.installDir, fb.installDir),
    // The tailer reads whatever this names: only a character log.
    logFile: logFilePath(v.logFile, fb.logFile),
    logFolders: logFolders(v.logFolders, fb.logFolders),
    autoStart: bool(v.autoStart, fb.autoStart),
    autoRestartUpdates: bool(v.autoRestartUpdates, fb.autoRestartUpdates),
    characters,
    tracking,
    audio,
    archive,
    overlays,
    overlaysOnlyWithGame: bool(v.overlaysOnlyWithGame, fb.overlaysOnlyWithGame),
    yieldToGame: bool(v.yieldToGame, fb.yieldToGame),
    uiScale: num(v.uiScale, fb.uiScale, 0.75, 2),
    theme: oneOf(v.theme, ['system', 'light', 'dark'] as const, fb.theme),
    hotkeys: bool(v.hotkeys, fb.hotkeys),
    achievementCues: bool(v.achievementCues, fb.achievementCues),
    modules: modules(v.modules, fb.modules),
    combat,
    groupHealth,
    factionPlan,
    setup
  })
}
