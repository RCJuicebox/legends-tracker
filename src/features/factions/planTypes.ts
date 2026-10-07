import type { PlanActivity } from './catalog'
import type { Way } from './ways'

// What the planner (planner.ts) takes and what it gives: the achievements it is for, the race unlocks
// still to do and what each race adds to the cons; the plan's steps, every way to raise each achievement
// still open, why one is left undone, and the order, kept while only the standings change.

export interface PlanTarget {
  faction: string
  /** The achievement's name ("New Sebilis Expedition" for faction New Sebilisian Expedition). */
  achievement: string
  standing: number
}

export interface PlanInput {
  targets: PlanTarget[]
  /** Every faction's standing where known, so where each ends can be counted; the targets' are theirs. */
  standings?: Record<string, number>
  /** Factions at 2000 now that are not achievements to do: lowering one costs a little (the achievement is kept, the standing lost). */
  maxed: string[]
  activities: PlanActivity[]
  /** The race unlocks still to do: achievements too, and each one done is one more race to swap to. */
  unlocks?: UnlockGoal[]
  /**
   * What each race the character could be adds to its cons. With it, a quest opens as the standings
   * reach the con its NPC wants, as the character's own race or one it can swap to, and the plan may
   * raise a faction to get there; without it, a quest is open or not as the catalog found it.
   */
  races?: RaceMods
}

/** A race unlock still to do, as the planner takes it. */
export interface UnlockGoal {
  /** "Race Unlock - Barbarian". */
  achievement: string
  /** The race it unlocks in Loadouts. */
  race: string
  /** The factions still to max for it, by the game's names. */
  factions: string[]
  /** Done when any of these race unlocks is, rather than by factions (Half Elf's, with Human's or Wood Elf's). */
  anyOf?: string[]
}

/** The races a character could be, for the cons its NPCs give. */
interface RaceMods {
  /** Its race now. */
  own: string
  /** The races it can swap to in Loadouts now; null when no achievements export says, and then every race counts. */
  unlocked: string[] | null
  /** By race (its own among them), by faction: the race's modifier and the best of its classes' (the plan counts everyone Agnostic, which adds none). 0s left out. */
  mods: Record<string, Record<string, number>>
}

export interface PlanStep {
  activity: PlanActivity
  units: number
  /** Including getting there, and any race swap. */
  seconds: number
  travel: number
  /** Swapping race in Loadouts for it and back; 0 when the character's own race will do. */
  swap: number
  /** Units the items on hand cover. */
  fromStock: number
  /** Copper the bought items cost. */
  copper: number
  /** Achievements done during this step (and factions a race unlock wanted maxed). */
  finishes: string[]
  /** Race unlocks done during this step. */
  unlocks: string[]
  /**
   * Factions it raises to the con a later step's NPC wants: the standing to reach, that con's word, and
   * that step's activity. A step there only for this finishes nothing itself: it opens a quicker way.
   */
  reaches: { faction: string; to: number; band: string; opens: string }[]
  /** The race it is done as, swapped to in Loadouts, when not the character's own. */
  race?: string
  /** Then: the first con its NPC wants that the character's own race would fall short of there. */
  why?: { faction: string; band: string; con: number }
  /** What it does to achievements still open when it starts: points up (to 2000 at most), points down. */
  raises: Record<string, number>
  lowers: Record<string, number>
  /** Factions at 2000 it takes down (achievements kept, standing lost). */
  maxedLowered: Record<string, number>
  /** Factions it brings from below zero to 0 or above, and ones it takes below zero. */
  lifts: string[]
  sinks: string[]
  /** It finishes no achievement: it is there to bring factions back to 0 or above (the 'positive' goal). */
  restores: boolean
  /** Locked achievements among those it finishes. */
  locked: string[]
  /**
   * Achievements locked in to another activity that this step gets to 2000 first, with that activity's
   * title: standing rises with whatever raises it, so the lock is not needed for them any more.
   */
  onTheWay: Record<string, string>
}

export interface PlanOption extends Way {
  /** Open achievements it lowers. */
  lowersOpen: string[]
  /** The plan finishes this achievement with it. */
  chosen: boolean
  /** The plan uses it at all. */
  used: boolean
}

/**
 * Why the plan leaves an achievement undone: nothing known raises it; only quests done once do (a lock
 * plans one); every way is ruled out; every way's NPC wants a con the plan cannot get to, as the
 * character's race or one it can swap to; or the ways it may use do not get it to 2000.
 */
export type Unplanned = 'nothing known' | 'once only' | 'ruled out' | 'gated' | 'not reached'

/**
 * A plan's order: each block's activity, the achievements it is there to finish, the factions it is
 * there to bring back to 0 or above, and those it is there to raise to what another activity's NPC wants.
 */
export type PlanShape = { act: string; finish: string[]; lift?: string[]; reach?: { faction: string; to: number; for: string }[]; use?: boolean }[]

export interface FactionPlan {
  steps: PlanStep[]
  seconds: number
  /** What it is for: the achievements to do, then the factions only a race unlock wants maxed. */
  targets: PlanTarget[]
  /** Of those, what the plan does not get done: nothing it may use raises them (with the choices made), or opens a way that does. */
  unplanned: string[]
  /** Why, for each of them. */
  unplannedWhy: Record<string, Unplanned>
  /** Every way to raise each achievement still open, quickest first. */
  options: Record<string, PlanOption[]>
  /** Locks whose activity no longer raises the achievement, or is gone. */
  staleLocks: string[]
  /** Points factions end below 2000 after being there, over the whole plan: what a later step gives back is not lost. */
  maxedLost: number
  /** Factions below zero, of those whose standing is known: now, and at the end of the plan. */
  belowZero: { now: number; after: number }
  /** The order, to keep while only the standings change (planFactions' `keep`). */
  shape: PlanShape
  /** The order kept was still good, so no search was made. */
  kept: boolean
}
