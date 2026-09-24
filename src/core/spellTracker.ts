import type { LogLine } from './logLine'
import type { RankedSpell, Spell, SpellBook } from './spells'
import { TICK_MS } from './durations'
import type { BoardTimer, TimerBoard } from './timers'
import type { DurationBreakdown, FeedItem, Notification, SpellCategory, SpellRule, TrackingSettings } from '../shared/types'

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
/**
 * An estimated timer ends at the earliest its spell can wear off; the real fade comes up to one tick
 * later. One whose fade line never arrives (the log was missed, or the target left) is dropped once
 * this has passed as well.
 */
const GRACE_MS = 14000
/** How long after a beneficial spell first lands other targets may still report it: group buffs land in the same second. */
const GROUP_LAND_MS = 1500

const RE_CAST = /^You begin (?:casting|singing) (.+)\.$/
const RE_FAIL_NAMED = /^Your (.+?) spell (?:is interrupted|fizzles)[.!]$/
const RE_FAIL = /^Your spell (?:is interrupted|fizzles)[.!]$/
const RE_RESIST = /^Your target resisted the (.+) spell\.$/
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
const RE_DOT_TICK = /^(.+) has taken \d+ damage from your (.+)\.$/
const RE_WORN_OFF = /^Your (.+) spell has worn off of (.+)\.$/
const RE_PET_WORN_OFF = /^Your pet's (.+) spell has worn off\.$/
const RE_SLAIN_BY = /^(.+) has been slain by .+!$/
const RE_YOU_SLEW = /^You have slain (.+)!$/
const RE_DIED = /^(.+) died\.$/
const RE_YOU_DIED = /^(?:You died\.|You have been slain by .+!)$/
const RE_ZONE = /^You have entered (.+)\.$/
const RE_NOT_ZONE = /^(?:an? (?:area|Arena)|the Drunken)/i

export function targetKey(target: string): string {
  return target.toLowerCase()
}

export function timerKey(spellName: string, target: string): string {
  return `spell:${spellName}|${targetKey(target)}`
}

export function renderSpeech(template: string, spell: string, target: string): string {
  return template.replace(/\{spell\}/gi, spell).replace(/\{target\}/gi, target === SELF ? 'you' : target)
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
 */
export class SpellTracker {
  private pending: PendingCast[] = []
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
    this.pending = this.pending.filter((p) => p.expires >= now)

    let m = RE_CAST.exec(text)
    if (m) return this.onCast(m[1], now)

    if ((m = RE_FAIL_NAMED.exec(text))) return this.dropPending(m[1])
    if (RE_FAIL.test(text)) return void this.pending.pop()
    if ((m = RE_RESIST.exec(text))) {
      this.dropPending(m[1])
      this.hooks.feed('warn', `${m[1]} resisted`)
      return
    }
    if (FAIL_PREFIXES.some((p) => text.startsWith(p))) return void this.pending.pop()

    if (this.tryLand(text, now)) return

    if ((m = RE_DOT_TICK.exec(text))) return this.onDotTick(m[1], m[2], now)
    if ((m = RE_WORN_OFF.exec(text))) return this.onWornOff(m[1], m[2])
    if ((m = RE_PET_WORN_OFF.exec(text))) return this.onPetWornOff(m[1])

    if ((m = RE_SLAIN_BY.exec(text)) || (m = RE_YOU_SLEW.exec(text)) || (m = RE_DIED.exec(text))) {
      const k = targetKey(m[1])
      this.board.endWhere((t) => t.source === 'spell' && targetKey(t.target) === k, 'died')
      return
    }
    if (RE_YOU_DIED.test(text)) {
      this.board.endWhere((t) => t.source === 'spell' && t.target === SELF, 'died')
      return
    }
    if ((m = RE_ZONE.exec(text)) && !RE_NOT_ZONE.test(m[1])) {
      this.zone = m[1]
      this.pending = []
      // Mobs do not follow you; buffs do.
      this.board.endWhere((t) => t.source === 'spell' && !isBeneficialTimer(t), 'zoned')
      this.hooks.onZone?.(m[1])
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
    const d = this.config.durationFor(r.spell, r.rank)
    if (d.ticks === 0 || d.permanent) return
    this.pending.push({ r, at: now, expires: now + r.spell.castMs + 6000, targets: new Set() })
    if (this.pending.length > 6) this.pending.shift()
  }

  private dropPending(name: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]
      if (p.r.spell.name === name || p.r.rankedName === name) {
        this.pending.splice(i, 1)
        return
      }
    }
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
      this.start(p.r, target, now)
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

  private start(r: RankedSpell, target: string, now: number, joinedAtTick = false): void {
    const s = r.spell
    const rule = this.config.ruleFor(s.name)
    const kind = this.kindOf(s, target)
    if (!this.enabled(kind, rule)) return
    const d = this.config.durationFor(s, r.rank)
    if (d.ticks <= 0) return
    const t = this.config.tracking
    const label = rule.alias || s.name
    const warnSec = rule.recastCue === false ? 0 : (rule.warnSec ?? (kind === 'selfBuff' ? t.buffWarnSec : kind === 'dot' ? t.dotWarnSec : 0))
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
      onWarn: warnSec > 0 && warnTemplate ? [{ kind: 'speak', text: renderSpeech(warnTemplate, label, target), interrupt: false }] : [],
      onExpire: [],
      warned: false,
      graceMs: GRACE_MS,
      meta: { kind, ticks: d.ticks, firstTick: joinedAtTick, joined: joinedAtTick, rankedName: r.rankedName }
    }
    this.board.upsert(timer)
    this.hooks.feed('timer', `${r.rankedName} on ${target}: ${d.earliestSec}–${d.latestSec}s${joinedAtTick ? ' (joined at a tick)' : ''}`)
  }

  private onDotTick(target: string, rankedName: string, now: number): void {
    const r = this.book.resolve(rankedName)
    if (!r) return
    const key = timerKey(r.spell.name, target)
    const t = this.board.get(key)
    if (!t) {
      // Landed before we were watching, or its landing text was missed.
      this.start(r, target, now, true)
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
    for (const t of this.board.list()) {
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
    this.hooks.feed('fade', `${t.label} faded from ${t.target}`)
    if (rule.fadeCue === false) return
    let template = rule.fadeSpeech
    if (template === undefined) {
      if (kind === 'selfBuff') template = cfg.buffFadeSpeech
      else if (kind === 'otherBuff') template = cfg.announceOtherBuffFades ? cfg.buffFadeSpeech + ' on {target}' : ''
      else template = cfg.dotFadeSpeech
    }
    if (template) this.hooks.notify([{ kind: 'speak', text: renderSpeech(template, t.label, t.target), interrupt: false }])
  }
}

function isBeneficialTimer(t: BoardTimer): boolean {
  return t.category === 'buff' || t.category === 'hot' || t.category === 'heal'
}
