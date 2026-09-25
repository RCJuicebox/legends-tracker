import {
  CLASS_NAMES,
  type AppSettings,
  type CharacterSettings,
  type FocusSource,
  type MeterOverlayOptions,
  type OverlayConfig,
  type Phrase,
  type Trigger,
  type TriggerAction
} from '../shared/types'
import { DEFAULT_METER_OPTIONS } from './storeCore'

// What the pages send the main process is checked here before it is stored. A page is our own code,
// but a bug in one should not be able to write a setting that breaks the app on its next start.
// Nothing is rejected for one bad field: the field falls back to what was there, and numbers are held
// to the range their control allows.

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Character keys as the game names its files: `Name_server`. Anything else could reach outside the app's folders. */
export function isCharacterKey(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_]+$/.test(v)
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

function focusSource(v: unknown): FocusSource | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  const fb: FocusSource = {
    id: v.id, name: '', kind: 'item', from: '', pct: 0, appliesTo: 'both', maxLevel: 0, decayPct: 0, minTicks: 0,
    requireSpas: [], excludeSpas: [], enabled: true
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
    for (const c of CLASS_NAMES) {
      const n = v.classLevels[c]
      if (typeof n === 'number' && Number.isFinite(n)) classLevels[c] = num(n, 1, 1, LEVEL_MAX)
    }
  }
  const out = shape(v, fb, {
    level: num(v.level, fb.level, 1, LEVEL_MAX),
    classLevels: isObj(v.classLevels) ? classLevels : fb.classLevels,
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

function overlay(v: unknown, fb: OverlayConfig | undefined): OverlayConfig | null {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null
  const base: OverlayConfig = fb ?? {
    id: v.id, name: v.id, kind: 'timers', x: 100, y: 100, width: 340, height: 420, opacity: 1, fontSize: 15, visible: true, groupByTarget: true
  }
  const kind = oneOf(v.kind, ['timers', 'alerts', 'meter'] as const, base.kind)
  const meter = kind === 'meter' ? (meterOptions(v.meter, base.meter) ?? { ...DEFAULT_METER_OPTIONS }) : undefined
  return shape(v, base, {
    id: v.id,
    name: str(v.name, base.name),
    kind,
    meter,
    x: num(v.x, base.x, -100_000, 100_000),
    y: num(v.y, base.y, -100_000, 100_000),
    width: num(v.width, base.width, 40, 20_000),
    height: num(v.height, base.height, 40, 20_000),
    opacity: num(v.opacity, base.opacity, 0.05, 1),
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
    combinePet: bool(cb.combinePet, fb.combat.combinePet)
  })

  let overlays = fb.overlays
  if (Array.isArray(v.overlays)) {
    const seen = new Set<string>()
    overlays = []
    for (const o of v.overlays) {
      const clean = overlay(o, fb.overlays.find((x) => isObj(o) && x.id === o.id))
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

  return shape(v, fb, {
    installDir: str(v.installDir, fb.installDir),
    logFile: str(v.logFile, fb.logFile),
    autoStart: bool(v.autoStart, fb.autoStart),
    characters,
    tracking,
    audio,
    archive,
    overlays,
    overlaysOnlyWithGame: bool(v.overlaysOnlyWithGame, fb.overlaysOnlyWithGame),
    yieldToGame: bool(v.yieldToGame, fb.yieldToGame),
    combat
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
        color: str(v.color, '#e8b44c'),
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
