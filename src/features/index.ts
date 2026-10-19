import type { IconName } from '../shared/icons'

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
  /**
   * An optional module: off until the player turns it on under Settings › Modules, and this is what
   * that tab says it does. Off, its page is not in the sidebar; what it keeps is kept for when it is on again.
   */
  readonly optional?: string
}

export const FEATURE_PAGES = [
  { id: 'factions', group: 'Plan', label: 'Factions', icon: 'flag', after: 'achievements' },
  { id: 'slayer', group: 'Plan', label: 'Slayer', icon: 'sword', after: 'factions' },
  { id: 'hunter', group: 'Plan', label: 'Hunter', icon: 'crosshair', after: 'slayer' },
  {
    id: 'sky',
    group: 'Plan',
    label: 'Plane of Sky',
    icon: 'cloud',
    after: 'hunter',
    optional:
      'Every class’s Test quests, with what each takes and how many of each you have, counted from your log. A wish list keeps the rewards you want, and how many of each (two Wu’s Fists to merge), and adds up what they still take.'
  }
] as const satisfies readonly FeaturePage[]

export type FeaturePageId = (typeof FEATURE_PAGES)[number]['id']

/** The optional modules, in sidebar order: Settings › Modules lists them, and the sidebar leaves out those that are off. */
export const OPTIONAL_MODULES: readonly (FeaturePage & { optional: string })[] = (FEATURE_PAGES as readonly FeaturePage[]).filter(
  (p): p is FeaturePage & { optional: string } => !!p.optional
)

/** Whether a page is in the sidebar: every page, but an optional module only while it is on. */
export const pageShown = (id: string, modules: Readonly<Record<string, boolean>>): boolean => !OPTIONAL_MODULES.some((m) => m.id === id) || modules[id] === true
