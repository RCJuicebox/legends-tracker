// What the achievements overlay and the pages are told as the game is played: where the character is
// in the faction plan it follows, and its Slayer counts since its achievements export.

export type TrackKind = 'kill' | 'turnin' | 'quest'

/** A faction a step is there for: an achievement to take to 2000, a faction to bring back to 0, or a city's guards to content. */
export interface FactionTrackGoal {
  faction: string
  /** The achievement's name, when it is one; else what the standing is for ("Qeynos guards"). */
  achievement?: string
  standing: number
  /** 2000 for an achievement, 0 for a faction brought back, else the standing a later step's NPC wants or a city's guards con the character Indifferent at. */
  to: number
  done: boolean
  /** A city's guards: at `to`, they con the character Indifferent. */
  city?: boolean
}

/** What goes into one hand-in of a step: the item and how many, and what the items are combined into first. */
export interface TrackItem {
  name: string
  count: number
  makes?: string
}

/**
 * A hand-in's items in a few words: "2 Lizard Tail", "10 Fire Beetle Eye made into a Box of Beetle
 * Eyes", "2 Rusty Dagger + 1 Gold". A count of one is said too: "(1 Ruby each)", not "(Ruby each)" (LT-596).
 */
export const itemsSaid = (items: TrackItem[]) => items.map((it) => `${it.count.toLocaleString()} ${it.name}${it.makes ? ` made into ${it.makes}` : ''}`).join(' + ')

interface FactionTrackStep {
  /** Its place in the plan, from 0, and its activity's id. */
  index: number
  id: string
  kind: TrackKind
  title: string
  zone: string
  npc?: string
  /** What goes into one hand-in; none for a kill. */
  items?: TrackItem[]
  /** Kills or hand-ins still to go, and about how long they take. */
  unitsLeft: number
  secondsLeft: number
  /** 0 to 1: how far along since it became the step being worked on. */
  progress: number
  goals: FactionTrackGoal[]
}

export interface FactionTrackView {
  steps: number
  /** Steps done. */
  done: number
  /** The step being worked on; null when every step is done. */
  current: FactionTrackStep | null
  next: { index: number; kind: TrackKind; title: string; zone: string; npc?: string; items?: TrackItem[] } | null
  /** About how long the steps not done take. */
  secondsLeft: number
}

/** A Slayer achievement's count: the achievements export's, and the kills the log has shown since. */
export interface SlayerRow {
  name: string
  section: string
  /** What it counts, as the achievement says: "Orcs and Wereorcs." */
  races: string
  count: number
  since: number
  /** Of `since`, the kills only a mob's name (or an alias not yet settled) put here: no eqlwiki race, and no export has said. */
  guessed: number
  max: number
  /** The last kill it counted; 0 for none since the export. */
  last: number
  /** The game said it was completed since the export. */
  done: boolean
}

export interface SlayerTrackView {
  exportFile: string
  exportAt: number
  rows: SlayerRow[]
  /** Kills since the export that no Slayer achievement still open is known to count (their kind not known). */
  unplaced: { name: string; n: number }[]
  /** Names still being looked up on eqlwiki for their race. */
  pending: number
}

/** A skill objective still open ("Reach the maximum skill in Divination at level 50."): the skill's value and the cap to reach. */
export interface SkillRow {
  achievement: string
  /** The class the achievement is for: "Shaman". */
  className: string
  skill: string
  level: number
  /** The value the log last gave; null when it has none (a skill never raised since logging began, or only at a guildmaster). */
  value: number | null
  /** The cap to reach: the best of the character's classes at that level, as the Skills window shows it. */
  target: number
  /** When the log last saw it go up; 0 for never. */
  last: number
}

export interface SkillTrackView {
  rows: SkillRow[]
  /** The character's classes the caps come from; empty when not known (then each achievement's own class). */
  classes: string[]
}

/** An achievement the player keeps on the overlay, with its progress in whatever way it has one. */
export interface TrackedAchievement {
  /** achKey(): "Slayer: Conquest > puttin' on the dog". */
  key: string
  name: string
  /** "Slayer: Conquest". */
  section: string
  done: boolean
  /** A count toward a total: Slayer kills (with what the log added since the export), or a faction's standing toward 2000. */
  count?: { value: number; max: number; since?: number; faction?: string }
  /** The skills it wants, each against the cap to reach. */
  skills?: { skill: string; value: number | null; target: number }[]
  /** Otherwise its required objectives still to do (the named left, for a Hunter achievement), of how many. */
  left?: string[]
  total?: number
  /** Objectives the log has shown done since the export (a named killed), with when. */
  justDone?: { name: string; at: number }[]
}

/** The Hunter achievements of the zone the player is in: the named each still wants. */
export interface HunterTrackView {
  zone: string
  rows: {
    achievement: string
    left: string[]
    total: number
    /** Killed since the export, the export not knowing yet. */
    since: string[]
    /** What the Respawns records say of each named left, by name ("died 6 min ago; back in ~2 min as you timed it"), where the log saw it die. */
    seen?: Record<string, string>
    /** How far and which way the nearest spot of each named left is from the player's last /loc in this zone (FEAT-023). */
    near?: Record<string, string>
  }[]
}

/** A step of the Slayer plan, as the overlay shows it (slayerPlanView). */
export interface SlayerPlanStepView {
  /** Its place in the plan, from 0. */
  index: number
  zone: string
  /** The player is in its zone now. */
  here: boolean
  /** The Banestrike tier it works toward: "Progressive". */
  tier: string
  /** Killing there, and getting there from the step before, seconds. */
  seconds: number
  travel: number
  /** The zones crossed on the way, as the log has gone. */
  via?: string[]
  /** The achievements it is there for, with their counts now. */
  goals: { name: string; count: number; max: number }[]
  /** What to kill there and about how many, most first. */
  mobs: { name: string; n: number }[]
}

/** Plan › Slayer on the achievements overlay: made again from the counts as kills come in. */
export interface SlayerPlanTrackView {
  steps: number
  /** Achievements the plan works toward. */
  goals: number
  /** About how long the plan takes from here. */
  secondsLeft: number
  /** The step whose zone the player is in, else the first, to head to; null when nothing is left to plan. */
  current: SlayerPlanStepView | null
  next: SlayerPlanStepView | null
}

export interface AchievementTrack {
  /** The character being played (its key). */
  character: string
  at: number
  faction: FactionTrackView | null
  slayer: SlayerTrackView | null
  skills: SkillTrackView | null
  /** The Hunter named left in the zone the player is in; null outside a Hunter zone. */
  hunter?: HunterTrackView | null
  /** Plan › Slayer's step, when the player shows it here. */
  slayerPlan?: SlayerPlanTrackView | null
  /** The achievements the player tracks, in the order tracked. */
  tracked: TrackedAchievement[]
}

/** The player's last /loc, in the zone it was typed in (FEAT-023). */
export interface PlayerLocation {
  zone: string
  y: number
  x: number
  z: number
  at: number
}
