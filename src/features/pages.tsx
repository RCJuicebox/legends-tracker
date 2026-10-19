import type { ComponentType } from 'react'
import type { Go } from '../renderer/src/nav'
import type { FeaturePageId } from '.'
import { Factions } from './factions/page'
import { Slayer } from './slayer/page'
import { Hunter } from './hunter/page'
import { Sky } from './sky/page'

// Each feature module's page (src/features/<name>/page.tsx), by the id src/features/index.ts lists it
// under: the shell draws them from here, so a new feature's page is one line in each of the two (LT-632).

export const FEATURE_ELEMENTS: Record<FeaturePageId, ComponentType<{ go: Go }>> = { factions: Factions, slayer: Slayer, hunter: Hunter, sky: Sky }
