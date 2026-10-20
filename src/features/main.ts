import type { FeatureDeps } from '../main/appFeature'
import { Factions } from './factions/main'
import { SlayerPlanner } from './slayer/main'
import { HunterPlanner } from './hunter/main'
import { SkyTracker } from './sky/main'
import { EpicTracker } from './epics/main'

// The feature modules' main sides, built one way (LT-632): each class's static create takes the same
// FeatureDeps, and each one's log-history counts are spread into the LogHistory's from here. A new
// feature is a line in each, and its field on AppContext.

/** Every feature module's log-history consumers, by name. */
export const FEATURE_CONSUMERS = { ...Factions.consumers, ...SlayerPlanner.consumers, ...SkyTracker.consumers, ...EpicTracker.consumers }

/** Every feature module, built. */
export function createFeatures(d: FeatureDeps) {
  return { factions: Factions.create(d), slayer: SlayerPlanner.create(d), hunter: HunterPlanner.create(d), sky: SkyTracker.create(d), epics: EpicTracker.create(d) }
}
