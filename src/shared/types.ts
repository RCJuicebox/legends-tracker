// Types shared by the main process, the preload bridge and every renderer window.

export const CLASS_NAMES = [
  'Warrior', 'Cleric', 'Paladin', 'Ranger', 'Shadow Knight', 'Druid', 'Monk', 'Bard',
  'Rogue', 'Shaman', 'Necromancer', 'Wizard', 'Magician', 'Enchanter', 'Beastlord', 'Berserker'
] as const
export type ClassName = (typeof CLASS_NAMES)[number]

/**
 * Spell categories, matching the rows of the EQL per-tier bonus table. The category decides which
 * per-tier duration bonus a ranked spell gets.
 */
export type SpellCategory = 'nuke' | 'dot' | 'heal' | 'hot' | 'debuff' | 'charm' | 'mez' | 'buff'

export const CATEGORY_LABELS: Record<SpellCategory, string> = {
  nuke: 'Nuke / Lifetap',
  dot: 'DoT',
  heal: 'Heal',
  hot: 'Heal over Time',
  debuff: 'Debuff',
  charm: 'Charm',
  mez: 'Mez',
  buff: 'Buff'
}

/**
 * Duration bonus per tier, in percent, from the EQL spell upgrade (mote) guide. Heal over time is the
 * exception: the guide marks its 5% uncertain, and Slugs Healing V fits only 6–8% (Spell window 0:48
 * with the ring off, 9 ticks in the log with it on), so it is set to 7%.
 */
export const DEFAULT_TIER_DURATION_PCT: Record<SpellCategory, number> = {
  nuke: 0, dot: 5, heal: 0, hot: 7, debuff: 10, charm: 10, mez: 10, buff: 10
}

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
  /** EQL levels each class separately. A spell uses the level of a class that can cast it. */
  classLevels: Partial<Record<ClassName, number>>
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

export type OverlayKind = 'timers' | 'alerts'

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
}

// ---- Mote stock (the upgrade planner's inventory) ----

/** A character's achievements export as read from the game folder, with the player's own marks. */
export interface AchievementsView {
  /** Name_server, as the game names its files. */
  character: string
  file: string
  /** When the game last wrote the export; 0 when there is none. */
  modified: number
  sections: import('../core/achievements').AchSection[]
  marks: import('../core/achievements').AchMarks
  /** 'missing' when there is no export yet; otherwise a read error, or ''. */
  error: string
}

/** An item's eqlwiki page, as far as the tracker uses it. */
export interface ItemInfo {
  /** The page title. */
  title: string
  /** False when the wiki has no page for it. */
  found: boolean
  /** The in-game stats block from the page, base (unmerged) values. */
  statsblock: string
  /** The item's icon number (the page's lucy_img_ID), 500 and up; 0 when unknown. */
  icon?: number
}

/** A character's inventory export, with what the wiki says about the items worn. */
export interface InventoryView {
  character: string
  file: string
  modified: number
  inventory: import('../core/inventory').Inventory | null
  /** By itemKey(). */
  items: Record<string, ItemInfo>
  /** 'missing' when there is no export yet; otherwise a read error, or ''. */
  error: string
}

/** What the player has told the tracker about a character that no file records. */
export interface CharacterSheet {
  /** AC typed in for an item, by itemKey(); wins over the wiki. */
  acOverrides: Record<string, number>
  /** Whether the secondary item counts as a shield; null = go by its name. */
  shield: boolean | null
  /** The Stats page's inputs. */
  stats: Record<string, unknown>
}

/** What a game folder holds that the tracker can use. Character names are as the files spell them, e.g. Name_server. */
export interface GameFolderCheck {
  dir: string
  exists: boolean
  /** spells_us.txt: needed for spell timers. */
  spells: boolean
  logs: string[]
  inventory: string[]
  achievements: string[]
}

export interface MoteStock {
  /** Motes on hand, by rank key ("major": 60). */
  counts: Partial<Record<string, number>>
  /** The item being planned. */
  item: { name: string; lvl: number; xp: number; to: number }
  /** Add motes to the stock as they are looted. */
  autoAdd: boolean
  /** The time of the last loot line counted into the stock, so a mote is never added twice … */
  seenUntil?: number
  /** … and how many loot lines in that second were counted (a reward chest logs several at once). */
  seenAtSecond?: number
}

// ---- Triggers ----

export interface Phrase {
  text: string
  regex: boolean
}

export type TriggerAction =
  | { type: 'speak'; text: string; interrupt: boolean }
  | { type: 'sound'; file: string; volume: number }
  | { type: 'text'; text: string; color: string; durationSec: number }
  | {
      type: 'timer'
      name: string
      durationSec: number
      color: string
      overlay: string
      warnSec: number
      warnSpeech: string
      endSpeech: string
      restart: 'restart' | 'ignore'
      endEarly: Phrase[]
    }

export interface Trigger {
  id: string
  name: string
  folder: string
  enabled: boolean
  comment: string
  phrases: Phrase[]
  cooldownSec: number
  actions: TriggerAction[]
}

// ---- Runtime state pushed to windows ----

export type TimerSource = 'spell' | 'trigger'

export interface TimerView {
  id: string
  label: string
  target: string
  source: TimerSource
  category?: SpellCategory
  icon?: number
  color: string
  overlay: string
  startedAt: number
  endsAt: number
  /** False while the end is an estimate (a buff before it fades, a DoT before its first tick). */
  exact: boolean
  warnSec: number
  rank?: number
}

export type Notification =
  | { kind: 'speak'; text: string; interrupt: boolean }
  | { kind: 'sound'; file: string; volume: number }
  | { kind: 'text'; text: string; color: string; durationSec: number }

export interface FeedItem {
  at: number
  kind: 'timer' | 'fade' | 'trigger' | 'archive' | 'loot' | 'info' | 'warn'
  text: string
}

export interface WatchStatus {
  watching: boolean
  logFile: string
  character: string
  zone: string
  spellsLoaded: number
  spellError: string
  lastLineAt: number
  logSize: number
}

export interface LogFileInfo {
  path: string
  name: string
  character: string
  size: number
  modified: number
}

export interface ArchiveInfo {
  path: string
  name: string
  size: number
  modified: number
  loose: boolean
}

export interface ArchiveStatus {
  busy: boolean
  message: string
  pendingUntilGameExits: string[]
  gameRunning: boolean
  liveRotation: 'unknown' | 'supported' | 'unsupported'
}

export interface SpellSummary {
  id: number
  name: string
  category: SpellCategory
  beneficial: boolean
  icon: number
  castMs: number
  formula: number
  cap: number
  classes: string
  landSelf: string
  landOther: string
  fade: string
}

export interface DurationBreakdown {
  ticks: number
  permanent: boolean
  /** How long a timer runs: the earliest the effect can wear off. */
  seconds: number
  earliestSec: number
  latestSec: number
  /** What the in-game Spell window shows in brackets: whole ticks, before the partial tick. */
  spellWindowSec: number
  /** What the Spell window shows before the brackets: the unranked, unfocused duration. */
  baseSec: number
  steps: string[]
}

export interface KnownSpell extends SpellSummary {
  rank: number
  rankedName: string
  lastCast: number
  duration: DurationBreakdown
  rule: SpellRule
}

export interface LogCheckRow {
  rankedName: string
  category: SpellCategory
  samples: number
  observedMedianSec: number
  calculatedEarliestSec: number
  calculatedLatestSec: number
  fits: boolean
  /** Focus percent that would make the calculation fit, when it does not. */
  impliedFocusPct: number | null
  /** The whole range of focus percentages that would fit. */
  impliedFocusRange: [number, number] | null
}

export interface TriggerTestResult {
  matched: boolean
  phraseIndex: number
  captures: Record<string, string>
  outputs: string[]
  error: string
}
