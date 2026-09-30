import type { AppContext } from './context'

// A part of the app that keeps itself whole, beside the engine's parts (EngineFeature): its channels,
// its Data Sources rows, its part in following the log and what it keeps on disk are its own, so the
// context builds it, registers it and flushes it without knowing what it does. What it counts over the
// logs is fixed before LogHistory is built, so a feature class lists that as a static `consumers`.

export interface AppFeature {
  readonly id: string
  /** Its IPC handlers, its Data Sources rows and its engine feature, if any; once, as the app starts. */
  register(ctx: AppContext): void
  /** Writes what it keeps; quitting waits for it. */
  flush?(): Promise<void>
}
