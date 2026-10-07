import { zoneEntered, type LogLine } from './logLine'
import type { RankedSpell, Spell, SpellBook } from './spells'
import { isBeneficialCategory, TICK_MS } from './durations'
import type { BoardTimer, TimerBoard } from './timers'
import type { DurationBreakdown, FeedItem, Notification, SpellCategory, SpellRule, TrackingSettings } from '../shared/types'
import { CAST_BY_OTHER, CAST_BY_YOU, DIED, SLAIN_BY, SLAIN_BY_YOU, YOU_DIED, YOU_WERE_SLAIN } from './phrases'

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
}

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
/** How long after a beneficial spell first lands other targets may still report it: group buffs land in the same second. */
const GROUP_LAND_MS = 1500
/** A cast stays open this long past its cast time for its landing line: lag, and the tick it lands in. */
const CAST_SLACK_MS = 6000
/** Casts still waiting to land, at most; the oldest is dropped past this. */
const MAX_PENDING = 6

const RE_CAST = CAST_BY_YOU
const RE_FAIL_NAMED = /^Your (.+?) spell (?:is interrupted|fizzles)[.!]$/
const RE_FAIL = /^Your spell (?:is interrupted|fizzles)[.!]$/
/** "Your Infusion of Spirit spell did not take hold on Elund." */
const RE_NO_HOLD_NAMED = /^Your (.+?) spell did not take hold on (.+)\.$/
/** "Your Blade Dance spell on Innoruuk, the Prince of Hate has been overwritten." */
const RE_OVERWRITTEN = /^Your (.+?) spell on (.+) has been overwritten\.$/
// Older clients: "Your target resisted the X spell." Legends: "a ratman warrior resisted your Envenomed Bolt X!"
const RE_RESIST = /^Your target resisted the (.+) spell\.$/
const RE_RESISTED_YOUR = /^(.+?) resisted your (.+)!$/
const FAIL_PREFIXES = [
  'Your spell did not take hold',
  'Your spell would not have taken hold',
  'You must first select a target',
  'Your target is out of range',
  'You cannot see your target',
  'Insufficient Mana',
  "You can't cast spells while stunned",
  'Your target is immune',
  'Your target cannot be'
]
// A tick that crits ends "(Critical)", as combatLines reads it.
const RE_DOT_TICK = /^(.+?) has taken [\d,]+ damage from your (.+?)\.(?: \((.+)\))?$/
/** "A forsaken revenant has taken 451 damage from Harm Touch X by Rathor.": another player's DoT ticking. */
const RE_DOT_TICK_OTHER = /^(.+?) has taken [\d,]+ damage from (.+?) by (.+?)\.(?: \((.+)\))?$/
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
 * 3. A DoT's first tick line pins its end exactly: it wears off on its target's tick, (ticks − 1)
 *    ticks after the first one.
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

  handle(line: LogLine): void {
    const { text, time: now } = line
    if (this.pending.length) this.pending = this.pending.filter((p) => p.expires >= now)

    let m = RE_CAST.exec(text)
    if (m) return this.onCast(m[1], now)
    if (text.includes(' begins ') && (m = CAST_BY_OTHER.exec(text))) return this.onOtherCast(m[1], m[2], now)

    if ((m = RE_FAIL_NAMED.exec(text))) return void this.dropPending(m[1])
    if (RE_FAIL.test(text)) return void this.pending.pop()
    if (text.startsWith('Your ')) {
      if ((m = RE_NO_HOLD_NAMED.exec(text))) return this.onNoHold(m[1])
      if ((m = RE_OVERWRITTEN.exec(text))) return this.onOverwritten(m[1], m[2], now)
    }
    const resisted = RE_RESIST.exec(text)?.[1] ?? (text.includes(' resisted your ') ? RE_RESISTED_YOUR.exec(text)?.[2] : undefined)
    if (resisted) {
      // Said only of a spell you cast: a weapon's proc resisted is not worth a warning.
      const cast = this.lastCast && now <= this.lastCast.until && this.lastCast.names.includes(resisted)
      if (this.dropPending(resisted) || cast) this.hooks.feed('warn', `${resisted} resisted`)
      return
    }
    if (FAIL_PREFIXES.some((p) => text.startsWith(p))) return void this.pending.pop()

    if (this.tryLand(text, now)) return

    // Each "^(.+) …" pattern backtracks over the whole line, so a cheap look for its fixed words goes first.
    if (text.includes(' damage from ')) {
      if (text.includes(' damage from your ') && (m = RE_DOT_TICK.exec(text))) return this.onDotTick(m[1], m[2], now)
      if ((m = RE_DOT_TICK_OTHER.exec(text)) && isPlayer(m[3])) return this.onDotTick(m[1], m[2], now, m[3])
    }
    if (text.startsWith('Your ')) {
      if ((m = RE_WORN_OFF.exec(text))) return this.onWornOff(m[1], m[2])
      if ((m = RE_PET_WORN_OFF.exec(text))) return this.onPetWornOff(m[1])
    }

    // Your own death first: "You died." would otherwise be read as a target called "You" dying.
    if (text.startsWith('You ') && youDied(text)) {
      this.board.endWhere((t) => t.source === 'spell' && t.target === SELF, 'died')
      return
    }
    if (
      (text.includes(' has been slain by ') && (m = RE_SLAIN_BY.exec(text))) ||
      (text.startsWith('You have slain ') && (m = RE_YOU_SLEW.exec(text))) ||
      (text.endsWith(' died.') && (m = RE_DIED.exec(text)))
    ) {
      const k = targetKey(m[1])
      this.board.endWhere((t) => t.source === 'spell' && targetKey(t.target) === k, 'died')
      return
    }
    const zone = zoneEntered(text)
    if (zone) {
      this.zone = zone
      this.pending = []
      // Mobs do not follow you; buffs do.
      this.board.endWhere((t) => t.source === 'spell' && !isBeneficialTimer(t), 'zoned')
      this.hooks.onZone?.(zone)
      return
    }
    this.onSelfFade(text)
  }

  setZone(zone: string): void {
    this.zone = zone
  }

  private onCast(name: string, now: number): void {
    const r = this.book.resolve(name)
    if (!r) return
    this.hooks.onCast?.(r, now)
    this.lastCast = { names: [r.spell.name, r.rankedName], until: now + r.spell.castMs + CAST_SLACK_MS }
    const d = this.config.durationFor(r.spell, r.rank)
    if (d.ticks === 0 || d.permanent) return
    this.pending.push({ r, at: now, expires: now + r.spell.castMs + CAST_SLACK_MS, targets: new Set() })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
  }

  /** Another player's cast of a spell timed for everyone: it waits for its landing text like yours. */
  private onOtherCast(caster: string, name: string, now: number): void {
    if (!isPlayer(caster)) return
    const r = this.book.resolve(name)
    if (!r || !this.config.ruleFor(r.spell.name).others) return
    const d = this.config.durationFor(r.spell, r.rank)
    if (d.ticks === 0 || d.permanent) return
    this.pending.push({ r, at: now, expires: now + r.spell.castMs + CAST_SLACK_MS, targets: new Set(), caster })
    if (this.pending.length > MAX_PENDING) this.pending.shift()
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
    this.hooks.feed('fade', `${t.label} on ${target} was overwritten`)
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
    const label = caster ? `${name} (${caster})` : name
    // "Recast …" is not said of another's cast unless the rule has its own words for the warning.
    const warnSec = rule.recastCue === false || (caster && !rule.warnSpeech) ? 0 : (rule.warnSec ?? (kind === 'selfBuff' ? t.buffWarnSec : kind === 'dot' ? t.dotWarnSec : 0))
    const warnTemplate = rule.warnSpeech ?? (s.beneficial ? t.buffWarnSpeech : t.dotWarnSpeech)
    const endsAt = joinedAtTick ? now + (d.ticks - 1) * TICK_MS : now + d.seconds * 1000
    const key = timerKey(s.name, target)
    const timer: BoardTimer = {
      key,
      id: this.board.get(key)?.id ?? this.board.nextId(),
      label,
      target,
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
      meta: { kind, ticks: d.ticks, firstTick: joinedAtTick, joined: joinedAtTick, rankedName: r.rankedName, name, caster }
    }
    this.board.upsert(timer)
    const by = caster ? ` by ${caster}` : ''
    this.hooks.feed('timer', `${r.rankedName}${by} on ${target}: ${d.earliestSec}–${d.latestSec}s${joinedAtTick ? ' (joined at a tick)' : ''}`)
    if (caster) {
      const seconds = Math.round((endsAt - now) / 1000)
      this.hooks.notify([{ kind: 'speak', text: renderSpeech(rule.othersSpeech ?? DEFAULT_OTHERS_SPEECH, name, target, caster, seconds), interrupt: false }])
    }
  }

  private onDotTick(target: string, rankedName: string, now: number, caster?: string): void {
    const r = this.book.resolve(rankedName)
    if (!r) return
    if (caster && !this.config.ruleFor(r.spell.name).others) return
    const key = timerKey(r.spell.name, target)
    const t = this.board.get(key)
    if (!t) {
      // Landed before we were watching, or its landing text was missed.
      this.start(r, target, now, true, caster)
      return
    }
    if (t.meta?.firstTick) return
    t.meta = { ...t.meta, firstTick: true }
    const ticks = Number(t.meta.ticks)
    this.board.reschedule(key, now + (ticks - 1) * TICK_MS, true)
  }

  private onWornOff(name: string, target: string): void {
    const r = this.book.resolve(name)
    const t = this.board.end(timerKey(r?.spell.name ?? name, target), 'faded')
    if (t) this.announceFade(t)
  }

  private onPetWornOff(name: string): void {
    const r = this.book.resolve(name)
    const spell = r?.spell.name ?? name
    const candidates = this.board
      .list()
      .filter((t) => t.source === 'spell' && t.spell === spell && t.target !== SELF)
      .sort((a, b) => b.startedAt - a.startedAt)
    if (candidates[0]) this.board.end(candidates[0].key, 'faded')
  }

  private onSelfFade(text: string): void {
    // Most lines reach here, so the board is walked without copying it.
    for (const t of this.board.values()) {
      if (t.source !== 'spell' || t.target !== SELF || !t.spell) continue
      const s = this.book.named(t.spell)
      if (s?.fade && s.fade === text) {
        this.board.end(t.key, 'faded')
        this.announceFade(t)
        return
      }
    }
  }

  private announceFade(t: BoardTimer): void {
    const rule = this.config.ruleFor(t.spell ?? '')
    const cfg = this.config.tracking
    const kind = t.meta?.kind as TimerKind
    // Spoken by the spell's name: a bar of another's cast carries the caster too.
    const name = (t.meta?.name as string | undefined) ?? t.label
    this.hooks.feed('fade', `${t.label} faded from ${t.target}`)
    if (rule.fadeCue === false) return
    let template = rule.fadeSpeech
    if (template === undefined) {
      if (kind === 'selfBuff') template = cfg.buffFadeSpeech
      else if (kind === 'otherBuff') template = cfg.announceOtherBuffFades ? cfg.buffFadeSpeech + ' on {target}' : ''
      else template = cfg.dotFadeSpeech
    }
    if (template) this.hooks.notify([{ kind: 'speak', text: renderSpeech(template, name, t.target), interrupt: false }])
  }
}

function isBeneficialTimer(t: BoardTimer): boolean {
  return t.category !== undefined && isBeneficialCategory(t.category)
}
