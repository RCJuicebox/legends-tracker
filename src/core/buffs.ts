// The buff tracker: what the group could buff you with, what you have on you now, and when to ask.
//
// Who is who comes from /who lines ("[50 SHD/BRD/WIZ] Aldric (Erudite) <Guild> ZONE: …"): Legends
// characters have three classes and change them, so each name keeps its newest. What a class can
// cast comes from the spell file. What lands on you is the spell's "you" text ("You feel armored."),
// matched to a cast seen just before it ("Kelwyn begins casting Temperance."); its fade text ends it.
//
// What to ask for is the best combination that stacks: of the buffs the player picked that the
// group can cast, and what is on them already, the set worth the most that can all be on at once
// (stacking.ts), in the order the game's rules call for. Harnessing of Spirit is the shaman's biggest
// single buff, but it will not stack with Infusion of Spirit or Talisman of Altuna, which together
// are worth more; it does stay on over a level-50 Strength, but only when it lands second. Buffs are
// shown grouped into lines by what they do (HP & AC, haste, spell haste, mana regen, stats…).
//
// Offers are keyed by the spell file's own names: Rune I to Rune IV are four enchanter spells, not
// ranks of one (Legends prints its ranks after the name: "Rune I III").

import { CLASS_NUMBER, type ClassId } from './acModel'
import { computeDuration } from './durations'
import type { Spell, SpellBook } from './spells'
import { effectValue } from './effectValue'
import { bestStack, checkStack, pairOrder, type StackEffect, type StackItem } from './stacking'
import type { SpellCategory } from '../shared/types'

// ---- who is who ----

export interface Person {
  name: string
  /** Tracker class ids, in the order /who lists them. */
  classes: string[]
  level: number
  race: string
  /** When the /who line was printed. */
  at: number
}

const RE_WHO = /^\[(\d+) ([A-Z]{3}(?:\/[A-Z]{3}){0,2})\] (\S+) \(([^)]+)\)/

/** A /who line, or null. Anonymous and roleplaying players show no classes and are passed over. */
export function parseWho(text: string, at: number): Person | null {
  const m = RE_WHO.exec(text)
  if (!m) return null
  const classes = m[2].split('/').map((c) => c.toLowerCase()).filter((c) => c in CLASS_NUMBER)
  if (!classes.length) return null
  return { name: m[3], classes, level: Number(m[1]), race: m[4], at }
}

// ---- what a buff does ----

export type BuffLine = 'hpac' | 'haste' | 'spellHaste' | 'manaRegen' | 'hpRegen' | 'stats' | 'attack' | 'proc' | 'ds' | 'rune' | 'mana' | 'resist' | 'move' | 'other'

export const LINE_LABELS: Record<BuffLine, string> = {
  hpac: 'HP & AC',
  haste: 'Haste',
  spellHaste: 'Spell haste',
  manaRegen: 'Mana regen',
  hpRegen: 'HP regen',
  stats: 'Stats',
  attack: 'Attack',
  proc: 'Procs',
  ds: 'Damage shield',
  rune: 'Rune',
  mana: 'Mana pool',
  resist: 'Resists',
  move: 'Movement',
  other: 'Other'
}

/** The lines the tracker picks from out of the box: every buff of them worth something (procs and "other" are permanent buffs). */
export const DEFAULT_LINES: BuffLine[] = ['hpac', 'haste', 'spellHaste', 'manaRegen', 'stats', 'proc', 'other']

export interface BuffEffect {
  line: BuffLine
  label: string
  /** The spell file's figure where it reads as one ("HP 800", "haste 70%"); '' where it does not. */
  value: string
}

const STAT_SPA: Record<number, string> = { 4: 'STR', 5: 'DEX', 6: 'AGI', 7: 'STA', 8: 'INT', 9: 'WIS', 10: 'CHA' }
const RESIST_SPA: Record<number, string> = { 46: 'fire', 47: 'cold', 48: 'poison', 49: 'disease', 50: 'magic' }

/** What a proc buff (SPA 85) or a permanent utility buff does: the spell it procs, by id. */
const PERMANENT_ONLY: Record<number, string> = { 14: 'enduring breath', 57: 'levitate', 58: 'illusion', 184: 'accuracy' }

/**
 * What one effect of a beneficial spell does, or null for one the tracker does not follow. A weapon
 * proc, and the utility effects, count only on a permanent buff (a combat innate, a rogue poison,
 * Breath of the Dead): a timed Levitate is not something to keep up. Vision never counts.
 */
function effectOf(spa: number, base: number, max: number, permanent: boolean, procName: (id: number) => string): BuffEffect | null {
  if (permanent && spa === 85 && base > 0) return { line: 'proc', label: 'proc', value: procName(base) }
  if (permanent && PERMANENT_ONLY[spa]) return { line: 'other', label: PERMANENT_ONLY[spa], value: spa === 184 ? `+${base}%` : '' }
  if (spa === 69 && base > 0) return { line: 'hpac', label: 'HP', value: `+${base}` }
  if (spa === 1 && base > 0) return { line: 'hpac', label: 'AC', value: `+${base}` }
  if (spa === 11 && base > 100) return { line: 'haste', label: 'haste', value: `${base - 100}%` }
  if ((spa === 98 || spa === 119) && base > 0) return { line: 'haste', label: 'overhaste', value: `${base > 100 ? base - 100 : base}%` }
  if (spa === 127 && base > 0) return { line: 'spellHaste', label: 'spell haste', value: `${base}%` }
  if (spa === 15 && base > 0) return { line: 'manaRegen', label: 'mana regen', value: base > 1 ? `+${base}` : '' }
  if (spa === 0 && base > 0) return { line: 'hpRegen', label: 'HP regen', value: base > 1 ? `+${base}` : '' }
  if (STAT_SPA[spa] && base > 0) return { line: 'stats', label: STAT_SPA[spa], value: base > 1 ? `+${base}` : '' }
  if (spa === 2 && base > 0) return { line: 'attack', label: 'ATK', value: `+${base}` }
  if (spa === 59 && base < 0) return { line: 'ds', label: 'damage shield', value: `${-base}` }
  if (spa === 55 && base > 0) return { line: 'rune', label: 'rune', value: `${base}` }
  // A ward (Ward of Vie, Ward of Alendar): takes `base`% off each melee hit or spell until `max` damage has been taken off.
  if (spa === 162 && max > 0) return { line: 'rune', label: 'melee ward', value: `${max} (${base}%)` }
  if (spa === 161 && max > 0) return { line: 'rune', label: 'spell ward', value: `${max} (${base}%)` }
  if (spa === 121 && base > 0) return { line: 'hpRegen', label: 'heal per hit', value: `+${base}` }
  if (spa === 97 && base > 0) return { line: 'mana', label: 'mana', value: `+${base}` }
  if (RESIST_SPA[spa] && base > 0) return { line: 'resist', label: `${RESIST_SPA[spa]} resist`, value: `+${base}` }
  if (spa === 3 && base > 0) return { line: 'move', label: 'run speed', value: `${base}%` }
  return null
}

/** The line a spell counts for: what it does first, in this order. */
const LINE_ORDER: BuffLine[] = ['haste', 'spellHaste', 'hpac', 'manaRegen', 'hpRegen', 'ds', 'rune', 'attack', 'proc', 'stats', 'mana', 'resist', 'move', 'other']

// ---- what each class can cast ----

export interface BuffOffer {
  /** The spell file's name: "Temperance", "Rune IV". */
  spell: string
  line: BuffLine
  effects: BuffEffect[]
  /** The level each class gets it at, by tracker class id. */
  classes: Record<string, number>
  /** How long it lasts at level 50, unfocused, in seconds. */
  seconds: number
  group: boolean
  /** Self only: nobody can cast it on you but you. */
  self: boolean
  category: SpellCategory
  /** What it is worth at the level cap, in HP (see VALUE_PER_POINT): what the best combination adds up. */
  value: number
  /** Its effects slot by slot, with their level formulas, for telling what it stacks with. */
  stack: StackEffect[]
}

/**
 * What a point of each effect is worth, in HP, for weighing one buff against another. AC counts
 * twice (so a paladin's Symbol of Pinzarn, +307 HP, comes before Armor of Faith, +85 AC), STA 1.5
 * for the HP it brings, charisma nothing. Haste and spell haste are per percent, regen per point a tick.
 */
export const VALUE_PER_POINT: Record<number, number> = {
  69: 1, 1: 2, 4: 1, 5: 1, 6: 1, 7: 1.5, 8: 1, 9: 1, 10: 0, 2: 1,
  11: 20, 98: 20, 119: 20, 127: 30, 15: 30, 0: 10, 121: 10, 59: 5, 55: 0.5, 161: 0.5, 162: 0.5, 97: 1,
  46: 0.5, 47: 0.5, 48: 0.5, 49: 0.5, 50: 0.5, 3: 1
}

/** What a weapon proc, and a permanent utility effect, count for: flat, since neither is a number of anything. */
export const PROC_VALUE = 100
export const OTHER_VALUE = 20

/**
 * A buff's worth from its effects at the level cap. Haste is counted above 100%; a damage shield by
 * its size; a ward by what it takes in all; a proc or a permanent utility effect flat.
 */
function valueOf(effects: { spa: number; base: number; max: number }[], permanent: boolean): number {
  let v = 0
  for (const e of effects) {
    if (permanent && e.spa === 85 && e.base > 0) v += PROC_VALUE
    if (permanent && PERMANENT_ONLY[e.spa]) v += OTHER_VALUE
    const w = VALUE_PER_POINT[e.spa]
    if (!w) continue
    const n = e.spa === 11 ? e.base - 100 : e.spa === 98 || e.spa === 119 ? (e.base > 100 ? e.base - 100 : e.base) : e.spa === 59 ? -e.base : e.spa === 161 || e.spa === 162 ? e.max : e.base
    if (n > 0) v += n * w
  }
  return Math.round(v)
}

/** Casting skills of songs: brass, singing, stringed, wind, percussion. */
const SONG_SKILLS = [12, 41, 49, 54, 70]
/** Target types of a buff on a pet: never on a player. */
const PET_TARGETS = [14, 38]
/** A buff the caster can only put on themself: listed so the player is reminded to cast their own. */
const SELF_TARGET = 6
/** Buffs shorter than this are left out: the tracker is for the long ones worth asking for. */
export const MIN_BUFF_SEC = 5 * 60
/**
 * Legends' level cap. The spell file carries live EverQuest's later spells too (level 51 to 130);
 * nobody in Legends can cast those.
 */
export const LEVEL_CAP = 50

const GROUP_TARGETS = [3, 41, 42]

/** Every buff a player could get from another, per spell, with the classes that cast it and when. */
export function buffOffers(book: SpellBook, tierPct: Record<SpellCategory, number>, maxLevel = LEVEL_CAP): BuffOffer[] {
  const out = new Map<string, BuffOffer>()
  for (const s of book.all()) {
    if (!s.beneficial || PET_TARGETS.includes(s.targetType) || SONG_SKILLS.includes(s.skill) || /^Item Benefit/i.test(s.name)) continue
    const d = computeDuration({ spell: s, rank: 0, level: 50, tierPct, focusPct: 0 })
    if (!d.permanent && d.seconds < MIN_BUFF_SEC) continue
    // Values at the level cap, as a caster at the top would give them.
    const valued = s.effects.map((e) => ({ spa: e.spa, base: effectValue(e, maxLevel), max: e.max ?? 0 }))
    const effects = valued.map((e) => effectOf(e.spa, e.base, e.max, d.permanent, (id) => book.get(id)?.name ?? `spell ${id}`)).filter((e): e is BuffEffect => !!e)
    if (!effects.length) continue
    const classes: Record<string, number> = {}
    for (const [id, n] of Object.entries(CLASS_NUMBER) as [ClassId, number][]) {
      const l = s.classLevels[n - 1]
      if (l > 0 && l <= maxLevel) classes[id] = l
    }
    if (!Object.keys(classes).length) continue
    const name = s.name
    const line = LINE_ORDER.find((l) => effects.some((e) => e.line === l))!
    out.set(name, {
      spell: name,
      line,
      effects,
      classes,
      seconds: d.permanent ? Infinity : d.seconds,
      group: GROUP_TARGETS.includes(s.targetType),
      self: s.targetType === SELF_TARGET,
      category: s.category,
      value: valueOf(valued, d.permanent),
      stack: s.effects.map((e) => ({ slot: e.slot, spa: e.spa, base: e.base, base2: e.base2, formula: e.formula, max: e.max }))
    })
  }
  return [...out.values()].sort((a, b) => a.spell.localeCompare(b.spell))
}

/** What these classes can cast at this level: on others, or with `self`, on themselves. */
export function offersFor(offers: BuffOffer[], classes: string[], level: number, self = false): BuffOffer[] {
  return offers.filter((o) => o.self === self && classes.some((c) => o.classes[c] !== undefined && o.classes[c] <= level))
}

/** Worth most first; the higher-level spell first between two alike. */
export function byValue(a: BuffOffer, b: BuffOffer): number {
  return b.value - a.value || Math.max(...Object.values(b.classes)) - Math.max(...Object.values(a.classes)) || a.spell.localeCompare(b.spell)
}

/**
 * Out of the box: every buff of the default lines worth something (charisma alone is worth nothing).
 * Which of them to ask for is the best combination's call, so the pool can be wide.
 */
export function defaultWanted(offers: BuffOffer[]): string[] {
  return offers.filter((o) => DEFAULT_LINES.includes(o.line) && o.value > 0).sort(byValue).map((o) => o.spell)
}

// ---- what is on you ----

export interface ActiveBuff {
  /** The spell file's name. */
  spell: string
  /** As cast, with Legends' rank: "Temperance", "Clarity IV". */
  ranked: string
  line: BuffLine
  /** Who cast it: a name, 'You', or '' when the log did not say. */
  caster: string
  landedAt: number
  /** The earliest it can wear off, from the spell file at the caster's level without focus; null when permanent. */
  endsAt: number | null
}

interface Cast {
  ranked: string
  spell: Spell
  rank: number
  at: number
}

/** A cast lands within its cast time plus this: lag, and the tick it lands in. */
const LAND_WINDOW_MS = 12_000

export interface BuffWatchHooks {
  /** How long a spell lasts when this caster casts it. */
  seconds: (spell: Spell, rank: number, caster: string) => number | null
  onChange: () => void
  /** A buff landed on you or faded from you. */
  onLand?: (b: ActiveBuff) => void
  onFade?: (b: ActiveBuff, why: 'faded' | 'died') => void
  onWho?: (p: Person) => void
}

export class BuffWatch {
  private readonly casts = new Map<string, Cast>()
  private landIndex = new Map<string, Spell[]>()
  private fadeIndex = new Map<string, string[]>()
  private offers = new Map<string, BuffOffer>()

  constructor(
    public active: ActiveBuff[],
    private readonly hooks: BuffWatchHooks
  ) {}

  /** The spell file and the buffs worth following: indexed by their landing and fading texts. */
  setBook(book: SpellBook | null, offers: BuffOffer[]): void {
    this.landIndex = new Map()
    this.fadeIndex = new Map()
    this.offers = new Map(offers.map((o) => [o.spell, o]))
    if (!book) return
    for (const s of book.all()) {
      if (!this.offers.has(s.name)) continue
      if (s.landSelf) this.landIndex.set(s.landSelf, [...(this.landIndex.get(s.landSelf) ?? []), s])
      if (s.fade) this.fadeIndex.set(s.fade, [...new Set([...(this.fadeIndex.get(s.fade) ?? []), s.name])])
    }
  }

  handle(text: string, at: number, resolve: (ranked: string) => { spell: Spell; rank: number } | undefined): void {
    const who = text.startsWith('[') ? parseWho(text, at) : null
    if (who) return this.hooks.onWho?.(who)
    const cast = /^(.+?) begins? (?:casting|singing) (.+)\.$/.exec(text)
    if (cast) {
      const caster = cast[1]
      const r = resolve(cast[2])
      if (r && this.offers.has(r.spell.name)) this.casts.set(caster, { ranked: cast[2], spell: r.spell, rank: r.rank, at })
      return
    }
    if (text === 'You died.' || text.startsWith('You have been slain by ')) {
      const gone = this.active
      if (!gone.length) return
      this.active = []
      for (const b of gone) this.hooks.onFade?.(b, 'died')
      this.hooks.onChange()
      return
    }
    const landing = this.landIndex.get(text)
    if (landing) return this.land(landing, at)
    const fading = this.fadeIndex.get(text)
    if (fading) this.fade(fading)
  }

  /** Someone's buff took hold on you: the most recent cast of a spell with this landing text. */
  private land(spells: Spell[], at: number): void {
    let best: { caster: string; c: Cast } | null = null
    for (const [caster, c] of this.casts) {
      if (at - c.at > LAND_WINDOW_MS + c.spell.castMs || at < c.at) continue
      if (!spells.includes(c.spell)) continue
      if (!best || c.at > best.c.at) best = { caster, c }
    }
    // No cast seen (out of range, or the log missed it): one spell with this text still names itself.
    const spell = best?.c.spell ?? (spells.length === 1 ? spells[0] : null)
    if (!spell) return
    const base = spell.name
    const offer = this.offers.get(base)
    if (!offer) return
    const caster = best?.caster ?? ''
    if (best) this.casts.delete(best.caster)
    const secs = this.hooks.seconds(spell, best?.c.rank ?? 0, caster)
    const b: ActiveBuff = { spell: base, ranked: best?.c.ranked ?? spell.name, line: offer.line, caster, landedAt: at, endsAt: secs === null ? null : at + secs * 1000 }
    // A buff cast again replaces itself.
    this.active = [...this.active.filter((x) => x.spell !== base), b]
    this.hooks.onLand?.(b)
    this.hooks.onChange()
  }

  /** A fade text: the buff with it that was due to end first is the one that ended. */
  private fade(spells: string[]): void {
    const mine = this.active.filter((b) => spells.includes(b.spell)).sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))
    const b = mine[0]
    if (!b) return
    this.active = this.active.filter((x) => x !== b)
    this.hooks.onFade?.(b, 'faded')
    this.hooks.onChange()
  }

  /** Buffs past their estimate by more than a tick are gone, fade line or not (a missed log, a restart). */
  prune(now: number): void {
    const keep = this.active.filter((b) => b.endsAt === null || now < b.endsAt + 12_000)
    if (keep.length === this.active.length) return
    this.active = keep
    this.hooks.onChange()
  }
}

// ---- what to ask for ----

export interface BuffNeed {
  line: BuffLine
  /** The best wanted buff of this line a groupmate can cast, and who (YOU for one of your own). */
  spell: string
  from: string
  /** What of this line is on you now and would give way to it; '' when nothing is. */
  replaces: string
  /** Buffs of the combination that must be on before it lands (Strength before Harnessing of Spirit). */
  after: string[]
  /** Buffs on you that block it and that it would not replace: click them off first. */
  clickOff: string[]
}

/** Whether this person can cast the buff at their level. */
export function canCast(offer: BuffOffer, p: Person): boolean {
  return p.classes.some((c) => offer.classes[c] !== undefined && offer.classes[c] <= p.level)
}

/** A groupmate who can cast this buff at their level, or undefined. */
export function casterOf(offer: BuffOffer, group: Person[]): Person | undefined {
  return group.find((p) => canCast(offer, p))
}

/** The `from` of a buff only you can cast. */
export const YOU = 'you'

/** Asking is not worth it for less than this (a +5 DEX buff): the combination leaves such buffs out. */
export const MIN_ASK_VALUE = 20

export interface PlanItem {
  spell: string
  line: BuffLine
  value: number
  /** Who to ask: a groupmate's name, or with "anyone", the class and level ("Shaman 49"); YOU for a self-only buff; '' when on you already. */
  from: string
  on: boolean
  /** Buffs of the combination that must land before it. */
  after: string[]
}

export interface BuffPlan {
  /** The best combination: what is on you and stays, and what to ask for. */
  chosen: PlanItem[]
  /** Picked but not in it: nobody here casts it, or it does not stack with what is (named). */
  leftOut: { spell: string; line: BuffLine; value: number; reason: 'nobody' | 'stack' | 'small'; blockedBy: string[] }[]
  needs: BuffNeed[]
}

/**
 * The best combination of buffs to have: of the ones picked that the group can cast (or, with
 * 'anyone', any class can by the level cap) and the ones on you now, the set worth the most that can
 * all be on at once, by the game's stacking rules at each caster's level. What is in it and not on
 * you is what to ask for, in the order the rules call for, each replacing what of yours it does not
 * stack with. A tie goes to what is on you already, so a buff's twin (Temperance, Blessing of
 * Temperance) is never asked for over it.
 */
export function buffPlan(o: { offers: BuffOffer[]; wanted: string[]; group: Person[] | 'anyone'; active: ActiveBuff[]; me?: Person | null }): BuffPlan {
  const byName = new Map(o.offers.map((x) => [x.spell, x]))
  const onYou = new Map(o.active.map((b) => [b.spell, b]))
  const caster = (offer: BuffOffer): { from: string; level: number } | null => {
    // What you can cast yourself is yours to cast, group or no group; a self-only buff is nobody else's.
    if (o.me && canCast(offer, o.me)) return { from: YOU, level: o.me.level }
    if (offer.self) return null
    if (o.group === 'anyone') {
      const [c, l] = Object.entries(offer.classes).sort((a, b) => a[1] - b[1])[0] ?? []
      return c ? { from: `${c.toUpperCase()} ${l}`, level: LEVEL_CAP } : null
    }
    const p = casterOf(offer, o.group)
    return p ? { from: p.name, level: p.level } : null
  }
  // The level a buff on you was cast at: its caster's, when /who has said; else the cap.
  const levelOn = (b: ActiveBuff): number => (b.caster === 'You' ? o.me?.level : o.group === 'anyone' ? undefined : o.group.find((p) => p.name === b.caster)?.level) ?? LEVEL_CAP
  const items: StackItem[] = []
  const leftOut: BuffPlan['leftOut'] = []
  const from = new Map<string, string>()
  for (const spell of new Set([...o.wanted, ...onYou.keys()])) {
    const offer = byName.get(spell)
    if (!offer) continue
    const on = onYou.get(spell)
    const who = on ? null : caster(offer)
    if (!on && !who) {
      leftOut.push({ spell, line: offer.line, value: offer.value, reason: 'nobody', blockedBy: [] })
      continue
    }
    if (!on && offer.value < MIN_ASK_VALUE) {
      leftOut.push({ spell, line: offer.line, value: offer.value, reason: 'small', blockedBy: [] })
      continue
    }
    if (who) from.set(spell, who.from)
    items.push({ key: spell, value: offer.value, spell: { effects: offer.stack, group: offer.group }, level: on ? levelOn(on) : who!.level, keep: !!on })
  }
  const best = bestStack(items)
  const item = new Map(items.map((i) => [i.key, i]))
  const chosen = items
    .filter((i) => best.chosen.has(i.key))
    .map((i): PlanItem => {
      const offer = byName.get(i.key)!
      return { spell: i.key, line: offer.line, value: offer.value, from: i.keep ? '' : from.get(i.key) ?? '', on: i.keep, after: best.after.get(i.key) ?? [] }
    })
    .sort((a, b) => LINE_ORDER.indexOf(a.line) - LINE_ORDER.indexOf(b.line) || b.value - a.value)
  for (const i of items) {
    if (best.chosen.has(i.key) || i.keep) continue
    const offer = byName.get(i.key)!
    leftOut.push({ spell: i.key, line: offer.line, value: offer.value, reason: 'stack', blockedBy: chosen.filter((c) => pairOrder(i, item.get(c.spell)!) === null).map((c) => c.spell) })
  }
  const needs = chosen
    .filter((c) => !c.on)
    .map((c): BuffNeed => {
      const me = item.get(c.spell)!
      const replaces: string[] = []
      const clickOff: string[] = []
      // What is on you and not in the combination: it lands over some, and some it cannot land over.
      for (const b of o.active) {
        const was = item.get(b.spell)
        if (!was || best.chosen.has(b.spell)) continue
        const r = checkStack(was.spell, was.level, me.spell, me.level)
        if (r === 1) replaces.push(b.spell)
        else if (r === -1) clickOff.push(b.spell)
      }
      return { line: c.line, spell: c.spell, from: c.from, replaces: replaces.join(', '), after: c.after, clickOff }
    })
  return { chosen, leftOut: leftOut.sort((a, b) => b.value - a.value), needs }
}

/** What to ask the group for: the best combination's buffs that are not on you. */
export function buffNeeds(o: { offers: BuffOffer[]; wanted: string[]; group: Person[]; active: ActiveBuff[]; me?: Person | null }): BuffNeed[] {
  return buffPlan(o).needs
}

/**
 * "Cast Yaulp; ask Kelwyn for Temperance and Clarity; ask Aldric for Swift Like the Wind." A buff
 * that must land after another, or needs one clicked off first, says so: "Harnessing of Spirit
 * (after Strength)".
 */
export function askText(needs: BuffNeed[]): string {
  const byWho = new Map<string, string[]>()
  const name = (n: BuffNeed) => {
    const notes = [...(n.after.length ? [`after ${list(n.after)}`] : []), ...(n.clickOff.length ? [`once ${list(n.clickOff)} ${n.clickOff.length > 1 ? 'are' : 'is'} clicked off`] : [])]
    return notes.length ? `${n.spell} (${notes.join(', ')})` : n.spell
  }
  for (const n of needs) byWho.set(n.from, [...(byWho.get(n.from) ?? []), name(n)])
  const mine = byWho.get(YOU)
  byWho.delete(YOU)
  const parts = [...(mine ? [`Cast ${list(mine)}`] : []), ...[...byWho].map(([who, spells]) => `ask ${who} for ${list(spells)}`)]
  return parts.map((p, i) => (i ? p : p[0].toUpperCase() + p.slice(1))).join('; ')
}

const list = (xs: string[]) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

// ---- stored, and shown ----

/** buffs.json: who is who (from /who, by lower-cased name), what each character wants, what is on them. */
export interface BuffsFile {
  people: Record<string, Person>
  /** Wanted spells by character key; absent means the defaults. */
  wanted: Record<string, string[]>
  active: Record<string, ActiveBuff[]>
}

export const EMPTY_BUFFS: BuffsFile = { people: {}, wanted: {}, active: {} }

export interface BuffView {
  offers: BuffOffer[]
  wanted: string[]
  /** True while the wanted list is the defaults. */
  defaults: boolean
  /** The group, each with what /who last said of them; null when they have not been seen in a /who. */
  group: { name: string; person: Person | null }[]
  /** You, as /who last said (or the character sheet); null when neither knows your classes. */
  me: Person | null
  active: ActiveBuff[]
  needs: BuffNeed[]
  /** The best combination with this group, and with anyone at all, to plan by. */
  plan: BuffPlan
  planAnyone: BuffPlan
  /** False until the spell file is read. */
  spellsLoaded: boolean
}
