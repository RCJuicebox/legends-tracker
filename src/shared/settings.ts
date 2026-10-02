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
  /** As /who prints it ("Iksar"); '' or absent when not set. Iksar changes the AC sums; every race, faction cons. */
  race?: string
  /** As Loadouts names it ("Agnostic", "Cazic Thule"); '' or absent when not set. /who does not show it: set on the Stats page, for faction cons. */
  deity?: string
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

interface ArchiveSettings {
  autoEnabled: boolean
  thresholdMB: number
  /** Empty means `<Logs>\archive`. */
  archiveDir: string
}

type OverlayKind = 'timers' | 'alerts' | 'meter' | 'achievements'

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

export interface AchievementOverlayOptions {
  /** Show the step of the faction plan you follow (Factions › Plan). */
  factionPlan: boolean
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
  /** Achievements overlays only. */
  achievements?: AchievementOverlayOptions
}

interface CombatSettings {
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
  /** Restart into a downloaded update as soon as it arrives, without asking; off, it installs when the app closes. */
  autoRestartUpdates: boolean
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
  /** Light or dark, or as Windows is set. Overlays stay dark over the game either way. */
  theme: 'system' | 'light' | 'dark'
  /** Ctrl+Shift+F9 mutes, F10 starts a new meter session, F11 arranges the overlays, from anywhere. */
  hotkeys: boolean
  /** Say when a step of the faction plan being followed is done, and flash each achievement it finishes. */
  achievementCues: boolean
  combat: CombatSettings
  factionPlan: FactionPlanSettings
  setup: SetupFlags
}

// ---------- the faction plan (Factions › Plan) ----------

export interface PlanSettings {
  /** Getting to a new zone, and set up there. */
  travelMin: number
  /** Kills an hour at a camp of common mobs the log has no pace for. */
  killsPerHour: number
  /** How often a named or single mob comes back. */
  namedRespawnMin: number
  /** A hand-in the log has not timed (Legends takes a whole stack at once). */
  handInSec: number
  /** Gathering one item a hand-in needs from common mobs, foraging or crafting. */
  gatherSec: number
  /** A hand-in when neither the log nor the wiki says what goes in it. */
  unknownSec: number
  /**
   * A point a faction ends below 2000 after being there, as a share of a point on an achievement still
   * to do: 0 is the quickest plan whatever it costs them (the achievements are kept), more keeps them
   * up where another way is not much slower. Where a faction ends is what counts, so a point a later
   * step gives back costs nothing.
   */
  keepMaxed: number
  /** What the plan aims for: the least time, or also as few factions left below zero as it can. */
  goal: PlanGoal
  /** For the 'positive' goal: what one faction ending at 0 or above is worth, in hours of play. */
  positiveHours: number
  /** Swapping race in Loadouts for a quest the character's own race's con keeps closed: planned or not. */
  raceSwaps: boolean
  /** Minutes a swap takes, there and back. */
  swapMin: number
  /** Race unlocks before the rest: each one done sooner counts as time saved. */
  unlocksFirst: boolean
}

/** 'fastest': every achievement in the least time. 'positive': every achievement, ending with as many factions at 0 or above as is worth the time. */
export type PlanGoal = 'fastest' | 'positive'

/** What the player chose: an activity locked to an achievement, activities ruled out, their own pace for some. */
export interface PlanChoices {
  /** Faction → activity id. */
  locks: Record<string, string>
  excluded: string[]
  /** Activity id → kills or hand-ins an hour. */
  perHour: Record<string, number>
}

interface FactionPlanSettings {
  /** Only what the player changed; the rest are the planner's defaults. */
  assumptions: Partial<PlanSettings>
  /** By character key. */
  choices: Record<string, PlanChoices>
}

/** The Live page's first-run checklist. */
export interface SetupFlags {
  /** Hidden by the player before every step was done. */
  hidden: boolean
  /** Steps the player said are fine as they are. */
  accepted: string[]
  /** The overlays were arranged once, from anywhere. */
  arranged: boolean
}
