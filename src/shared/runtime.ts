// What main pushes to the windows while the app runs: timers, the feed, status, spell and log views.

import type { SpellCategory } from './game/guide'
import type { SpellRule } from './settings'

type TimerSource = 'spell' | 'trigger'

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
  /** What sets it: the spell's base name (its Spell Timers row), or the trigger's id (LT-691). */
  rule?: string
  /** An invisibility: it ends when you act, so the bar shows no clock and cues no recast (LT-717). */
  untilActed?: true
  /** Another player whose cast this is: the bar's name is the spell's, and this a line of its own (LT-750). */
  caster?: string
  /** A DoT's last tick, once one is seen: with its exact end, "3 ticks · 451 a tick" (LT-728). */
  tickDamage?: number
  /** Not a bar: a line under its overlay's bars, as the buffs overlay's "Missing: …" (LT-749). */
  note?: true
}

export type Notification =
  /** `urgent`: to the front of the speech queue, and never the phrase dropped when it is full (LT-719). */
  | { kind: 'speak'; text: string; interrupt: boolean; urgent?: boolean }
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
  /** What went wrong reading the log, or handling its lines, until it reads clean again. */
  logError?: string
  /** Another character's log that is being written while the watched one is quiet: likely who is being played now. */
  elsewhere?: { path: string; character: string } | null
  /** Another PC's log, followed while this PC's game is closed (Settings › Log files); null while this PC's is. */
  remote?: { path: string; character: string; folder: string } | null
  /** Other PCs' logs written in the last quarter hour, newest first: the ones Live lets the player pick between. */
  others?: OtherLog[]
  /** The other PC's log the player picked to follow, over the automatic pick; null for automatic. */
  chosenOther?: string | null
}

/** Another PC's log being written. */
export interface OtherLog {
  path: string
  character: string
  folder: string
  /** When it was last written (ms). */
  modified: number
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

/** How archiving or compressing one log went. */
export type ArchiveOutcome =
  | { status: 'archived'; zipPath: string; originalBytes: number; zipBytes: number; liveHandoff: boolean }
  | { status: 'deferred'; reason: 'locked' | 'held-open'; message: string }
  | { status: 'failed'; message: string }

/** What a spell is resisted with, from the spell file. */
export type ResistType = 'none' | 'magic' | 'fire' | 'cold' | 'poison' | 'disease' | 'chromatic' | 'prismatic' | 'physical' | 'corruption'

export interface SpellSummary {
  id: number
  name: string
  category: SpellCategory
  beneficial: boolean
  icon: number
  castMs: number
  resist: ResistType
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
  /** The spell without its rank, as its settings are kept. */
  spell: string
  /** The focus percent the calculation used, the spell's own extra included. */
  focusPct: number
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

/** The Kokoro voices' model, as the Audio page is told it. */
export interface KokoroStatus {
  /** absent: not downloaded; failed: the last download failed (error says why). */
  state: 'absent' | 'downloading' | 'ready' | 'failed'
  /** How far the download has got, 0 to 1, while downloading. */
  fraction: number | null
  /** Why the download or the model failed; '' when all is well. */
  error: string
}

/** Where the self-updater has got to. */
export type UpdateState =
  | { state: 'dev' }
  | { state: 'idle'; checkedAt: number }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number; notes?: string }
  | { state: 'ready'; version: string; notes?: string }
  | { state: 'error'; message: string }
