import type { IconName } from '../shared/icons'

// The feature modules. Each folder here keeps one feature whole: its logic (core.ts), its
// main-process side (main.ts: the log-history consumer, what the page asks for) and its page
// (page.tsx). This list is what the shell needs to put each page in the sidebar. It is data only, so
// the renderer reads it without pulling in either process's code.

/**
 * The sidebar's groups, in order, by the question each answers: Play, what runs beside the game;
 * Character, what the character is made of and where the motes go; Goals, what is being worked
 * towards (the achievements and their planners); Cues, what the app watches for and says. Settings is
 * in none: it sits at the sidebar's foot.
 */
export const NAV_GROUPS = ['Play', 'Character', 'Goals', 'Cues'] as const
export type NavGroup = (typeof NAV_GROUPS)[number]

export interface FeaturePage {
  /** The page's id, as the sidebar and `go` name it. */
  readonly id: string
  readonly group: NavGroup
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
  { id: 'factions', group: 'Goals', label: 'Factions', icon: 'flag', after: 'achievements' },
  { id: 'slayer', group: 'Goals', label: 'Slayer', icon: 'sword', after: 'factions' },
  { id: 'hunter', group: 'Goals', label: 'Hunter', icon: 'crosshair', after: 'slayer' },
  {
    id: 'sky',
    group: 'Goals',
    label: 'Plane of Sky',
    icon: 'cloud',
    after: 'hunter',
    optional:
      'Every class’s Test quests, with what each takes and how many of each you have, counted from your log. A wish list keeps the rewards you want, and how many of each (two Wu’s Fists to merge), and adds up what they still take.'
  },
  {
    id: 'epics',
    group: 'Goals',
    label: 'Epics',
    icon: 'scroll',
    after: 'sky',
    optional:
      'What to keep for each class’s epic quest, as the eqlwiki’s Epic Items To Keep checklist lists it, with how many of each you hold from your log and inventory export; a quest reward in hand covers what makes it. Targets says where to hunt for the rest.'
  },
  {
    id: 'spellquests',
    group: 'Goals',
    label: 'Spell Quests',
    icon: 'book',
    after: 'epics',
    optional:
      'The five class spells a quest gives (Tashania, Ice Comet, Divine Might, Life Leech, Call of Flame), every step of each with how many of each piece you hold from your log and inventory export. Every class’s by default; pick yours to narrow it. Targets says where to hunt for the rest.'
  },
  {
    id: 'reincarnation',
    group: 'Goals',
    label: 'Reincarnation',
    icon: 'reincarnate',
    after: 'spellquests',
    optional:
      'Every class and race Reincarnation AA with its three ranks, read from your log as the game gives them, and a planner: build the trios and races you mean to reincarnate as, and each class and race comes off the list once all three of its ranks are planned or done. Each class says whether it has Evasive or Defensive stance and whether its mana comes from WIS or INT.'
  }
] as const satisfies readonly FeaturePage[]

export type FeaturePageId = (typeof FEATURE_PAGES)[number]['id']

/** The optional modules, in sidebar order: Settings › Modules lists them, and the sidebar leaves out those that are off. */
export const OPTIONAL_MODULES: readonly (FeaturePage & { optional: string })[] = (FEATURE_PAGES as readonly FeaturePage[]).filter(
  (p): p is FeaturePage & { optional: string } => !!p.optional
)

/** Whether a page is in the sidebar: every page, but an optional module only while it is on. */
export const pageShown = (id: string, modules: Readonly<Record<string, boolean>>): boolean => !OPTIONAL_MODULES.some((m) => m.id === id) || modules[id] === true
