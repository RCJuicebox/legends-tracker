// The contract between the main process and its windows: every channel, what it takes and what it
// gives back. main's handlers and the pages' api.invoke/on/send are typed from these maps, and the
// preload's allowlist is built from their keys, so a channel with no caller or no handler, or a page
// expecting the wrong shape, is a compile error.
//
// This is the one file in shared/ that imports from core, and only types: it describes data core
// builds. Core never imports it.

import type { AaSummary } from '../core/aa'
import type { AaHistoryView } from '../core/aaHistory'
import type { BuffView } from '../core/buffs'
import type { EffectSpell } from '../core/itemEffects'
import type { FactionSources, FactionView } from '../features/factions/core'
import type { FactionPlanData } from '../features/factions/planner'
import type { FactionLookup, FactionMover } from '../features/factions/lookup'
import type { FollowedPlan } from '../features/factions/tracker'
import type { SlayerPlanChoices, SlayerPlanData } from '../features/slayer/core'
import type { SlayerMap, SlayerMark } from '../features/slayer/spawns'
import type { HunterPlanData } from '../features/hunter/core'
import type { SkyState } from '../features/sky/core'
import type { AchievementTrack, PlayerLocation } from './tracking'
import type { FocusReport } from '../core/itemFocus'
import type { LootSnapshot } from '../core/loot'
import type { MeleeProfile } from '../core/meleeTally'
import type { MoteState } from '../core/motes'
import type { PetGearReading, PetProfile, PetSpellOption } from '../core/pets'
import type { RespawnTimerSpec, RespawnView, SpawnLink } from '../core/respawns'
import type { MyClass, SpellCastRow } from '../core/spellMotes'
import type { BagLayoutView, SkinBuild, SkinBuildResult } from '../core/skinBuild'
import type { Offer, Purchase, Recipe } from '../core/tradeskills'
import type { CatalogItem } from '../core/wikiItem'
import type { AchMarks, AchievementsView, CharacterSheet, GameFolderCheck, InventoryView, ItemInfo, MoteStock } from './character'
import type { CombatSnapshot, Segment, SegmentSummary, StitchedTimeline } from './combat'
import type { AppSettings, AudioSettings, CharacterSettings, FocusSource, MeterOverlayOptions, OverlayConfig, SpellRule } from './settings'
import type { Trigger, TriggerTestResult } from './triggers'
import type { FoundSpot } from './game/legendsSpawns'
import type {
  ArchiveInfo,
  ArchiveOutcome,
  ArchiveStatus,
  AzureStatus,
  FeedItem,
  KnownSpell,
  LogCheckRow,
  LogFileInfo,
  SpellSummary,
  TimerView,
  UpdateState,
  WatchStatus
} from './runtime'

// ---- Views main hands the pages ----

export interface TriggerError {
  trigger: string
  error: string
}

export interface AudioDevice {
  deviceId: string
  label: string
}

/** Everything a window needs to draw its first frame. */
export interface AppState {
  settings: AppSettings
  status: WatchStatus
  timers: TimerView[]
  feed: FeedItem[]
  archive: ArchiveStatus
  character: CharacterSettings
  characterKey: string
  voices: string[]
  speechError: string
  arranging: boolean
  devices: AudioDevice[]
  triggerErrors: TriggerError[]
  /** Global hotkeys another program already holds. */
  hotkeysTaken: string[]
}

interface LogsOverview {
  logs: LogFileInfo[]
  archives: ArchiveInfo[]
  archiveDir: string
  status: ArchiveStatus
}

export type LootView = LootSnapshot & { sessions: SegmentSummary[] }

export interface MoteScan {
  scanning: string
  scanProgress: number
}

export type MoteView = MoteState & MoteScan

/** A download from the wiki under way, or the last one's error. */
export interface WikiProgress {
  busy: boolean
  pages: number
  total: number
  error: string
}

export type BookRecipe = Recipe & { icon: number }

export interface RecipeFile {
  fetchedAt: number
  format: number
  recipes: BookRecipe[]
  /** Each page's era tag ('Epics', 'Classic'; '' for none), by title: products and their ingredients. */
  eras?: Record<string, string>
}

interface RecipeState {
  file: RecipeFile | null
  stale: boolean
  progress: WikiProgress
}

export interface CatalogFile {
  fetchedAt: number
  items: CatalogItem[]
  /** Every page of the Items category at its revision then, equipment or not: what a later refresh compares against. */
  revs?: Record<string, number>
  /** The wiki's in/out era list (Template:PageEra), as it stood at the download. */
  eraStatus?: Record<string, 'in' | 'out'>
  format?: number
}

export interface CatalogState {
  file: CatalogFile | null
  stale: boolean
  progress: WikiProgress
  /** The page already has this catalog (it said when it was fetched): `file` is left out. */
  same?: true
}

/** The newest purchase of each item, by lower-cased name. */
export type Purchases = Record<string, Purchase>

export interface TradeFavorite {
  /** The recipe's key: its product and ingredients (see recipeKey). */
  key: string
  product: string
  combines: number
}

export interface TradeSaved {
  favorites: TradeFavorite[]
  /** Copper for one, by lower-cased item name. */
  prices: Record<string, number>
}

interface PetSummon {
  /** Unranked: "Frenzied Spirit". */
  spell: string
  at: number
}

/** What the log says of the pet: its last gear list and the last summoning cast. */
export interface PetState {
  gear: PetGearReading | null
  summon: PetSummon | null
}

type PetUpdate = PetState & { character: string }

export type PetView = PetUpdate & { spells: PetSpellOption[]; spellsLoaded: boolean }

/** A cast window over the log and its archives. */
interface CastWindow {
  total: number
  from: string
  to: string
}

export type FocusData = FocusReport & { window: CastWindow | null }

interface GearEffects {
  spells: Record<string, EffectSpell>
  profile: MeleeProfile | null
  loaded: boolean
}

interface SpellCasts {
  rows: SpellCastRow[]
  unknown: { name: string; casts: number }[]
  window: CastWindow | null
  /** Your classes as the game names them, each with its level, from /who or the character sheet. */
  mine: MyClass[]
}

export interface SkillCapRow {
  id: number
  cap: number
  /** Which of the classes has that best cap. */
  from: string
}

interface Caps {
  skills: SkillCapRow[]
  ac: Record<string, { cap: number; mult: number }>
  /** What a point of STA, the casting stat and the endurance stats is worth, by class. */
  factors: Record<string, { hp: number; mana: number; end: number }>
}

export interface MoteScreenRead {
  counts: Record<string, number>
  rows: string[]
  /** Lines that look like motes but were not read, when nothing was: to show what the screen had. */
  nearMisses: string[]
  screens: number
}

export interface StatsScreenRead {
  values: Record<string, number[]>
  rows: string[]
  screens: number
}

/** A long job under way, which the player can cancel. */
export interface JobView {
  id: string
  label: string
  /** 0 to 1, or null when there is no telling. */
  fraction: number | null
  detail: string
}

/** How a source of information last fared (see the Data Sources page). */
/** `idle`: there, and simply not being read now (the log while not watched). */
export type SourceStatus = 'ok' | 'stale' | 'error' | 'missing' | 'reading' | 'waiting' | 'idle'

/** Another PC's Logs folder as last looked at (Settings › Log files). */
export interface LogFolderView {
  dir: string
  /** It answered at the last look. */
  reachable: boolean
  /** When it was last looked at; 0 before the first look. */
  at: number
  /** The characters with a log there, at its last answer. */
  characters: string[]
  /** Why the last look failed; '' when it answered. */
  error: string
}

export interface SourceView {
  id: string
  label: string
  /** What it is and what uses it, in a sentence. */
  what: string
  kind: 'log' | 'game file' | 'wiki' | 'screen' | 'app'
  status: SourceStatus
  /** What the last read found ("73,975 spells", "written 3 minutes ago"). */
  detail: string
  /** The last failure, until the next good read. */
  error: string
  lastOk: number
  lastTried: number
  refreshable: boolean
  /** A longer report the row can open, with Copy: the log's unread lines (FEAT-025), what a patch changed (FEAT-026). */
  report?: { title: string; text: string }
}

/** `expiresAt`: past this time (epoch ms) a phrase still queued is dropped, not said late. */
export type AudioCommand =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean; expiresAt?: number; urgent?: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean; expiresAt?: number; urgent?: boolean }
  | { kind: 'sound'; data: Uint8Array; volume: number; name: string }

/** One achievements export, kept small (FEAT-032): achievements done in all and by section, and each Slayer achievement's count. */
export interface ExportSnapshot {
  /** When the game wrote it. */
  at: number
  total: number
  /** By "Category › Section": achievements done. */
  done: Record<string, number>
  /** By achievement: its count (the most, once done). */
  slayer: Record<string, number>
}

/** Achievements over time, for Achievements › Progress (FEAT-032). */
export interface AchievementProgress {
  /** "You have completed achievement: X" lines in the character's logs, oldest first. */
  completions: { name: string; at: number }[]
  /** Each export read, oldest first. */
  snapshots: ExportSnapshot[]
  /** Faction standings moved, by day ("2026-10-19"), then by faction: the net of the day. */
  factionDays: Record<string, Record<string, number>>
  today: string
}

// ---- The channels ----

/** Request and answer: api.invoke(channel, ...args) → Promise<result>. */
/** What running pasted log lines did: the lines read, and the timers and triggers that started. */
export interface SimulateResult {
  lines: number
  timers: number
  triggers: number
}

export interface Invokes {
  'app:state': () => AppState
  'app:openLogs': () => string
  /** Version, machine, settings summary and the end of the log, for a bug report. */
  'app:diagnostics': () => string
  /** Whether the group-health worker starts and loads the Windows calls: the packaged smoke test asks (LT-630). */
  'groupHealth:selfTest': () => { pong: boolean; koffi: boolean; error?: string }
  'settings:save': (settings: AppSettings) => AppSettings
  'character:save': (character: CharacterSettings) => void
  /** Any character's record (classes, levels, race, focus), by key; the character being played is the one app:state carries. */
  'character:get': (key: string) => CharacterSettings
  'character:put': (key: string, character: CharacterSettings) => CharacterSettings
  'watch:start': () => void
  'watch:stop': () => void
  simulate: (text: string) => SimulateResult

  'triggers:get': () => Trigger[]
  'triggers:save': (triggers: Trigger[]) => TriggerError[]
  'triggers:test': (trigger: Trigger, line: string) => TriggerTestResult
  'triggers:import': () => Trigger[] | null
  'triggers:export': (triggers: Trigger[]) => boolean

  'spells:known': () => KnownSpell[]
  'spells:search': (query: string) => SpellSummary[]
  'spells:rule': (name: string, rule: SpellRule | null) => KnownSpell[]
  'spells:checkLog': (megabytes: number) => LogCheckRow[]
  /** The character's casts and resists of each spell over the last two weeks of play, by its name (LT-722). */
  'spells:resists': () => Record<string, { casts: number; resisted: number }>
  'focus:search': (query: string) => FocusSource[]

  'logs:list': () => LogFileInfo[]
  'logs:overview': () => LogsOverview
  'logs:archive': (path: string) => ArchiveOutcome
  'logs:compress': (path: string) => ArchiveOutcome
  'logs:reveal': (path: string) => void
  /** Other PCs' Logs folders, looked at; `again` looks now however recent the last look. */
  'logs:folders': (again?: boolean) => LogFolderView[]
  /** Picks another PC's Logs folder and adds it. */
  'logs:addFolder': () => { canceled: boolean; dir: string; problem: string }

  'overlays:arrange': (on: boolean) => void
  'overlays:demo': () => void

  'combat:get': () => CombatSnapshot
  'combat:segment': (id: string) => Segment | null
  'combat:sessionTimeline': (id: string) => StitchedTimeline | null
  /** A host overlay window asks for its overlays and the newest timers and meter once its page is up. */
  'overlay:hostState': (
    display: number
  ) => { configs: OverlayConfig[]; origin: { x: number; y: number }; timers: TimerView[]; combat: CombatSnapshot | null; achievements: AchievementTrack | null } | null
  'combat:newSession': () => CombatSnapshot
  'combat:addMember': (name: string) => CombatSnapshot
  'combat:removeMember': (name: string) => CombatSnapshot
  'combat:clearGroup': () => CombatSnapshot
  'combat:rebuild': (minutes: number) => void

  'loot:get': () => LootView
  /** What merchants last offered the character being played, by item name lowercased (LT-725). */
  'loot:offers': () => Record<string, Offer>
  /** Whether a wanted Hunter named that dies starts its respawn timer by itself (FEAT-038). */
  'hunter:autoTimers': (on: boolean) => boolean
  'buffs:get': () => BuffView
  'buffs:setWanted': (spells: string[] | null) => BuffView

  'respawns:get': () => RespawnView
  'respawns:setTimer': (spec: RespawnTimerSpec) => RespawnView
  'respawns:removeTimer': (name: string) => RespawnView
  'respawns:forget': (key: string) => RespawnView
  'respawns:link': (link: SpawnLink) => RespawnView
  'respawns:unlink': (key: string) => RespawnView

  'trade:recipes': () => RecipeState
  'trade:refresh': () => RecipeState
  'trade:craftEras': () => Record<string, string[]>
  'trade:purchases': (character: string) => Purchases
  'trade:favorites': () => TradeSaved
  'trade:saveFavorites': (saved: TradeSaved) => TradeSaved

  'pet:state': (character: string, classes: string[], level: number) => PetView
  'pet:profile': (spell: string, force?: boolean) => { spell: string; profile: PetProfile | null }

  'motes:get': () => MoteView
  'motes:start': () => void
  'motes:stop': () => void
  'motes:pause': (at?: number) => void
  'motes:resume': () => void
  'motes:rescan': () => void
  'motes:setKind': (id: string, kind: 'crawl' | 'instance') => MoteView
  'motes:forget': (id: string) => MoteView
  'motes:spellCasts': (character: string, days: number) => SpellCasts | null

  'stock:get': () => MoteStock
  'stock:counts': (counts: MoteStock['counts']) => MoteStock
  'stock:item': (item: MoteStock['item']) => MoteStock
  'stock:autoAdd': (on: boolean) => MoteStock
  'stock:apply': () => MoteStock
  'stock:readScreen': () => MoteScreenRead

  'update:status': () => { status: UpdateState; version: string }
  'update:check': () => void
  'update:install': () => void

  'audio:test': (text: string) => void
  'audio:azure': () => AzureStatus
  'audio:setAzure': (region: string, key: string) => AzureStatus
  'audio:sound': (file: string) => void
  'audio:sounds': () => string[]
  /** The Audio page is open (true) or closed (false): the output devices are listed only meanwhile. */
  'audio:watchDevices': (on: boolean) => void
  'audio:voices': () => { voices: string[]; error: string }

  'achievements:load': (character: string) => AchievementsView
  'achievements:marks': (character: string, marks: AchMarks) => void
  /** Achievements done over time, export snapshots and factions moved per day (FEAT-032). */
  'achievements:progress': (character: string) => AchievementProgress

  /** Faction changes the character's log and its archives recorded. */
  'factions:get': (character: string) => FactionView
  /** What raises a faction, from its eqlwiki page; sources is null when the wiki has none. */
  'factions:sources': (faction: string) => { sources: FactionSources | null }
  /** What the Plan tab plans the faction achievements still to do from; `refresh` reads eqlwiki's pages again, `wide` adds the ways to raise every other faction. */
  'factions:plan': (character: string, refresh?: boolean, wide?: boolean) => FactionPlanData
  /** What moved a faction in the player's logs (this character's and the others'), most points first. */
  'factions:moved': (character: string, faction: string) => { movers: FactionMover[] }
  /** Mobs and NPCs whose name holds the query, with what each does to the factions: the logs' amounts, else eqlwiki's direction. */
  'factions:lookup': (character: string, query: string) => { results: FactionLookup[] }
  /** The plan the Plan tab shows for a character, to follow while it is played (null stops following). */
  'factions:follow': (character: string, plan: FollowedPlan | null) => void
  /** The step of the followed plan to work on now, picked by the player: shown until kills or hand-ins go toward another. */
  'factions:follow-step': (character: string, index: number) => void
  /** What the Slayer page plans from: the open Slayer achievements and where kills of their races come from; `refresh` reads the logs again. */
  'slayer:plan': (character: string, refresh?: boolean) => { data: SlayerPlanData; choices: SlayerPlanChoices }
  /** What the player chose on the Slayer page for a character. */
  'slayer:choices': (character: string, choices: SlayerPlanChoices) => void
  /** A zone's map as the game draws it, with the spots these mobs pop at (TAKP's spawn tables); no short name for a zone they lack. */
  'slayer:map': (zone: string, mobs: string[]) => SlayerMap
  /** Marks these spawns on the game's map, in its own map set (maps\LegendsTracker, a copy of the game's); none clears them. Each page's (`set`) are kept apart and written together. */
  'slayer:mark': (marks: SlayerMark[], set?: 'hunter') => { folder: string; zones: number; spots: number }
  /** What Plan › Hunter shows: each Hunter achievement not done, the named it still wants, and what their spawns allow. */
  /** The races the player said mobs are (by the mob's name words), and every race there is to say (FEAT-021). */
  'slayer:said': () => { races: Record<string, string>; names: string[] }
  /** Says a mob's race, or forgets it (null); the races said after. Everything counts again at once. */
  'slayer:sayRace': (mob: string, race: string | null) => Record<string, string>
  'hunter:plan': (character: string) => HunterPlanData
  /** Says a Hunter achievement does not work in Legends (left out of the plans and the overlay), or works again; the list after. */
  'hunter:broken': (achievement: string, broken: boolean) => string[]
  /** Keeps a spot the player found a named at (as /loc or /waypoint gives it) with a few words; every spot kept after (FEAT-020). */
  'hunter:found': (zone: string, name: string, spot: string, words: string) => FoundSpot[]
  /** Forgets one found spot, by when it was said; every spot kept after. */
  'hunter:unfound': (zone: string, name: string, on: number) => FoundSpot[]
  /** Every spot the player found. */
  'hunter:foundSpots': () => FoundSpot[]
  /** What Plan › Plane of Sky shows for a character: the Sky's items its logs count, the Tests handed in, its wish list and corrections. */
  'sky:state': (character: string) => SkyState
  /** Wants a Test's reward this many times (0 drops the wish), with hand-ins the log did not see; the state after. */
  'sky:wish': (character: string, quest: string, want: number, extra?: number) => SkyState
  /** Says how many of an item the character holds: kept as a correction to the log's count; the state after. */
  'sky:have': (character: string, item: string, have: number) => SkyState
  /** Stars a Test, or ignores it (on the Ignored tab alone), or takes that back; the state after. */
  'sky:mark': (character: string, quest: string, mark: 'favorite' | 'ignored', on: boolean) => SkyState
  /** Hand-ins of a Test the player adds over what the log saw (or takes away, below 0); the state after. */
  'sky:turnIns': (character: string, quest: string, hand: number) => SkyState
  /** Where the character being played is in its faction plan, and its Slayer counts since its achievements export. */
  'achievements:track': (watching?: boolean) => AchievementTrack | null
  /** The player's last /loc, while they are still in its zone; null without one (FEAT-023). */
  'game:location': () => PlayerLocation | null

  'character:exports': () => { current: string; achievements: string[]; inventory: string[]; factions: string[] }
  'character:sheet': (character: string) => CharacterSheet
  'character:saveSheet': (character: string, sheet: CharacterSheet) => void
  'inventory:load': (character: string, refresh?: boolean) => InventoryView
  /** `force` reads the pages again from eqlwiki, however recently they were read. */
  'inventory:lookup': (names: string[], force?: boolean) => Record<string, ItemInfo>

  /** `have`: when the catalog the page holds was fetched, so the same one is not sent again. */
  'gear:catalog': (have?: number) => CatalogState
  'gear:catalogRefresh': () => CatalogState
  'gear:foci': (names: string[], classes: string[], level: number, character: string, days: number) => FocusData | null
  'gear:effects': (names: string[], character: string, days: number) => GearEffects

  'stats:caps': (classes: string[], level: number) => Caps
  /** The newest /alternateadv list in the character's own log. */
  'stats:readAAs': (character: string) => AaSummary | null
  /** The AAs the character's log and archives saw bought and refunded, and its ability points. */
  'stats:aaHistory': (character: string) => { character: string; view: AaHistoryView }
  'stats:readScreen': () => StatsScreenRead

  'game:check': (dir?: string) => GameFolderCheck
  'game:find': () => string
  'game:choose': () => { canceled: boolean; picked: string; dir: string }
  /** The UI skins in the game folder that ask for a rebuild button (src/core/skinBuild.ts). */
  'skins:builds': () => SkinBuild[]
  /** Runs a skin's rebuild, for a character's export. */
  /** `approve`: the player has seen the command and agreed to it; needed the first time a command runs. */
  'skins:build': (skin: string, character: string, approve?: boolean) => SkinBuildResult
  /** A skin's bag layout and the character's bags, for Tradeskills › Bag layout; null for a skin that keeps none. */
  'skins:layout': (skin: string, character: string) => BagLayoutView | null
  /** Keeps a skin's bag layout (cells per line, by the export's bag slot names); returns what was kept. */
  'skins:saveLayout': (skin: string, columns: Record<string, number>) => Record<string, number>
  'dialog:folder': () => string | null

  'sources:list': () => SourceView[]
  'jobs:list': () => JobView[]
  'jobs:cancel': (id: string) => void
  'sources:refresh': (id: string) => SourceView[]
}

/** One way, page to main: api.send(channel, ...args). */
export interface Sends {
  /** A meter overlay wants the mouse while the pointer is on its controls, or gives it back. */
  'overlay:mouse': (id: string, interactive: boolean) => void
  /** A meter overlay's header changed what it shows. */
  'overlay:meter': (id: string, patch: Partial<MeterOverlayOptions>) => void
  /** The audio window's list of output devices. */
  'audio:devices': (devices: AudioDevice[]) => void
  /**
   * The main window's page started (on) or stopped listening to a live view's channel (WATCHED_PUSHES);
   * the preload sends it, counting listeners, and '' at each page load forgets them all (LT-556).
   */
  'views:watch': (channel: string, on: boolean) => void
  /** Something the audio window could not do: a saved device gone (playing on the default), a phrase or sound that would not decode or play (LT-618). */
  'audio:problem': (kind: 'device' | 'decode' | 'play', detail: string) => void
}

/** One way, main to a window: api.on(channel, listener). */
export interface Pushes {
  'state:settings': (settings: AppSettings) => void
  'state:character': (character: CharacterSettings) => void
  'state:status': (status: WatchStatus) => void
  'state:timers': (timers: TimerView[]) => void
  'state:feed': (item: FeedItem) => void
  'state:archive': (archive: ArchiveStatus) => void
  'state:arranging': (on: boolean) => void
  'state:devices': (devices: AudioDevice[]) => void
  'state:voices': (voices: { voices: string[]; error: string }) => void
  'state:update': (status: UpdateState) => void
  'state:combat': (snapshot: CombatSnapshot) => void
  'state:loot': (view: LootView) => void
  'state:respawns': (view: RespawnView) => void
  'state:buffs': (view: BuffView) => void
  'state:motes': (view: MoteView) => void
  'state:moteScan': (scan: MoteScan) => void
  'state:stock': (stock: MoteStock) => void
  'state:pet': (pet: PetUpdate) => void
  'state:achievements': (view: AchievementsView) => void
  'state:inventory': (view: InventoryView) => void
  'state:catalog': (progress: WikiProgress) => void
  'state:sources': (rows: SourceView[]) => void
  'state:jobs': (jobs: JobView[]) => void
  /** A faction moved in the log, or a factions export was written: the Factions page reads again. */
  'state:factionsChanged': () => void
  'state:recipes': (progress: WikiProgress) => void
  /** The faction plan's step and the Slayer counts, as they change. */
  'state:achievementTrack': (track: AchievementTrack) => void

  'overlay:config': (update: { config: OverlayConfig; arranging: boolean }) => void
  'overlay:timers': (timers: TimerView[]) => void
  'overlay:combat': (snapshot: CombatSnapshot) => void
  /** `at`: when it was raised, so a host that loads a moment later shows it for what is left of its time. */
  'overlay:alert': (alert: { text: string; color: string; durationSec: number; at?: number }) => void
  'overlay:achievements': (track: AchievementTrack | null) => void
  /** The overlays one host window draws, and where the window's top left is on the screen. */
  'overlay:host': (update: { configs: OverlayConfig[]; origin: { x: number; y: number } }) => void

  'audio:config': (audio: AudioSettings) => void
  'audio:play': (command: AudioCommand) => void
  /** Whether a page lists the output devices: the audio window lists them, and follows changes, only then. */
  'audio:watchDevices': (on: boolean) => void
}

export type InvokeChannel = keyof Invokes
export type SendChannel = keyof Sends
export type PushChannel = keyof Pushes

/** What an invoke resolves to. */
export type InvokeResult<K extends InvokeChannel> = Awaited<ReturnType<Invokes[K]>>

// Every channel by name, so the preload can check a page's call at run time. The Record types make
// the compiler insist each list is exactly its map's keys.
const INVOKE_CHANNELS: Record<InvokeChannel, true> = {
  'app:state': true,
  'app:openLogs': true,
  'app:diagnostics': true,
  'groupHealth:selfTest': true,
  'settings:save': true,
  'character:save': true,
  'character:get': true,
  'character:put': true,
  'watch:start': true,
  'watch:stop': true,
  simulate: true,
  'triggers:get': true,
  'triggers:save': true,
  'triggers:test': true,
  'triggers:import': true,
  'triggers:export': true,
  'spells:known': true,
  'spells:search': true,
  'spells:rule': true,
  'spells:checkLog': true,
  'spells:resists': true,
  'focus:search': true,
  'logs:list': true,
  'logs:overview': true,
  'logs:archive': true,
  'logs:compress': true,
  'logs:reveal': true,
  'logs:folders': true,
  'logs:addFolder': true,
  'overlays:arrange': true,
  'overlays:demo': true,
  'combat:get': true,
  'combat:segment': true,
  'combat:sessionTimeline': true,
  'overlay:hostState': true,
  'combat:newSession': true,
  'combat:addMember': true,
  'combat:removeMember': true,
  'combat:clearGroup': true,
  'combat:rebuild': true,
  'loot:get': true,
  'loot:offers': true,
  'hunter:autoTimers': true,
  'buffs:get': true,
  'buffs:setWanted': true,
  'respawns:get': true,
  'respawns:setTimer': true,
  'respawns:removeTimer': true,
  'respawns:forget': true,
  'respawns:link': true,
  'respawns:unlink': true,
  'trade:recipes': true,
  'trade:refresh': true,
  'trade:craftEras': true,
  'trade:purchases': true,
  'trade:favorites': true,
  'trade:saveFavorites': true,
  'pet:state': true,
  'pet:profile': true,
  'motes:get': true,
  'motes:start': true,
  'motes:stop': true,
  'motes:pause': true,
  'motes:resume': true,
  'motes:rescan': true,
  'motes:setKind': true,
  'motes:forget': true,
  'motes:spellCasts': true,
  'stock:get': true,
  'stock:counts': true,
  'stock:item': true,
  'stock:autoAdd': true,
  'stock:apply': true,
  'stock:readScreen': true,
  'update:status': true,
  'update:check': true,
  'update:install': true,
  'audio:test': true,
  'audio:watchDevices': true,
  'audio:azure': true,
  'audio:setAzure': true,
  'audio:sound': true,
  'audio:sounds': true,
  'audio:voices': true,
  'achievements:load': true,
  'achievements:marks': true,
  'achievements:progress': true,
  'factions:get': true,
  'factions:sources': true,
  'factions:plan': true,
  'factions:moved': true,
  'factions:lookup': true,
  'factions:follow': true,
  'factions:follow-step': true,
  'slayer:plan': true,
  'slayer:choices': true,
  'slayer:map': true,
  'slayer:mark': true,
  'slayer:said': true,
  'slayer:sayRace': true,
  'hunter:plan': true,
  'hunter:broken': true,
  'hunter:found': true,
  'hunter:unfound': true,
  'hunter:foundSpots': true,
  'sky:state': true,
  'sky:wish': true,
  'sky:have': true,
  'sky:mark': true,
  'sky:turnIns': true,
  'achievements:track': true,
  'game:location': true,
  'character:exports': true,
  'character:sheet': true,
  'character:saveSheet': true,
  'inventory:load': true,
  'inventory:lookup': true,
  'gear:catalog': true,
  'gear:catalogRefresh': true,
  'gear:foci': true,
  'gear:effects': true,
  'stats:caps': true,
  'stats:readAAs': true,
  'stats:aaHistory': true,
  'stats:readScreen': true,
  'game:check': true,
  'game:find': true,
  'game:choose': true,
  'skins:builds': true,
  'skins:build': true,
  'skins:layout': true,
  'skins:saveLayout': true,
  'dialog:folder': true,
  'sources:list': true,
  'sources:refresh': true,
  'jobs:list': true,
  'jobs:cancel': true
}
const SEND_CHANNELS: Record<SendChannel, true> = { 'overlay:mouse': true, 'overlay:meter': true, 'audio:devices': true, 'audio:problem': true, 'views:watch': true }

/**
 * The live views the main window is sent only while a page there listens (LT-556): the rest of the
 * time main keeps the latest of each and sends it when a page starts listening, as it does while the
 * window is hidden. Each was cloned and decoded several times a second while Settings showed.
 */
export const WATCHED_PUSHES: ReadonlySet<string> = new Set<PushChannel>([
  'state:combat',
  'state:respawns',
  'state:buffs',
  'state:loot',
  'state:motes',
  'state:stock',
  'state:pet',
  'state:achievementTrack'
])
const PUSH_CHANNELS: Record<PushChannel, true> = {
  'state:settings': true,
  'state:character': true,
  'state:status': true,
  'state:timers': true,
  'state:feed': true,
  'state:archive': true,
  'state:arranging': true,
  'state:devices': true,
  'state:voices': true,
  'state:update': true,
  'state:combat': true,
  'state:loot': true,
  'state:respawns': true,
  'state:buffs': true,
  'state:motes': true,
  'state:moteScan': true,
  'state:stock': true,
  'state:pet': true,
  'state:achievements': true,
  'state:inventory': true,
  'state:catalog': true,
  'state:recipes': true,
  'state:achievementTrack': true,
  'state:sources': true,
  'state:jobs': true,
  'state:factionsChanged': true,
  'overlay:config': true,
  'overlay:timers': true,
  'overlay:combat': true,
  'overlay:alert': true,
  'overlay:achievements': true,
  'overlay:host': true,
  'audio:config': true,
  'audio:play': true,
  'audio:watchDevices': true
}

export const isInvokeChannel = (c: unknown): c is InvokeChannel => typeof c === 'string' && Object.hasOwn(INVOKE_CHANNELS, c)
/**
 * Every invoke channel the contract names: each must have a handler (tests/main/ipcHandlers.test.ts).
 * @public
 */
export const invokeChannels = (): InvokeChannel[] => Object.keys(INVOKE_CHANNELS) as InvokeChannel[]
export const isSendChannel = (c: unknown): c is SendChannel => typeof c === 'string' && Object.hasOwn(SEND_CHANNELS, c)
export const isPushChannel = (c: unknown): c is PushChannel => typeof c === 'string' && Object.hasOwn(PUSH_CHANNELS, c)
