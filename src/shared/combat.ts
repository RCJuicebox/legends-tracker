// The damage meter's model, as main builds it and the pages and overlays draw it.

/**
 * Who an entity is to the player. `unknown` is a single capitalised word the log has not yet placed
 * on a side: a stranger or a named mob, told apart by whom it hits.
 */
export type EntityKind = 'you' | 'pet' | 'group' | 'player' | 'npc' | 'npcpet' | 'unknown'

export interface Tally {
  total: number
  hits: number
  crits: number
  critTotal: number
  max: number
  /** 0 until the first hit. */
  min: number
}

export type DamageHow = 'melee' | 'spell' | 'dot' | 'ds'

export interface SkillStat extends Tally {
  name: string
  how: DamageHow
  /** Swings that did not land, for melee. */
  misses: number
  /** Casts the target resisted, for spells. */
  resists: number
  /** Hits by their modifier: critical, riposte, flurry, rampage, finishing blow. */
  mods: Record<string, number>
}

export interface HealTally {
  /** Hit points actually restored. */
  total: number
  /** What the heals were for, before overhealing was cut off; the same as total when the log gave no figure. */
  raw: number
  count: number
  crits: number
  max: number
}

/** Swings aimed at an entity and what became of them. */
export interface Defense {
  swings: number
  hit: number
  miss: number
  dodge: number
  parry: number
  block: number
  riposte: number
  absorb: number
}

/**
 * Where a proc row came from. `spell`: a spell effect that landed with no cast line behind it, so
 * something fired it (a weapon, a buff). `ability`: the same, for an ability the game lists as one
 * you press. `aa`: a swing the game annotated "(Finishing Blow)".
 */
export type ProcOrigin = 'spell' | 'ability' | 'aa'

export interface ProcStat {
  name: string
  origin: ProcOrigin
  count: number
  /** Damage the firings did; for Finishing Blow, the damage of the swings that procced. */
  damage: number
  /** Hit points the firings healed: a lifetap proc prints a damage line and a heal line for one firing. */
  healed: number
}

export interface Entity {
  name: string
  kind: EntityKind
  /** The owner's name, for a pet. */
  owner?: string
  out: Tally
  in: Tally
  /** Damage dealt, by skill or spell. */
  skills: Record<string, SkillStat>
  /** Damage dealt, by target. */
  targets: Record<string, Tally>
  /** Damage taken, by attacker. */
  attackers: Record<string, Tally>
  /** Damage taken, by skill or spell. */
  takenBy: Record<string, SkillStat>
  /** Effects that fired without being cast, by name. */
  procs: Record<string, ProcStat>
  defense: Defense
  healOut: HealTally
  healIn: HealTally
  healSpells: Record<string, HealTally>
  healTargets: Record<string, HealTally>
  healers: Record<string, HealTally>
  /** Absorption granted by runes. */
  runes: number
  casts: number
  /** Spells of this entity that a target resisted. */
  resisted: number
  kills: number
  deaths: number
  firstAt: number
  lastAt: number
  /** Time in combat: gaps between this entity's own hits, each capped at 3 s. */
  activeMs: number
  /** For activeMs; not shown. */
  lastHitAt: number
}

export type SegmentKind = 'fight' | 'session'

/** Damage per second of a fight, one entry per second from its start: you, your pets, the rest of your side, and damage to you. */
export interface Timeline {
  you: number[]
  pet: number[]
  group: number[]
  inc: number[]
}

/** A session's fights' timelines end to end, a short gap between them; `marks` say where each fight begins. */
export interface StitchedTimeline extends Timeline {
  marks: { at: number; name: string }[]
}

export interface Segment {
  id: string
  kind: SegmentKind
  name: string
  zone: string
  startedAt: number
  /** The last event's time. */
  endedAt: number
  open: boolean
  /** Time in combat across everyone: gaps between hits capped at 3 s. */
  activeMs: number
  /** For activeMs; not shown. */
  lastHitAt: number
  /** By lowercased name. */
  entities: Record<string, Entity>
  /** Enemies engaged, by lowercased name, and whether each still lives. */
  enemies: Record<string, boolean>
  kills: number
  /** Deaths on your side. */
  deaths: number
  /** Hit points enemies healed: damage undone. */
  enemyHeal: number
  /** You or your pet took part. */
  mine: boolean
  /** Fights only. */
  timeline?: Timeline
}

export interface SegmentSummary {
  id: string
  kind: SegmentKind
  name: string
  zone: string
  startedAt: number
  endedAt: number
  open: boolean
  /** Damage dealt by your side. */
  total: number
  dps: number
  /** Your own damage, pets folded in. */
  yours: number
  kills: number
  /** Deaths on your side. */
  deaths: number
  mine: boolean
}

export interface RosterMember {
  name: string
  /** How the tracker learned of them. */
  from: 'log' | 'you'
}

export interface CombatSnapshot {
  /** Newest first. */
  fights: SegmentSummary[]
  sessions: SegmentSummary[]
  liveFight: Segment | null
  /**
   * The open session, summed up: in a raid the whole of it runs to megabytes, too much to push twice
   * a second. A page showing it fetches it (combat:segment), every few seconds while it changes.
   */
  liveSession: SegmentSummary | null
  /** Your character's name, as the log spells it; '' until known. */
  self: string
  roster: RosterMember[]
  /** Your pets' names, the newest last. */
  pets: string[]
  /** Group members' pets: pet name → owner. */
  otherPets: Record<string, string>
  /** Lines the meter is still reading from the log, or ''. */
  reading: string
}
