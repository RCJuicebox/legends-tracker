// What the achievements overlay and the pages are told as the game is played: where the character is
// in the faction plan it follows, and its Slayer counts since its achievements export.

export type TrackKind = 'kill' | 'turnin' | 'quest'

/** A faction a step is there for: an achievement to take to 2000, or a faction to bring back to 0. */
export interface FactionTrackGoal {
  faction: string
  /** The achievement's name, when it is one. */
  achievement?: string
  standing: number
  /** 2000 for an achievement, 0 for a faction brought back, else the standing a later step's NPC wants. */
  to: number
  done: boolean
}

export interface FactionTrackStep {
  /** Its place in the plan, from 0, and its activity's id. */
  index: number
  id: string
  kind: TrackKind
  title: string
  zone: string
  npc?: string
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
  next: { index: number; kind: TrackKind; title: string; zone: string; npc?: string } | null
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

export interface AchievementTrack {
  /** The character being played (its key). */
  character: string
  at: number
  faction: FactionTrackView | null
  slayer: SlayerTrackView | null
  skills: SkillTrackView | null
  /** The achievements the player tracks, in the order tracked. */
  tracked: TrackedAchievement[]
}
