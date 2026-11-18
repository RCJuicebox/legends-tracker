import { CLASSES, CLASS_TABLE, classIdOf, type ClassId } from '../../shared/game/classes'
import { PLAYABLE_RACES } from '../../shared/game/races'
import { LEVEL_CAP } from '../../shared/game/levels'
import type { Inventory } from '../../shared/character'

// Goals › Reincarnation (an optional module): the 2026-11-10 patch's Reincarnation AAs, one line per
// class and per race, three ranks each, and a plan made from the player's priority list: the trios and
// races to reincarnate as, and the trios to level as between them. A reincarnation takes a Token of Reincarnation and a three-class loadout at the level cap; it
// sets the race and the three classes back to level 1 and gives one rank in each of their four AAs.
// Rank 3 of a class AA adds an activated ability (all of them share one timer). Completionist rises
// a rank each time every class AA reaches the next rank.
//
// What each AA does is the client's own wording at rank 1 (dbstr_us.txt 26000–26202, read 2026-11-11
// from the test character's /alternateadv list), put shortly; the patch notes say only that ranks 2 and
// 3 are "escalating", so their numbers are not known until someone holds them.

/** Every Reincarnation AA has three ranks. */
export const REINC_RANKS = 3

/** The stances a class has that a trio's planner cares about (eqlwiki's Stances & Invocations, 2026-11-11). */
export type Stance = 'defensive' | 'evasive'
/** The stat a class's mana comes from (the Stats page's rule: WIS for the priests and WIS hybrids, INT for the rest with mana). */
export type ManaStat = 'WIS' | 'INT'

export interface ReincClass {
  id: ClassId
  name: string
  code: string
  /** What the passive does, and its size at rank 1. */
  passive: string
  first: string
  /** The activated ability rank 3 adds. */
  active: { name: string; does: string }
  stances: readonly Stance[]
  /** Null for a class with no mana (Warrior, Monk, Rogue, Berserker). */
  mana: ManaStat | null
}

type ClassFacts = Omit<ReincClass, 'id' | 'name' | 'code'>

const CLASS_FACTS: Record<ClassId, ClassFacts> = {
  war: {
    passive: 'Less melee damage taken',
    first: '2%',
    active: { name: 'Thrash', does: 'Four main-hand rounds on everything within 40 feet.' },
    stances: ['defensive'],
    mana: null
  },
  clr: {
    passive: 'Healing spells cost less mana',
    first: '2%',
    active: { name: 'Divine Wrath', does: 'Your next cleric or paladin nuke hits 50% harder and casts 50% faster.' },
    stances: [],
    mana: 'WIS'
  },
  pal: {
    passive: 'Instant heals on you heal more',
    first: '3%',
    active: { name: 'Healing Touch', does: 'Heals a friend, or an enemy’s target, for half their health at once.' },
    stances: ['defensive'],
    mana: 'WIS'
  },
  rng: {
    passive: 'Better chance to hit',
    first: '3%',
    active: { name: 'Perfect Technique', does: 'Doubles your chance to hit and strikes through every defence.' },
    stances: ['evasive'],
    mana: 'WIS'
  },
  shd: {
    passive: 'Instant lifetaps you cast hit harder',
    first: '3%',
    active: { name: 'Drain Touch', does: 'Spends half your current health and deals that much as damage.' },
    stances: ['defensive'],
    mana: 'INT'
  },
  dru: {
    passive: 'Every spell casts faster',
    first: '2%',
    active: { name: 'Nature’s Revenge', does: 'Doubles the damage of the thorn damage shields on you.' },
    stances: [],
    mana: 'WIS'
  },
  mnk: {
    passive: 'Better chance to dodge',
    first: '2%',
    active: { name: 'Perfect Self', does: 'Cures you of everything and heals half your health.' },
    stances: ['evasive'],
    mana: null
  },
  brd: {
    passive: 'Faster movement',
    first: '3%',
    active: { name: 'Fading Memories', does: 'Escapes combat with NPCs up to 5 levels above you, and turns you invisible.' },
    stances: ['evasive'],
    mana: 'INT'
  },
  rog: {
    passive: 'Activated skills hit harder (Backstab, Kick, Bash and the rest)',
    first: '3%',
    active: { name: 'Preparation', does: 'Restores a fifth of your health and endurance.' },
    stances: ['evasive'],
    mana: null
  },
  shm: {
    passive: 'Beneficial spells without a heal cost less mana',
    first: '3%',
    active: { name: 'Judgement', does: 'Sets off every DoT you have on the target at once, when that would kill it.' },
    stances: [],
    mana: 'WIS'
  },
  nec: {
    passive: 'DoTs cost less mana',
    first: '2%',
    active: { name: 'Defiled Rune', does: 'For 30 seconds your spells cost health instead of mana.' },
    stances: [],
    mana: 'INT'
  },
  wiz: {
    passive: 'Nukes cost less mana',
    first: '2%',
    active: { name: 'Rune of Twincast', does: 'Your next two nukes twincast.' },
    stances: [],
    mana: 'INT'
  },
  mag: {
    passive: 'Your pet hits harder',
    first: '3%',
    active: { name: 'Summoner’s Rune', does: 'Restores your pet fully and cures it.' },
    stances: [],
    mana: 'INT'
  },
  enc: {
    passive: 'Detrimental spells that do no damage cost less mana',
    first: '3%',
    active: { name: 'Rune of Acceleration', does: 'Your next two spells cast at once (within 2 minutes).' },
    stances: [],
    mana: 'INT'
  },
  bst: {
    passive: 'Your pet attacks faster',
    first: '3%',
    active: { name: 'Bestial Fury', does: 'Your pet procs twice as often for 30 seconds.' },
    stances: ['evasive'],
    mana: 'WIS'
  },
  ber: {
    passive: 'Endurance costs less',
    first: '3%',
    active: { name: 'Blood Scar', does: 'A Blood Rune of two-thirds of your missing health, over your cap.' },
    stances: [],
    mana: null
  }
}

/** The sixteen class AAs, in the order class pickers list them (melee, priests, casters). */
export const REINC_CLASSES: readonly ReincClass[] = CLASSES.map(([id, name]) => ({
  id,
  name,
  code: CLASS_TABLE.find((c) => c.id === id)!.code,
  ...CLASS_FACTS[id]
}))

export interface ReincRace {
  race: string
  passive: string
  first: string
}

const RACE_FACTS: Record<Exclude<(typeof PLAYABLE_RACES)[number], 'Drakkin'>, [string, string]> = {
  Human: ['Higher base stat caps', '+5'],
  Barbarian: ['Less cold damage taken', '3%'],
  Erudite: ['Mana regeneration', '+2'],
  'Wood Elf': ['Longer reach for spells and ranged attacks', '+10'],
  'High Elf': ['Less magic damage taken', '3%'],
  'Dark Elf': ['Less fire damage taken', '3%'],
  'Half Elf': ['Higher base stat caps and every resist', '+3'],
  Dwarf: ['Resists fear more often', '10%'],
  Troll: ['HP regeneration', '+3'],
  Ogre: ['Resists stuns more often', '10%'],
  Halfling: ['Snares slow you less', '15%'],
  Gnome: ['Resists charm and mez more often', '10%'],
  Iksar: ['HP regeneration and base AC', '+2 regen, +5 AC'],
  Kerran: ['Endurance regeneration and Safe Fall', '+2 regen, +10 Safe Fall'],
  Froglok: ['Jump higher, and HP regeneration', '10% jump, +1 regen'],
  // The client's text leaves its number out ("by #1%").
  'Half Dark Elf': ['Longer range for tracking and map awareness', '?%']
}

/**
 * The playable races' AAs but Drakkin's: the game's text for it is blank (2026-11-11), a rank does nothing
 * anyone can see, and the player leaves it out (2026-11-15). The client also has a placeholder
 * ("Race 18") for a race no one can play.
 */
export const REINC_RACES: readonly ReincRace[] = PLAYABLE_RACES.filter((r): r is keyof typeof RACE_FACTS => r !== 'Drakkin').map((race) => ({
  race,
  passive: RACE_FACTS[race][0],
  first: RACE_FACTS[race][1]
}))

export const COMPLETIONIST = {
  name: 'Reincarnation: Completionist',
  passive: 'Melee damage, a rank each time every class AA reaches the next rank',
  first: '1%',
  active: 'Improved Ranger Gate'
} as const

/** A line's key: `class:shd`, `race:Wood Elf`. */
export type ReincKey = `class:${ClassId}` | `race:${string}`
export const classKey = (id: ClassId): ReincKey => `class:${id}`
export const raceKey = (race: string): ReincKey => `race:${race}`

const CLASS_AA = /^Class Reincarnation: (.+)$/
const RACE_AA = /^Race Reincarnation: (.+)$/

/** The line an AA's name is, or null for any other AA (Completionist is counted, not read). */
export function reincKeyOf(aaName: string): ReincKey | null {
  const cls = CLASS_AA.exec(aaName.trim())
  if (cls) {
    const id = classIdOf(cls[1])
    return id ? classKey(id) : null
  }
  const named = RACE_AA.exec(aaName.trim())?.[1].trim().toLowerCase()
  const race = named ? REINC_RACES.find((r) => r.race.toLowerCase() === named) : undefined
  return race ? raceKey(race.race) : null
}

/** Every line's key: the classes, then the races. */
export const REINC_KEYS: readonly ReincKey[] = [...REINC_CLASSES.map((c) => classKey(c.id)), ...REINC_RACES.map((r) => raceKey(r.race))]

// ---- What the player keeps ----

/** One line of the priority list: this class or race, up to this rank. A line can be on the list twice (Monk to 1 early, to 3 later). */
export interface PriorityEntry {
  key: ReincKey
  rank: number
}

/** A rank the player set by hand, and when: a rank the log sees later wins over it. */
export interface HandRank {
  rank: number
  at: number
}

/** A reincarnation the player said they made (the log's are read from it, not kept). */
export interface ReincDone {
  at: number
  classes: ClassId[]
  race: string
  by: 'log' | 'hand'
}

/** Whether a class was at the level cap, when, and who said so: the player, or /who for the classes being played. */
export interface LevelSeen {
  capped: boolean
  at: number
  by: 'hand' | 'who'
}

export interface ReincCharacter {
  hand: Partial<Record<ReincKey, HandRank>>
  /** The order the player wants ranks in; the plan is made from it. */
  priority: PriorityEntry[]
  /** Each class at the cap or not, as last seen. A reincarnation after it sets the class back to level 1. */
  levels: Partial<Record<ClassId, LevelSeen>>
  /** The class every levelling trio keeps; '' for none. */
  anchor: ClassId | ''
  done: ReincDone[]
}

export const emptyReincCharacter = (): ReincCharacter => ({ hand: {}, priority: [], levels: {}, anchor: '', done: [] })

const isClassId = (v: unknown): v is ClassId => typeof v === 'string' && CLASS_TABLE.some((c) => c.id === v)
const isRace = (v: unknown): v is string => typeof v === 'string' && REINC_RACES.some((r) => r.race === v)
const isKey = (v: unknown): v is ReincKey => typeof v === 'string' && (REINC_KEYS as readonly string[]).includes(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The longest priority list kept: every line three times over. */
export const MAX_PRIORITY = 3 * 32

/** A trio's classes, if they are three different classes. */
function trioOf(v: unknown): ClassId[] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isClassId) || new Set(v).size !== 3) return null
  return [...v]
}

/** A priority list as the page sends it: null when a line is not one or the list is too long. */
export function sanitizePriority(v: unknown): PriorityEntry[] | null {
  if (!Array.isArray(v) || v.length > MAX_PRIORITY) return null
  const out: PriorityEntry[] = []
  for (const e of v) {
    const x = (e ?? {}) as Record<string, unknown>
    if (!isKey(x.key) || !Number.isInteger(x.rank) || (x.rank as number) < 1 || (x.rank as number) > REINC_RANKS) return null
    out.push({ key: x.key, rank: x.rank as number })
  }
  return out
}

/**
 * The priority list an older file's trios stand for (the planner kept trios before 2026-11-15): each
 * class and race where it first comes, up to the number of trios it is in. Those were ranks to add, so
 * this is right for lines planned from rank 0, which every line in them was.
 */
function priorityFromTrios(plans: unknown[]): PriorityEntry[] {
  const out: PriorityEntry[] = []
  for (const p of plans) {
    const x = (p ?? {}) as Record<string, unknown>
    const classes = trioOf(x.classes)
    if (!classes) continue
    const keys: ReincKey[] = [...classes.map(classKey), ...(isRace(x.race) ? [raceKey(x.race)] : [])]
    for (const k of keys) {
      const had = out.find((e) => e.key === k)
      if (had) had.rank = Math.min(REINC_RANKS, had.rank + 1)
      else out.push({ key: k, rank: 1 })
    }
  }
  return out.slice(0, MAX_PRIORITY)
}

/** What the file holds for a character, with anything it cannot use left out. */
export function sanitizeReincCharacter(v: unknown): ReincCharacter {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const hand: ReincCharacter['hand'] = {}
  if (o.hand && typeof o.hand === 'object')
    for (const [k, h] of Object.entries(o.hand as Record<string, unknown>)) {
      const r = h as Partial<HandRank> | null
      if (isKey(k) && r && Number.isInteger(r.rank) && r.rank! >= 0 && r.rank! <= REINC_RANKS && isTime(r.at)) hand[k] = { rank: r.rank!, at: r.at }
    }
  const priority = Array.isArray(o.priority) ? o.priority.flatMap((e) => sanitizePriority([e]) ?? []) : Array.isArray(o.plans) ? priorityFromTrios(o.plans) : []
  const levels: ReincCharacter['levels'] = {}
  if (o.levels && typeof o.levels === 'object')
    for (const [k, l] of Object.entries(o.levels as Record<string, unknown>)) {
      const x = (l ?? {}) as Record<string, unknown>
      if (isClassId(k) && typeof x.capped === 'boolean' && isTime(x.at) && (x.by === 'hand' || x.by === 'who')) levels[k] = { capped: x.capped, at: x.at, by: x.by }
    }
  const done = Array.isArray(o.done)
    ? o.done.flatMap((d): ReincDone[] => {
        const x = (d ?? {}) as Record<string, unknown>
        const classes = trioOf(x.classes)
        return classes && isTime(x.at) && (x.race === '' || isRace(x.race)) ? [{ at: x.at, classes, race: x.race as string, by: 'hand' }] : []
      })
    : []
  return { hand, priority: priority.slice(0, MAX_PRIORITY), levels, anchor: isClassId(o.anchor) ? o.anchor : '', done }
}

// ---- Ranks ----

/** One rank the log saw given: the AA's name, the rank, when. */
export interface RankEvent {
  name: string
  rank: number
  at: number
}

/** What the log last said of each line: its rank and when. Refunds are not a thing for these AAs. */
export function loggedRanks(events: readonly RankEvent[]): Partial<Record<ReincKey, HandRank>> {
  const out: Partial<Record<ReincKey, HandRank>> = {}
  for (const e of events) {
    const k = reincKeyOf(e.name)
    if (!k) continue
    const had = out[k]
    if (!had || e.at >= had.at) out[k] = { rank: Math.min(REINC_RANKS, Math.max(0, e.rank)), at: e.at }
  }
  return out
}

export interface LineRank {
  rank: number
  /** Where the rank comes from: the log, the player, or nothing yet (rank 0). */
  from: 'log' | 'hand' | 'none'
  /** What the log says, for the page to show beside a rank set by hand. */
  logged: number
}

/** A line's rank: the newer of what the log saw and what the player set. */
export function rankOf(logged: HandRank | undefined, hand: HandRank | undefined): LineRank {
  const l = logged?.rank ?? 0
  if (hand && (!logged || hand.at >= logged.at)) return { rank: hand.rank, from: 'hand', logged: l }
  return logged ? { rank: l, from: 'log', logged: l } : { rank: 0, from: 'none', logged: 0 }
}

/** Completionist's rank: how many ranks every class AA has reached. */
export const completionistRank = (ranks: Partial<Record<ReincKey, LineRank>>): number => Math.min(...REINC_CLASSES.map((c) => ranks[classKey(c.id)]?.rank ?? 0))

/** Rank events of the four AAs one reincarnation gives come together; further apart than this, they are two. */
const ONE_REINCARNATION_MS = 2 * 60_000

/**
 * The reincarnations the log saw: rank events of class and race AAs close together, each run one
 * reincarnation with the classes and race in it. A run with no class in it (a race AA alone) is left out.
 */
export function loggedReincarnations(events: readonly RankEvent[]): ReincDone[] {
  const runs: ReincDone[] = []
  let last = -Infinity
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const k = reincKeyOf(e.name)
    if (!k) continue
    if (e.at - last > ONE_REINCARNATION_MS) runs.push({ at: e.at, classes: [], race: '', by: 'log' })
    last = e.at
    const run = runs[runs.length - 1]
    if (k.startsWith('class:')) {
      const id = k.slice(6) as ClassId
      if (!run.classes.includes(id)) run.classes.push(id)
    } else run.race = k.slice(5)
  }
  return runs.filter((r) => r.classes.length > 0)
}

const sameTrio = (a: readonly ClassId[], b: readonly ClassId[]) => a.length === b.length && a.every((c) => b.includes(c))

/** The history to show: the log's reincarnations and the player's, newest first; one the player said and the log also saw (within a day) once. */
export function reincHistory(logged: readonly ReincDone[], said: readonly ReincDone[]): ReincDone[] {
  const DAY = 24 * 3600_000
  const fromHand = said.filter((h) => !logged.some((l) => sameTrio(l.classes, h.classes) && Math.abs(l.at - h.at) < DAY))
  return [...logged, ...fromHand].sort((a, b) => b.at - a.at)
}

/** Reincarnations left before every class has all three ranks: three a reincarnation, so a third of what is left, rounded up. */
export function reincarnationsLeft(ranks: Partial<Record<ReincKey, LineRank>>): { classes: number; races: number } {
  const left = (keys: ReincKey[]) => keys.reduce((n, k) => n + REINC_RANKS - (ranks[k]?.rank ?? 0), 0)
  return { classes: Math.ceil(left(REINC_CLASSES.map((c) => classKey(c.id))) / 3), races: left(REINC_RACES.map((r) => raceKey(r.race))) }
}

// ---- The XP penalty ----

/**
 * Levelling reincarnated classes and race takes more XP: 10% for each time one was reincarnated (past
 * rank 3 too, the player says: a reincarnation at rank 3 gains nothing but still counts), at level 50
 * and below, and only while you play them. Measured 2026-11-15 from one character's log (the same mob at
 * the same level, kill for kill, before and after): a trio and race's first reincarnation cost 10% and
 * its second 20%, not the 40% and 80% that adding the four lines would give. Counting the most-
 * reincarnated of the classes and race you play fits both. That is this module's reading; a loadout
 * whose lines differ would tell it apart from an average, say.
 */
export const XP_PENALTY_PER_RANK = 10
/** The penalty is on levels up to the cap, not on AA experience. */
export const XP_PENALTY_LEVELS = LEVEL_CAP

/** The XP penalty, in percent, for playing these classes and race with these ranks. */
export function xpPenalty(ranks: Partial<Record<ReincKey, { rank: number }>>, classes: readonly ClassId[], race: string): number {
  const keys: ReincKey[] = [...classes.map(classKey), ...(race ? [raceKey(race)] : [])]
  return XP_PENALTY_PER_RANK * Math.max(0, ...keys.map((k) => ranks[k]?.rank ?? 0))
}

// ---- Class levels ----

/** A class at the level cap or not, and what says so; null when nothing has. */
export interface ClassLevel {
  capped: boolean | null
  from: 'hand' | 'who' | 'reincarnated' | 'none'
}

/** Each class at the cap or not: the newer of what was last seen and a reincarnation of it (which sets it to level 1). */
export function classLevels(seen: ReincCharacter['levels'], reincs: readonly Pick<ReincDone, 'at' | 'classes'>[]): Record<ClassId, ClassLevel> {
  const out = {} as Record<ClassId, ClassLevel>
  for (const c of REINC_CLASSES) {
    const s = seen[c.id]
    const last = Math.max(-1, ...reincs.filter((r) => r.classes.includes(c.id)).map((r) => r.at))
    out[c.id] = s && s.at >= last ? { capped: s.capped, from: s.by } : last >= 0 ? { capped: false, from: 'reincarnated' } : { capped: null, from: 'none' }
  }
  return out
}

/**
 * The levels kept, after the classes played now (the character record, from /who); null when they
 * change nothing. A class reincarnated since it was last seen is not taken as at the cap on the
 * record's word: the record may be from before the reincarnation. The player says so instead.
 */
export function levelsSeen(
  kept: ReincCharacter['levels'],
  reincs: readonly Pick<ReincDone, 'at' | 'classes'>[],
  playing: readonly { id: ClassId; level: number }[],
  at: number
): ReincCharacter['levels'] | null {
  const now = classLevels(kept, reincs)
  let next: ReincCharacter['levels'] | null = null
  for (const c of playing) {
    const capped = c.level >= LEVEL_CAP
    if (now[c.id].capped === capped || (capped && now[c.id].from === 'reincarnated')) continue
    next = { ...(next ?? kept), [c.id]: { capped, at, by: 'who' } }
  }
  return next
}

// ---- The plan ----

/** A reincarnation the plan makes: three classes and a race, and which of them the rankings did not ask for. */
export interface PlannedReinc {
  classes: ClassId[]
  /** '' when no race is known: the one played then gains the rank. */
  race: string
  /** Classes and race taken to make up the reincarnation: their ranks are done, it needs them for the races. */
  extra: ReincKey[]
  /** How many times each of its lines has been reincarnated, this one counted. */
  times: Partial<Record<ReincKey, number>>
}

/** A trio to level as: its classes, which of them are below the cap and level, and the XP penalty while it does. */
export interface LevelRun {
  classes: ClassId[]
  /** The classes below the cap, levelled by this trio. */
  levels: ClassId[]
  /** Slots left for any class reincarnated no more often than the trio's lines, when no class that needs levelling fits. */
  open: number
  race: string
  /** Whether the race is below the cap and levels too (a reincarnation sets it to level 1). */
  raceLevels: boolean
  /** With the race. */
  penalty: number
  /** The classes' alone: lower when the race has been reincarnated more often than they have. */
  classPenalty: number
}

/** The levelling before a reincarnation (or after the last one, when `reinc` is null), then it. */
export interface PlanStage {
  runs: LevelRun[]
  reinc: PlannedReinc | null
}

export interface PlanInput {
  /** Reincarnations so far, by line: its rank, or more for a line reincarnated past rank 3. */
  times: Partial<Record<ReincKey, number>>
  priority: readonly PriorityEntry[]
  /** Below the cap: false. At it, or not known (taken as at it: the player's classes are levelled), anything else. */
  capped: Partial<Record<ClassId, boolean | null>>
  /** The class every levelling trio keeps; '' for none. */
  anchor: ClassId | ''
  /** The race played now, and whether it is at the cap (every other race is taken as at it). */
  race: string
  raceCapped: boolean
  /** The last reincarnation made: its classes and race still short of rank 3 go on to it before any others start. */
  last?: Pick<ReincDone, 'classes' | 'race'> | null
}

/** The most reincarnations a plan runs to: every race three times over. */
const MAX_REINCS = 48

const isClassKey = (k: ReincKey): k is `class:${ClassId}` => k.startsWith('class:')
const classOfKey = (k: `class:${ClassId}`) => k.slice(6) as ClassId
const CLASS_ORDER = REINC_CLASSES.map((c) => c.id)
const hasStance = (c: ClassId, s: Stance) => reincClass(c).stances.includes(s)

/** The player's order of every class and of every race: those on the list first, in its order, then the rest in the game's order. */
export function rankedLines(priority: readonly PriorityEntry[]): { classes: ClassId[]; races: string[] } {
  const classes: ClassId[] = []
  const races: string[] = []
  for (const e of priority) {
    if (isClassKey(e.key)) {
      if (!classes.includes(classOfKey(e.key))) classes.push(classOfKey(e.key))
    } else if (!races.includes(e.key.slice(5))) races.push(e.key.slice(5))
  }
  for (const c of CLASS_ORDER) if (!classes.includes(c)) classes.push(c)
  for (const r of REINC_RACES) if (!races.includes(r.race)) races.push(r.race)
  return { classes, races }
}

/** Reincarnations so far, by line: the rank, or how many the history shows when more (a line reincarnated at rank 3 gains nothing but still counts). */
export function reincTimes(ranks: Partial<Record<ReincKey, { rank: number }>>, history: readonly Pick<ReincDone, 'classes' | 'race'>[]): Partial<Record<ReincKey, number>> {
  const seen: Partial<Record<ReincKey, number>> = {}
  for (const h of history) for (const k of [...h.classes.map(classKey), ...(h.race ? [raceKey(h.race)] : [])]) seen[k] = (seen[k] ?? 0) + 1
  const out: Partial<Record<ReincKey, number>> = {}
  for (const k of REINC_KEYS) out[k] = Math.max(ranks[k]?.rank ?? 0, seen[k] ?? 0)
  return out
}

/** Every way to take `k` of `from`, in order. */
function combos<T>(from: readonly T[], k: number): T[][] {
  if (k === 0) return [[]]
  return from.flatMap((x, i) => combos(from.slice(i + 1), k - 1).map((rest) => [x, ...rest]))
}

/**
 * The whole plan, as the player plays it: every class and race starts at the cap (but those /who, a
 * reincarnation or the player says are below it). A reincarnation takes three classes at the cap and
 * a race at the cap, and sets all four to level 1. Then one levelling trio, as that race: the anchor
 * class (the player's choice, in every levelling trio) and two classes at level 1, which brings the
 * race and those two back to the cap; the third class levels in the next trio. When too few classes
 * are at the cap for the next reincarnation, another levelling trio comes first, as the race played then.
 *
 * A class or race reincarnated goes on to rank 3 before any other starts (the player, 2026-11-18: with
 * the anchor at rank 3 every levelling trio costs its 30% anyway, so nothing is saved by spreading the
 * ranks, and none is left part done): the next reincarnation takes the last one's classes and race still
 * below rank 3 again, so it waits, levelling trios first, until all of them are back at the cap. The
 * third class's trio has a place over for a class a group before left at level 1.
 *
 * Otherwise reincarnations go by the player's order: the highest classes at the cap still below rank 3, and the
 * highest race at the cap below it. Once fewer classes than that are ready, the trio is made up from
 * classes at the cap reincarnated least often (each time adds 10% to levelling that class), in the
 * player's order; the anchor takes its turn only while one more leaves it below the most-reincarnated
 * class (the player's rule). With every race at rank 3 the reincarnations end; races take three times
 * as many reincarnations as classes, so classes are reincarnated past rank 3 on the way. Last, levelling
 * trios (as the last race) bring every class still below the cap back to it.
 *
 * A levelling trio's two places go to the pair that, in turn: has the most classes still below rank 3
 * (they must be back at the cap to be reincarnated again), carries the least XP penalty (10% for each
 * reincarnation of the most-reincarnated of the trio and race), has evasive stance (else defensive),
 * has been reincarnated least (so the extra reincarnations spread), and comes highest in the player's
 * order.
 */
export function makePlan(input: PlanInput): PlanStage[] {
  const order = rankedLines(input.priority)
  const times: Partial<Record<ReincKey, number>> = {}
  for (const k of REINC_KEYS) times[k] = input.times[k] ?? 0
  const tc = (c: ClassId) => times[classKey(c)]!
  const tr = (r: string) => (r ? times[raceKey(r)]! : 0)
  const atCap: Partial<Record<ClassId, boolean>> = {}
  for (const c of CLASS_ORDER) atCap[c] = input.capped[c] !== false
  const raceAtCap: Partial<Record<string, boolean>> = {}
  for (const r of REINC_RACES) raceAtCap[r.race] = true
  if (input.race) raceAtCap[input.race] = input.raceCapped
  let race = input.race
  let last = input.last ?? null
  const anchor = input.anchor
  const pos = (c: ClassId) => order.classes.indexOf(c)
  const needs = (c: ClassId) => tc(c) < REINC_RANKS
  const stanceOf = (cs: readonly ClassId[]) => (cs.some((c) => hasStance(c, 'evasive')) ? 2 : cs.some((c) => hasStance(c, 'defensive')) ? 1 : 0)

  /** One levelling trio as `as`: the anchor and the best classes below the cap; at the cap after it. */
  const levelRun = (as: string): LevelRun => {
    const fixed: ClassId[] = anchor ? [anchor] : []
    const below = order.classes.filter((c) => !fixed.includes(c) && !atCap[c])
    const raceT = tr(as)
    const penalty = (cs: readonly ClassId[]) => Math.max(raceT, ...cs.map(tc))
    const score = (pick: ClassId[]): number[] => {
      const trio = [...fixed, ...pick]
      return [-pick.filter(needs).length, penalty(trio), Math.max(0, ...pick.map(tc)), -stanceOf(trio), pick.reduce((n, c) => n + tc(c), 0), pick.reduce((n, c) => n + pos(c), 0)]
    }
    const better = (a: number[], b: number[]) => {
      const i = a.findIndex((x, j) => x !== b[j])
      return i >= 0 && a[i] < b[i]
    }
    let pick: ClassId[] = []
    let best: number[] | null = null
    for (const c of combos(below, Math.min(3 - fixed.length, below.length))) {
      const s = score(c)
      if (!best || better(s, best)) [pick, best] = [c, s]
    }
    const classes = [...fixed, ...pick]
    // A place nothing below the cap fills: a class at it with the stance the trio lacks, adding no penalty.
    const floor = penalty(classes)
    for (const s of ['evasive', 'defensive'] as const) {
      if (classes.length >= 3 || stanceOf(classes) >= (s === 'evasive' ? 2 : 1)) continue
      const carry = order.classes.filter((c) => !classes.includes(c) && atCap[c] && tc(c) <= floor && hasStance(c, s)).sort((a, b) => tc(a) - tc(b))[0]
      if (carry) classes.push(carry)
    }
    const levels = classes.filter((c) => !atCap[c])
    const raceLevels = !!as && raceAtCap[as] === false
    for (const c of classes) atCap[c] = true
    if (as) raceAtCap[as] = true
    const classPenalty = XP_PENALTY_PER_RANK * Math.max(0, ...classes.map(tc))
    return { classes, levels, open: 3 - classes.length, race: as, raceLevels, penalty: Math.max(classPenalty, XP_PENALTY_PER_RANK * raceT), classPenalty }
  }

  /** The next reincarnation from the classes and races at the cap; null when too few are. */
  const nextReinc = (): PlannedReinc | null => {
    const most = Math.max(0, ...CLASS_ORDER.filter((c) => c !== anchor).map(tc))
    const allowed = (c: ClassId) => c !== anchor || tc(c) < most
    const ok = (c: ClassId) => atCap[c] && allowed(c)
    // The last reincarnation's lines short of rank 3 go again, once they are back at the cap.
    const going = (last?.classes ?? []).filter((c) => needs(c) && allowed(c))
    const goingRace = last?.race && tr(last.race) < REINC_RANKS ? last.race : ''
    if (going.some((c) => !atCap[c]) || (goingRace && !raceAtCap[goingRace])) return null
    const classes = [...going, ...order.classes.filter((c) => !going.includes(c) && ok(c) && needs(c))].slice(0, 3)
    const extra: ReincKey[] = []
    for (const c of order.classes.filter((x) => ok(x) && !classes.includes(x)).sort((a, b) => tc(a) - tc(b) || pos(a) - pos(b))) {
      if (classes.length >= 3) break
      classes.push(c)
      extra.push(classKey(c))
    }
    const ready = order.races.filter((r) => raceAtCap[r])
    const wanted = goingRace || ready.find((r) => tr(r) < REINC_RANKS)
    const r = wanted ?? [...ready].sort((a, b) => tr(a) - tr(b))[0]
    if (classes.length < 3 || !r) return null
    if (!wanted) extra.push(raceKey(r))
    return { classes, race: r, extra, times: {} }
  }

  const unfinished = () => order.classes.some(needs) || order.races.some((r) => tr(r) < REINC_RANKS)
  const stages: PlanStage[] = []
  // Levelling under way now (the race played is below the cap): finished first.
  let runs: LevelRun[] = race && raceAtCap[race] === false ? [levelRun(race)] : []
  while (stages.length < MAX_REINCS && unfinished()) {
    let reinc = nextReinc()
    for (let n = 0; !reinc && n < CLASS_ORDER.length; n++) {
      runs.push(levelRun(race))
      reinc = nextReinc()
    }
    if (!reinc) break
    const keys = [...reinc.classes.map(classKey), raceKey(reinc.race)]
    for (const k of keys) times[k]! += 1
    reinc.times = Object.fromEntries(keys.map((k) => [k, times[k]]))
    for (const c of reinc.classes) atCap[c] = false
    raceAtCap[reinc.race] = false
    race = reinc.race
    last = reinc
    stages.push({ runs, reinc })
    runs = [levelRun(race)]
  }
  // Then every class back to the cap: the plan ends with all of them at 50, the anchor in each trio still.
  for (let n = 0; CLASS_ORDER.some((c) => !atCap[c]) && n < CLASS_ORDER.length; n++) runs.push(levelRun(race))
  if (runs.length) stages.push({ runs, reinc: null })
  return stages
}

// ---- A trio's notes ----

export interface TrioNotes {
  evasive: ClassId[]
  defensive: ClassId[]
  wis: ClassId[]
  int: ClassId[]
  /** Casters on both stats: each class's mana comes from its own, so neither gets all the trio's gear. */
  mixed: boolean
}

export const reincClass = (id: ClassId): ReincClass => REINC_CLASSES.find((c) => c.id === id)!

/** What a trio has of the things a planner weighs: the stances, and which stat its mana comes from. */
export function trioNotes(classes: readonly ClassId[]): TrioNotes {
  const cs = classes.map(reincClass)
  const wis = cs.filter((c) => c.mana === 'WIS').map((c) => c.id)
  const int = cs.filter((c) => c.mana === 'INT').map((c) => c.id)
  return {
    evasive: cs.filter((c) => c.stances.includes('evasive')).map((c) => c.id),
    defensive: cs.filter((c) => c.stances.includes('defensive')).map((c) => c.id),
    wis,
    int,
    mixed: wis.length > 0 && int.length > 0
  }
}

// ---- What the page shows ----

export interface ReincState {
  character: string
  /** Every line's rank, by key. */
  ranks: Partial<Record<ReincKey, LineRank>>
  completionist: number
  /** The order the player wants ranks in. */
  priority: PriorityEntry[]
  /** Each class at the level cap or not, as far as anything says. */
  levels: Record<ClassId, ClassLevel>
  /** The class every levelling trio keeps; '' for none. */
  anchor: ClassId | ''
  /** Reincarnations made, newest first. */
  history: ReincDone[]
  /** The character's race and classes as its record has them (from /who), with each class's level. */
  loadout: { race: string; classes: { id: ClassId; level: number }[] }
  /** Tokens of Reincarnation in the inventory export; null without one. */
  tokens: { count: number; modified: number } | null
  /** The first line of the oldest log read. */
  logFrom: number
}

/** The token's name, as the inventory export lists it. */
const TOKEN = 'token of reincarnation'

/** Tokens of Reincarnation in an inventory export: bags, bank, shared bank, depot and Storage. */
export function tokenCount(inv: Pick<Inventory, 'bags' | 'bank' | 'sharedBank' | 'depot' | 'keyRing'>): number {
  let n = 0
  for (const it of [...inv.bags, ...inv.bank, ...inv.sharedBank, ...inv.depot]) if (it.name.trim().toLowerCase() === TOKEN) n += it.count || 1
  for (const k of inv.keyRing) if (k.name.trim().toLowerCase() === TOKEN) n++
  return n
}
