import { CLASSES, CLASS_TABLE, classIdOf, type ClassId } from '../../shared/game/classes'
import { PLAYABLE_RACES } from '../../shared/game/races'
import type { Inventory } from '../../shared/character'

// Goals › Reincarnation (an optional module): the 2026-11-10 patch's Reincarnation AAs, one line per
// class and per race, three ranks each, and the player's plan of which trio and race to reincarnate
// next. A reincarnation takes a Token of Reincarnation and a three-class loadout at the level cap; it
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

const RACE_FACTS: Record<(typeof PLAYABLE_RACES)[number], [string, string]> = {
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
  // The game's text for it is blank (2026-11-11): a rank does nothing anyone can see yet.
  Drakkin: ['Nothing yet: the game’s text for it is blank', '—']
}

/** The sixteen playable races' AAs. The client also has Half Dark Elf's and a placeholder, for races no one can play. */
export const REINC_RACES: readonly ReincRace[] = PLAYABLE_RACES.map((race) => ({ race, passive: RACE_FACTS[race][0], first: RACE_FACTS[race][1] }))

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

/** A trio and race the player means to reincarnate as. */
export interface ReincPlan {
  id: string
  /** Three classes, none twice. */
  classes: ClassId[]
  /** The race; '' while not chosen. */
  race: string
  /** When it was planned: a reincarnation the log sees after it, as this trio and race, is this one done. */
  since: number
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

export interface ReincCharacter {
  hand: Partial<Record<ReincKey, HandRank>>
  plans: ReincPlan[]
  done: ReincDone[]
}

export const emptyReincCharacter = (): ReincCharacter => ({ hand: {}, plans: [], done: [] })

const isClassId = (v: unknown): v is ClassId => typeof v === 'string' && CLASS_TABLE.some((c) => c.id === v)
const isRace = (v: unknown): v is string => typeof v === 'string' && REINC_RACES.some((r) => r.race === v)
const isKey = (v: string): v is ReincKey => (REINC_KEYS as readonly string[]).includes(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The most plans kept: every class three times over, as trios, with room to spare. */
export const MAX_PLANS = 48

/** A trio's classes, if they are three different classes. */
function trioOf(v: unknown): ClassId[] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isClassId) || new Set(v).size !== 3) return null
  return [...v]
}

/** A plan as the page sends it or the file holds it; null when it is not one. */
export function sanitizePlan(v: unknown): ReincPlan | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const classes = trioOf(p.classes)
  if (!classes || typeof p.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id)) return null
  const race = p.race === '' || p.race === undefined ? '' : isRace(p.race) ? p.race : null
  if (race === null) return null
  return { id: p.id, classes, race, since: isTime(p.since) ? p.since : 0 }
}

/** Plans as the page sends them: null when any is not one, two share an id, or there are too many. */
export function sanitizePlans(v: unknown): ReincPlan[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLANS) return null
  const plans = v.map(sanitizePlan)
  if (plans.some((p) => !p)) return null
  const ok = plans as ReincPlan[]
  return new Set(ok.map((p) => p.id)).size === ok.length ? ok : null
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
  const plans = Array.isArray(o.plans)
    ? o.plans
        .map(sanitizePlan)
        .filter((p): p is ReincPlan => !!p)
        .slice(0, MAX_PLANS)
    : []
  const done = Array.isArray(o.done)
    ? o.done.flatMap((d): ReincDone[] => {
        const x = (d ?? {}) as Record<string, unknown>
        const classes = trioOf(x.classes)
        return classes && isTime(x.at) && (x.race === '' || isRace(x.race)) ? [{ at: x.at, classes, race: x.race as string, by: 'hand' }] : []
      })
    : []
  return { hand, plans, done }
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

/**
 * The plans the log has not yet seen done: a reincarnation after a plan was made, as its trio (and its
 * race, when the plan has one), takes the first such plan off. Each reincarnation takes one plan.
 */
export function openPlans(plans: readonly ReincPlan[], seen: readonly ReincDone[]): { open: ReincPlan[]; done: ReincPlan[] } {
  const done: ReincPlan[] = []
  const used = new Set<ReincDone>()
  for (const p of plans) {
    const r = seen.find((s) => !used.has(s) && s.at >= p.since && sameTrio(s.classes, p.classes) && (!p.race || p.race === s.race))
    if (!r) continue
    used.add(r)
    done.push(p)
  }
  return { open: plans.filter((p) => !done.includes(p)), done }
}

/** The history to show: the log's reincarnations and the player's, newest first; one the player said and the log also saw (within a day) once. */
export function reincHistory(logged: readonly ReincDone[], said: readonly ReincDone[]): ReincDone[] {
  const DAY = 24 * 3600_000
  const fromHand = said.filter((h) => !logged.some((l) => sameTrio(l.classes, h.classes) && Math.abs(l.at - h.at) < DAY))
  return [...logged, ...fromHand].sort((a, b) => b.at - a.at)
}

// ---- The plan's pool ----

export interface Pool {
  /** By class: ranks still to plan (3 less done, less planned); below 0 when planned too often. */
  classes: Record<ClassId, number>
  races: Record<string, number>
}

/** What is left to place in a plan: each class and race three times, less the ranks held and the plans made. */
export function poolLeft(ranks: Partial<Record<ReincKey, LineRank>>, plans: readonly ReincPlan[]): Pool {
  const classes = {} as Record<ClassId, number>
  for (const c of REINC_CLASSES) classes[c.id] = REINC_RANKS - (ranks[classKey(c.id)]?.rank ?? 0)
  const races: Record<string, number> = {}
  for (const r of REINC_RACES) races[r.race] = REINC_RANKS - (ranks[raceKey(r.race)]?.rank ?? 0)
  for (const p of plans) {
    for (const c of p.classes) classes[c]--
    if (p.race) races[p.race]--
  }
  return { classes, races }
}

/** Reincarnations left before every class has all three ranks: three a reincarnation, so a third of what is left, rounded up. */
export function reincarnationsLeft(ranks: Partial<Record<ReincKey, LineRank>>): { classes: number; races: number } {
  const left = (keys: ReincKey[]) => keys.reduce((n, k) => n + REINC_RANKS - (ranks[k]?.rank ?? 0), 0)
  return { classes: Math.ceil(left(REINC_CLASSES.map((c) => classKey(c.id))) / 3), races: left(REINC_RACES.map((r) => raceKey(r.race))) }
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
  /** The plans not yet done, in the player's order. */
  plans: ReincPlan[]
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
