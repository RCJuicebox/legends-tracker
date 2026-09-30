import { factionKey, NO_MOB, standingBand, type FactionMob, type FactionPageData } from './core'
import { itemKey } from '../../core/inventory'
import type { ItemInfo } from '../../shared/types'
import { usualAmount, type FactionSourceTallies, type SharedFrom, type SourceTally } from './attribution'
import type { QuestHandIn, QuestPage } from './questPages'
import { allaKills, allaNeeds, allaQuestAmounts, questKey, type AllaFaction, type AllaKill } from './allakhazam'
import {
  AMOUNTS,
  CAMPS,
  CITY_PEOPLE,
  CYCLES,
  FEW_IN_PLAY,
  ITEMS_IN_PLAY,
  NEEDS,
  ONCE_IN_PLAY,
  QUEST_COIN,
  QUEST_ITEMS_IN_PLAY,
  type HandInHow,
  type Need
} from '../../shared/game/factions'
import { factionNamer, isCity, zoneKey } from './names'

// What raises a faction comes from two places:
//   - the character's own log: every kill and hand-in that moved a faction, with the amounts
//     Legends really gives and how fast the player got through them (attribution.ts);
//   - eqlwiki: each faction page's mobs and quests, each quest page's hand-ins and faction lines.
//     The wiki's amounts are often missing (classic logs said only "got better"), and then the
//     usual amounts in the player's own log stand in for them.
// A kill camp is the mobs of one zone that move the same factions; a hand-in, one NPC's or one
// quest step's. How long one takes comes from the log where it can, and from a few settings the
// player can change where it cannot: kills an hour, how often a named mob comes back, how long it
// takes to gather an item a hand-in needs. Items already in bags, bank or depot cost nothing to get.
//
// A quest step is taken to repeat when it wants one kind of item that can be had (bought, dropped
// or crafted) and that nobody in the walkthrough hands you: four Bone Chips, a Small Piece of High
// Quality Ore. A step of a chain, one worth fifty points or more, or one whose hand-in the
// walkthrough does not make plain is taken to be once only; so is a hand-in the log saw fewer than
// three times, which most likely was a quest's reward and is done. Those are listed, not planned,
// unless the player locks one in: a lock says "I know it repeats; build around it".

export type ActivityKind = 'kill' | 'turnin' | 'quest'

export interface HandInItem {
  name: string
  /** Per hand-in. */
  count: number
  how: HandInHow
  /** A merchant (and zone), or a zone it drops in: '' when not known. */
  where: string
  /** In bags, bank, shared bank and depot at the last inventory export. */
  have?: number
  /** What one cost the last time the character bought it, in copper. */
  each?: number
  /** Dropped only by named mobs: how many different ones (their respawn sets the pace). */
  named?: number
  /** What the walkthrough combines these into before handing it in ("Box of Beetle Eyes"). */
  makes?: string
  /** Seconds to come by one, as found in play, where that is known better than any estimate. */
  sec?: number
  /** Who takes it, where that is not the step's NPC: a quest round's first hand-in (the milk goes to Mojax Hikspin). */
  to?: string
}

export interface PlanActivity {
  /** Stable across rebuilds, so a lock or a pace the player set sticks. */
  id: string
  kind: ActivityKind
  /** "A gnoll, A gnoll guardsman and 19 more", "Lashun Novashine", "Bone Chips Kaladim". */
  title: string
  zone: string
  /** A kill camp's mobs, most killed first. */
  mobs?: string[]
  /** Who a hand-in goes to. */
  npc?: string
  /** What one kill or hand-in does to each faction, by the game's faction names. */
  hits: Record<string, number>
  /** Factions whose amount is a guess (the wiki names the faction but not the amount). */
  guessed?: string[]
  source: 'log' | 'wiki'
  /** Log: how many times the player did it. */
  seen?: number
  /** Log: kills or hand-ins an hour while the player was at it. */
  measured?: number
  /** Kill camps: kinds of common mob, and named or single ones. */
  common?: number
  named?: number
  /** Kill camps: how many spawns there are of mobs play found only a few of; the camp goes at their respawn, whatever pace the log saw. */
  few?: number
  /** Hand-ins: what goes in each. */
  items?: HandInItem[]
  /** Taken to be done once only: why. Planned at most once unless locked in. */
  once?: string
  /** The walkthrough line, for a wiki quest. */
  line?: string
  /** A wiki page to read more on: the quest's, or the faction's for a camp. */
  page?: string
  /** A wiki mob's note ("Quest NPC", "Merchant"). */
  note?: string
  /** Log: the player's other characters whose logs saw it too; `theirs` when only they did, not this one. */
  others?: string[]
  theirs?: boolean
  /** A kill camp of a city's people (guards, merchants, guildmasters): the guards may join in. */
  city?: boolean
  /** Hand-ins one unit takes: 2 where what the NPC gives back is handed back for as much again. */
  handIns?: number
  /** What the NPC gives back, handed back as the second of them ("Grilled Rat Ears"). */
  back?: string
  /** Why it cannot be done yet: its NPC takes it only above a con the character is not at. Planned only when locked in. */
  blocked?: string
  /** The con it needs, for a flag: "Amiable". */
  needs?: string
  /**
   * When it is blocked: the other races whose con its NPC takes (as an Agnostic of the export's class,
   * among the races the character has unlocked). The plan may use it with a swap to one of them in
   * Loadouts for the step, and back.
   */
  swap?: string[]
  /**
   * The cons its NPC wants, met now or not (a need a faked Indifferent meets left out): the plan checks
   * them as the standings move, and may raise a faction to get there.
   */
  gate?: Need[]
  /**
   * The factions of `gate` there is no con for: the faction is in neither the factions export nor the
   * achievements list (so its race and class modifiers cannot be looked up), or the character has no
   * race on record. The plan counts the standing alone there (0 where none is known), or takes the NPC
   * as open without a race.
   */
  conUnknown?: string[]
  /** Where the facts come from when not eqlwiki or the log: "Allakhazam". */
  site?: string
}

/** The amounts a guess stands in for: the usual ones in the player's own log. */
export interface Guesses {
  killUp: number
  killDown: number
  handUp: number
  handDown: number
}

export const DEFAULT_GUESSES: Guesses = { killUp: 5, killDown: -2, handUp: 5, handDown: -1 }

export interface CatalogInput {
  /** Every faction the game knows, as it writes them (the factions export's names). */
  factions: string[]
  /** The achievements still to do, by faction as the game writes it. */
  targets: string[]
  sources: FactionSourceTallies
  pages: FactionPageData[]
  /** Quest pages by title as faction pages link them. */
  quests: Record<string, QuestPage | null>
  /** Items the character has bought, by lower-cased name: from whom, and what one cost (copper). */
  bought: Record<string, { merchant: string; each: number }>
  /** What the character holds, by itemKey: bags, bank, shared bank and depot. */
  have: Record<string, number>
  /** What eqlwiki says of hand-in items, by itemKey. */
  items: Record<string, ItemInfo>
  /** Also the ways to raise every other faction the character has, to bring factions back from below zero (the Most factions positive goal). */
  wide?: boolean
  /** What the player's other characters' logs saw, by tally key: `sources` has it added in (shareSources). */
  shared?: SharedFrom
  /** Allakhazam's faction pages read so far: the cons quests want, kill and quest amounts, mobs eqlwiki lacks. */
  alla?: AllaFaction[]
  /** What each faction cons at now, by the game's names: the standing with the race's and class's modifiers. */
  cons?: Record<string, number>
  /** The same for each other race the character could swap to, by race: which of them opens a quest its own race cannot. */
  swapCons?: Record<string, Record<string, number>>
}

export interface FactionCatalog {
  activities: PlanActivity[]
  /** The player's kills an hour while killing things that move factions, over the log's runs; null with too few. */
  killsPerHour: number | null
  guesses: Guesses
}

export const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** The usual amounts in the log, each amount counted once per time it was seen. */
export function guessesFrom(sources: FactionSourceTallies): Guesses {
  const by: Record<string, number[]> = { killUp: [], killDown: [], handUp: [], handDown: [] }
  for (const t of Object.values(sources.acts)) {
    for (const amounts of Object.values(t.hits)) {
      for (const [a, n] of Object.entries(amounts)) {
        const v = Number(a)
        if (!v) continue
        const k = `${t.kind === 'kill' ? 'kill' : 'hand'}${v > 0 ? 'Up' : 'Down'}`
        for (let i = 0; i < Math.min(n, 50); i++) by[k].push(v)
      }
    }
  }
  const pick = (k: keyof Guesses) => (by[k].length >= 20 ? median(by[k]) : DEFAULT_GUESSES[k])
  return { killUp: pick('killUp'), killDown: pick('killDown'), handUp: pick('handUp'), handDown: pick('handDown') }
}

/** Kills an hour in a zone's runs, when there were enough of them to say. */
function zoneRate(sources: FactionSourceTallies, zone: string): number | null {
  const z = sources.zones[zone.toLowerCase()]
  if (!z || z.runN < 10 || z.runMs <= 0) return null
  return z.runN / (z.runMs / 3_600_000)
}

const COIN = /^(?:platinum|gold|silver|copper)(?: pieces?)?$/i
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
/** "Leatherfoot Raider Skullcap (drop)" → "Leatherfoot Raider Skullcap": the page's disambiguation off. */
const itemName = (page: string) => page.replace(/\s*\((?:drop|quest|item|ground spawn|quest item)\)\s*$/i, '').trim()

/** The other races (and trios) whose con meets every need, the best at the one not met first. */
function swapRaces(needs: Need[], faction: string, swapCons: CatalogInput['swapCons']): string[] {
  return Object.entries(swapCons ?? {})
    .filter(([, cons]) => !needs.some((n) => blockedBy(n, cons)))
    .sort(([, a], [, b]) => (b[faction] ?? 0) - (a[faction] ?? 0))
    .map(([race]) => race)
}

/** The factions of a gate with no con known, each once. */
function conUnknown(gate: Need[], cons: Record<string, number> | undefined): string[] {
  return [...new Set(gate.filter((n) => cons?.[n.faction] === undefined).map((n) => n.faction))]
}

/**
 * Why a quest cannot be done yet: its NPC wants a con the character is not at. A con can be faked as
 * far as Indifferent (0), not past it, so a need at or below that never stops one; one that wants a con
 * no better than some band stops one above it.
 */
function blockedBy(need: Need, cons: Record<string, number> | undefined): string {
  const con = cons?.[need.faction]
  if (con === undefined) return ''
  if (need.min !== undefined && (need.min > 0 || need.real) && con < need.min)
    return `needs ${need.band} with ${need.faction}; you con ${standingBand(con).word} (${con}), ${need.min - con} short`
  if (need.max !== undefined && con > need.max) return `wants no better than ${need.band} with ${need.faction}; you con ${standingBand(con).word} (${con})`
  return ''
}

const bareMob = (name: string) =>
  name
    .toLowerCase()
    .replace(/^(?:a|an)\s+/, '')
    .replace(/\s*(?:\(.*\)|-\s.*)$/, '')
    .trim()

/** The spawns of a camp's few-spawn mobs, as a field: none when it has none. */
const fewOf = (names: string[]): { few?: number } => {
  const n = [...new Set(names.map(bareMob))].reduce((sum, m) => sum + (FEW_IN_PLAY.get(m) ?? 0), 0)
  return n ? { few: n } : {}
}

/** "a gnoll", "an orc pawn", "clockwork scrubber": one of many alike. The wiki's notes mark single NPCs. */
const isCommon = (name: string, note = '') =>
  (/^(?:a|an)\s/i.test(name) || /^[a-z]/.test(name)) && !/quest|merchant|guildmaster|npc|banker|named/i.test(note) && !FEW_IN_PLAY.has(bareMob(name))

/** How a hand-in item is come by: coin, bought before, a merchant sells it, crafted, dropped, or not known. */
export function howHad(
  name: string,
  input: Pick<CatalogInput, 'bought' | 'items'>,
  common: (mob: string) => boolean = (m) => isCommon(m)
): Pick<HandInItem, 'how' | 'where' | 'each' | 'named'> {
  const plain = itemName(name)
  if (COIN.test(plain)) return { how: 'coin', where: '' }
  const bought = input.bought[plain.toLowerCase()]
  if (bought) return { how: 'bought', where: bought.merchant, ...(bought.each > 0 ? { each: bought.each } : {}) }
  const known = ITEMS_IN_PLAY[plain.toLowerCase()]
  if (known) return { ...known }
  const use = (input.items[itemKey(name)] ?? input.items[itemKey(plain)])?.use
  const vendor = use?.vendors?.[0]
  if (vendor) return { how: 'vendor', where: vendor.zone ? `${vendor.npc} (${vendor.zone})` : vendor.npc }
  if (use?.sources?.crafted) return { how: 'crafted', where: '' }
  const drops = use?.sources?.drops ?? []
  if (drops.length) {
    const mobs = drops.flatMap((d) => d.mobs)
    const named = mobs.length && !mobs.some(common) ? new Set(mobs.map((m) => m.toLowerCase())).size : 0
    return { how: 'drop', where: drops.find((d) => d.zone)?.zone ?? '', ...(named ? { named } : {}) }
  }
  if (use?.sources?.foraged?.length) return { how: 'drop', where: `foraged: ${use.sources.foraged[0]}` }
  return { how: 'unknown', where: '' }
}

/** Every name that is a place, a mob or a faction: a link to one in a walkthrough line is not an item. */
function notItems(input: Omit<CatalogInput, 'items'>): { isThing: (name: string) => boolean; isZone: (name: string) => boolean } {
  const names = new Set<string>()
  const zones = new Set<string>()
  for (const f of input.factions) names.add(factionKey(f))
  for (const p of input.pages) {
    names.add(factionKey(p.page))
    for (const side of [p.raise, p.lower]) {
      for (const m of side.mobs) {
        names.add(m.name.toLowerCase())
        if (m.zone) zones.add(zoneKey(m.zone))
      }
      for (const z of side.zones) zones.add(zoneKey(z))
    }
  }
  for (const q of Object.values(input.quests)) {
    if (!q) continue
    q.givers.forEach((g) => names.add(g.toLowerCase()))
    q.zones.forEach((z) => zones.add(zoneKey(z)))
  }
  for (const t of Object.values(input.sources.acts)) {
    names.add(t.name.toLowerCase())
    if (t.zone) zones.add(zoneKey(t.zone))
  }
  const isZone = (name: string) => zones.has(zoneKey(name))
  return { isThing: (name) => names.has(name.toLowerCase()) || names.has(factionKey(name)) || isZone(name), isZone }
}

/** The hand-in items the catalog would like eqlwiki's word on: not coin, not bought before. */
export function itemsToLookUp(input: Omit<CatalogInput, 'items'>): string[] {
  const want = new Set<string>()
  const { isThing } = notItems(input)
  const add = (name: string) => {
    const plain = itemName(name)
    if (!COIN.test(plain) && !input.bought[plain.toLowerCase()] && !isThing(plain)) want.add(name)
  }
  for (const t of Object.values(input.sources.acts)) if (t.kind === 'turnin') for (const item of Object.keys(t.items ?? {})) add(item)
  const name = factionNamer(input.factions)
  const open = wanted(input)
  for (const p of input.pages) {
    if (!open.has(name(p.page))) continue
    for (const q of p.raise.quests) for (const s of input.quests[q]?.steps ?? []) for (const h of s.handIn) if (!h.given) add(h.item)
  }
  return [...want]
}

/** A tally's per-unit amounts by the game's faction names, with capped factions guessed at. */
function tallyHits(t: SourceTally, name: (f: string) => string, up: number, down: number): { hits: Record<string, number>; guessed: string[] } {
  const hits: Record<string, number> = {}
  const guessed: string[] = []
  for (const [f, amounts] of Object.entries(t.hits)) hits[name(f)] = usualAmount(amounts)
  for (const [caps, amount] of [
    [t.top, up],
    [t.bottom, down]
  ] as const) {
    for (const f of caps) {
      if (name(f) in hits) continue
      hits[name(f)] = amount
      guessed.push(name(f))
    }
  }
  return { hits, guessed }
}

const positives = (hits: Record<string, number>) =>
  Object.keys(hits)
    .filter((f) => hits[f] > 0)
    .sort()
const raisesAny = (hits: Record<string, number>, open: Set<string>) => Object.entries(hits).some(([f, v]) => v > 0 && open.has(f))
/** A con a quest's NPC wants that can stop it: above a faked Indifferent, eaten below it, or no better than some band. */
const holdsBack = (n: Need) => (n.min !== undefined && (n.min > 0 || !!n.real)) || n.max !== undefined

/**
 * The factions the catalog finds ways to raise: the achievements still to do, and with `wide` every
 * faction the character has; and the ones a quest raising one of those wants more of than the character
 * cons, since raising that first may be the quicker way.
 */
function wanted(input: Omit<CatalogInput, 'items'>, name: (f: string) => string = factionNamer(input.factions)): Set<string> {
  const open = new Set(input.wide ? [...input.targets, ...input.factions] : input.targets)
  const allaNeed = allaNeeds(input.alla ?? [], name)
  const short: string[] = []
  const check = (n: Need | undefined) => {
    const con = n ? input.cons?.[name(n.faction)] : undefined
    if (n?.min !== undefined && (n.min > 0 || n.real) && con !== undefined && con < n.min) short.push(name(n.faction))
  }
  for (const p of input.pages) {
    if (!open.has(name(p.page))) continue
    for (const title of p.raise.quests) {
      const q = input.quests[title]
      if (!q) continue
      check(NEEDS[q.page.toLowerCase()])
      allaNeed.get(questKey(q.page))?.forEach(check)
    }
  }
  for (const c of CYCLES) if (Object.entries(c.hits).some(([f, v]) => v > 0 && open.has(name(f)))) check(c.needs)
  short.forEach((f) => open.add(f))
  return open
}
/** A camp's mobs kept, most killed first: enough to know it by. */
const MOBS_KEPT = 12
const shortList = (names: string[]) => (names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`)
/** A wiki quest step worth this much or more on one faction is taken to be a one-time reward. */
const ONCE_POINTS = 50

/** Every activity that raises one of the achievements still to do, from the log and the wiki. */
export function buildCatalog(input: CatalogInput): FactionCatalog {
  const name = factionNamer(input.factions)
  const open = wanted(input, name)
  const guesses = guessesFrom(input.sources)
  const { isThing, isZone } = notItems(input)
  // What Allakhazam's pages add: the cons quests want, quest amounts, and every mob they name with its amounts.
  const alla = input.alla ?? []
  const allaNeed = allaNeeds(alla, name)
  const allaAmount = allaQuestAmounts(alla, name)
  const allaKill = allaKills(alla, name)
  const allaMobs = new Set(allaKill.map((m) => `${m.name.toLowerCase()}|${zoneKey(m.zone)}`))
  const activities: PlanActivity[] = []
  const entries = Object.entries(input.sources.acts)
  const acts = entries.map(([, t]) => t)
  // Which of the player's other characters saw each tally: all of it their doing, or some of it.
  const keyOf = new Map(entries.map(([k, t]) => [t, k]))
  const sharedBy = (ts: SourceTally[]): Pick<PlanActivity, 'others' | 'theirs'> => {
    const others = new Set<string>()
    let theirs = true
    for (const t of ts) {
      const s = input.shared?.[keyOf.get(t) ?? '']
      s?.others.forEach((c) => others.add(c))
      if (!s || s.own) theirs = false
    }
    return others.size ? { others: [...others].sort(), ...(theirs ? { theirs: true } : {}) } : {}
  }
  const withStock = (it: HandInItem): HandInItem => {
    const have = input.have[itemKey(it.name)] ?? 0
    return have > 0 ? { ...it, have } : it
  }
  // Mobs the log saw killed as "a goblin janitor" are common, whatever capitals the wiki gives them.
  const loggedCommon = new Set(acts.filter((t) => t.kind === 'kill' && /^an?\s/i.test(t.name)).map((t) => t.name.toLowerCase().replace(/^an?\s+/, '')))
  const common = (mob: string) => isCommon(mob) || loggedCommon.has(mob.toLowerCase().replace(/^an?\s+/, ''))
  const had = (item: string) => howHad(item, input, common)

  // What an NPC gives back to be handed straight back for as much again, from the quest pages
  // (Rephas's Grilled Rat Ears, for Rat Ears), by NPC and what goes in first: one unit is both hand-ins.
  const loopOf = (q: QuestPage, i: number): { item: string; back: string } | null => {
    const [step, next] = [q.steps[i], q.steps[i + 1]]
    if (!next || !step.gives?.length || step.handIn.length !== 1 || next.handIn.length !== 1 || (next.npc && step.npc && next.npc !== step.npc)) return null
    const back = itemName(next.handIn[0].item)
    return step.gives.some((g) => itemName(g).toLowerCase() === back.toLowerCase()) ? { item: itemName(step.handIn[0].item), back } : null
  }
  const loops = new Map<string, { item: string; back: string }>()
  for (const q of Object.values(input.quests)) {
    q?.steps.forEach((step, i) => {
      const loop = loopOf(q, i)
      const npc = [step.npc, ...q.givers].find((n) => n && !isZone(n))
      if (loop && npc) loops.set(`${npc.toLowerCase()}|${loop.item.toLowerCase()}`, loop)
    })
  }
  const doubled = (hits: Record<string, number>) => Object.fromEntries(Object.entries(hits).map(([f, v]) => [f, v * 2]))
  // What the log saw of a quest round's parts (the mob that takes the note and dies, the note handed in) is the round's, below.
  const parts = CYCLES.flatMap((c) => c.parts ?? [])
  const isPart = (t: SourceTally) =>
    parts.some(
      (p) =>
        p.name.toLowerCase() === t.name.replace(/^\*/, '').toLowerCase() &&
        (t.kind === 'kill' ? !p.item : !!p.item && Object.keys(t.items ?? {}).every((it) => itemName(it).toLowerCase() === p.item!.toLowerCase()))
    )

  // ---- hand-ins from the log ----
  // By NPC: each hand-in activity, with every item offered for it.
  const loggedNpcs = new Map<string, { a: PlanActivity; offered: Set<string> }[]>()
  for (const t of acts) {
    if (t.kind !== 'turnin' || isPart(t)) continue
    const { hits, guessed } = tallyHits(t, name, guesses.handUp, guesses.handDown)
    if (!raisesAny(hits, open)) continue
    const offered = Object.entries(t.items ?? {}).filter(([, v]) => v.done > 0)
    // What goes in first, when what the NPC gives for it is handed back too; else what went into most
    // of the trades (Tylfon's two Rusty Daggers and two Gold), the coin last.
    const loop = offered.map(([it]) => loops.get(`${t.name.toLowerCase()}|${itemName(it).toLowerCase()}`)).find((l) => l !== undefined)
    const most = Math.max(0, ...offered.map(([, v]) => v.done))
    const each = loop
      ? offered.filter(([it]) => itemName(it).toLowerCase() === loop.item.toLowerCase())
      : offered.filter(([, v]) => v.done * 2 >= most).sort((a, b) => (had(a[0]).how === 'coin' ? 1 : 0) - (had(b[0]).how === 'coin' ? 1 : 0) || b[1].done - a[1].done)
    const items: HandInItem[] = each.map(([it, v]) => withStock({ name: it, count: Math.max(1, Math.round(v.count / v.done)), ...had(it) }))
    // Done once or twice is most likely a quest's one-time reward, and done.
    const repeatable = t.n >= 3
    const a: PlanActivity = {
      id: `turnin:${zoneKey(t.zone)}:${t.name.toLowerCase()}`,
      kind: 'turnin',
      title: t.name,
      zone: t.zone,
      npc: t.name,
      hits: loop ? doubled(hits) : hits,
      ...(guessed.length ? { guessed } : {}),
      ...(loop ? { handIns: 2, back: loop.back } : {}),
      source: 'log',
      seen: t.n,
      ...(t.runN >= 5 && t.runMs > 0 ? { measured: clamp(t.runN / (t.runMs / 3_600_000), 1, 72_000) } : {}),
      items,
      ...(repeatable ? {} : { once: `done ${t.n === 1 ? 'once' : 'twice'} in your logs` }),
      ...sharedBy([t])
    }
    activities.push(a)
    const k = t.name.toLowerCase()
    loggedNpcs.set(k, [...(loggedNpcs.get(k) ?? []), { a, offered: new Set(Object.keys(t.items ?? {}).map((it) => itemName(it).toLowerCase())) }])
  }

  // ---- kill camps from the log: the mobs of a zone that move the same factions ----
  const camps = new Map<string, SourceTally[]>()
  for (const t of acts) {
    if (t.kind !== 'kill' || isPart(t)) continue
    const { hits } = tallyHits(t, name, guesses.killUp, guesses.killDown)
    if (!raisesAny(hits, open)) continue
    const k = `${zoneKey(t.zone)}|${positives(hits).join('+')}`
    camps.set(k, [...(camps.get(k) ?? []), t])
  }
  // Mobs the log saw killed: the wiki's and Allakhazam's word on them is not needed (nor on a round's part).
  const logged = new Set(acts.flatMap((t) => (t.kind === 'kill' && isPart(t) ? [`${t.name.replace(/^\*/, '').toLowerCase()}|${zoneKey(t.zone)}`] : [])))
  const zoneKills = new Map<string, number>()
  for (const t of acts) if (t.kind === 'kill') zoneKills.set(zoneKey(t.zone), (zoneKills.get(zoneKey(t.zone)) ?? 0) + t.n)
  for (const [k, members] of camps) {
    members.sort((a, b) => b.n - a.n)
    const kills = members.reduce((n, m) => n + m.n, 0)
    const sum: Record<string, number> = {}
    const guessed = new Set<string>()
    for (const m of members) {
      const h = tallyHits(m, name, guesses.killUp, guesses.killDown)
      for (const [f, v] of Object.entries(h.hits)) sum[f] = (sum[f] ?? 0) + v * m.n
      h.guessed.forEach((f) => guessed.add(f))
      logged.add(`${m.name.toLowerCase()}|${zoneKey(m.zone)}`)
    }
    const hits = Object.fromEntries(Object.entries(sum).map(([f, v]) => [f, Math.round((v / kills) * 10) / 10]))
    const zone = members[0].zone
    const rate = zoneRate(input.sources, zone)
    const share = kills / (zoneKills.get(zoneKey(zone)) ?? kills)
    activities.push({
      id: `kill:${k}`,
      kind: 'kill',
      title: shortList(members.map((m) => m.name)),
      zone,
      mobs: members.slice(0, MOBS_KEPT).map((m) => m.name),
      hits,
      ...(guessed.size ? { guessed: [...guessed] } : {}),
      source: 'log',
      seen: kills,
      ...(rate ? { measured: clamp(rate * Math.max(0.5, share), 5, 600) } : {}),
      common: members.filter((m) => isCommon(m.name)).length,
      named: members.filter((m) => !isCommon(m.name)).length,
      ...fewOf(members.map((m) => m.name)),
      ...sharedBy(members),
      ...(isCity(zone) && members.some((m) => !isCommon(m.name) || CITY_PEOPLE.test(m.name)) ? { city: true } : {})
    })
  }

  // ---- kill camps from the wiki, for mobs the log has not seen killed there ----
  interface WikiMob {
    mob: FactionMob
    raise: Set<string>
    lower: Set<string>
    page: string
  }
  const wikiMobs = new Map<string, WikiMob>()
  for (const p of input.pages) {
    const f = name(p.page)
    for (const [side, list] of [
      ['raise', p.raise.mobs],
      ['lower', p.lower.mobs]
    ] as const) {
      for (const m of list) {
        // Where a page has no mob to list, some write "none" or "unknown" (and a cached page may still have it).
        if (NO_MOB.test(m.name)) continue
        const k = `${m.name.toLowerCase()}|${zoneKey(m.zone)}`
        const e = wikiMobs.get(k) ?? { mob: m, raise: new Set<string>(), lower: new Set<string>(), page: '' }
        if (side === 'raise') {
          e.raise.add(f)
          if (open.has(f) && !e.page) e.page = p.page
        } else e.lower.add(f)
        wikiMobs.set(k, e)
      }
    }
  }
  const wikiCamps = new Map<string, WikiMob[]>()
  for (const [k, e] of wikiMobs) {
    // A mob Allakhazam gives amounts for is its camp's, below.
    if (logged.has(k) || allaMobs.has(k) || ![...e.raise].some((f) => open.has(f))) continue
    const ck = `${zoneKey(e.mob.zone)}|${[...e.raise].sort().join('+')}`
    wikiCamps.set(ck, [...(wikiCamps.get(ck) ?? []), e])
  }
  for (const [k, members] of wikiCamps) {
    const hits: Record<string, number> = {}
    for (const f of members[0].raise) hits[f] = guesses.killUp
    const lowered = new Map<string, number>()
    for (const m of members) for (const f of m.lower) lowered.set(f, (lowered.get(f) ?? 0) + 1)
    for (const [f, n] of lowered) if (!(f in hits)) hits[f] = Math.round(((guesses.killDown * n) / members.length) * 10) / 10
    const notes = [...new Set(members.map((m) => m.mob.note).filter(Boolean))]
    const zone = members[0].mob.zone
    activities.push({
      id: `wikikill:${k}`,
      kind: 'kill',
      title: shortList(members.map((m) => m.mob.name)),
      zone,
      mobs: members.slice(0, MOBS_KEPT).map((m) => m.mob.name),
      hits,
      guessed: Object.keys(hits),
      source: 'wiki',
      common: members.filter((m) => isCommon(m.mob.name, m.mob.note)).length,
      named: members.filter((m) => !isCommon(m.mob.name, m.mob.note)).length,
      ...fewOf(members.map((m) => m.mob.name)),
      page: members[0].page,
      ...(notes.length ? { note: notes.join(', ') } : {}),
      ...(isCity(zone) && members.some((m) => !isCommon(m.mob.name, m.mob.note) || CITY_PEOPLE.test(m.mob.name)) ? { city: true } : {})
    })
  }

  // ---- kill camps from Allakhazam: the mobs its pages give amounts for, that the log has not seen killed ----
  const allaCamps = new Map<string, AllaKill[]>()
  for (const m of allaKill) {
    if (logged.has(`${m.name.toLowerCase()}|${zoneKey(m.zone)}`) || !raisesAny(m.hits, open)) continue
    const ck = `${zoneKey(m.zone)}|${positives(m.hits).join('+')}`
    allaCamps.set(ck, [...(allaCamps.get(ck) ?? []), m])
  }
  for (const [k, members] of allaCamps) {
    // A kill in the camp does, on average, what its mobs do.
    const sum: Record<string, number> = {}
    for (const m of members) for (const [f, v] of Object.entries(m.hits)) sum[f] = (sum[f] ?? 0) + v
    const hits = Object.fromEntries(Object.entries(sum).map(([f, v]) => [f, Math.round((v / members.length) * 10) / 10]))
    const zone = members[0].zone
    activities.push({
      id: `alla:${k}`,
      kind: 'kill',
      title: shortList(members.map((m) => m.name)),
      zone,
      mobs: members.slice(0, MOBS_KEPT).map((m) => m.name),
      hits,
      source: 'wiki',
      site: 'Allakhazam',
      common: members.filter((m) => isCommon(m.name)).length,
      named: members.filter((m) => !isCommon(m.name)).length,
      ...fewOf(members.map((m) => m.name)),
      ...(isCity(zone) && members.some((m) => !isCommon(m.name) || CITY_PEOPLE.test(m.name)) ? { city: true } : {})
    })
  }

  // ---- kill camps known from play or read off Allakhazam by hand, for mobs nothing above has ----
  for (const c of CAMPS) {
    const hits = Object.fromEntries(Object.entries(c.hits).map(([f, v]) => [name(f), v]))
    const known = c.mobs.some((m) => {
      const k = `${m.toLowerCase()}|${zoneKey(c.zone)}`
      return logged.has(k) || wikiMobs.has(k) || allaMobs.has(k)
    })
    if (known || !raisesAny(hits, open)) continue
    activities.push({
      id: `camp:${zoneKey(c.zone)}|${positives(hits).join('+')}`,
      kind: 'kill',
      title: shortList(c.mobs),
      zone: c.zone,
      mobs: c.mobs,
      hits,
      guessed: c.guessed.map(name),
      source: 'wiki',
      site: 'Allakhazam',
      common: c.mobs.length,
      named: 0
    })
  }

  // ---- quests from the wiki, for the achievements still open ----
  const replaced = new Set(CYCLES.filter((c) => c.replaces).map((c) => c.page.toLowerCase()))
  const seenSteps = new Set<string>()
  const sameSteps = new Set<string>()
  for (const p of input.pages) {
    if (!open.has(name(p.page))) continue
    for (const title of p.raise.quests) {
      const q = input.quests[title]
      if (!q || replaced.has(q.page.toLowerCase())) continue
      q.steps.forEach((s, i) => {
        const id = `quest:${q.page.toLowerCase()}#${i}`
        if (seenSteps.has(id)) return
        seenSteps.add(id)
        // What the NPC gives for it, handed straight back for as much again, is the same unit.
        const loop = loopOf(q, i)
        if (loop) seenSteps.add(`quest:${q.page.toLowerCase()}#${i + 1}`)
        const hits: Record<string, number> = {}
        const guessed: string[] = []
        for (const step of loop ? [s, q.steps[i + 1]] : [s])
          for (const [f, v] of Object.entries(step.hits)) {
            const g = name(f)
            // What a page left as "got better", Allakhazam may give an amount for: a whole quest's, so only
            // where it goes the same way (Innoruuk Recommendation's -840 Primordial Malice is the note's, not
            // the skullcap's, which "got better").
            const alla = step.guessed.includes(f) ? allaAmount.get(questKey(q.page))?.[g] : undefined
            const given = AMOUNTS[q.page.toLowerCase()]?.[g] ?? (alla !== undefined && Math.sign(alla) === Math.sign(v) ? alla : undefined)
            if (given !== undefined) hits[g] = (hits[g] ?? 0) + given
            else if (step.guessed.includes(f)) {
              hits[g] = (hits[g] ?? 0) + (v > 0 ? guesses.handUp : guesses.handDown)
              if (!guessed.includes(g)) guessed.push(g)
            } else hits[g] = (hits[g] ?? 0) + v
          }
        if (!raisesAny(hits, open)) return
        const npc = [s.npc, ...q.givers].find((n) => n && !isZone(n)) ?? ''
        // The cons its NPC wants: known from play, and as Allakhazam lists them. The first not met holds it back.
        const needs = [NEEDS[q.page.toLowerCase()], ...(allaNeed.get(questKey(q.page)) ?? [])]
          .filter((n): n is Need => !!n)
          .map((n) => ({ ...n, faction: name(n.faction) }))
          // Play and Allakhazam can say the same.
          .filter((n, i, all) => all.findIndex((m) => m.faction === n.faction && m.min === n.min && m.max === n.max) === i)
        const unmet = needs.find((n) => blockedBy(n, input.cons))
        const blocked = unmet ? blockedBy(unmet, input.cons) : ''
        const need = unmet ?? needs[0]
        const swap = unmet ? swapRaces(needs, unmet.faction, input.swapCons) : []
        const gate = needs.filter(holdsBack)
        const unknown = conUnknown(gate, input.cons)
        const wants: Pick<PlanActivity, 'needs' | 'blocked' | 'swap' | 'gate' | 'conUnknown'> = {
          ...(need ? { needs: need.band } : {}),
          ...(blocked ? { blocked } : {}),
          ...(swap.length ? { swap } : {}),
          ...(gate.length ? { gate } : {}),
          ...(unknown.length ? { conUnknown: unknown } : {})
        }
        // The log's own hand-ins of the same things to this NPC, moving the same factions, say this
        // already, and exactly; one of other things (Metal Bits where the log saw ore) is another way.
        // What the walkthrough knows besides stands: that it repeats, though the log saw it only once or
        // twice (Sylia Windlehands' Spiderling Silks), and what its NPC wants.
        const sameUp = positives(hits).join('+')
        const handed = s.handIn.map((h) => itemName(h.item).toLowerCase())
        const logged = (loggedNpcs.get(npc.toLowerCase()) ?? []).find((l) => positives(l.a.hits).join('+') === sameUp && handed.every((it) => l.offered.has(it)))
        if (logged) {
          const repeats = !ONCE_IN_PLAY[q.page.toLowerCase()] && Math.max(...Object.values(hits)) < ONCE_POINTS && s.handIn.length === 1 && !s.handIn[0].given
          if (repeats) delete logged.a.once
          if (!logged.a.needs) Object.assign(logged.a, wants)
          return
        }
        // Each item once, at the largest count the line gives it (a walkthrough can name it twice).
        const counts = new Map<string, QuestHandIn>()
        for (const h of s.handIn) {
          const nm = itemName(h.item)
          if (isThing(nm) || isThing(nm.replace(/\s*\([^)]*\)\s*$/, ''))) continue
          const was = counts.get(nm.toLowerCase())
          counts.set(nm.toLowerCase(), { ...was, ...h, count: Math.max(was?.count ?? 0, h.count), given: !!was?.given || !!h.given })
        }
        const handIn = [...counts.values()]
        // "Hand 4 of them": the count the line gives, once places and people are set aside.
        if (handIn.length === 1 && handIn[0].count === 1 && s.count) handIn[0] = { ...handIn[0], count: s.count }
        const items = handIn.map((h): HandInItem => {
          // What goes in: the item, or what the walkthrough combines into it; from the mob the
          // walkthrough says to kill for it, which outranks a merchant (Nillipuss's Jumjum, not the
          // shop's), though not what the player bought or found in play.
          const raw = h.madeOf ? h.madeOf.item : h.item
          const plain = itemName(raw).toLowerCase()
          const source =
            QUEST_ITEMS_IN_PLAY[q.page.toLowerCase()]?.[plain] ??
            (h.from && !input.bought[plain] && !ITEMS_IN_PLAY[plain] ? { how: 'drop' as const, where: h.from, ...(common(h.from) ? {} : { named: 1 }) } : had(raw))
          return withStock({ name: itemName(raw), count: h.count * (h.madeOf?.count ?? 1), ...source, ...(h.madeOf ? { makes: itemName(h.item) } : {}) })
        })
        const coin = QUEST_COIN[q.page.toLowerCase()]
        if (coin && items.length) items.push({ name: coin.name, count: coin.count, how: 'coin', where: '' })
        // The same hand-in written on two pages (Metal Bits on the quest's own and on another) is one way.
        const same = [
          npc.toLowerCase(),
          items.map((it) => `${it.count} ${it.name.toLowerCase()}`).sort(),
          Object.entries(hits)
            .map(([f, v]) => `${f}:${v}`)
            .sort()
        ].join('|')
        if (sameSteps.has(same)) return
        sameSteps.add(same)
        const top = Math.max(...Object.values(hits))
        const once =
          ONCE_IN_PLAY[q.page.toLowerCase()] ??
          (top >= ONCE_POINTS
            ? `worth ${top} at once`
            : handIn.some((h) => h.given)
              ? 'a step of a chain'
              : handIn.length === 0
                ? 'the walkthrough shows no simple hand-in'
                : handIn.length > 1
                  ? 'wants several different items'
                  : items.every((it) => it.how === 'unknown')
                    ? 'nothing says where its item comes from'
                    : '')
        activities.push({
          id,
          kind: 'quest',
          title: q.page,
          zone: q.zones[0] ?? '',
          ...(npc ? { npc } : {}),
          hits,
          ...(guessed.length ? { guessed } : {}),
          ...(loop ? { handIns: 2, back: loop.back } : {}),
          ...wants,
          source: 'wiki',
          items,
          ...(once ? { once } : {}),
          ...(s.line ? { line: s.line } : {}),
          page: q.page
        })
      })
    }
  }

  // ---- quest cycles known from play ----
  for (const c of CYCLES) {
    const hits = Object.fromEntries(Object.entries(c.hits).map(([f, v]) => [name(f), v]))
    if (!raisesAny(hits, open)) continue
    const need = c.needs ? { ...c.needs, faction: name(c.needs.faction) } : null
    const blocked = need ? blockedBy(need, input.cons) : ''
    const swap = need && blocked ? swapRaces([need], need.faction, input.swapCons) : []
    const gate = need && holdsBack(need) ? [need] : []
    const unknown = conUnknown(gate, input.cons)
    activities.push({
      id: `cycle:${c.page.toLowerCase()}${c.key ? `#${c.key}` : ''}`,
      // A round of a quest: the step is the quest's, to its last NPC, and says what goes to whom.
      kind: 'quest',
      title: c.page,
      zone: c.zone,
      npc: c.npc,
      hits,
      ...(c.guessed.length ? { guessed: c.guessed.map(name) } : {}),
      ...(c.log ? { source: 'log' as const, seen: c.log.seen, measured: 3600 / c.log.sec } : { source: 'wiki' as const, site: c.site }),
      // What the round itself comes by (a note from an NPC on the way) is not what the character holds
      // under that name (the bags' Notes are other notes); what it buys is.
      items: c.items.map((it) =>
        it.how
          ? { name: it.name, count: it.count, how: it.how, where: it.where ?? '', ...(it.sec ? { sec: it.sec } : {}), ...(it.to ? { to: it.to } : {}) }
          : withStock({ name: it.name, count: it.count, ...had(it.name), ...(it.to ? { to: it.to } : {}) })
      ),
      ...(need ? { needs: need.band } : {}),
      ...(blocked ? { blocked } : {}),
      ...(swap.length ? { swap } : {}),
      ...(gate.length ? { gate } : {}),
      ...(unknown.length ? { conUnknown: unknown } : {}),
      line: c.line,
      page: c.page
    })
  }

  // The player's pace at killing things that move factions, over every zone with enough runs.
  const rates: number[] = []
  for (const z of Object.values(input.sources.zones)) if (z.runN >= 10 && z.runMs > 0) for (let i = 0; i < Math.min(z.runN, 200); i++) rates.push(z.runN / (z.runMs / 3_600_000))
  const killsPerHour = rates.length >= 30 ? Math.round(clamp(median(rates), 10, 400)) : null
  return { activities, killsPerHour, guesses }
}
