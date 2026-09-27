// The settings file's shape: what settings.json holds, and a character's spell settings.

import type { ClassName } from './game/classes'
import type { SpellCategory } from './game/guide'

/**
 * One spell duration focus: an item's focus effect (read from its focus spell in spells_us.txt) or
 * an AA such as Spell Casting Reinforcement.
 */
export interface FocusSource {
  id: string
  name: string
  /** Items: only the best item focus of a kind applies. AAs add on top. */
  kind: 'item' | 'aa'
  /** Where it comes from, for display: "Engineer's Ring", "AA". */
  from: string
  /** The focus spell's id, when it came from the spell book. */
  spellId?: number
  pct: number
  appliesTo: 'beneficial' | 'detrimental' | 'both'
  /** Spells above this level get less of it. 0 = no limit. */
  maxLevel: number
  /** Percent of the focus lost per spell level over the limit. */
  decayPct: number
  /** Only spells lasting at least this many ticks. */
  minTicks: number
  /** Only spells with every one of these effects (SPA). */
  requireSpas: number[]
  /** Never spells with any of these effects (SPA). */
  excludeSpas: number[]
  enabled: boolean
}

export interface CharacterSettings {
  /** Level used by the duration formulas when no class-specific level applies. */
  level: number
  /**
   * EQL levels each class separately. A spell uses the level of a class that can cast it. In the
   * player's own order: the first is the class they think of as their main one.
   */
  classLevels: Partial<Record<ClassName, number>>
  /** As /who prints it ("Iksar"); '' or absent when not set. Iksar changes the AC sums. */
  race?: string
  focusSources: FocusSource[]
  /** Replaced by focusSources; read once to carry an old single figure over. */
  beneficialFocusPct?: number
  detrimentalFocusPct?: number
}

export const DEFAULT_CHARACTER: CharacterSettings = {
  level: 50,
  classLevels: {},
  focusSources: []
}

/** Per-spell settings, keyed by the spell's base (unranked) name. Every field is optional. */
export interface SpellRule {
  track?: boolean
  /** The "Recast …" warning before it ends, spoken and flashed. Off for a spell on a long cooldown. */
  recastCue?: boolean
  /** The spoken announcement when it wears off. */
  fadeCue?: boolean
  alias?: string
  warnSec?: number
  warnSpeech?: string
  fadeSpeech?: string
  color?: string
  overlay?: string
  /** A fixed duration, for the rare spell whose formula the calculation cannot model. */
  durationOverrideSec?: number
  /** Extra focus in percent for this spell only, on top of the character's focus sources. */
  extraFocusPct?: number
}

export interface TrackingSettings {
  enabled: boolean
  selfBuffs: boolean
  otherBuffs: boolean
  /** Group buffs on the overlays: timers for buffs others cast on me, and the on-screen "ask X for Y" reminder. */
  groupBuffs: boolean
  dots: boolean
  debuffs: boolean
  /** Seconds before a self buff ends to warn, unless the spell's rule says otherwise. 0 = off. */
  buffWarnSec: number
  dotWarnSec: number
  buffWarnSpeech: string
  buffFadeSpeech: string
  dotWarnSpeech: string
  dotFadeSpeech: string
  announceOtherBuffFades: boolean
  tierDurationPct: Record<SpellCategory, number>
}

export interface AudioSettings {
  deviceId: string
  masterVolume: number
  speechVolume: number
  soundVolume: number
  voice: string
  rate: number
  muted: boolean
}

export interface ArchiveSettings {
  autoEnabled: boolean
  thresholdMB: number
  /** Empty means `<Logs>\archive`. */
  archiveDir: string
}

export type OverlayKind = 'timers' | 'alerts' | 'meter'

/** What a damage meter (page or overlay) lists. */
export type MeterMode = 'damage' | 'incoming' | 'healing'
/** Which segment a meter shows: the current fight, or everything since the session began. */
export type MeterSpan = 'fight' | 'session'
/** Whose rows a meter lists. */
export type MeterScope = 'everyone' | 'group' | 'you'

export interface MeterOverlayOptions {
  mode: MeterMode
  span: MeterSpan
  scope: MeterScope
  /** Bars shown at most; the rest are summed into "+N more". */
  rows: number
  /** Fold each pet's damage into its owner's row. */
  combinePet: boolean
  /** Show the header line (fight name, duration, total). */
  header: boolean
}

export interface OverlayConfig {
  id: string
  name: string
  kind: OverlayKind
  x: number
  y: number
  width: number
  height: number
  opacity: number
  fontSize: number
  visible: boolean
  /** Timer overlays only: group bars under a heading per target. */
  groupByTarget: boolean
  /** Meter overlays only. */
  meter?: MeterOverlayOptions
}

export interface CombatSettings {
  /** Seconds without a hit before a fight is over. */
  fightGapSec: number
  /** How far back in the log to read fights from when watching starts. 0 = none. */
  historyMinutes: number
  /** Entering a zone closes the session and starts a new one named after the zone. */
  newSessionOnZone: boolean
  /** Fold each pet's damage into its owner's row on the Live page. */
  combinePet: boolean
  /**
   * Book a charmed mob's blows to its charmer as a pet. The log names a charm pet as the mob, so
   * the guess can go wrong; off, charmed mobs are left out as before.
   */
  charmPets: boolean
}

export interface AppSettings {
  installDir: string
  logFile: string
  autoStart: boolean
  characters: Record<string, CharacterSettings>
  tracking: TrackingSettings
  audio: AudioSettings
  archive: ArchiveSettings
  overlays: OverlayConfig[]
  /** Hide the overlays unless the game (or this app) has focus. */
  overlaysOnlyWithGame: boolean
  /** Run this app's processes at below-normal priority, so the game wins every tie for the CPU. */
  yieldToGame: boolean
  /** The main window's zoom: 1 is 100%. */
  uiScale: number
  /** Ctrl+Shift+F9 mutes, F10 starts a new meter session, F11 arranges the overlays, from anywhere. */
  hotkeys: boolean
  combat: CombatSettings
}
