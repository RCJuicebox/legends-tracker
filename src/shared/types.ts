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

/** One of Microsoft's neural voices, as Azure lists it. */
export interface AzureVoice {
  /** The voice's short name, as SSML takes it: "en-US-JennyNeural". */
  name: string
  label: string
  locale: string
  gender: string
}

/** The Azure voices' state, as the Audio page is told it: never the key. */
export interface AzureStatus {
  configured: boolean
  region: string
  voices: AzureVoice[]
  /** Why the key or the last phrase failed; '' when all is well. */
  error: string
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
  combat: CombatSettings
}

// ---- Damage meter ----

/**
 * Who an entity is to the player. `unknown` is a single capitalised word the log has not yet placed
 * on a side: a stranger or a named mob, told apart by whom it hits.
 */
export type EntityKind = 'you' | 'pet' | 'group' | 'player' | 'npc' | 'npcpet' | 'unknown'

export interface Tally {
  total: number
  hits: number
  crits: number
  critTotal: number
  max: number
  /** 0 until the first hit. */
  min: number
}

export type DamageHow = 'melee' | 'spell' | 'dot' | 'ds'

export interface SkillStat extends Tally {
  name: string
  how: DamageHow
  /** Swings that did not land, for melee. */
  misses: number
  /** Casts the target resisted, for spells. */
  resists: number
  /** Hits by their modifier: critical, riposte, flurry, rampage, finishing blow. */
  mods: Record<string, number>
}

export interface HealTally {
  /** Hit points actually restored. */
  total: number
  /** What the heals were for, before overhealing was cut off; the same as total when the log gave no figure. */
  raw: number
  count: number
  crits: number
  max: number
}

/** Swings aimed at an entity and what became of them. */
export interface Defense {
  swings: number
  hit: number
  miss: number
  dodge: number
  parry: number
  block: number
  riposte: number
  absorb: number
}

/**
 * Where a proc row came from. `spell`: a spell effect that landed with no cast line behind it, so
 * something fired it (a weapon, a buff). `ability`: the same, for an ability the game lists as one
 * you press. `aa`: a swing the game annotated "(Finishing Blow)".
 */
export type ProcOrigin = 'spell' | 'ability' | 'aa'

export interface ProcStat {
  name: string
  origin: ProcOrigin
  count: number
  /** Damage the firings did; for Finishing Blow, the damage of the swings that procced. */
  damage: number
  /** Hit points the firings healed: a lifetap proc prints a damage line and a heal line for one firing. */
  healed: number
}

export interface Entity {
  name: string
  kind: EntityKind
  /** The owner's name, for a pet. */
  owner?: string
  out: Tally
  in: Tally
  /** Damage dealt, by skill or spell. */
  skills: Record<string, SkillStat>
  /** Damage dealt, by target. */
  targets: Record<string, Tally>
  /** Damage taken, by attacker. */
  attackers: Record<string, Tally>
  /** Damage taken, by skill or spell. */
  takenBy: Record<string, SkillStat>
  /** Effects that fired without being cast, by name. */
  procs: Record<string, ProcStat>
  defense: Defense
  healOut: HealTally
  healIn: HealTally
  healSpells: Record<string, HealTally>
  healTargets: Record<string, HealTally>
  healers: Record<string, HealTally>
  /** Absorption granted by runes. */
  runes: number
  casts: number
  /** Spells of this entity that a target resisted. */
  resisted: number
  kills: number
  deaths: number
  firstAt: number
  lastAt: number
  /** Time in combat: gaps between this entity's own hits, each capped at 3 s. */
  activeMs: number
  /** For activeMs; not shown. */
  lastHitAt: number
}

export type SegmentKind = 'fight' | 'session'

/** Damage per second of a fight, one entry per second from its start: you, your pets, the rest of your side, and damage to you. */
export interface Timeline {
  you: number[]
  pet: number[]
  group: number[]
  inc: number[]
}

export interface Segment {
  id: string
  kind: SegmentKind
  name: string
  zone: string
  startedAt: number
  /** The last event's time. */
  endedAt: number
  open: boolean
  /** Time in combat across everyone: gaps between hits capped at 3 s. */
  activeMs: number
  /** For activeMs; not shown. */
  lastHitAt: number
  /** By lowercased name. */
  entities: Record<string, Entity>
  /** Enemies engaged, by lowercased name, and whether each still lives. */
  enemies: Record<string, boolean>
  kills: number
  /** Deaths on your side. */
  deaths: number
  /** Hit points enemies healed: damage undone. */
  enemyHeal: number
  /** You or your pet took part. */
  mine: boolean
  /** Fights only. */
  timeline?: Timeline
}

export interface SegmentSummary {
  id: string
  kind: SegmentKind
  name: string
  zone: string
  startedAt: number
  endedAt: number
  open: boolean
  /** Damage dealt by your side. */
  total: number
  dps: number
  /** Your own damage, pets folded in. */
  yours: number
  kills: number
  mine: boolean
}

export interface RosterMember {
  name: string
  /** How the tracker learned of them. */
  from: 'log' | 'you'
}

export interface CombatSnapshot {
  /** Newest first. */
  fights: SegmentSummary[]
  sessions: SegmentSummary[]
  liveFight: Segment | null
  liveSession: Segment | null
  /** Your character's name, as the log spells it; '' until known. */
  self: string
  roster: RosterMember[]
  /** Your pets' names, the newest last. */
  pets: string[]
  /** Group members' pets: pet name → owner. */
  otherPets: Record<string, string>
  /** Lines the meter is still reading from the log, or ''. */
  reading: string
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

/** What an item is for, from its eqlwiki page: the notes, the quests and recipes it is used in. */
export interface ItemUse {
  /** The page's notes, markup stripped and cut short; '' for none. */
  notes: string
  /** Quests the page relates it to. */
  quests: string[]
  /** "Jewelcrafting: Silver Blue Diamond Ring (75)". */
  recipes: string[]
  /** What merchants pay, as the page words it; '' when unsaid. */
  value: string
  /** The merchants the page lists selling it. Absent on entries cached before it was kept. */
  vendors?: { zone: string; npc: string; note: string }[]
  /** Where else it comes from, when no vendor sells it. Absent on entries cached before it was kept. */
  sources?: ItemSources
}

/** An item's other sources, from its page: what drops it and where, where it is foraged, whether it is crafted. */
export interface ItemSources {
  drops: { zone: string; mobs: string[] }[]
  foraged: string[]
  crafted: boolean
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
  /** Absent on entries cached before it was kept. */
  use?: ItemUse
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
  kind: 'timer' | 'fade' | 'trigger' | 'archive' | 'loot' | 'fight' | 'info' | 'warn'
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
  /**
   * Ticks the effect is seen on its target, counting the partial tick it lands in: wholeTicks + 1.
   * A timer joined at a tick ends (ticks − 1) ticks after it. 0 for an instant spell, -1 permanent.
   */
  ticks: number
  /** Whole ticks after rounding, the Spell window's bracketed figure: spellWindowSec = wholeTicks × 6. */
  wholeTicks: number
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
