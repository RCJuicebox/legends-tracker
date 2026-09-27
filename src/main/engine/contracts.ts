import type { MoteState } from '../../core/motes'
import type { RespawnRecords, RespawnView } from '../../core/respawns'
import type { PetGearReading } from '../../core/pets'
import type { BuffsFile, BuffView } from '../../core/buffs'
import type { Cell } from '../../core/moteStock'
import type { MoteScanJob, MoteScanResult } from '../moteHistory'
import type { SpeechWorker } from '../speech'
import type { AppSettings, ArchiveStatus, CharacterSettings, CombatSnapshot, FeedItem, MoteStock, SpellRule, TimerView, Trigger, WatchStatus } from '../../shared/types'
import type { AudioCommand, LootView, MoteScan, MoteView } from '../../shared/ipc'

// What the engine is given and what it gives back: passed in, so the engine runs anywhere, tests
// included.

export interface EngineOutputs {
  timers: (views: TimerView[]) => void
  alert: (payload: { text: string; color: string; durationSec: number }) => void
  audio: (payload: AudioCommand) => void
  status: (status: WatchStatus) => void
  feed: (item: FeedItem) => void
  archive: (status: ArchiveStatus) => void
  motes: (state: MoteView) => void
  /** Progress of a mote history rebuild alone, without the history itself. */
  moteScan: (scan: MoteScan) => void
  stock: (stock: MoteStock) => void
  combat: (snapshot: CombatSnapshot) => void
  loot: (snapshot: LootView) => void
  respawns: (view: RespawnView) => void
  /** A `/pet inventory check` list, or a pet summoned, as the log reports it. */
  pet: (update: { gear?: PetGearReading; summon?: { spell: string; at: number } }) => void
  buffs: (view: BuffView) => void
}

/** Reads mote history somewhere (a worker thread in the app); `stop` abandons it. */
export type MoteScanner = (
  job: MoteScanJob,
  progress: (message: string, fraction: number) => void
) => { done: Promise<MoteScanResult>; stop: () => void }

/** What the engine needs from the running app. */
export interface EngineEnv {
  /** The mote history worker's script (electron-vite's `./moteWorker?modulePath`). */
  moteWorkerPath: string
  isGameRunning: () => Promise<boolean>
  findInstall: () => Promise<string>
  soundDirs: () => string[]
  /** Where the engine keeps its own files: catchup.json. */
  dataDir: string
  /** Reads mote history in place of the worker thread; for tests. */
  scanMotes?: MoteScanner
}

/** The parts of the settings store the engine uses. */
export interface EngineStore {
  settings: Cell<AppSettings>
  triggers: { get(): Trigger[] }
  rules: { get(): Record<string, SpellRule> }
  casts: Cell<Record<string, { rankedName: string; lastCast: number; count: number }>>
  motes: Cell<MoteState>
  stock: Cell<MoteStock>
  respawns: Cell<RespawnRecords>
  buffs: Cell<BuffsFile>
  readonly motesFresh: boolean
  characterOf(logFile: string): CharacterSettings
}

export type Speaker = Pick<SpeechWorker, 'synthesize'> & { warm?(voice: string): void }

export type Feed = (kind: FeedItem['kind'], text: string) => void

export type { AudioCommand, LootView, MoteView }
