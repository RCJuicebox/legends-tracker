import moteWorkerPath from './moteWorker?modulePath'
import { findInstall, isGameRunning } from './game'
import type { EngineEnv } from './engine'

/** The engine's view of the running app: the worker script electron-vite builds, and the Windows lookups. */
export function appEngineEnv(o: { dataDir: string; soundDirs: () => string[] }): EngineEnv {
  return { moteWorkerPath, isGameRunning, findInstall, ...o }
}
