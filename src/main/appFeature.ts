import type { LogHistory } from './sources/logHistory'
import type { AppContext } from './context'
import type { AchievementsExport } from './achievements'
import type { AchievementTrack, PlayerLocation } from '../shared/tracking'

// A part of the app that keeps itself whole, beside the engine's parts (EngineFeature): its channels,
// its Data Sources rows, its part in following the log and what it keeps on disk are its own, so the
// context builds it, registers it and flushes it without knowing what it does. What it counts over the
// logs is fixed before LogHistory is built, so a feature class lists that as a static `consumers`.

/** What LiveAchievements has read when it asks each feature for its part of the track. */
export interface TrackContext {
  /** The character being played (its key). */
  character: string
  /** The zone the player is in. */
  zone: string
  /** The character's achievements export as last read; null without one. */
  exported: AchievementsExport | null
  /** The player's last /loc in this zone, if any (FEAT-023). */
  loc?: PlayerLocation | null
}

export interface AppFeature {
  readonly id: string
  /** Its IPC handlers, its Data Sources rows and its engine feature, if any; once, as the app starts. */
  register(ctx: AppContext): void
  /** Writes what it keeps; quitting waits for it. */
  flush?(): Promise<void>
  /**
   * Its part of the achievements overlay's track, from what it holds (LiveAchievements asks when it
   * publishes, LT-623): the faction plan's step, the Slayer counts, the Hunter named and the epic pieces in the zone.
   */
  track?(at: TrackContext): Partial<Pick<AchievementTrack, 'faction' | 'slayer' | 'hunter' | 'epics'>>
}

/** What every feature module is built from (LT-632): the log history its counts come from, and the settings folder its files are kept in. */
export interface FeatureDeps {
  logHistory: LogHistory
  dir: string
}
