import type { CombatEvent } from './combatLines'
import { displayName, nameKey, type Roster } from './combatRoster'

// Charmed mobs followed as their charmers' pets, for the damage meter (LT-638: out of combatMeter.ts).
// A charm pet has the mob's name, and other mobs may share it, so its blows are told apart by where
// they land: on an enemy they are the pet's (mobs do not fight each other), booked to its label; on a
// friend they are an enemy's, and mean the charm has broken.

/** "an ire ghast has been charmed." */
const RE_CHARMED = /^(.+) has been charmed\.$/
/** A charm lands within its cast time (Allure's is a few seconds) of the cast beginning. */
const CHARM_CAST_MS = 15_000

export class CharmWatch {
  /** Charmed mobs, by the mob's name key: the pet's label, its charmers and since when. */
  private readonly charmed = new Map<string, { label: string; owners: string[]; since: number }>()
  /** The last spell a friend began casting: whoever it was charmed what "has been charmed" next. */
  private lastFriendCast: { who: string; at: number } | null = null
  /** Charm spells friends began casting, newest last, each with the line that says it landed. */
  private casts: { who: string; at: number; land: string }[] = []

  constructor(
    private readonly who: Roster,
    private readonly on: {
      /** Whether charms are followed at all (the app's setting). */
      enabled: () => boolean
      /** A pet label was claimed for its charmers: the meter's entities of that name follow. */
      claimed: (labelKey: string) => void
    }
  ) {}

  /** Every charm forgotten: a zone line (charm does not survive one), the setting turned off, another log. */
  clear(all = false): void {
    this.charmed.clear()
    if (!all) return
    this.lastFriendCast = null
    this.casts = []
  }

  /** A friend began casting `spell`; `land` is what the log prints after the mob's name when it is a charm that lands. */
  cast(who: string, at: number, land: string | undefined): void {
    this.lastFriendCast = { who, at }
    if (land) this.casts.push({ who, at, land })
  }

  /** A line that is a charm landing ("… has been charmed.", "<mob> moans."): taken, and true. */
  line(text: string, at: number): boolean {
    if (this.casts.length && this.landed(text, at)) return true
    const charm = text.endsWith(' has been charmed.') ? RE_CHARMED.exec(text) : null
    if (!charm) return false
    const cast = this.lastFriendCast
    if (cast && at - cast.at <= CHARM_CAST_MS && at >= cast.at) this.charm(charm[1], cast.who, at)
    return true
  }

  /**
   * "<mob> moans." after a friend began casting Cajole Undead: the landing of the newest charm cast
   * whose spell prints that line. A friend's heal begun in between does not take the pet.
   */
  private landed(text: string, at: number): boolean {
    this.casts = this.casts.filter((c) => at - c.at <= CHARM_CAST_MS)
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i]
      if (at < c.at || text.length <= c.land.length || !text.endsWith(c.land)) continue
      this.casts.splice(i, 1)
      this.charm(text.slice(0, -c.land.length), c.who, at)
      return true
    }
    return false
  }

  /** A charm landed on `mob`: from now it is `who`'s pet. */
  private charm(mob: string, who: string, at: number): void {
    if (!this.on.enabled()) return
    // One pet at a time: a new charm ends the charmer's last one.
    for (const [k, c] of this.charmed) if (c.owners.includes(who) && k !== nameKey(mob)) this.charmed.delete(k)
    const label = `${displayName(mob)} (charmed)`
    // Two charmers of mobs with one name: the log cannot tell their pets apart, so the pet is theirs
    // together, a row of its own rather than a share of either's.
    const had = this.charmed.get(nameKey(mob))
    const owners = had && !had.owners.includes(who) ? [...had.owners, who] : [who]
    this.charmed.set(nameKey(mob), { label, owners, since: at })
    this.who.pets.set(nameKey(label), owners.join(' or '))
    this.on.claimed(nameKey(label))
  }

  /**
   * A blow, miss or heal involving a charmed mob's name, rewritten to its pet label where the pet is
   * the one meant: its blows on enemies, enemies' blows on it, friends' heals on it. Its blows on a
   * friend stay an enemy's, and end the charm: the pet has turned. A charmed mob dead at an enemy's
   * hand, or of its own accord, was the pet.
   */
  event(ev: CombatEvent): CombatEvent {
    if (!this.charmed.size) return ev
    if (ev.kind === 'kill') {
      const c = this.charmed.get(nameKey(ev.target))
      if (!c) return ev
      const killer = ev.killer ? this.who.sideOf(this.who.norm(ev.killer)) : 'enemy'
      if (killer === 'friend') return ev
      this.charmed.delete(nameKey(ev.target))
      return { ...ev, target: c.label }
    }
    if (ev.kind !== 'damage' && ev.kind !== 'miss' && ev.kind !== 'heal') return ev
    const src = ev.source ? this.charmed.get(nameKey(ev.source)) : undefined
    const tgt = this.charmed.get(nameKey(ev.target))
    if (!src && !tgt) return ev
    let out = ev
    if (src && ev.kind !== 'heal') {
      const side = nameKey(ev.source) === nameKey(ev.target) ? 'enemy' : this.who.sideOf(this.who.norm(ev.target))
      if (side === 'friend') {
        this.charmed.delete(nameKey(ev.source))
        return ev
      }
      if (side === 'enemy') out = { ...out, source: src.label }
    }
    if (tgt && out.source !== tgt.label) {
      const side = out.source ? this.who.sideOf(this.who.norm(out.source)) : 'unknown'
      const same = nameKey(out.source) === nameKey(ev.target)
      if (!same && (ev.kind === 'heal' ? side === 'friend' : side === 'enemy')) out = { ...out, target: tgt.label }
    }
    return out
  }
}
