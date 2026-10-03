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
import type { AchievementTrack } from './tracking'
import type { FocusReport } from '../core/itemFocus'
import type { LootSnapshot } from '../core/loot'
import type { MeleeProfile } from '../core/meleeTally'
import type { MoteState } from '../core/motes'
import type { PetGearReading, PetProfile, PetSpellOption } from '../core/pets'
import type { RespawnTimerSpec, RespawnView, SpawnLink } from '../core/respawns'
import type { MyClass, SpellCastRow } from '../core/spellMotes'
import type { SkinBuild, SkinBuildResult } from '../core/skinBuild'
import type { Purchase, Recipe } from '../core/tradeskills'
import type { CatalogItem } from '../core/wikiItem'
import type { AchMarks, AchievementsView, CharacterSheet, GameFolderCheck, InventoryView, ItemInfo, MoteStock } from './character'
import type { CombatSnapshot, Segment, SegmentSummary, StitchedTimeline } from './combat'
import type { AppSettings, AudioSettings, CharacterSettings, FocusSource, MeterOverlayOptions, OverlayConfig, SpellRule } from './settings'
import type { Trigger, TriggerTestResult } from './triggers'
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
export type SourceStatus = 'ok' | 'stale' | 'error' | 'missing' | 'reading' | 'waiting'

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
}

export type AudioCommand =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean }
  | { kind: 'sound'; data: Uint8Array; volume: number; name: string }

// ---- The channels ----

/** Request and answer: api.invoke(channel, ...args) → Promise<result>. */
export interface Invokes {
  'app:state': () => AppState
  'app:openLogs': () => string
  /** Version, machine, settings summary and the end of the log, for a bug report. */
  'app:diagnostics': () => string
  'settings:save': (settings: AppSettings) => AppSettings
  'character:save': (character: CharacterSettings) => void
  /** Any character's record (classes, levels, race, focus), by key; the character being played is the one app:state carries. */
  'character:get': (key: string) => CharacterSettings
  'character:put': (key: string, character: CharacterSettings) => CharacterSettings
  'watch:start': () => void
  'watch:stop': () => void
  simulate: (text: string) => void

  'triggers:get': () => Trigger[]
  'triggers:save': (triggers: Trigger[]) => TriggerError[]
  'triggers:test': (trigger: Trigger, line: string) => TriggerTestResult
  'triggers:import': () => Trigger[] | null
  'triggers:export': (triggers: Trigger[]) => boolean

  'spells:known': () => KnownSpell[]
  'spells:search': (query: string) => SpellSummary[]
  'spells:rule': (name: string, rule: SpellRule | null) => KnownSpell[]
  'spells:checkLog': (megabytes: number) => LogCheckRow[]
  'focus:search': (query: string) => FocusSource[]

  'logs:list': () => LogFileInfo[]
  'logs:overview': () => LogsOverview
  'logs:archive': (path: string) => ArchiveOutcome
  'logs:compress': (path: string) => ArchiveOutcome
  'logs:reveal': (path: string) => void

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
  'audio:voices': () => { voices: string[]; error: string }

  'achievements:characters': () => { current: string; available: string[] }
  'achievements:load': (character: string) => AchievementsView
  'achievements:marks': (character: string, marks: AchMarks) => void

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
  /** Where the character being played is in its faction plan, and its Slayer counts since its achievements export. */
  'achievements:track': (watching?: boolean) => AchievementTrack | null

  'character:exports': () => { current: string; achievements: string[]; inventory: string[]; factions: string[] }
  'character:sheet': (character: string) => CharacterSheet
  'character:saveSheet': (character: string, sheet: CharacterSheet) => void
  'inventory:load': (character: string, refresh?: boolean) => InventoryView
  /** `force` reads the pages again from eqlwiki, however recently they were read. */
  'inventory:lookup': (names: string[], force?: boolean) => Record<string, ItemInfo>

  'gear:catalog': () => CatalogState
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
  'skins:build': (skin: string, character: string) => SkinBuildResult
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
  'state:recipes': (progress: WikiProgress) => void
  /** The faction plan's step and the Slayer counts, as they change. */
  'state:achievementTrack': (track: AchievementTrack) => void

  'overlay:config': (update: { config: OverlayConfig; arranging: boolean }) => void
  'overlay:timers': (timers: TimerView[]) => void
  'overlay:combat': (snapshot: CombatSnapshot) => void
  'overlay:alert': (alert: { text: string; color: string; durationSec: number }) => void
  'overlay:achievements': (track: AchievementTrack | null) => void
  /** The overlays one host window draws, and where the window's top left is on the screen. */
  'overlay:host': (update: { configs: OverlayConfig[]; origin: { x: number; y: number } }) => void

  'audio:config': (audio: AudioSettings) => void
  'audio:play': (command: AudioCommand) => void
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
  'focus:search': true,
  'logs:list': true,
  'logs:overview': true,
  'logs:archive': true,
  'logs:compress': true,
  'logs:reveal': true,
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
  'audio:azure': true,
  'audio:setAzure': true,
  'audio:sound': true,
  'audio:sounds': true,
  'audio:voices': true,
  'achievements:characters': true,
  'achievements:load': true,
  'achievements:marks': true,
  'factions:get': true,
  'factions:sources': true,
  'factions:plan': true,
  'factions:moved': true,
  'factions:lookup': true,
  'factions:follow': true,
  'factions:follow-step': true,
  'achievements:track': true,
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
  'dialog:folder': true,
  'sources:list': true,
  'sources:refresh': true,
  'jobs:list': true,
  'jobs:cancel': true
}
const SEND_CHANNELS: Record<SendChannel, true> = { 'overlay:mouse': true, 'overlay:meter': true, 'audio:devices': true }
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
  'overlay:config': true,
  'overlay:timers': true,
  'overlay:combat': true,
  'overlay:alert': true,
  'overlay:achievements': true,
  'overlay:host': true,
  'audio:config': true,
  'audio:play': true
}

export const isInvokeChannel = (c: unknown): c is InvokeChannel => typeof c === 'string' && Object.hasOwn(INVOKE_CHANNELS, c)
/** Every invoke channel the contract names: each must have a handler (tests/main/ipcHandlers.test.ts). */
export const invokeChannels = (): InvokeChannel[] => Object.keys(INVOKE_CHANNELS) as InvokeChannel[]
export const isSendChannel = (c: unknown): c is SendChannel => typeof c === 'string' && Object.hasOwn(SEND_CHANNELS, c)
export const isPushChannel = (c: unknown): c is PushChannel => typeof c === 'string' && Object.hasOwn(PUSH_CHANNELS, c)
