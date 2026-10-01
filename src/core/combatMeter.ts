import { parseCombatLine, looksLikeCombat, SELF, type CombatEvent } from './combatLines'
import { zoneEntered, type LogLine } from './logLine'
import { ARTICLE, displayName, isFriend, nameKey, Roster } from './combatRoster'
import { book, stitch } from './combatTimeline'
import type { CombatSnapshot, DamageHow, Defense, Entity, EntityKind, HealTally, ProcOrigin, Segment, SegmentSummary, SkillStat, Tally, StitchedTimeline } from '../shared/types'

export { displayName, isFriend, nameKey } from './combatRoster'

// The damage meter: every combat line sorted into fights and sessions, per entity.
//
// A FIGHT opens on the first blow between your side and an enemy and closes when the last enemy it
// engaged dies, or when nobody has struck for `fightGapSec`. A SESSION is everything since the
// zone was entered (or "New session" was pressed); fights and sessions hold the same shape of
// data, so one view reads either. Who is on which side is the Roster's (combatRoster.ts); a fight's
// second-by-second damage, the timeline's (combatTimeline.ts).

/** A gap between an entity's hits counts as combat time up to this long. */
const ACTIVE_GAP_MS = 3000
/**
 * A spell effect landing this long after its cast line is the cast; later, or with no cast line at
 * all, it was fired by something else: a weapon, a buff, an ability. Long casts run to ten seconds.
 */
export const CAST_WINDOW_MS = 20_000
/** Abilities the game lists as ones you press, whose effect prints like a proc. */
const ACTIVATED = new Set(['reaving strike', 'harm touch', 'leech touch'])
const FIGHTS_KEPT = 300
/** Others' blows held at most on one enemy, while waiting to see whether your side joins in. */
const HELD_MAX = 2000
const SESSIONS_KEPT = 60
/**
 * How long a fight closed by its last enemy's death may be taken up again by another of the same
 * name: the log does not tell two "a ratman warrior"s apart, so a blow from or to one a second or more
 * after the first died is the second, still fighting, not a new pull. A line in the death's own second
 * may only be printed after it.
 */
export const SAME_NAME_MS = 4000

export interface MeterConfig {
  fightGapSec: number
  newSessionOnZone: boolean
  /** Follow charmed mobs as their charmers' pets. Off by default here; the app's setting turns it on. */
  charmPets?: boolean
  /**
   * What the log prints when a charm spell (as cast, rank and all) lands on a mob, after the mob's
   * name: " has been charmed.", or " moans." for the undead charms; undefined when it is no charm.
   */
  charmLand?: (spell: string) => string | undefined
}

export interface MeterHooks {
  onChange?: () => void
  onFightStart?: (fight: Segment) => void
  onFightEnd?: (fight: Segment) => void
}

/** "an ire ghast has been charmed." */
const RE_CHARMED = /^(.+) has been charmed\.$/
/** A charm lands within its cast time (Allure's is a few seconds) of the cast beginning. */
const CHARM_CAST_MS = 15_000
/** An invite older than this is not the one a "You have joined the group." answers. */
const INVITE_MS = 60_000

const tally = (): Tally => ({ total: 0, hits: 0, crits: 0, critTotal: 0, max: 0, min: 0 })
const healTally = (): HealTally => ({ total: 0, raw: 0, count: 0, crits: 0, max: 0 })
const skillStat = (name: string, how: DamageHow): SkillStat => ({ ...tally(), name, how, misses: 0, resists: 0, mods: {} })
const defense = (): Defense => ({ swings: 0, hit: 0, miss: 0, dodge: 0, parry: 0, block: 0, riposte: 0, absorb: 0 })

/** "Envenomed Bolt X" and "Envenomed Bolt" are one spell for matching a landing to its cast. */
export function spellBase(name: string): string {
  return name.replace(/ (?:[IVXL]+|\d+)$/, '').toLowerCase()
}

function newEntity(name: string, kind: EntityKind, owner: string | undefined, at: number): Entity {
  return {
    name,
    kind,
    ...(owner ? { owner } : {}),
    out: tally(),
    in: tally(),
    skills: {},
    targets: {},
    attackers: {},
    takenBy: {},
    procs: {},
    defense: defense(),
    healOut: healTally(),
    healIn: healTally(),
    healSpells: {},
    healTargets: {},
    healers: {},
    runes: 0,
    casts: 0,
    resisted: 0,
    kills: 0,
    deaths: 0,
    firstAt: at,
    lastAt: at,
    activeMs: 0,
    lastHitAt: 0
  }
}

function add(t: Tally, amount: number, crit: boolean): void {
  t.total += amount
  t.hits++
  if (crit) {
    t.crits++
    t.critTotal += amount
  }
  if (amount > t.max) t.max = amount
  if (t.min === 0 || amount < t.min) t.min = amount
}

function addHeal(h: HealTally, amount: number, raw: number, crit: boolean): void {
  h.total += amount
  h.raw += raw
  h.count++
  if (crit) h.crits++
  if (amount > h.max) h.max = amount
}

/** Counts a hit into an entity's or a segment's combat time: the gap since its last hit, capped. */
function active(o: { activeMs: number; lastHitAt: number }, at: number): void {
  o.activeMs += o.lastHitAt ? Math.max(0, Math.min(at - o.lastHitAt, ACTIVE_GAP_MS)) : 1000
  o.lastHitAt = at
}

export function durationMs(seg: Pick<Segment, 'startedAt' | 'endedAt'>): number {
  // Times are whole seconds; a fight whose first and last blows share a second lasted one.
  return Math.max(1000, seg.endedAt - seg.startedAt + 1000)
}

export class CombatMeter {
  private zone = ''
  /** Oldest first. */
  fights: Segment[] = []
  sessions: Segment[] = []
  private live: Segment | null = null
  /** The fight its last enemy's death closed, and when: another of those names may take it up again (SAME_NAME_MS). */
  private lastKilled: { fight: Segment; at: number } | null = null
  private session: Segment | null = null
  /** Who is who: you, your pets, your group, and the side each other name is on. */
  private readonly who = new Roster((k) => this.refreshKind(k))
  /** Who last invited you to a group, until you join one or the invite goes stale. */
  private invite: { who: string; at: number } | null = null
  /** When each entity last began casting each spell: "kelwyn|envenomed bolt" → time. */
  private lastCast = new Map<string, number>()
  /** When each entity's proc last did damage, by base name, so its heal line a moment later is the same firing. */
  private lastProc = new Map<string, number>()
  /** A proc's heal line counted as its firing before its damage line came (same second): the damage line pairs with it. */
  private healFiring = new Map<string, number>()
  /**
   * Charmed mobs, by the mob's name key. A charm pet has the mob's name, and other mobs may share it,
   * so its blows are told apart by where they land: on an enemy they are the pet's (mobs do not fight
   * each other), booked to `label`; on a friend they are an enemy's, and mean the charm has broken.
   */
  private charmed = new Map<string, { label: string; owners: string[]; since: number }>()
  /** The last spell a friend began casting: whoever it was charmed what "has been charmed" next. */
  private lastFriendCast: { who: string; at: number } | null = null
  /** Charm spells friends began casting, newest last, each with the line that says it landed. */
  private charmCasts: { who: string; at: number; land: string }[] = []
  /**
   * Blows between others, by enemy, held while that fight goes on (no gap longer than a fight's) in
   * case your side joins in on it: a raid's tank pulls well before the rest of it swings.
   */
  private held = new Map<string, { last: number; blows: { ev: Extract<CombatEvent, { kind: 'damage' | 'miss' }>; at: number }[] }>()
  /** When `held` was last cleared of fights gone quiet: once a second is enough, not every blow. */
  private heldPrunedAt = 0
  private replaying = false
  private seq = 0
  /** Summaries of closed fights and sessions, which do not change again: worked out once, not every push. */
  private readonly summaries = new WeakMap<Segment, SegmentSummary>()
  /** A note shown while the log's history is being read. */
  reading = ''

  constructor(
    private config: MeterConfig,
    private readonly hooks: MeterHooks = {}
  ) {}

  configure(config: MeterConfig): void {
    this.config = config
    if (!config.charmPets) this.charmed.clear()
  }

  get charmPets(): boolean {
    return !!this.config.charmPets
  }

  /** The character's name as the log spells it, so lines naming them ("Aldric healed Kelwyn") read as You. */
  setSelf(name: string): void {
    this.who.setSelf(name)
  }

  get currentZone(): string {
    return this.zone
  }

  /** The group's other members, as the log and the player have given them. */
  get groupMembers(): string[] {
    return [...this.who.members.values()].map((m) => m.name)
  }

  /** A fight is on. */
  get fighting(): boolean {
    return this.live !== null
  }

  /** Everything forgotten: another character's log is being watched. */
  reset(): void {
    this.fights = []
    this.sessions = []
    this.live = null
    this.lastKilled = null
    this.session = null
    this.who.clear()
    this.lastCast.clear()
    this.lastProc.clear()
    this.healFiring.clear()
    this.charmed.clear()
    this.lastFriendCast = null
    this.charmCasts = []
    this.held.clear()
    this.heldPrunedAt = 0
    this.zone = ''
    this.changed()
  }

  private changed(): void {
    this.hooks.onChange?.()
  }

  // ---- names and sides ----

  /** A name's kind as the meter has placed it: you, pet (and whose), group, player, mob. */
  kindOf(name: string): { kind: EntityKind; owner?: string } {
    return this.who.kindOf(name)
  }

  /**
   * Whether a blow is the meter's business: one your side gives or takes, one on an enemy your side
   * is fighting, or one by an ally of this fight (anyone who has fought its enemies: a raid, and the
   * adds it takes on). Other players' fights nearby are left out altogether: seen in passing
   * through a zone they are nothing to do with you, and counted they would open fights of their own
   * or keep yours from ever ending.
   */
  private counts(friend: string, enemy: string): boolean {
    if (this.replaying || this.who.ours(friend) || this.who.ours(enemy)) return true
    const f = this.live
    return !!f && (nameKey(enemy) in f.enemies || !!f.entities[nameKey(friend)])
  }

  /**
   * Sorts a blow: the meter's, or held for a fight's gap. When one of your side's lands on an enemy
   * others were already fighting (a raid's pull, a moment before you joined), their held blows on it
   * go in first, so the fight starts where it did.
   */
  private admit(ev: Extract<CombatEvent, { kind: 'damage' | 'miss' }>, at: number, friend: string, enemy: string): boolean {
    const gapMs = this.config.fightGapSec * 1000
    if (at - this.heldPrunedAt > 1000) {
      this.heldPrunedAt = at
      for (const [k, h] of this.held) if (at - h.last > gapMs) this.held.delete(k)
    }
    const k = nameKey(enemy)
    if (!this.counts(friend, enemy)) {
      const h = this.held.get(k) ?? { last: at, blows: [] }
      h.last = at
      h.blows.push({ ev, at })
      if (h.blows.length > HELD_MAX) h.blows.shift()
      this.held.set(k, h)
      return false
    }
    const h = this.replaying ? undefined : this.held.get(k)
    if (h) {
      this.held.delete(k)
      this.replaying = true
      try {
        for (const b of h.blows) {
          if (b.ev.kind === 'damage') this.onDamage(b.ev, b.at)
          else this.onMiss(b.ev, b.at)
        }
      } finally {
        this.replaying = false
      }
    }
    return true
  }

  /** A name's kind changed (a pet claimed, a stranger placed): every live entity of that name follows. */
  private refreshKind(k: string): void {
    for (const seg of [this.live, this.session]) {
      const e = seg?.entities[k]
      if (!e) continue
      const { kind, owner } = this.who.kindOf(e.name)
      e.kind = kind
      if (owner) e.owner = owner
      else delete e.owner
      if (seg && (kind === 'you' || (kind === 'pet' && owner === SELF))) seg.mine = true
    }
  }

  // ---- segments ----

  private ent(seg: Segment, name: string, at: number): Entity {
    const k = nameKey(name)
    let e = seg.entities[k]
    if (!e) {
      const { kind, owner } = this.who.kindOf(name)
      e = newEntity(name, kind, owner, at)
      seg.entities[k] = e
    }
    e.lastAt = Math.max(e.lastAt, at)
    return e
  }

  private newSegment(kind: Segment['kind'], at: number, name: string): Segment {
    return {
      id: `${kind[0]}${++this.seq}-${at}`,
      kind,
      name,
      zone: this.zone,
      startedAt: at,
      endedAt: at,
      open: true,
      activeMs: 0,
      lastHitAt: 0,
      entities: {},
      enemies: {},
      kills: 0,
      deaths: 0,
      enemyHeal: 0,
      mine: false,
      ...(kind === 'fight' ? { timeline: { you: [], pet: [], group: [], inc: [] } } : {})
    }
  }

  private ensureSession(at: number): Segment {
    if (!this.session) {
      this.session = this.newSegment('session', at, this.zone || 'Session')
      this.sessions.push(this.session)
      if (this.sessions.length > SESSIONS_KEPT) this.sessions.shift()
    }
    return this.session
  }

  private ensureFight(at: number): Segment {
    const gapMs = this.config.fightGapSec * 1000
    if (this.live && at - this.live.endedAt > gapMs) this.closeFight()
    if (!this.live) {
      this.live = this.newSegment('fight', at, '')
      this.fights.push(this.live)
      if (this.fights.length > FIGHTS_KEPT) this.fights.shift()
      this.hooks.onFightStart?.(this.live)
    }
    return this.live
  }

  private closeFight(): void {
    const f = this.live
    if (!f) return
    f.open = false
    f.name = fightName(f)
    this.live = null
    this.hooks.onFightEnd?.(f)
    this.changed()
  }

  /** Closes the session and starts a new one from `at`, named after the zone unless given a name. */
  newSession(at: number, name = ''): Segment {
    if (this.session) {
      this.session.open = false
      if (!this.session.name) this.session.name = this.session.zone || 'Session'
    }
    this.session = null
    const s = this.ensureSession(at)
    if (name) s.name = name
    this.changed()
    return s
  }

  /** The session a moment falls in, opened if there is none: what loot at that moment is filed under. */
  sessionAt(at: number): Segment {
    return this.ensureSession(at)
  }

  /** The fight ends when nobody has struck for the gap; called on a clock, since the log goes quiet too. */
  tick(now: number): void {
    if (this.live && now - this.live.endedAt > this.config.fightGapSec * 1000) this.closeFight()
  }

  onZone(zone: string, at: number): void {
    if (this.live) this.closeFight()
    this.lastKilled = null
    // Charm does not survive a zone line.
    this.charmed.clear()
    this.zone = zone
    if (this.config.newSessionOnZone || !this.session) this.newSession(at, zone)
  }

  // ---- lines ----

  /** Reads one line; returns the combat event in it, if any, for others that follow the same lines. */
  handle(line: LogLine): CombatEvent | null {
    const { text, time } = line
    const zone = zoneEntered(text)
    if (zone) {
      this.onZone(zone, time)
      return null
    }
    if (this.charmCasts.length && this.charmLanded(text, time)) return null
    const charm = text.endsWith(' has been charmed.') ? RE_CHARMED.exec(text) : null
    if (charm) {
      const cast = this.lastFriendCast
      if (cast && time - cast.at <= CHARM_CAST_MS && time >= cast.at) this.onCharm(charm[1], cast.who, time)
      return null
    }
    if (!looksLikeCombat(text)) return null
    const ev = parseCombatLine(text)
    if (ev) this.event(ev, time)
    return ev
  }

  // ---- charm pets ----

  /**
   * "<mob> moans." after a friend began casting Cajole Undead: the landing of the newest charm cast
   * whose spell prints that line. A friend's heal begun in between does not take the pet.
   */
  private charmLanded(text: string, at: number): boolean {
    this.charmCasts = this.charmCasts.filter((c) => at - c.at <= CHARM_CAST_MS)
    for (let i = this.charmCasts.length - 1; i >= 0; i--) {
      const c = this.charmCasts[i]
      if (at < c.at || text.length <= c.land.length || !text.endsWith(c.land)) continue
      this.charmCasts.splice(i, 1)
      this.onCharm(text.slice(0, -c.land.length), c.who, at)
      return true
    }
    return false
  }

  /** A charm landed on `mob`: from now it is `who`'s pet. */
  private onCharm(mob: string, who: string, at: number): void {
    if (!this.config.charmPets) return
    // One pet at a time: a new charm ends the charmer's last one.
    for (const [k, c] of this.charmed) if (c.owners.includes(who) && k !== nameKey(mob)) this.charmed.delete(k)
    const label = `${displayName(mob)} (charmed)`
    // Two charmers of mobs with one name: the log cannot tell their pets apart, so the pet is theirs
    // together, a row of its own rather than a share of either's.
    const had = this.charmed.get(nameKey(mob))
    const owners = had && !had.owners.includes(who) ? [...had.owners, who] : [who]
    this.charmed.set(nameKey(mob), { label, owners, since: at })
    this.who.pets.set(nameKey(label), owners.join(' or '))
    this.refreshKind(nameKey(label))
    this.changed()
  }

  /**
   * A blow, miss or heal involving a charmed mob's name, rewritten to its pet label where the pet is
   * the one meant: its blows on enemies, enemies' blows on it, friends' heals on it. Its blows on a
   * friend stay an enemy's, and end the charm: the pet has turned.
   */
  private charmEvent(ev: CombatEvent): CombatEvent {
    if (!this.charmed.size || (ev.kind !== 'damage' && ev.kind !== 'miss' && ev.kind !== 'heal')) return ev
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

  /** A charmed mob dead at an enemy's hand, or of its own accord, was the pet. */
  private charmDeath(ev: Extract<CombatEvent, { kind: 'kill' }>): Extract<CombatEvent, { kind: 'kill' }> {
    const c = this.charmed.get(nameKey(ev.target))
    if (!c) return ev
    const killer = ev.killer ? this.who.sideOf(this.who.norm(ev.killer)) : 'enemy'
    if (killer === 'friend') return ev
    this.charmed.delete(nameKey(ev.target))
    return { ...ev, target: c.label }
  }

  event(input: CombatEvent, at: number): void {
    const ev = input.kind === 'kill' ? this.charmDeath(input) : this.charmEvent(input)
    switch (ev.kind) {
      case 'damage':
        return this.onDamage(ev, at)
      case 'miss':
        return this.onMiss(ev, at)
      case 'heal':
        return this.onHeal(ev, at)
      case 'rune': {
        const target = this.who.norm(ev.target)
        for (const seg of this.liveSegments(at, false)) this.ent(seg, target, at).runes += ev.amount
        return this.changed()
      }
      case 'kill':
        return this.onKill(ev, at)
      case 'resist':
        return this.onResist(ev, at)
      case 'pet': {
        // "a gnoll told you, 'Attacking … Master.'" is a charmed mob: claiming its name would make
        // every gnoll a pet. Charms are followed from the charm spell's landing line instead.
        if (ARTICLE.test(ev.pet)) return
        const owner = this.who.norm(ev.owner)
        this.who.pets.set(nameKey(ev.pet), owner)
        this.who.sides.delete(nameKey(ev.pet))
        this.refreshKind(nameKey(ev.pet))
        return this.changed()
      }
      case 'group':
        return this.onGroup(ev, at)
      case 'cast': {
        const source = this.who.norm(ev.source)
        this.lastCast.set(`${nameKey(source)}|${spellBase(ev.spell)}`, at)
        if (this.lastCast.size > 4000) this.lastCast.delete(this.lastCast.keys().next().value!)
        // Anyone not an enemy may be the one a charm that lands next belongs to.
        if (this.who.sideOf(source) !== 'enemy') {
          this.lastFriendCast = { who: source, at }
          const land = this.config.charmPets ? this.config.charmLand?.(ev.spell) : undefined
          if (land) this.charmCasts.push({ who: source, at, land })
        }
        if (this.who.sideOf(source) !== 'friend') return
        for (const seg of this.liveSegments(at, false)) this.ent(seg, source, at).casts++
        return
      }
    }
  }

  /** A spell effect of a friend's with no cast line of theirs within the window was fired by something. */
  private procOrigin(source: string, spell: string, at: number): ProcOrigin | null {
    const base = spellBase(spell)
    const cast = this.lastCast.get(`${nameKey(source)}|${base}`)
    if (cast !== undefined && at - cast <= CAST_WINDOW_MS && at >= cast) return null
    return ACTIVATED.has(base) ? 'ability' : 'spell'
  }

  /**
   * Books one proc line. A lifetap's damage line carries the rank ("Lifebite III") and its heal line
   * may not ("Lifebite"): one proc, found by its base name and named as the damage line has it.
   */
  private static proc(e: Entity, name: string, origin: ProcOrigin, damage: number, healed: number, firing: boolean): void {
    const base = spellBase(name)
    const had = e.procs[name] ? name : Object.keys(e.procs).find((k) => spellBase(k) === base)
    let p = had ? e.procs[had] : undefined
    if (p && had !== name && damage > 0) {
      delete e.procs[had!]
      p.name = name
      e.procs[name] = p
    }
    p ??= e.procs[name] = { name, origin, count: 0, damage: 0, healed: 0 }
    if (firing) p.count++
    p.damage += damage
    p.healed += healed
  }

  /** A lifetap's later tick heals into the proc row its first firing opened, without counting another firing. */
  private static tapTick(e: Entity, spell: string, healed: number): void {
    const base = spellBase(spell)
    const had = Object.keys(e.procs).find((k) => spellBase(k) === base)
    if (had) e.procs[had].healed += healed
  }

  /** The segments an event lands in: the session, and the fight (opened if `combat` says the event is one). */
  private liveSegments(at: number, combat: boolean): Segment[] {
    const out = [this.ensureSession(at)]
    if (combat) out.push(this.ensureFight(at))
    else if (this.live) out.push(this.live)
    return out
  }

  private onDamage(ev: Extract<CombatEvent, { kind: 'damage' }>, at: number): void {
    if (!ev.source) return this.onUncredited(ev, at)
    const target = this.who.norm(ev.target)
    const source = this.who.norm(ev.source)
    const [ss, ts] = this.who.place(source, target, true)
    if (ss === 'unknown' || ts === 'unknown' || ss === ts) return
    if (!this.admit(ev, at, ss === 'friend' ? source : target, ss === 'enemy' ? source : target)) return
    const closed = this.afterKill(at, ss === 'enemy' ? source : target)
    const crit = ev.mods.includes('critical')
    const proc = ss === 'friend' && ev.how === 'spell' ? this.procOrigin(source, ev.skill, at) : null
    const procKey = `${nameKey(source)}|${spellBase(ev.skill)}`
    // A lifetap whose heal line came first already counted this firing.
    const paired = !!proc && Math.abs(at - (this.healFiring.get(procKey) ?? -Infinity)) <= 1000
    if (paired) this.healFiring.delete(procKey)
    if (proc) this.lastProc.set(procKey, at)
    const finishing = ev.how === 'melee' && ev.mods.includes('finishing blow')
    for (const seg of closed ? [this.ensureSession(at), closed] : this.liveSegments(at, true)) {
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      add(src.out, ev.amount, crit)
      if (proc) CombatMeter.proc(src, ev.skill, proc, ev.amount, 0, !paired)
      if (finishing) CombatMeter.proc(src, 'Finishing Blow', 'aa', ev.amount, 0, true)
      const skill = (src.skills[ev.skill] ??= skillStat(ev.skill, ev.how))
      add(skill, ev.amount, crit)
      for (const m of ev.mods) skill.mods[m] = (skill.mods[m] ?? 0) + 1
      add((src.targets[target] ??= tally()), ev.amount, crit)
      add(tgt.in, ev.amount, crit)
      add((tgt.attackers[source] ??= tally()), ev.amount, crit)
      add((tgt.takenBy[ev.skill] ??= skillStat(ev.skill, ev.how)), ev.amount, crit)
      if (ev.how === 'melee') {
        tgt.defense.swings++
        tgt.defense.hit++
      }
      active(src, at)
      active(seg, at)
      const enemy = ss === 'enemy' ? source : target
      if (seg !== closed) seg.enemies[nameKey(enemy)] = true
      if (src.kind === 'you' || tgt.kind === 'you' || (src.kind === 'pet' && src.owner === SELF)) seg.mine = true
      seg.endedAt = Math.max(seg.endedAt, at)
      if (src.kind === 'you') book(seg, at, 'you', ev.amount)
      else if (src.kind === 'pet' && src.owner === SELF) book(seg, at, 'pet', ev.amount)
      else if (ss === 'friend') book(seg, at, 'group', ev.amount)
      if (tgt.kind === 'you') book(seg, at, 'inc', ev.amount)
    }
    this.changed()
  }

  /**
   * A DoT tick whose caster has died or left: "Jobarab has taken 30 damage by Deadly Poison." It is
   * damage its target took, with nobody to credit, on a target the segment already knows (yours, or
   * an enemy it engaged). It opens no fight and names none.
   */
  private onUncredited(ev: Extract<CombatEvent, { kind: 'damage' }>, at: number): void {
    const target = this.who.norm(ev.target)
    const side = this.who.sideOf(target)
    if (side === 'unknown') return
    const k = nameKey(target)
    const crit = ev.mods.includes('critical')
    let booked = false
    for (const seg of this.liveSegments(at, false)) {
      if (side === 'enemy' ? !(k in seg.enemies) : !this.who.ours(target) && !seg.entities[k]) continue
      const tgt = this.ent(seg, target, at)
      add(tgt.in, ev.amount, crit)
      add((tgt.takenBy[ev.skill] ??= skillStat(ev.skill, ev.how)), ev.amount, crit)
      if (tgt.kind === 'you') book(seg, at, 'inc', ev.amount)
      booked = true
    }
    if (booked) this.changed()
  }

  private onMiss(ev: Extract<CombatEvent, { kind: 'miss' }>, at: number): void {
    const source = this.who.norm(ev.source)
    const target = this.who.norm(ev.target)
    const [ss, ts] = this.who.place(source, target, true)
    if (ss === 'unknown' || ts === 'unknown' || ss === ts) return
    if (!this.admit(ev, at, ss === 'friend' ? source : target, ss === 'enemy' ? source : target)) return
    const closed = this.afterKill(at, ss === 'enemy' ? source : target)
    for (const seg of closed ? [this.ensureSession(at), closed] : this.liveSegments(at, true)) {
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      const skill = (src.skills[ev.skill] ??= skillStat(ev.skill, 'melee'))
      skill.misses++
      for (const m of ev.mods) skill.mods[m] = (skill.mods[m] ?? 0) + 1
      tgt.defense.swings++
      tgt.defense[ev.outcome]++
      active(src, at)
      active(seg, at)
      if (seg !== closed) seg.enemies[nameKey(ss === 'enemy' ? source : target)] = true
      if (src.kind === 'you' || tgt.kind === 'you' || (src.kind === 'pet' && src.owner === SELF)) seg.mine = true
      seg.endedAt = Math.max(seg.endedAt, at)
    }
    this.changed()
  }

  private onHeal(ev: Extract<CombatEvent, { kind: 'heal' }>, at: number): void {
    let source = this.who.norm(ev.source)
    const target = this.who.norm(ev.target)
    let [ss, ts] = this.who.place(source, target, false)
    // A lifetap ticking on an enemy heals its caster, and the log names the enemy as the healer:
    // "Innoruuk, the Prince of Hate healed you for 451 hit points by Leech Touch I." Enemies do not
    // heal your side, so the heal is the target's own, a tick of the ability that started it.
    const tap = ss === 'enemy' && ts === 'friend'
    if (tap) {
      source = target
      ss = ts
    }
    if (ss === 'unknown' || ts === 'unknown' || ss !== ts) return
    const crit = ev.mods.includes('critical')
    // A heal over time ticks long after its cast; only a direct heal can be a proc. A lifetap's heal
    // line follows its damage line: the same firing, not another.
    const proc = ss === 'friend' && !ev.hot && !tap ? this.procOrigin(source, ev.spell, at) : null
    const procKey = `${nameKey(source)}|${spellBase(ev.spell)}`
    const firing = !!proc && Math.abs(at - (this.lastProc.get(procKey) ?? -Infinity)) > 1000
    if (firing) this.healFiring.set(procKey, at)
    const ours = this.who.ours(source) || this.who.ours(target)
    for (const seg of this.liveSegments(at, false)) {
      // A heal between strangers is no more yours than their fight: it counts once either is in the segment.
      if (!ours && !seg.entities[nameKey(source)] && !seg.entities[nameKey(target)]) continue
      if (ss === 'enemy') {
        // Only a fight cares what the enemy healed: it is damage undone.
        if (seg.kind === 'fight') seg.enemyHeal += ev.amount
        continue
      }
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      if (proc) CombatMeter.proc(src, ev.spell, proc, 0, ev.amount, firing)
      if (tap) CombatMeter.tapTick(src, ev.spell, ev.amount)
      addHeal(src.healOut, ev.amount, ev.raw, crit)
      addHeal((src.healSpells[ev.spell] ??= healTally()), ev.amount, ev.raw, crit)
      addHeal((src.healTargets[target] ??= healTally()), ev.amount, ev.raw, crit)
      addHeal(tgt.healIn, ev.amount, ev.raw, crit)
      addHeal((tgt.healers[source] ??= healTally()), ev.amount, ev.raw, crit)
      // A heal is not a blow: it neither opens a fight nor extends one.
    }
    this.changed()
  }

  private onKill(ev: Extract<CombatEvent, { kind: 'kill' }>, at: number): void {
    const target = this.who.norm(ev.target)
    const killer = ev.killer ? this.who.norm(ev.killer) : null
    if (killer) this.who.place(killer, target, true)
    const side = this.who.sideOf(target)
    if (side === 'unknown') return
    const k = nameKey(target)
    for (const seg of this.liveSegments(at, false)) {
      if (side === 'enemy') {
        if (!(k in seg.enemies)) continue
        seg.kills++
        if (killer && this.who.sideOf(killer) === 'friend') this.ent(seg, killer, at).kills++
        if (k in seg.enemies) seg.enemies[k] = false
      } else {
        // Your side's deaths, and those of anyone who fought in the segment; not every player who
        // dies somewhere in the zone.
        if (!this.who.ours(target) && !seg.entities[k]) continue
        seg.deaths++
        if (seg.entities[k]) seg.entities[k].deaths++
        else if (seg.kind === 'session' || target === SELF) this.ent(seg, target, at).deaths++
      }
    }
    // The fight is over when nothing it engaged still stands, unless another of a name it engaged
    // strikes or is struck soon after (sameName).
    if (side === 'enemy' && this.live && k in this.live.enemies && !Object.values(this.live.enemies).some(Boolean)) {
      this.live.endedAt = Math.max(this.live.endedAt, at)
      const fight = this.live
      this.closeFight()
      this.lastKilled = { fight, at }
    }
    this.changed()
  }

  /**
   * A blow from or to `enemy` after a fight closed on its last enemy's death. In the death's own second
   * and of a name it engaged, it is that fight's, printed after the death: returned, to be booked there
   * with the fight left closed. From the next second to SAME_NAME_MS, of a name it engaged, it is
   * another of that name still fighting: the fight is taken up again. Any other blow, or one later,
   * leaves it closed for good.
   */
  private afterKill(at: number, enemy: string): Segment | null {
    const last = this.lastKilled
    if (!last) return null
    if (this.live) {
      this.lastKilled = null
      return null
    }
    const k = nameKey(enemy)
    const engaged = k in last.fight.enemies
    if (at <= last.at) return engaged ? last.fight : null
    this.lastKilled = null
    if (!engaged || at - last.at > Math.min(SAME_NAME_MS, this.config.fightGapSec * 1000)) return null
    const f = last.fight
    f.open = true
    f.enemies[k] = true
    this.live = f
    this.changed()
    return null
  }

  private onResist(ev: Extract<CombatEvent, { kind: 'resist' }>, at: number): void {
    const source = this.who.norm(ev.source)
    const target = this.who.norm(ev.target)
    const [ss, ts] = this.who.place(source, target, true)
    if (ss !== 'friend' || ts !== 'enemy') return
    for (const seg of this.liveSegments(at, false)) {
      const src = this.ent(seg, source, at)
      src.resisted++
      ;(src.skills[ev.spell] ??= skillStat(ev.spell, 'spell')).resists++
    }
    this.changed()
  }

  private onGroup(ev: Extract<CombatEvent, { kind: 'group' }>, at: number): void {
    const k = nameKey(ev.who)
    if (ev.action === 'joined') {
      this.who.members.set(k, { name: ev.who, from: 'log' })
      this.who.sides.delete(k)
      this.refreshKind(k)
    } else if (ev.action === 'invited') {
      this.invite = { who: ev.who, at }
    } else if (ev.action === 'youJoined') {
      // Joining within a minute of an invite is accepting it: the inviter is in the group with you.
      // Forming your own group prints the same line, with no invite before it.
      if (this.invite && at - this.invite.at <= INVITE_MS) {
        const ik = nameKey(this.invite.who)
        this.who.members.set(ik, { name: this.invite.who, from: 'log' })
        this.who.sides.delete(ik)
        this.refreshKind(ik)
      }
      this.invite = null
    } else if (ev.action === 'left') {
      // Out of the group, but still a person.
      if (this.who.members.get(k)?.from === 'log') this.who.members.delete(k)
      if (!this.who.members.has(k)) this.who.sides.set(k, 'friend')
      this.refreshKind(k)
    } else if (ev.action === 'youLeft') {
      this.invite = null
      for (const [key, m] of [...this.who.members]) {
        if (m.from !== 'log') continue
        this.who.members.delete(key)
        this.who.sides.set(key, 'friend')
        this.refreshKind(key)
      }
    }
    this.changed()
  }

  // ---- the roster, by hand ----

  addMember(name: string): void {
    const clean = name.trim()
    if (!clean) return
    this.who.members.set(nameKey(clean), { name: clean, from: 'you' })
    this.refreshKind(nameKey(clean))
    this.changed()
  }

  removeMember(name: string): void {
    this.who.members.delete(nameKey(name))
    this.refreshKind(nameKey(name))
    this.changed()
  }

  /** Everyone out, the log's members and the hand-added alike: the group has changed and the log missed it. */
  clearGroup(): void {
    this.invite = null
    for (const [key] of [...this.who.members]) {
      this.who.members.delete(key)
      this.who.sides.set(key, 'friend')
      this.refreshKind(key)
    }
    this.changed()
  }

  // ---- views ----

  segment(id: string): Segment | null {
    return this.fights.find((f) => f.id === id) ?? this.sessions.find((s) => s.id === id) ?? null
  }

  /** A session's DPS over time: its fights' timelines end to end (stitch). */
  sessionTimeline(id: string): StitchedTimeline | null {
    const s = this.sessions.find((x) => x.id === id) ?? (this.session?.id === id ? this.session : null)
    if (!s) return null
    const end = s.open ? Infinity : s.endedAt
    return stitch(this.fights.filter((f) => f.startedAt >= s.startedAt && f.startedAt <= end))
  }

  /** A fight's or session's summary; a closed one's is kept, since nothing changes it after it closes. */
  summaryOf(seg: Segment): SegmentSummary {
    if (seg.open) return summarize(seg)
    let s = this.summaries.get(seg)
    if (!s) this.summaries.set(seg, (s = summarize(seg)))
    return s
  }

  get liveFight(): Segment | null {
    return this.live
  }

  get liveSession(): Segment | null {
    return this.session
  }

  snapshot(): CombatSnapshot {
    const pets: string[] = []
    const otherPets: Record<string, string> = {}
    for (const [k, owner] of this.who.pets) {
      const name = this.session?.entities[k]?.name ?? this.live?.entities[k]?.name ?? k
      if (owner === SELF) pets.push(name)
      else otherPets[name] = owner
    }
    return {
      fights: [...this.fights].reverse().map((s) => this.summaryOf(s)),
      sessions: [...this.sessions].reverse().map((s) => this.summaryOf(s)),
      liveFight: this.live,
      liveSession: this.session ? this.summaryOf(this.session) : null,
      self: this.who.selfName,
      roster: [...this.who.members.values()],
      pets,
      otherPets,
      reading: this.reading
    }
  }
}

/** The enemy that took the most, plus how many others: "a fetid fiend +2". */
export function fightName(seg: Segment): string {
  const enemies = Object.keys(seg.enemies)
    .map((k) => seg.entities[k])
    .filter((e): e is Entity => !!e)
    .sort((a, b) => b.in.total - a.in.total || a.firstAt - b.firstAt)
  if (!enemies.length) return seg.name || 'Fight'
  return enemies.length > 1 ? `${enemies[0].name} +${enemies.length - 1}` : enemies[0].name
}

export function summarize(seg: Segment): SegmentSummary {
  let total = 0
  let yours = 0
  for (const e of Object.values(seg.entities)) {
    if (!isFriend(e.kind)) continue
    total += e.out.total
    if (e.kind === 'you' || (e.kind === 'pet' && e.owner === SELF)) yours += e.out.total
  }
  return {
    id: seg.id,
    kind: seg.kind,
    name: seg.kind === 'fight' ? fightName(seg) : seg.name || seg.zone || 'Session',
    zone: seg.zone,
    startedAt: seg.startedAt,
    endedAt: seg.endedAt,
    open: seg.open,
    total,
    dps: total / (durationMs(seg) / 1000),
    yours,
    kills: seg.kills,
    deaths: seg.deaths,
    mine: seg.mine
  }
}
