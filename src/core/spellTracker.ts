import { castable } from './spells'
import { zoneEntered, type LogLine } from './logLine'
import type { RankedSpell, Spell, SpellBook } from './spells'
import { isBeneficialCategory, TICK_MS } from './durations'
import type { BoardTimer, TimerBoard } from './timers'
import type { DurationBreakdown, FeedItem, Notification, SpellCategory, SpellRule, TrackingSettings } from '../shared/types'
import { CAST_BY_OTHER, CAST_BY_YOU, DIED, RESISTED_YOUR, SLAIN_BY, SLAIN_BY_YOU, YOU_DIED, YOU_WERE_SLAIN } from './phrases'
import { SPA } from '../shared/game/spa'

export type TimerKind = 'selfBuff' | 'otherBuff' | 'dot' | 'debuff'

export interface TrackerConfig {
  tracking: TrackingSettings
  durationFor: (spell: Spell, rank: number) => DurationBreakdown
  ruleFor: (baseName: string) => SpellRule
}

export interface TrackerHooks {
  notify: (n: Notification[]) => void
  feed: (kind: FeedItem['kind'], text: string) => void
  onZone?: (zone: string) => void
  onCast?: (r: RankedSpell, at: number) => void
  /** Whether a name the log gives as a caster is a pet the damage meter knows: never another player. */
  isPet?: (name: string) => boolean
  /** Whether a name is your own pet, as the roster knows it: whom "Your pet's X spell has worn off." is about. */
  isYourPet?: (name: string) => boolean
  /** The buffs the character casts (the newest rank of each, from the casts kept): what Quick Buff can land. */
  quickBuffs?: () => RankedSpell[]
}

/** "You activate Quick Buff.": Legends casts the character's buffs with no cast line, only the landings. */
export const QUICK_BUFF = 'You activate Quick Buff.'
/** The game's own warning that invisibility is about to end. */
const APPEARING = 'You feel yourself starting to appear.'
/** How long after Quick Buff its landings are taken as the character's own casts. */
export const QUICK_BUFF_MS = 15_000

interface PendingCast {
  r: RankedSpell
  at: number
  expires: number
  targets: Set<string>
  /** Another player's cast (a rule with `others`); yours when absent. */
  caster?: string
}

export const CATEGORY_COLORS: Record<SpellCategory, string> = {
  buff: '#3fb6a8',
  hot: '#6cc46c',
  heal: '#6cc46c',
  dot: '#b46ae0',
  debuff: '#e0a03a',
  mez: '#e05ab4',
  charm: '#e05a5a',
  nuke: '#e07a4a'
}

const SELF = 'You'
/** Said when another player's cast of a spell with `others` lands, unless the rule has its own words. */
export const DEFAULT_OTHERS_SPEECH = '{caster} cast {spell} on {target}, do not cast for {seconds} seconds'
/**
 * An estimated timer ends at the earliest its spell can wear off; the real fade comes up to one tick
 * later. One whose fade line never arrives (the log was missed, or the target left) is dropped once
 * this has passed as well.
 */
const GRACE_MS = 14000
/**
 * A recast at least this long gets a "ready again" bar (FEAT-024). The spell file's field 10 is the recast
 * (Harm Touch 72 min, Lay on Hands 70, Divine Aura 15, Gate 8 s); shorter ones would only crowd the bars.
 * Legends' ranked abilities (Harm Touch X) have none there, so they stay trigger timers.
 */
export const COOLDOWN_MIN_MS = 30_000
/** A ready-again bar's colour: grey, apart from the spell categories'. */
const COOLDOWN_COLOR = '#8d939c'
/** How long after a beneficial spell first lands other targets may still report it: group buffs land in the same second. */
const GROUP_LAND_MS = 1500
/** A cast stays open this long past its cast time for its landing line: lag, and the tick it lands in. */
const CAST_SLACK_MS = 6000
/** Casts still waiting to land, at most; the oldest is dropped past this. */
const MAX_PENDING = 6
/** The longest silence before a zone line taken as its loading screen (seen 7 to 23 s); longer was idling first. */
const ZONE_LOAD_MAX_MS = 60_000

const RE_CAST = CAST_BY_YOU
const RE_FAIL_NAMED = /^Your (.+?) spell (?:is interrupted|fizzles)[.!]$/
const RE_FAIL = /^Your spell (?:is interrupted|fizzles)[.!]$/
/** "Your Infusion of Spirit spell did not take hold on Elund. (Blocked by Harnessing of Spirit.)": Legends says what blocked it. */
const RE_NO_HOLD_NAMED = /^Your (.+?) spell did not take hold(?: on (.+?))?\.(?: \(Blocked by .+\.\))?$/
/** "Your Blade Dance spell on Innoruuk, the Prince of Hate has been overwritten." */
const RE_OVERWRITTEN = /^Your (.+?) spell on (.+) has been overwritten\.$/
// Older clients: "Your target resisted the X spell." Legends: "a ratman warrior resisted your Envenomed Bolt X!"
const RE_RESIST = /^Your target resisted the (.+) spell\.$/
const RE_RESISTED_YOUR = RESISTED_YOUR
/** Resists in a row on one target, of spells you cast, before it is said (LT-722). */
const RESIST_STREAK = 3
const FAIL_PREFIXES = [
  'Your spell did not take hold',
  'Your spell would not have taken hold',
  'You must first select a target',
  'Your target is out of range',
  'You cannot see your target',
  'Your target is immune',
  'Your target cannot be'
]
/** Attempts the game refuses before they begin: no cast line, so only a cast of yours begun that same second can be the one refused (LT-517). */
const REFUSALS = ['Insufficient Mana', "You can't cast spells while stunned"]
/** The casting skills of bard songs (brass, singing, stringed, wind, percussion): a song lands again on each pulse. */
const SONG_SKILLS = new Set([12, 41, 49, 54, 70])
const isSong = (s: Spell) => SONG_SKILLS.has(s.skill)
// A tick that crits ends "(Critical)", as combatLines reads it.
const RE_DOT_TICK = /^(.+?) has taken ([\d,]+) damage from your (.+?)\.(?: \((.+)\))?$/
/** "A forsaken revenant has taken 451 damage from Harm Touch X by Fenwick.": another player's DoT ticking. */
const RE_DOT_TICK_OTHER = /^(.+?) has taken ([\d,]+) damage from (.+?) by (.+?)\.(?: \((.+)\))?$/
const RE_WORN_OFF = /^Your (.+) spell has worn off of (.+)\.$/
const RE_PET_WORN_OFF = /^Your pet's (.+) spell has worn off\.$/
const RE_SLAIN_BY = SLAIN_BY
const RE_YOU_SLEW = SLAIN_BY_YOU
const RE_DIED = DIED
const youDied = (text: string) => YOU_DIED.test(text) || YOU_WERE_SLAIN.test(text)

function targetKey(target: string): string {
  return target.toLowerCase()
}

export function timerKey(spellName: string, target: string): string {
  return `spell:${spellName}|${targetKey(target)}`
}

function renderSpeech(template: string, spell: string, target: string, caster = '', seconds = 0): string {
  return template
    .replace(/\{spell\}/gi, spell)
    .replace(/\{target\}/gi, target === SELF ? 'you' : target)
    .replace(/\{caster\}/gi, caster)
    .replace(/\{seconds\}/gi, String(seconds))
}

/**
 * Whether a caster the log names is another player: one capitalised word, as player names are. A
 * mob's name has an article or several words ("An ire ghast", "Phinigel Autropos"), and a pet is
 * "Name`s pet".
 */
function isPlayer(caster: string): boolean {
  return /^[A-Z][a-z]+$/.test(caster)
}

/**
 * Follows your own casts through the log and keeps a timer per spell per target.
 *
 * 1. `You begin casting X.` opens a pending cast.
 * 2. The spell's own landing text (from spells_us_str) names the target and starts the timer. Only
 *    spells you are casting are considered, which tells your landing apart from anyone else's.
 * 3. A DoT's first tick line pins its end exactly: it wears off on its target's tick, the Spell
 *    window's whole ticks after the first one: (ticks − 1) here, `ticks` counting the partial tick
 *    (docs/formulas.md, Spell durations).
 * 4. The fade line, the target dying, or a zone change ends it.
 *
 * A spell whose rule has `others` is timed for other players' casts too, on the same bar: their
 * "begins casting" and the landing text, or their ticks ("… from X by Caster."), with a word spoken
 * as it lands. For a spell a mob carries only one of (Harm Touch), so nobody casts over another's.
 */
export class SpellTracker {
  private pending: PendingCast[] = []
  /** The last spell you began casting, by both its names, and until when a resist can be of that cast. */
  private lastCast: { names: string[]; until: number } | null = null
  private zone = ''
  /** Quick Buff was activated: until when its landings are yours, which buffs they may be, and which have been counted as a cast. */
  private quick: { until: number; spells: RankedSpell[]; counted: Set<string> } | null = null
  /** Songs running on you, by their landing text: each pulse lands again and runs the timer on (LT-521). */
  private songs = new Map<string, { key: string; seconds: number }>()
  /** Your spells resisted in a row, by target, until one lands on it; -1 once said, until it dies (LT-722). */
  private readonly resists = new Map<string, number>()
  /** The time of the last line read: a zone line's gap from it is the load, when buffs stand still. */
  private lastLineAt = 0

  constructor(
    private readonly book: SpellBook,
    private readonly board: TimerBoard,
    private config: TrackerConfig,
    private readonly hooks: TrackerHooks
  ) {}

  configure(config: TrackerConfig): void {
    this.config = config
  }

  get currentZone(): string {
    return this.zone
  }

  /** Whether the line was one the tracker reads (FEAT-025): a cast, a landing, a tick, a fade, a death, a zone. */
  handle(line: LogLine): boolean {
    const { text, time: now } = line
    const prevAt = this.lastLineAt || now
    this.lastLineAt = now
    if (this.pending.length) this.pending = this.pending.filter((p) => p.expires >= now)

    let m = RE_CAST.exec(text)
    if (m) return took(this.onCast(m[1], now))
    if (text === QUICK_BUFF) return took(this.onQuickBuff(now))
    if (text.includes(' begins ') && (m = CAST_BY_OTHER.exec(text))) return took(this.onOtherCast(m[1], m[2], now))

    if ((m = RE_FAIL_NAMED.exec(text))) return took(this.dropPending(m[1]), this.takeBackCooldown(now))
    if (RE_FAIL.test(text)) return took(this.dropOwn(), this.takeBackCooldown(now))
    if (text.startsWith('Your ')) {
      if ((m = RE_NO_HOLD_NAMED.exec(text))) return took(this.onNoHold(m[1]))
      if ((m = RE_OVERWRITTEN.exec(text))) return took(this.onOverwritten(m[1], m[2], now))
    }
    const yours = text.includes(' resisted your ') ? RE_RESISTED_YOUR.exec(text) : null
    const resisted = RE_RESIST.exec(text)?.[1] ?? yours?.[2]
    if (resisted) {
      // Said only of a spell you cast: a weapon's proc resisted is not worth a warning.
      const cast = this.lastCast && now <= this.lastCast.until && this.lastCast.names.includes(resisted)
      // A game event, not the app's trouble: info, so main.log's WARN lines are the app's own (LT-606).
      if (this.dropPending(resisted) || cast) {
        this.hooks.feed('info', `${resisted} resisted`)
        if (yours) this.resistedOn(yours[1], resisted)
      }
      return true
    }
    if (FAIL_PREFIXES.some((p) => text.startsWith(p))) return took(this.dropOwn(), this.takeBackCooldown(now))
    if (REFUSALS.some((p) => text.startsWith(p))) return took(this.dropOwn(now), this.takeBackCooldown(now))

    if (this.tryLand(text, now)) return true
    if (this.songs.size && this.onSongPulse(text, now)) return true
    if (this.quick) {
      if (this.quick.until < now) this.quick = null
      else if (this.tryQuickLand(text, now)) return true
    }

    // Each "^(.+) …" pattern backtracks over the whole line, so a cheap look for its fixed words goes first.
    if (text.includes(' damage from ')) {
      if (text.includes(' damage from your ') && (m = RE_DOT_TICK.exec(text))) return took(this.onDotTick(m[1], m[3], now, undefined, amount(m[2])))
      if ((m = RE_DOT_TICK_OTHER.exec(text)) && this.otherPlayer(m[4])) return took(this.onDotTick(m[1], m[3], now, m[4], amount(m[2])))
    }
    if (text.startsWith('Your ')) {
      if ((m = RE_WORN_OFF.exec(text))) return took(this.onWornOff(m[1], m[2], now))
      if ((m = RE_PET_WORN_OFF.exec(text))) return took(this.onPetWornOff(m[1]))
    }

    // Invisibility is about to drop: its bar ends here, in silence (the shipped "Invis dropping" trigger speaks); its fade line follows (LT-717).
    if (text === APPEARING) {
      for (const t of this.board.endWhere((t) => t.source === 'spell' && t.target === SELF && !!t.untilActed, 'faded')) this.hooks.feed('fade', `${named(t)} is dropping`)
      return true
    }
    // Your own death first: "You died." would otherwise be read as a target called "You" dying.
    if (text.startsWith('You ') && youDied(text)) {
      this.board.endWhere((t) => t.source === 'spell' && t.target === SELF, 'died')
      return true
    }
    if (
      (text.includes(' has been slain by ') && (m = RE_SLAIN_BY.exec(text))) ||
      (text.startsWith('You have slain ') && (m = RE_YOU_SLEW.exec(text))) ||
      (text.endsWith(' died.') && (m = RE_DIED.exec(text)))
    ) {
      const k = targetKey(m[1])
      this.board.endWhere((t) => t.source === 'spell' && targetKey(t.target) === k, 'died')
      this.resists.delete(k)
      return true
    }
    const zone = zoneEntered(text)
    if (zone) {
      this.zone = zone
      this.pending = []
      this.resists.clear()
      // Mobs do not follow you; buffs do, and stand still while the zone loads: the log's silence
      // before "You have entered" (LT-718: 53 of 60 Puma bars that ran out with no fade had zoned, and
      // with the load taken off their fades fall on the unzoned median).
      // A recast runs on through a zone (FEAT-024).
      this.board.endWhere((t) => t.source === 'spell' && !isBeneficialTimer(t) && !isCooldown(t), 'zoned')
      this.board.delay((t) => t.source === 'spell' && isBeneficialTimer(t) && t.startedAt <= prevAt, Math.min(Math.max(0, now - prevAt), ZONE_LOAD_MAX_MS))
      this.hooks.onZone?.(zone)
      return true
    }
    return this.onSelfFade(text)
  }

  setZone(zone: string): void {
    this.zone = zone
  }

  /** The cooldown the cast begun last started, until its cast is over: a fizzle or an interruption takes it back. */
  private castCooldown: { key: string; until: number } | null = null

  private onCast(name: string, now: number): void {
    const r = this.book.resolve(name)
    if (!r) return
    this.hooks.onCast?.(r, now)
    this.startCooldown(r, now)
    this.lastCast = { names: [r.spell.name, r.rankedName], until: now + r.spell.castMs + CAST_SLACK_MS }
    const d = this.config.durationFor(r.spell, r.rank)
    if (d.ticks === 0 || d.permanent) return
    this.pending.push({ r, at: now, expires: now + r.spell.castMs + CAST_SLACK_MS, targets: new Set() })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
  }

  /**
   * Quick Buff: the character's buffs land with no cast line of their own. For a while, a landing of a
   * buff the character casts is its own cast: timed, counted, with "You" as its caster.
   */
  private onQuickBuff(now: number): void {
    const spells = this.hooks.quickBuffs?.() ?? []
    this.quick = spells.length ? { until: now + QUICK_BUFF_MS, spells, counted: new Set() } : null
  }

  private tryQuickLand(text: string, now: number): boolean {
    const q = this.quick!
    for (const r of q.spells) {
      const s = r.spell
      let target: string | null = null
      if (s.landSelf && text === s.landSelf) target = SELF
      else if (s.landOther && text.length > s.landOther.length && text.endsWith(s.landOther)) target = text.slice(0, text.length - s.landOther.length).trim()
      if (!target) continue
      // One cast a spell an activation, whoever it lands on (a group buff lands on each).
      if (!q.counted.has(s.name)) {
        q.counted.add(s.name)
        this.hooks.onCast?.(r, now)
      }
      this.start(r, target, now)
      return true
    }
    return false
  }

  /** A caster the log names who is another player: not a mob, and not a pet the damage meter knows (a pet's name is one word too). */
  private otherPlayer(caster: string): boolean {
    return isPlayer(caster) && !this.hooks.isPet?.(caster)
  }

  /**
   * Another player's cast of a spell timed for everyone: it waits for its landing text like yours. A
   * spell no class casts (an NPC's own Harm Touch, every class 255) is a mob's, whatever its name.
   */
  private onOtherCast(caster: string, name: string, now: number): void {
    if (!this.otherPlayer(caster)) return
    const r = this.book.resolve(name)
    if (!r || !castable(r.spell) || !this.config.ruleFor(r.spell.name).others) return
    const d = this.config.durationFor(r.spell, r.rank)
    if (d.ticks === 0 || d.permanent) return
    this.pending.push({ r, at: now, expires: now + r.spell.castMs + CAST_SLACK_MS, targets: new Set(), caster })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
  }

  /** Drops your newest pending cast, never another player's; with `at`, only one begun in that second. */
  private dropOwn(at?: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      if (p.caster) continue
      if (at === undefined || p.at === at) this.pending.splice(i, 1)
      return
    }
  }

  /**
   * Your spell with a long recast: a bar until it can be cast again, from the end of its cast (FEAT-024).
   * Its reuse focus and mote rank are not taken off, so it may be ready a little before the bar ends.
   */
  private startCooldown(r: RankedSpell, now: number): void {
    const t = this.config.tracking
    const s = r.spell
    if (!t.enabled || !t.cooldowns || s.recastMs < COOLDOWN_MIN_MS) return
    const key = `cooldown:${s.name}`
    const words = t.cooldownReadySpeech
    this.board.upsert({
      key,
      id: this.board.get(key)?.id ?? this.board.nextId(),
      label: `${r.rankedName} ready in`,
      target: '',
      source: 'spell',
      spell: s.name,
      icon: s.icon,
      color: COOLDOWN_COLOR,
      overlay: 'targets',
      startedAt: now,
      endsAt: now + s.castMs + s.recastMs,
      exact: true,
      warnSec: 0,
      onWarn: [],
      onExpire: words ? [{ kind: 'speak', text: renderSpeech(words, r.rankedName, ''), interrupt: false }] : [],
      warned: false,
      graceMs: 0,
      meta: { kind: 'cooldown', rankedName: r.rankedName }
    })
    this.castCooldown = { key, until: now + s.castMs + CAST_SLACK_MS }
  }

  /** The cast did not go off: no recast to wait for. */
  private takeBackCooldown(now: number): void {
    const c = this.castCooldown
    this.castCooldown = null
    if (c && now <= c.until) this.board.end(c.key, 'cleared')
  }

  /** A song's pulse landing on you again: its timer runs on from now, without a feed line each pulse. */
  private onSongPulse(text: string, now: number): boolean {
    const song = this.songs.get(text)
    if (!song) return false
    const t = this.board.get(song.key)
    if (!t) {
      this.songs.delete(text)
      return false
    }
    if (t.startedAt < now) {
      t.startedAt = now
      this.board.reschedule(song.key, now + song.seconds * 1000, false)
    }
    return true
  }

  /** Drops the latest pending cast of `name`; whether there was one. */
  private dropPending(name: string): boolean {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      if (p.r.spell.name === name || p.r.rankedName === name) {
        this.pending.splice(i, 1)
        return true
      }
    }
    return false
  }

  /**
   * A spell that did not take hold on one target. A detrimental spell has one target, so the cast is
   * over; a beneficial one may be a group spell still landing on the others, and is left to expire.
   */
  private onNoHold(name: string): void {
    const p = this.pending.findLast((x) => x.r.spell.name === name || x.r.rankedName === name)
    if (p && !p.r.spell.beneficial) this.dropPending(name)
  }

  /**
   * Another spell took this one's place on its target: the timer ends now rather than running to its
   * estimate with a recast cue for a spell that is gone. A timer started this very second is the
   * spell that did the overwriting (your own recast), and stays.
   */
  private onOverwritten(name: string, target: string, now: number): void {
    const r = this.book.resolve(name)
    const key = timerKey(r?.spell.name ?? name, target)
    const t = this.board.get(key)
    if (!t || t.startedAt >= now) return
    this.board.end(key, 'replaced')
    this.hooks.feed('fade', `${named(t)} on ${target} was overwritten`)
  }

  private tryLand(text: string, now: number): boolean {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      const s = p.r.spell
      let target: string | null = null
      if (s.landSelf && text === s.landSelf) target = SELF
      else if (s.landOther && text.length > s.landOther.length && text.endsWith(s.landOther)) {
        target = text.slice(0, text.length - s.landOther.length).trim()
      }
      if (!target || p.targets.has(targetKey(target))) continue
      p.targets.add(targetKey(target))
      if (!p.caster) this.resists.delete(targetKey(target))
      // Another's cast landing on you is a mob's (a player's never does): not timed as theirs.
      if (p.caster && target === SELF) continue
      this.start(p.r, target, now, false, p.caster)
      if (s.beneficial) p.expires = Math.min(p.expires, now + GROUP_LAND_MS)
      else this.pending.splice(i, 1)
      return true
    }
    return false
  }

  kindOf(spell: Spell, target: string): TimerKind {
    if (spell.beneficial) return target === SELF ? 'selfBuff' : 'otherBuff'
    return spell.category === 'dot' ? 'dot' : 'debuff'
  }

  private enabled(kind: TimerKind, rule: SpellRule): boolean {
    if (rule.track !== undefined) return rule.track
    const t = this.config.tracking
    if (!t.enabled) return false
    return { selfBuff: t.selfBuffs, otherBuff: t.otherBuffs, dot: t.dots, debuff: t.debuffs }[kind]
  }

  private start(r: RankedSpell, target: string, now: number, joinedAtTick = false, caster?: string): void {
    const s = r.spell
    const rule = this.config.ruleFor(s.name)
    const kind = this.kindOf(s, target)
    // Another player's cast is timed by the spell's `others` alone; yours by its tracking.
    if (caster ? !rule.others : !this.enabled(kind, rule)) return
    const d = this.config.durationFor(s, r.rank)
    if (d.ticks <= 0) return
    const t = this.config.tracking
    const name = rule.alias || s.name
    const cc = isCrowdControl(s)
    // An invisibility ends when you act: no clock to cue on, and the bar says so (LT-717).
    const untilActed = s.effects.some((e) => e.spa === SPA.INVISIBILITY)
    // "Recast …" is not said of another's cast unless the rule has its own words for the warning. A
    // mez or charm has its own default: the one cue an enchanter needs (LT-713).
    const warnSec =
      rule.recastCue === false || untilActed || (caster && !rule.warnSpeech)
        ? 0
        : (rule.warnSec ?? (kind === 'selfBuff' ? t.buffWarnSec : kind === 'dot' ? t.dotWarnSec : cc ? t.ccWarnSec : 0))
    const warnTemplate = rule.warnSpeech ?? (cc ? t.ccWarnSpeech : s.beneficial ? t.buffWarnSpeech : t.dotWarnSpeech)
    const endsAt = joinedAtTick ? now + (d.ticks - 1) * TICK_MS : now + d.seconds * 1000
    const key = timerKey(s.name, target)
    const timer: BoardTimer = {
      key,
      id: this.board.get(key)?.id ?? this.board.nextId(),
      label: name,
      target,
      ...(caster ? { caster } : {}),
      source: 'spell',
      spell: s.name,
      category: s.category,
      icon: s.icon,
      color: rule.color || CATEGORY_COLORS[s.category],
      overlay: rule.overlay || (s.beneficial ? 'buffs' : 'targets'),
      startedAt: now,
      endsAt,
      exact: false,
      warnSec,
      rank: r.rank,
      onWarn: warnSec > 0 && warnTemplate ? [{ kind: 'speak', text: renderSpeech(warnTemplate, name, target, caster), interrupt: false }] : [],
      onExpire: [],
      warned: false,
      graceMs: GRACE_MS,
      ...(untilActed ? { untilActed: true as const } : {}),
      meta: { kind, ticks: d.ticks, firstTick: joinedAtTick, joined: joinedAtTick, rankedName: r.rankedName, name, caster }
    }
    this.board.upsert(timer)
    if (target === SELF && !caster && s.landSelf && isSong(s)) this.songs.set(s.landSelf, { key, seconds: d.seconds })
    const by = caster ? ` by ${caster}` : ''
    this.hooks.feed('timer', `${r.rankedName}${by} on ${target}: ${untilActed ? 'until you act' : `${d.earliestSec}–${d.latestSec}s`}${joinedAtTick ? ' (joined at a tick)' : ''}`)
    if (caster) {
      const seconds = Math.round((endsAt - now) / 1000)
      this.hooks.notify([{ kind: 'speak', text: renderSpeech(rule.othersSpeech ?? DEFAULT_OTHERS_SPEECH, name, target, caster, seconds), interrupt: false }])
    }
  }

  private onDotTick(target: string, rankedName: string, now: number, caster: string | undefined, damage: number): void {
    const r = this.book.resolve(rankedName)
    if (!r) return
    if (caster && (!castable(r.spell) || target === SELF || !this.config.ruleFor(r.spell.name).others)) return
    const key = timerKey(r.spell.name, target)
    const t = this.board.get(key)
    if (!t) {
      // Landed before we were watching, or its landing text was missed.
      this.start(r, target, now, true, caster)
      this.board.ticked(key, damage)
      return
    }
    this.board.ticked(key, damage)
    if (t.meta?.firstTick) return
    t.meta = { ...t.meta, firstTick: true }
    const ticks = Number(t.meta.ticks)
    this.board.reschedule(key, now + (ticks - 1) * TICK_MS, true)
  }

  private onWornOff(name: string, target: string, now: number): void {
    const r = this.book.resolve(name)
    const t = this.board.end(timerKey(r?.spell.name ?? name, target), 'faded')
    if (t) this.announceFade(t, now)
  }

  /**
   * "Your pet's X spell has worn off.": the timer on your pet, as the roster names it; never a
   * groupmate's buff of the same name, nor another player's cast (LT-514).
   */
  private onPetWornOff(name: string): void {
    const r = this.book.resolve(name)
    const spell = r?.spell.name ?? name
    const yours = this.hooks.isYourPet
    const candidates = this.board
      .list()
      .filter((t) => t.source === 'spell' && t.spell === spell && t.target !== SELF && !t.meta?.caster && !isCooldown(t) && (!yours || yours(t.target)))
      .sort((a, b) => b.startedAt - a.startedAt)
    if (candidates[0]) this.board.end(candidates[0].key, 'faded')
  }

  /** One more of your spells resisted by `target`: the third in a row is said, once until it dies (LT-722). */
  private resistedOn(target: string, spell: string): void {
    const k = targetKey(target)
    const n = this.resists.get(k) ?? 0
    if (n < 0) return
    if (n + 1 < RESIST_STREAK) return void this.resists.set(k, n + 1)
    this.resists.set(k, -1)
    const words = this.config.tracking.resistStreakSpeech
    if (words) this.hooks.notify([{ kind: 'speak', text: renderSpeech(words, spell, target), interrupt: false }])
  }

  private onSelfFade(text: string): boolean {
    // Most lines reach here, so the board is walked without copying it.
    for (const t of this.board.values()) {
      if (t.source !== 'spell' || t.target !== SELF || !t.spell) continue
      // Another's buff on you (BuffWatch's `buff:` bar) ends with BuffWatch's own fade, and is not spoken as a DoT's (LT-511).
      if (t.key.startsWith('buff:')) continue
      const s = this.book.named(t.spell)
      if (s?.fade && s.fade === text) {
        this.board.end(t.key, 'faded')
        this.announceFade(t)
        return true
      }
    }
    return false
  }

  /** `now`: the fade line's time, when one ended it; a mez or charm gone a tick or more early broke (LT-714). */
  private announceFade(t: BoardTimer, now?: number): void {
    const rule = this.config.ruleFor(t.spell ?? '')
    const cfg = this.config.tracking
    const kind = t.meta?.kind as TimerKind
    // Spoken by the spell's name; the feed names another's cast's caster too.
    const name = t.label
    const broke = now !== undefined && (t.category === 'mez' || t.category === 'charm') && now < t.endsAt - TICK_MS
    this.hooks.feed('fade', broke ? `${named(t)} broke on ${t.target}` : `${named(t)} faded from ${t.target}`)
    if (rule.fadeCue === false) return
    if (broke) {
      // The one thing to hear at once: it cuts in, goes to the front of the queue, and is never dropped.
      if (cfg.ccBreakSpeech) this.hooks.notify([{ kind: 'speak', text: renderSpeech(cfg.ccBreakSpeech, name, t.target), interrupt: true, urgent: true }])
      return
    }
    let template = rule.fadeSpeech
    if (template === undefined) {
      if (kind === 'selfBuff') template = cfg.buffFadeSpeech
      else if (kind === 'otherBuff') template = cfg.announceOtherBuffFades ? cfg.buffFadeSpeech + ' on {target}' : ''
      else template = cfg.dotFadeSpeech
    }
    if (template) this.hooks.notify([{ kind: 'speak', text: renderSpeech(template, name, t.target), interrupt: false }])
  }
}

/** A line a branch of `handle` read: whatever the branch made of it, the line was the tracker's (FEAT-025). */
const took = (..._done: unknown[]): true => true

/** A bar as the feed names it: "Harm Touch (Fenwick)" for another's cast. */
function named(t: BoardTimer): string {
  return t.caster ? `${t.label} (${t.caster})` : t.label
}

/** "1,534" as 1534. */
const amount = (s: string) => +s.replace(/,/g, '')

/** A mez or a charm: the crowd control an enchanter times, with cues of its own (LT-713). */
function isCrowdControl(s: Spell): boolean {
  return s.category === 'mez' || s.category === 'charm'
}

/** A "ready again" bar (FEAT-024), not a spell running on someone. */
function isCooldown(t: BoardTimer): boolean {
  return t.key.startsWith('cooldown:')
}

function isBeneficialTimer(t: BoardTimer): boolean {
  return t.category !== undefined && isBeneficialCategory(t.category)
}
