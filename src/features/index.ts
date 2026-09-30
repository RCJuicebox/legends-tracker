import type { IconName } from '../renderer/src/components/ui'

// The feature modules. Each folder here keeps one feature whole: its logic (core.ts), its
// main-process side (main.ts: the log-history consumer, what the page asks for) and its page
// (page.tsx). This list is what the shell needs to put each page in the sidebar. It is data only, so
// the renderer reads it without pulling in either process's code.

export interface FeaturePage {
  /** The page's id, as the sidebar and `go` name it. */
  readonly id: string
  readonly group: 'Play' | 'Plan' | 'Setup'
  readonly label: string
  readonly icon: IconName
  /** The page it comes after in the sidebar. */
  readonly after: string
}

export const FEATURE_PAGES = [{ id: 'factions', group: 'Plan', label: 'Factions', icon: 'flag', after: 'achievements' }] as const satisfies readonly FeaturePage[]

export type FeaturePageId = (typeof FEATURE_PAGES)[number]['id']
