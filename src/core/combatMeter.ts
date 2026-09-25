import { parseCombatLine, looksLikeCombat, SELF, type CombatEvent } from './combatLines'
import { zoneEntered, type LogLine } from './logLine'
import type {
  CombatSnapshot, DamageHow, Defense, Entity, EntityKind, HealTally, ProcOrigin, RosterMember, Segment, SegmentSummary, SkillStat, Tally
} from '../shared/types'

// The damage meter: every combat line sorted into fights and sessions, per entity.
//
// A FIGHT opens on the first blow between your side and an enemy and closes when the last enemy it
// engaged dies, or when nobody has struck for `fightGapSec`. A SESSION is everything since the
// zone was entered (or "New session" was pressed); fights and sessions hold the same shape of
// data, so one view reads either.
//
// SIDES. You, your pets and your group are yours; a name with an article ("a fetid fiend"), a
// named mob ("Cleric of Innoruuk") and a mob's pet ("a scareling pet") are enemies. A single
// capitalised word could be a player or a named mob (Phoboplasm); it is placed by whom it hits or
// heals, and remembered. Nothing between two unknowns, or two names on the same side, is counted.

/** A gap between an entity's hits counts as combat time up to this long. */
export const ACTIVE_GAP_MS = 3000
/**
 * A spell effect landing this long after its cast line is the cast; later, or with no cast line at
 * all, it was fired by something else: a weapon, a buff, an ability. Long casts run to ten seconds.
 */
export const CAST_WINDOW_MS = 20_000
/** Abilities the game lists as ones you press, whose effect prints like a proc. */
const ACTIVATED = new Set(['reaving strike', 'harm touch', 'leech touch'])
const FIGHTS_KEPT = 300
const SESSIONS_KEPT = 60
/** A fight's per-second timeline stops growing past an hour. */
const TIMELINE_MAX = 3600

export interface MeterConfig {
  fightGapSec: number
  newSessionOnZone: boolean
  /** Follow charmed mobs as their charmers' pets. Off by default here; the app's setting turns it on. */
  charmPets?: boolean
}

export interface MeterHooks {
  onChange?: () => void
  onFightStart?: (fight: Segment) => void
  onFightEnd?: (fight: Segment) => void
}

type Side = 'friend' | 'enemy' | 'unknown'

export const nameKey = (name: string): string => name.toLowerCase()

/** "a fetid fiend" as the log prints it mid-sentence → "A fetid fiend", as it prints it first. */
export function displayName(name: string): string {
  return /^(?:a|an|the) /.test(name) ? name[0].toUpperCase() + name.slice(1) : name
}

const ARTICLE = /^(?:a|an|the) /i
const SINGLE_WORD = /^[A-Z][A-Za-z`']*$/
/** "an ire ghast has been charmed." */
const RE_CHARMED = /^(.+) has been charmed\.$/
/** A charm lands within its cast time (Allure's is a few seconds) of the cast beginning. */
const CHARM_CAST_MS = 15_000

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
    name, kind, ...(owner ? { owner } : {}),
    out: tally(), in: tally(), skills: {}, targets: {}, attackers: {}, takenBy: {}, procs: {}, defense: defense(),
    healOut: healTally(), healIn: healTally(), healSpells: {}, healTargets: {}, healers: {},
    runes: 0, casts: 0, resisted: 0, kills: 0, deaths: 0, firstAt: at, lastAt: at, activeMs: 0, lastHitAt: 0
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

export function isFriend(kind: EntityKind): boolean {
  return kind === 'you' || kind === 'pet' || kind === 'group' || kind === 'player'
}

export class CombatMeter {
  private self = ''
  private selfKey = ''
  private zone = ''
  /** Oldest first. */
  fights: Segment[] = []
  sessions: Segment[] = []
  private live: Segment | null = null
  private session: Segment | null = null
  /** Pet name key → owner's name (SELF for yours). */
  private pets = new Map<string, string>()
  private roster = new Map<string, RosterMember>()
  /** Which side a single-word name turned out to be on. */
  private sides = new Map<string, Side>()
  /** When each entity last began casting each spell: "kelwyn|envenomed bolt" → time. */
  private lastCast = new Map<string, number>()
  /** When each entity's proc last did damage, by name, so its heal line a moment later is the same firing. */
  private lastProc = new Map<string, number>()
  /**
   * Charmed mobs, by the mob's name key. A charm pet has the mob's name, and other mobs may share it,
   * so its blows are told apart by where they land: on an enemy they are the pet's (mobs do not fight
   * each other), booked to `label`; on a friend they are an enemy's, and mean the charm has broken.
   */
  private charmed = new Map<string, { label: string; owners: string[]; since: number }>()
  /** The last spell a friend began casting: whoever it was charmed what "has been charmed" next. */
  private lastFriendCast: { who: string; at: number } | null = null
  private seq = 0
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
    this.self = name
    this.selfKey = nameKey(name)
  }

  get currentZone(): string {
    return this.zone
  }

  /** The group's other members, as the log and the player have given them. */
  get groupMembers(): string[] {
    return [...this.roster.values()].map((m) => m.name)
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
    this.session = null
    this.pets.clear()
    this.roster.clear()
    this.sides.clear()
    this.lastCast.clear()
    this.lastProc.clear()
    this.charmed.clear()
    this.lastFriendCast = null
    this.zone = ''
    this.changed()
  }

  private changed(): void {
    this.hooks.onChange?.()
  }

  // ---- names and sides ----

  private norm(name: string): string {
    if (name === SELF) return SELF
    if (this.selfKey && nameKey(name) === this.selfKey) return SELF
    return displayName(name)
  }

  kindOf(name: string): { kind: EntityKind; owner?: string } {
    if (name === SELF) return { kind: 'you' }
    const k = nameKey(name)
    const owner = this.pets.get(k)
    if (owner) return { kind: 'pet', owner }
    if (this.roster.has(k)) return { kind: 'group' }
    if (k.endsWith(' pet')) return { kind: 'npcpet' }
    if (ARTICLE.test(name)) return { kind: 'npc' }
    if (!SINGLE_WORD.test(name)) return { kind: 'npc' }
    const side = this.sides.get(k)
    return { kind: side === 'friend' ? 'player' : side === 'enemy' ? 'npc' : 'unknown' }
  }

  private sideOf(name: string): Side {
    const { kind } = this.kindOf(name)
    return isFriend(kind) ? 'friend' : kind === 'unknown' ? 'unknown' : 'enemy'
  }

  private learn(name: string, side: Side): void {
    if (side === 'unknown') return
    const k = nameKey(name)
    if (this.sides.get(k) === side) return
    this.sides.set(k, side)
    this.refreshKind(k)
  }

  /** A name's kind changed (a pet claimed, a stranger placed): every live entity of that name follows. */
  private refreshKind(k: string): void {
    for (const seg of [this.live, this.session]) {
      const e = seg?.entities[k]
      if (!e) continue
      const { kind, owner } = this.kindOf(e.name)
      e.kind = kind
      if (owner) e.owner = owner
      else delete e.owner
      if (seg && (kind === 'you' || (kind === 'pet' && owner === SELF))) seg.mine = true
    }
  }

  /**
   * Places two names on opposite sides (a blow) or the same side (a heal) when one is known and the
   * other is not. Returns the sides after learning.
   */
  private place(a: string, b: string, opposite: boolean): [Side, Side] {
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

  // ---- segments ----

  private ent(seg: Segment, name: string, at: number): Entity {
    const k = nameKey(name)
    let e = seg.entities[k]
    if (!e) {
      const { kind, owner } = this.kindOf(name)
      e = newEntity(name, kind, owner, at)
      seg.entities[k] = e
    }
    e.lastAt = Math.max(e.lastAt, at)
    return e
  }

  private newSegment(kind: Segment['kind'], at: number, name: string): Segment {
    return {
      id: `${kind[0]}${++this.seq}-${at}`, kind, name, zone: this.zone, startedAt: at, endedAt: at, open: true,
      activeMs: 0, lastHitAt: 0, entities: {}, enemies: {}, kills: 0, deaths: 0, enemyHeal: 0, mine: false,
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
    const charm = RE_CHARMED.exec(text)
    if (charm) {
      this.onCharm(charm[1], time)
      return null
    }
    if (!looksLikeCombat(text)) return null
    const ev = parseCombatLine(text)
    if (ev) this.event(ev, time)
    return ev
  }

  // ---- charm pets ----

  /** "<mob> has been charmed.": the pet of the friend who began casting just before, if one did. */
  private onCharm(mob: string, at: number): void {
    if (!this.config.charmPets) return
    const cast = this.lastFriendCast
    if (!cast || at - cast.at > CHARM_CAST_MS || at < cast.at) return
    // One pet at a time: a new charm ends the charmer's last one.
    for (const [k, c] of this.charmed) if (c.owners.includes(cast.who) && k !== nameKey(mob)) this.charmed.delete(k)
    const label = `${displayName(mob)} (charmed)`
    // Two charmers of mobs with one name: the log cannot tell their pets apart, so the pet is theirs
    // together, a row of its own rather than a share of either's.
    const had = this.charmed.get(nameKey(mob))
    const owners = had && !had.owners.includes(cast.who) ? [...had.owners, cast.who] : [cast.who]
    this.charmed.set(nameKey(mob), { label, owners, since: at })
    this.pets.set(nameKey(label), owners.join(' or '))
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
      const side = nameKey(ev.source) === nameKey(ev.target) ? 'enemy' : this.sideOf(this.norm(ev.target))
      if (side === 'friend') {
        this.charmed.delete(nameKey(ev.source))
        return ev
      }
      if (side === 'enemy') out = { ...out, source: src.label }
    }
    if (tgt && out.source !== tgt.label) {
      const side = out.source ? this.sideOf(this.norm(out.source)) : 'unknown'
      const same = nameKey(out.source) === nameKey(ev.target)
      if (!same && (ev.kind === 'heal' ? side === 'friend' : side === 'enemy')) out = { ...out, target: tgt.label }
    }
    return out
  }

  /** A charmed mob dead at an enemy's hand, or of its own accord, was the pet. */
  private charmDeath(ev: Extract<CombatEvent, { kind: 'kill' }>): Extract<CombatEvent, { kind: 'kill' }> {
    const c = this.charmed.get(nameKey(ev.target))
    if (!c) return ev
    const killer = ev.killer ? this.sideOf(this.norm(ev.killer)) : 'enemy'
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
        const target = this.norm(ev.target)
        for (const seg of this.liveSegments(at, false)) this.ent(seg, target, at).runes += ev.amount
        return this.changed()
      }
      case 'kill':
        return this.onKill(ev, at)
      case 'resist':
        return this.onResist(ev, at)
      case 'pet': {
        // "a gnoll told you, 'Attacking … Master.'" is a charmed mob: claiming its name would make
        // every gnoll a pet. Charms are followed from "has been charmed" instead.
        if (ARTICLE.test(ev.pet)) return
        const owner = this.norm(ev.owner)
        this.pets.set(nameKey(ev.pet), owner)
        this.sides.delete(nameKey(ev.pet))
        this.refreshKind(nameKey(ev.pet))
        return this.changed()
      }
      case 'group':
        return this.onGroup(ev)
      case 'cast': {
        const source = this.norm(ev.source)
        this.lastCast.set(`${nameKey(source)}|${spellBase(ev.spell)}`, at)
        if (this.lastCast.size > 4000) this.lastCast.delete(this.lastCast.keys().next().value!)
        // Anyone not an enemy may be the one a charm that lands next belongs to.
        if (this.sideOf(source) !== 'enemy') this.lastFriendCast = { who: source, at }
        if (this.sideOf(source) !== 'friend') return
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

  private static proc(e: Entity, name: string, origin: ProcOrigin, damage: number, healed: number, firing: boolean): void {
    const p = (e.procs[name] ??= { name, origin, count: 0, damage: 0, healed: 0 })
    if (firing) p.count++
    p.damage += damage
    p.healed += healed
  }

  /** The segments an event lands in: the session, and the fight (opened if `combat` says the event is one). */
  private liveSegments(at: number, combat: boolean): Segment[] {
    const out = [this.ensureSession(at)]
    if (combat) out.push(this.ensureFight(at))
    else if (this.live) out.push(this.live)
    return out
  }

  private onDamage(ev: Extract<CombatEvent, { kind: 'damage' }>, at: number): void {
    const target = this.norm(ev.target)
    // A tick with no caster named ("Jobarab has taken 30 damage by Deadly Poison.") is booked to the spell.
    const source = ev.source ? this.norm(ev.source) : ev.skill
    const [ss, ts] = this.place(source, target, true)
    if (ss === 'unknown' || ts === 'unknown' || ss === ts) return
    const crit = ev.mods.includes('critical')
    const proc = ss === 'friend' && ev.how === 'spell' ? this.procOrigin(source, ev.skill, at) : null
    if (proc) this.lastProc.set(`${nameKey(source)}|${ev.skill}`, at)
    const finishing = ev.how === 'melee' && ev.mods.includes('finishing blow')
    for (const seg of this.liveSegments(at, true)) {
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      add(src.out, ev.amount, crit)
      if (proc) CombatMeter.proc(src, ev.skill, proc, ev.amount, 0, true)
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
      seg.enemies[nameKey(enemy)] = true
      if (src.kind === 'you' || tgt.kind === 'you' || (src.kind === 'pet' && src.owner === SELF)) seg.mine = true
      seg.endedAt = Math.max(seg.endedAt, at)
      if (seg.timeline) {
        const b = Math.floor((at - seg.startedAt) / 1000)
        if (b >= 0 && b < TIMELINE_MAX) {
          const tl = seg.timeline
          if (src.kind === 'you') tl.you[b] = (tl.you[b] ?? 0) + ev.amount
          else if (src.kind === 'pet' && src.owner === SELF) tl.pet[b] = (tl.pet[b] ?? 0) + ev.amount
          else if (ss === 'friend') tl.group[b] = (tl.group[b] ?? 0) + ev.amount
          if (tgt.kind === 'you') tl.inc[b] = (tl.inc[b] ?? 0) + ev.amount
        }
      }
    }
    this.changed()
  }

  private onMiss(ev: Extract<CombatEvent, { kind: 'miss' }>, at: number): void {
    const source = this.norm(ev.source)
    const target = this.norm(ev.target)
    const [ss, ts] = this.place(source, target, true)
    if (ss === 'unknown' || ts === 'unknown' || ss === ts) return
    for (const seg of this.liveSegments(at, true)) {
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      const skill = (src.skills[ev.skill] ??= skillStat(ev.skill, 'melee'))
      skill.misses++
      for (const m of ev.mods) skill.mods[m] = (skill.mods[m] ?? 0) + 1
      tgt.defense.swings++
      tgt.defense[ev.outcome]++
      active(src, at)
      active(seg, at)
      seg.enemies[nameKey(ss === 'enemy' ? source : target)] = true
      if (src.kind === 'you' || tgt.kind === 'you' || (src.kind === 'pet' && src.owner === SELF)) seg.mine = true
      seg.endedAt = Math.max(seg.endedAt, at)
    }
    this.changed()
  }

  private onHeal(ev: Extract<CombatEvent, { kind: 'heal' }>, at: number): void {
    const source = this.norm(ev.source)
    const target = this.norm(ev.target)
    const [ss, ts] = this.place(source, target, false)
    if (ss === 'unknown' || ts === 'unknown' || ss !== ts) return
    const crit = ev.mods.includes('critical')
    // A heal over time ticks long after its cast; only a direct heal can be a proc. A lifetap's heal
    // line follows its damage line: the same firing, not another.
    const proc = ss === 'friend' && !ev.hot ? this.procOrigin(source, ev.spell, at) : null
    const firing = !!proc && Math.abs(at - (this.lastProc.get(`${nameKey(source)}|${ev.spell}`) ?? -Infinity)) > 1000
    for (const seg of this.liveSegments(at, false)) {
      if (ss === 'enemy') {
        // Only a fight cares what the enemy healed: it is damage undone.
        if (seg.kind === 'fight') seg.enemyHeal += ev.amount
        continue
      }
      const src = this.ent(seg, source, at)
      const tgt = this.ent(seg, target, at)
      if (proc) CombatMeter.proc(src, ev.spell, proc, 0, ev.amount, firing)
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
    const target = this.norm(ev.target)
    const killer = ev.killer ? this.norm(ev.killer) : null
    if (killer) this.place(killer, target, true)
    const side = this.sideOf(target)
    if (side === 'unknown') return
    const k = nameKey(target)
    for (const seg of this.liveSegments(at, false)) {
      if (side === 'enemy') {
        if (seg.kind === 'fight' && !(k in seg.enemies)) continue
        seg.kills++
        if (killer && this.sideOf(killer) === 'friend') this.ent(seg, killer, at).kills++
        if (k in seg.enemies) seg.enemies[k] = false
      } else {
        seg.deaths++
        if (seg.entities[k]) seg.entities[k].deaths++
        else if (seg.kind === 'session' || target === SELF) this.ent(seg, target, at).deaths++
      }
    }
    // The fight is over when nothing it engaged still stands.
    if (side === 'enemy' && this.live && k in this.live.enemies && !Object.values(this.live.enemies).some(Boolean)) {
      this.live.endedAt = Math.max(this.live.endedAt, at)
      this.closeFight()
    }
    this.changed()
  }

  private onResist(ev: Extract<CombatEvent, { kind: 'resist' }>, at: number): void {
    const source = this.norm(ev.source)
    const target = this.norm(ev.target)
    const [ss, ts] = this.place(source, target, true)
    if (ss !== 'friend' || ts !== 'enemy') return
    for (const seg of this.liveSegments(at, false)) {
      const src = this.ent(seg, source, at)
      src.resisted++
      ;(src.skills[ev.spell] ??= skillStat(ev.spell, 'spell')).resists++
    }
    this.changed()
  }

  private onGroup(ev: Extract<CombatEvent, { kind: 'group' }>): void {
    const k = nameKey(ev.who)
    if (ev.action === 'joined') {
      this.roster.set(k, { name: ev.who, from: 'log' })
      this.sides.delete(k)
      this.refreshKind(k)
    } else if (ev.action === 'left') {
      // Out of the group, but still a person.
      if (this.roster.get(k)?.from === 'log') this.roster.delete(k)
      if (!this.roster.has(k)) this.sides.set(k, 'friend')
      this.refreshKind(k)
    } else if (ev.action === 'youLeft') {
      for (const [key, m] of [...this.roster]) {
        if (m.from !== 'log') continue
        this.roster.delete(key)
        this.sides.set(key, 'friend')
        this.refreshKind(key)
      }
    }
    this.changed()
  }

  // ---- the roster, by hand ----

  addMember(name: string): void {
    const clean = name.trim()
    if (!clean) return
    this.roster.set(nameKey(clean), { name: clean, from: 'you' })
    this.refreshKind(nameKey(clean))
    this.changed()
  }

  removeMember(name: string): void {
    this.roster.delete(nameKey(name))
    this.refreshKind(nameKey(name))
    this.changed()
  }

  // ---- views ----

  segment(id: string): Segment | null {
    return this.fights.find((f) => f.id === id) ?? this.sessions.find((s) => s.id === id) ?? null
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
    for (const [k, owner] of this.pets) {
      const name = this.session?.entities[k]?.name ?? this.live?.entities[k]?.name ?? k
      if (owner === SELF) pets.push(name)
      else otherPets[name] = owner
    }
    return {
      fights: [...this.fights].reverse().map(summarize),
      sessions: [...this.sessions].reverse().map(summarize),
      liveFight: this.live,
      liveSession: this.session,
      self: this.self,
      roster: [...this.roster.values()],
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
    id: seg.id, kind: seg.kind, name: seg.kind === 'fight' ? fightName(seg) : seg.name || seg.zone || 'Session', zone: seg.zone,
    startedAt: seg.startedAt, endedAt: seg.endedAt, open: seg.open,
    total, dps: total / (durationMs(seg) / 1000), yours, kills: seg.kills, mine: seg.mine
  }
}
