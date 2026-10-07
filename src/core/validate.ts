import {
  CLASS_NAMES,
  type AppSettings,
  type CharacterSettings,
  type CharacterSheet,
  type MoteStock,
  type SpellRule,
  type FocusSource,
  type AchievementOverlayOptions,
  type MeterOverlayOptions,
  type OverlayConfig,
  type Phrase,
  type PlanChoices,
  type PlanSettings,
  type Trigger,
  type TriggerAction
} from '../shared/types'
import { DEFAULT_ACHIEVEMENT_OPTIONS, DEFAULT_METER_OPTIONS, minOpacity, TRIGGER_TIMER_COLOR } from '../shared/overlays'
import type { RespawnRecords, RespawnTimerSpec, SpawnLink } from './respawns'
import { MOTE_RANKS, type MoteSession, type MoteState } from './motes'
import type { ActiveBuff, BuffsFile, Person } from './buffs'
import type { TradeFavorite, TradeSaved } from '../shared/ipc'

// What the pages send the main process is checked here before it is stored. A page is our own code,
// but a bug in one should not be able to write a setting that breaks the app on its next start.
// Nothing is rejected for one bad field: the field falls back to what was there, and numbers are held
// to the range their control allows.

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A character key as the game names its files, `Name_server`. Whatever a file name may hold is
 * allowed (accented names, hyphens); only what could reach outside the app's folders is not: path
 * separators, drive colons, wildcards, dot-only names. listLogs goes by the same rule.
 */
export function isCharacterKey(v: unknown): v is string {
  if (typeof v !== 'string' || !v.length || v.length > 64 || /[\\/:*?"<>|]/.test(v) || /^\.+$/.test(v)) return false
  // Nor a name Windows keeps for a device ("CON.json" is the console), nor one that is an object's own.
  if (DEVICE_NAME.test(v) || !isRecordKey(v)) return false
  // No control characters either: a file name cannot hold them.
  return ![...v].some((c) => c.charCodeAt(0) < 32)
}

/** Throws unless `v` is a character key (isCharacterKey): for a handler that is asked about a character. */
export function assertCharacterKey(v: unknown): asserts v is string {
  if (!isCharacterKey(v)) throw new Error('Not a character.')
}

/** CON, PRN, AUX, NUL, COM1-9 and LPT1-9, with or without an extension, in any case. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i

/** A string that is safe as a key of a plain object: not `__proto__`, `constructor` or `prototype`. */
export function isRecordKey(v: unknown, max = 120): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && v !== '__proto__' && v !== 'constructor' && v !== 'prototype'
}

/** Text a page sends, cut to `max`; '' for anything that is not a string. */
export function textArg(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** A whole number a page sends, held between `lo` and `hi`; `fb` for anything that is not a finite number. */
export function intArg(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fb
}

/** A list of short strings a page sends (class names, item names), at most `max` of them. */
export function stringsArg(v: unknown, max: number, len = 120): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= len).slice(0, max) : []
}

/** A full Windows path: a drive ("E:\…") or a share ("\\server\…"). Not "E:folder", which depends on the drive's current folder. */
export function isFullPath(v: unknown): v is string {
  return typeof v === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/.test(v)
}

/** `...\Logs\eqlog_Kelwyn_neriak.txt` → `Kelwyn_neriak` */
export function characterKey(logFile: string): string {
  const m = /eqlog_(.+)\.txt$/i.exec(logFile)
  return m ? m[1] : ''
}

/** A character log as the game writes it, by its full path; '' is none chosen. Anything else keeps what was set. */
function logFilePath(v: unknown, fb: string): string {
  if (v === '') return ''
  if (!isFullPath(v)) return fb
  const m = /[\\/]eqlog_([^\\/]+)\.txt$/i.exec(v)
  return m && isCharacterKey(m[1]) ? v : fb
}

function str(v: unknown, fb: string): string {
  return typeof v === 'string' ? v : fb
}

function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb
}

function num(v: unknown, fb: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fb
  return Math.max(min, Math.min(max, n))
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return allowed.includes(v as T) ? (v as T) : fb
}

function numbers(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)) : []
}

/** Same kind of value as the fallback: for fields this file does not know by name. */
function sameKind(v: unknown, fb: unknown): boolean {
  if (fb === undefined || v === undefined) return false
  if (Array.isArray(fb)) return Array.isArray(v)
  if (fb === null) return v === null
  return typeof v === typeof fb && Array.isArray(v) === Array.isArray(fb)
}

/**
 * Builds an object from `known` (checked fields) plus any other field of `v` that the fallback also
 * has, with the same kind of value. Fields neither side knows are dropped.
 */
function shape<T>(v: Obj, fb: T, known: Partial<Record<keyof T, unknown>>): T {
  const out: Obj = { ...(fb as Obj) }
  for (const [k, x] of Object.entries(v)) if (!(k in known) && sameKind(x, (fb as Obj)[k])) out[k] = x
  for (const [k, x] of Object.entries(known)) if (x !== undefined) out[k] = x
  return out as T
}

const LEVEL_MAX = 255

/** The faction plan's numbers, held to what their inputs on the Plan tab allow. */
const PLAN_RANGES: Partial<Record<keyof PlanSettings, [number, number]>> = {
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
function planAssumptions(v: unknown, fb: Partial<PlanSettings>): Partial<PlanSettings> {
  if (!isObj(v)) return fb
  const out: Record<string, unknown> = {}
  const was = fb as Record<string, unknown>
  for (const [k, [lo, hi]] of Object.entries(PLAN_RANGES)) {
    const x = v[k]
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = Math.max(lo, Math.min(hi, x))
    else if (k in v && typeof was[k] === 'number') out[k] = was[k]
  }
  if (v.goal === 'fastest' || v.goal === 'positive') out.goal = v.goal
  else if ('goal' in v && fb.goal) out.goal = fb.goal
  for (const k of ['raceSwaps', 'unlocksFirst'] as const) {
    if (typeof v[k] === 'boolean') out[k] = v[k]
    else if (k in v && fb[k] !== undefined) out[k] = fb[k]
  }
  return out as Partial<PlanSettings>
}

/** Locks, rule-outs or paces a page may keep for one character: about the size of every faction's ways. */
const PLAN_CHOICES_MAX = 5000
const ACTIVITY_ID_MAX = 300

/** A character's locks, rule-outs and paces on the Plan tab; null when there are none. */
function planChoices(v: unknown): PlanChoices | null {
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

function focusSource(v: unknown): FocusSource | null {
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

function achievementOptions(v: unknown, fb: AchievementOverlayOptions | undefined): AchievementOverlayOptions {
  const base = fb ?? DEFAULT_ACHIEVEMENT_OPTIONS
  return isObj(v) ? { factionPlan: bool(v.factionPlan, base.factionPlan) } : { ...base }
}

function overlay(v: unknown, fb: OverlayConfig | undefined): OverlayConfig | null {
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
    combat,
    groupHealth,
    factionPlan,
    setup
  })
}

function phrases(v: unknown): Phrase[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((p): Phrase[] => {
    if (typeof p === 'string') return [{ text: p, regex: false }]
    if (!isObj(p) || typeof p.text !== 'string') return []
    return [{ text: p.text, regex: bool(p.regex, false) }]
  })
}

const DAY = 86_400

function action(v: unknown): TriggerAction | null {
  if (!isObj(v)) return null
  switch (v.type) {
    case 'speak':
      return { type: 'speak', text: str(v.text, ''), interrupt: bool(v.interrupt, false) }
    case 'sound':
      return { type: 'sound', file: str(v.file, ''), volume: num(v.volume, 1, 0, 1) }
    case 'text':
      return { type: 'text', text: str(v.text, ''), color: str(v.color, '#ffd84d'), durationSec: num(v.durationSec, 5, 0, 3600) }
    case 'timer':
      return {
        type: 'timer',
        name: str(v.name, ''),
        durationSec: num(v.durationSec, 30, 0, 7 * DAY),
        color: str(v.color, TRIGGER_TIMER_COLOR),
        overlay: str(v.overlay, 'targets'),
        warnSec: num(v.warnSec, 0, 0, 7 * DAY),
        warnSpeech: str(v.warnSpeech, ''),
        endSpeech: str(v.endSpeech, ''),
        restart: oneOf(v.restart, ['restart', 'ignore'] as const, 'restart'),
        endEarly: phrases(v.endEarly)
      }
    default:
      return null
  }
}

let idSeq = 0

/**
 * A list of triggers from a page or an imported file. Entries that are not objects are dropped;
 * missing fields get the new-trigger defaults; unknown action types are dropped. Null when it is
 * not a list at all.
 */
export function sanitizeTriggers(v: unknown): Trigger[] | null {
  if (!Array.isArray(v)) return null
  return v.flatMap((t): Trigger[] => {
    if (!isObj(t)) return []
    return [
      {
        id: typeof t.id === 'string' && t.id ? t.id : `t${Date.now().toString(36)}${(idSeq++).toString(36)}`,
        name: str(t.name, 'Trigger'),
        folder: str(t.folder, ''),
        enabled: bool(t.enabled, true),
        comment: str(t.comment, ''),
        phrases: phrases(t.phrases),
        cooldownSec: num(t.cooldownSec, 0, 0, DAY),
        actions: Array.isArray(t.actions) ? t.actions.map(action).filter((x) => x !== null) : []
      }
    ]
  })
}

/** One trigger, as the trigger tester takes it. */
export function sanitizeTrigger(v: unknown): Trigger | null {
  return sanitizeTriggers([v])?.[0] ?? null
}

/** respawns.json as read back: records with a name and a zone, every field in range. */
export function sanitizeRespawns(v: unknown): RespawnRecords {
  const out: RespawnRecords = {}
  if (!isObj(v)) return out
  for (const [key, r] of Object.entries(v)) {
    if (!isObj(r) || typeof r.name !== 'string' || !r.name || typeof r.zone !== 'string') continue
    out[key] = {
      zone: r.zone,
      name: r.name,
      kills: num(r.kills, 0, 0, 1e9),
      lastDeath: num(r.lastDeath, 0, 0, 1e15),
      pendingSince: num(r.pendingSince, 0, 0, 1e15),
      gaps: numbers(r.gaps).filter((g) => g >= 0),
      shared: bool(r.shared, false)
    }
    const names = stringsArg(r.names, MAX_SPAWN_NAMES)
    if (names.length) out[key].names = names
  }
  return out
}

/** The most mobs one spawn point can pop, as far as a link goes. */
const MAX_SPAWN_NAMES = 12

/** A spawn point as the Respawns page links it: a zone, its own name and at least two mobs; null otherwise. */
export function sanitizeSpawnLink(v: unknown): SpawnLink | null {
  if (!isObj(v) || typeof v.zone !== 'string' || !v.zone.trim() || typeof v.name !== 'string' || !v.name.trim()) return null
  const names = [
    ...new Map(
      stringsArg(v.names, MAX_SPAWN_NAMES, 100)
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => [n.toLowerCase(), n])
    ).values()
  ]
  if (names.length < 2) return null
  return { zone: v.zone.trim(), name: v.name.trim().slice(0, 100), names }
}

/** A respawn timer as the Respawns page asks for it; null without a name or a length. */
export function sanitizeRespawnTimer(v: unknown): RespawnTimerSpec | null {
  if (!isObj(v) || typeof v.name !== 'string' || !v.name.trim() || typeof v.seconds !== 'number') return null
  return {
    name: v.name.trim().slice(0, 100),
    seconds: Math.round(num(v.seconds, 0, 1, DAY)),
    overlay: str(v.overlay, 'respawns'),
    warnSec: Math.round(num(v.warnSec, 0, 0, 3600)),
    announce: bool(v.announce, true)
  }
}

/** buffs.json as read back: people with a name and classes, wanted lists of names, active buffs with times. */
export function sanitizeBuffs(v: unknown): BuffsFile {
  const out: BuffsFile = { people: {}, wanted: {}, active: {} }
  if (!isObj(v)) return out
  if (isObj(v.people)) {
    for (const [k, p] of Object.entries(v.people)) {
      if (!isObj(p) || typeof p.name !== 'string' || !Array.isArray(p.classes)) continue
      const person: Person = {
        name: p.name,
        classes: p.classes.filter((c): c is string => typeof c === 'string'),
        level: num(p.level, 1, 1, 100),
        race: str(p.race, ''),
        at: num(p.at, 0, 0, 1e15)
      }
      out.people[k.toLowerCase()] = person
    }
  }
  if (isObj(v.wanted)) {
    for (const [k, list] of Object.entries(v.wanted)) {
      if (isCharacterKey(k) && Array.isArray(list)) out.wanted[k] = list.filter((x): x is string => typeof x === 'string')
    }
  }
  if (isObj(v.active)) {
    for (const [k, list] of Object.entries(v.active)) {
      if (!isCharacterKey(k) || !Array.isArray(list)) continue
      out.active[k] = list.flatMap((b): ActiveBuff[] =>
        isObj(b) && typeof b.spell === 'string' && typeof b.line === 'string'
          ? [
              {
                spell: b.spell,
                ranked: str(b.ranked, b.spell),
                line: b.line as ActiveBuff['line'],
                caster: str(b.caster, ''),
                landedAt: num(b.landedAt, 0, 0, 1e15),
                endsAt: b.endsAt === null ? null : num(b.endsAt, 0, 0, 1e15)
              }
            ]
          : []
      )
    }
  }
  return out
}

/** A spell's own settings from the Spell Timers page: known fields only, each of its own kind; null when not an object. */
export function sanitizeSpellRule(v: unknown): SpellRule | null {
  if (!isObj(v)) return null
  const out: SpellRule = {}
  for (const k of ['track', 'recastCue', 'fadeCue'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean
  for (const k of ['alias', 'warnSpeech', 'fadeSpeech', 'color', 'overlay'] as const) if (typeof v[k] === 'string') out[k] = (v[k] as string).slice(0, 500)
  if (typeof v.warnSec === 'number' && Number.isFinite(v.warnSec)) out.warnSec = num(v.warnSec, 0, 0, 3600)
  if (typeof v.durationOverrideSec === 'number' && Number.isFinite(v.durationOverrideSec)) out.durationOverrideSec = num(v.durationOverrideSec, 0, 0, 7 * DAY)
  if (typeof v.extraFocusPct === 'number' && Number.isFinite(v.extraFocusPct)) out.extraFocusPct = num(v.extraFocusPct, 0, -100, 1000)
  return out
}

/** Motes on hand as the planner sends them: known ranks only, whole numbers from 0. */
export function sanitizeStockCounts(v: unknown): MoteStock['counts'] {
  const out: MoteStock['counts'] = {}
  if (!isObj(v)) return out
  for (const { key } of MOTE_RANKS) if (typeof v[key] === 'number' && Number.isFinite(v[key])) out[key] = Math.round(num(v[key], 0, 0, 1e9))
  return out
}

/** The item being planned; null when it is not an object. */
export function sanitizeStockItem(v: unknown): MoteStock['item'] | null {
  if (!isObj(v)) return null
  return { name: str(v.name, '').slice(0, 200), lvl: Math.round(num(v.lvl, 0, 0, 100)), xp: num(v.xp, 0, 0, 1e9), to: Math.round(num(v.to, 1, 0, 100)) }
}

/** mote-stock.json as read back: the planner's counts and item, with the loot-line mark it counts from. */
export function sanitizeMoteStock(v: unknown): MoteStock {
  const o = isObj(v) ? v : {}
  const out: MoteStock = {
    counts: sanitizeStockCounts(o.counts),
    item: sanitizeStockItem(o.item) ?? { name: '', lvl: 0, xp: 0, to: 1 },
    autoAdd: bool(o.autoAdd, true)
  }
  if (typeof o.seenUntil === 'number' && Number.isFinite(o.seenUntil)) out.seenUntil = o.seenUntil
  if (typeof o.seenAtSecond === 'number' && Number.isFinite(o.seenAtSecond)) out.seenAtSecond = Math.max(0, Math.round(o.seenAtSecond))
  return out
}

const SESSION_KINDS = ['instance', 'crawl', 'manual'] as const
const SESSION_OUTCOMES = ['active', 'completed', 'abandoned', 'stopped', 'game closed'] as const
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function moteSession(v: unknown): MoteSession | null {
  if (!isObj(v) || typeof v.id !== 'string' || time(v.startedAt) === null) return null
  const s: MoteSession = {
    id: v.id,
    kind: oneOf(v.kind, SESSION_KINDS, 'instance'),
    name: str(v.name, ''),
    startedAt: v.startedAt as number,
    endedAt: time(v.endedAt),
    outcome: oneOf(v.outcome, SESSION_OUTCOMES, 'stopped'),
    motes: sanitizeStockCounts(v.motes),
    outsideSince: time(v.outsideSince),
    outsideMs: num(v.outsideMs, 0, 0, 1e12)
  }
  if (v.byHand === true) s.byHand = true
  if ('pausedSince' in v) s.pausedSince = time(v.pausedSince)
  if ('pausedMs' in v) s.pausedMs = num(v.pausedMs, 0, 0, 1e12)
  return s
}

/**
 * motes.json as read back. Null when its outline is wrong (no session list, no daily counts): the
 * history is then rebuilt from the logs, which hold all of it. Otherwise broken runs and days are
 * dropped and the rest kept.
 */
export function sanitizeMotes(v: unknown): MoteState | null {
  if (!isObj(v) || !Array.isArray(v.sessions) || !isObj(v.daily)) return null
  const daily: MoteState['daily'] = {}
  for (const [day, counts] of Object.entries(v.daily)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && isObj(counts)) daily[day] = sanitizeStockCounts(counts)
  const out: MoteState = {
    active: v.active === null ? null : moteSession(v.active),
    sessions: v.sessions.map(moteSession).filter((s): s is MoteSession => !!s),
    daily
  }
  const seen = time(v.seenUntil)
  if (seen !== null) out.seenUntil = seen
  if (isObj(v.marks)) {
    const marks: NonNullable<MoteState['marks']> = {}
    for (const [k, kind] of Object.entries(v.marks)) if (kind === 'crawl' || kind === 'instance') marks[k] = kind
    out.marks = marks
  }
  return out
}

/** casts.json as read back: each spell's ranked name, last cast and count. Entries of another shape are dropped. */
export function sanitizeCasts(v: unknown): Record<string, { rankedName: string; lastCast: number; count: number }> {
  const out: Record<string, { rankedName: string; lastCast: number; count: number }> = {}
  if (!isObj(v)) return out
  for (const [name, c] of Object.entries(v)) {
    if (!isObj(c) || typeof c.rankedName !== 'string') continue
    out[name] = { rankedName: c.rankedName, lastCast: num(c.lastCast, 0, 0, 1e15), count: Math.round(num(c.count, 0, 0, 1e9)) }
  }
  return out
}

/** The largest Stats page input the sheet keeps, as JSON: far above any real one. */
const SHEET_STATS_MAX = 200_000

/** A character sheet from the Stats and Gear pages; null when it is not one. */
export function sanitizeSheet(v: unknown): CharacterSheet | null {
  if (!isObj(v)) return null
  const acOverrides: Record<string, number> = {}
  if (isObj(v.acOverrides)) {
    for (const [k, n] of Object.entries(v.acOverrides)) if (typeof n === 'number' && Number.isFinite(n)) acOverrides[k.slice(0, 200)] = num(n, 0, -10_000, 10_000)
  }
  const stats = isObj(v.stats) ? v.stats : {}
  if (JSON.stringify(stats).length > SHEET_STATS_MAX) return null
  return { acOverrides, shield: typeof v.shield === 'boolean' ? v.shield : null, stats }
}

/** tradeskills.json, the Tradeskills page's favourites: only what the page is allowed to store, strings where strings go, sane numbers. */
export function sanitizeTradeSaved(v: unknown): TradeSaved | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as { favorites?: unknown; prices?: unknown }
  const favorites = (Array.isArray(o.favorites) ? o.favorites : []).flatMap((f): TradeFavorite[] => {
    if (!f || typeof f !== 'object') return []
    const x = f as Record<string, unknown>
    if (typeof x.key !== 'string' || typeof x.product !== 'string' || !x.key) return []
    const combines = typeof x.combines === 'number' && Number.isFinite(x.combines) ? Math.max(1, Math.min(100_000, Math.round(x.combines))) : 1
    return [{ key: x.key.slice(0, 2000), product: x.product.slice(0, 200), combines }]
  })
  const prices: Record<string, number> = {}
  if (o.prices && typeof o.prices === 'object' && !Array.isArray(o.prices)) {
    for (const [k, n] of Object.entries(o.prices as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) prices[k.toLowerCase().slice(0, 200)] = Math.round(n)
    }
  }
  return { favorites, prices }
}
