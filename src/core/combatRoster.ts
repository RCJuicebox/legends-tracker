import { SELF } from './combatLines'
import type { EntityKind, RosterMember } from '../shared/types'

// Who is who for the damage meter: you, your pets, your group, and which side every other name
// turned out to be on.
//
// SIDES. You, your pets and your group are yours; a name with an article ("a fetid fiend"), a
// named mob ("Cleric of Innoruuk") and a mob's pet ("a scareling pet") are enemies. A single
// capitalised word could be a player or a named mob (Phoboplasm); it is placed by whom it hits or
// heals, and remembered. Nothing between two unknowns, or two names on the same side, is counted.

export type Side = 'friend' | 'enemy' | 'unknown'

export const nameKey = (name: string): string => name.toLowerCase()

/** "a fetid fiend" as the log prints it mid-sentence → "A fetid fiend", as it prints it first. */
export function displayName(name: string): string {
  return /^(?:a|an|the) /.test(name) ? name[0].toUpperCase() + name.slice(1) : name
}

export function isFriend(kind: EntityKind): boolean {
  return kind === 'you' || kind === 'pet' || kind === 'group' || kind === 'player'
}

/** A name that starts with an article is a mob's: "a gnoll". */
export const ARTICLE = /^(?:a|an|the) /i
/** A beastlord's warder, a pet or a familiar named for its owner: "Jobarab`s warder". */
const OWNED_PET = /^([A-Z][a-z]+)`s (?:warder|pet|familiar)$/
const SINGLE_WORD = /^[A-Z][A-Za-z`']*$/

const SIDES_KEPT = 5000

export class Roster {
  private self = ''
  private selfKey = ''
  /** Pet name key → owner's name (SELF for yours). */
  readonly pets = new Map<string, string>()
  /** Your group, by name key. */
  readonly members = new Map<string, RosterMember>()
  /**
   * Which side a single-word name turned out to be on. The longest unasked go past SIDES_KEPT (a
   * name seen again is placed again as it fights), so an evening of raid zones does not keep them all.
   */
  readonly sides = new Map<string, Side>()

  /** `changed` hears of a name whose kind may have changed (a stranger placed), so what shows it can follow. */
  constructor(private readonly changed: (key: string) => void) {}

  /** The character's name as the log spells it, so lines naming them ("Aldric healed Kelwyn") read as You. */
  setSelf(name: string): void {
    this.self = name
    this.selfKey = nameKey(name)
  }

  get selfName(): string {
    return this.self
  }

  /** Everyone forgotten: another character's log. */
  clear(): void {
    this.pets.clear()
    this.members.clear()
    this.sides.clear()
  }

  /** A name as the meter keeps it: you as SELF, a mob as the log prints it first. */
  norm(name: string): string {
    if (name === SELF) return SELF
    if (this.selfKey && nameKey(name) === this.selfKey) return SELF
    return displayName(name)
  }

  kindOf(name: string): { kind: EntityKind; owner?: string } {
    if (name === SELF) return { kind: 'you' }
    const k = nameKey(name)
    const owner = this.pets.get(k)
    if (owner) return { kind: 'pet', owner }
    if (this.members.has(k)) return { kind: 'group' }
    // A warder is its owner's from its first blow, before any "/pet who leader" says so; unless the
    // owner is a mob.
    const own = OWNED_PET.exec(name)
    if (own && this.sides.get(nameKey(own[1])) !== 'enemy') return { kind: 'pet', owner: this.norm(own[1]) }
    if (k.endsWith(' pet')) return { kind: 'npcpet' }
    if (ARTICLE.test(name)) return { kind: 'npc' }
    if (!SINGLE_WORD.test(name)) return { kind: 'npc' }
    const side = this.sides.get(k)
    return { kind: side === 'friend' ? 'player' : side === 'enemy' ? 'npc' : 'unknown' }
  }

  /** You, your pet, and your group and their pets (a pet two charmed is either's): the side the meter is about. */
  ours(name: string): boolean {
    const { kind, owner } = this.kindOf(name)
    if (kind === 'you' || kind === 'group') return true
    return kind === 'pet' && !!owner && owner.split(' or ').some((o) => o === SELF || this.members.has(nameKey(o)))
  }

  sideOf(name: string): Side {
    const { kind } = this.kindOf(name)
    return isFriend(kind) ? 'friend' : kind === 'unknown' ? 'unknown' : 'enemy'
  }

  learn(name: string, side: Side): void {
    if (side === 'unknown') return
    const k = nameKey(name)
    if (this.sides.get(k) === side) return
    this.sides.delete(k)
    this.sides.set(k, side)
    if (this.sides.size > SIDES_KEPT) this.sides.delete(this.sides.keys().next().value!)
    this.changed(k)
  }

  /**
   * Places two names on opposite sides (a blow) or the same side (a heal) when one is known and the
   * other is not. Returns the sides after learning.
   */
  place(a: string, b: string, opposite: boolean): [Side, Side] {
    let sa = this.sideOf(a)
    let sb = this.sideOf(b)
    const flip = (s: Side): Side => (s === 'friend' ? 'enemy' : s === 'enemy' ? 'friend' : 'unknown')
    if (sa === 'unknown' && sb !== 'unknown') {
      this.learn(a, opposite ? flip(sb) : sb)
      sa = this.sideOf(a)
    } else if (sb === 'unknown' && sa !== 'unknown') {
      this.learn(b, opposite ? flip(sa) : sa)
      sb = this.sideOf(b)
    }
    return [sa, sb]
  }
}
