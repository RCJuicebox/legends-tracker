import { STANDING_MAX, type FactionView } from './core'
import type { RaceUnlock } from './unlocks'
import type { PlanChoices, PlanSettings } from '../../shared/settings'
import type { FactionCatalog } from './catalog'
import { NO_CHOICES } from './ways'
import type { FactionPlan, PlanInput, PlanShape, PlanTarget } from './planTypes'
import { buildModel } from './model'
import { search } from './search'
import { planSteps } from './steps'

// A plan for the faction achievements still to do: what to kill or hand in, how many, and in what
// order, for the least time. Each achievement is done the moment its raw standing reaches 2000, and
// stays done whatever the standing does after, so the order is what matters: an achievement whose
// work lowers another is best left until that other one is done.
//
// What can be done and what it moves is the catalog's (catalog.ts), built in the main process. The plan
// is worked out in the page: the model (model.ts) puts the catalog and the standings as numbers, the
// search (search.ts) finds the order, and the steps (steps.ts) are what the Plan tab shows. One
// faction's ways to 2000 alone are ways.ts's; the names the wiki and the log write differently, names.ts's.

/**
 * What the Plan tab plans from, gathered by the main process. What is still to do is as it was when
 * the catalog was built; the page follows the Standings tab's own view for it (planFor).
 */
export interface FactionPlanData extends PlanFor {
  catalog: FactionCatalog
  /** The factions export the standings come from; null without one, and then they start from 0. */
  export: { file: string; modified: number } | null
  /** The inventory export items on hand are counted from; null without one. */
  inventory: { file: string; modified: number } | null
  /**
   * eqlwiki's faction and quest pages: when read, how many, and why a refresh failed (the pages kept
   * serve meanwhile); `unmatched`, the names the wiki and the character's factions do not share.
   */
  wiki: { fetchedAt: number; pages: number; quests: number; error: string; unmatched: { pages: string[]; factions: string[] } }
  /** Kills and hand-ins in the log that moved a faction, and changes nothing around them explained. */
  log: { kills: number; handIns: number; unexplained: number }
  /** The player's other characters whose logs the plan also learns from, and what those saw. */
  shared: { characters: string[]; kills: number; handIns: number }
  /** Allakhazam's faction pages: how many of the factions wanted are read (they come a page every twenty seconds), and why reading stopped. */
  alla: { read: number; wanted: number; error: string }
  /** Whether Agnostic, the deity the plan counts everyone as, is unlocked to pick in Loadouts; null when no achievements export says. */
  agnostic: boolean | null
  /** The races the character can swap to in Loadouts; null when no achievements export says, and then every race is counted. */
  races: string[] | null
  /** Every race unlock, done or not, with its factions (as the achievements export has them, else as the standings say). */
  unlocks: RaceUnlock[]
  /** The character's race and what each race it could be adds to its cons, as an Agnostic of its classes; null without a race on its record. */
  raceMods: { own: string; mods: Record<string, Record<string, number>> } | null
  /** The game folder has no achievement list (Resources/Achievements/AchievementsClient.txt): a wrong folder, not everything done. */
  noAchievementList?: boolean
}

/** What a plan is for, read off the Factions page's own view, so the plan and the Standings tab never disagree. */
export interface PlanFor {
  /** The achievements still to do (the Standings tab's "Achievements to Do"), with where each faction stands. */
  targets: PlanTarget[]
  /** Factions at 2000 now. */
  maxed: string[]
  /** Whether the character's achievements export says which are done; without one, an achievement counts as done only while its standing is at 2000. */
  achievementsExport: boolean
  /** Every faction's standing where it is known (the factions export plus the log since): where each ends is counted. */
  standings: Record<string, number>
}

/** The achievements a character has still to do, from its factions view: whichever character it is, whatever it has done. */
export function planFor(view: Pick<FactionView, 'factions'>): PlanFor {
  const targets: PlanTarget[] = []
  const maxed: string[] = []
  const standings: Record<string, number> = {}
  let achievementsExport = false
  for (const r of view.factions) {
    const standing = r.standing?.value ?? 0
    if (r.standing) standings[r.name] = r.standing.value
    if (standing >= STANDING_MAX) maxed.push(r.name)
    if (r.achievement?.from === 'achievements') achievementsExport = true
    if (r.achievement && r.achievement.done !== true) targets.push({ faction: r.name, achievement: r.achievement.name, standing })
  }
  return { targets, maxed, achievementsExport, standings }
}

/**
 * The plan. Every achievement still to do is a must, and so is every race unlock's faction; how the rest
 * is weighed is the goal's: 'fastest' counts time (and, a little, points left off factions that were at
 * 2000), 'positive' also counts every faction that ends at 0 or above, and may add steps at the end to
 * bring factions back there. Where a faction ends is what counts, so a point an early step takes and a
 * later one gives back costs nothing. With race unlocks first, each unlock done sooner counts as well.
 *
 * Where the races' modifiers are known (`input.races`), a quest whose NPC wants a con opens as the
 * standings get there, as the character's own race or one it can swap to (the ones unlocked, and each
 * one a race unlock in the plan unlocks); and the plan may add a step that raises a faction to what a
 * quicker quest's NPC wants, where that saves time.
 *
 * With `keep`, the order of an earlier plan is kept when it still finishes everything (only the
 * standings have moved since): the steps update, nothing is searched, and nothing is reshuffled under
 * the player's feet. Otherwise, or when it no longer does, the order is searched for afresh.
 */
export function planFactions(input: PlanInput, settings: PlanSettings, choices: PlanChoices = NO_CHOICES, keep?: PlanShape): FactionPlan {
  const m = buildModel(input, settings, choices)
  const { best, kept } = search(m, keep)
  return planSteps(m, best, kept)
}
