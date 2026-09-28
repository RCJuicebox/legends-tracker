import { itemKey } from '../../core/inventory'
import type { ItemInfo } from '../../shared/types'
import { baseZone, usualAmount, type FactionSourceTallies, type SharedFrom, type SourceTally } from './attribution'
import { NO_MOB, STANDING_MAX, STANDING_MIN, type FactionMob, type FactionPageData, type FactionView } from './core'
import type { QuestHandIn, QuestPage } from './questPages'

// A plan for the faction achievements still to do: what to kill or hand in, how many, and in what
// order, for the least time. Each achievement is done the moment its raw standing reaches 2000, and
// stays done whatever the standing does after, so the order is what matters: an achievement whose
// work lowers another is best left until that other one is done.
//
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
//
// The plan is found in three passes. A greedy build takes, again and again, the activity that does
// most for the achievements still open per hour, counting points it takes off another open one as
// work to do again, and runs it until the next achievement it serves is done. It is built several
// times with a little noise and the quickest kept. Then a local search moves whole blocks earlier
// or later and gives an achievement to another activity, keeping any change that saves time. An
// achievement the player has locked to an activity is only ever finished by that activity.

export type ActivityKind = 'kill' | 'turnin' | 'quest'

/** How an item handed in is come by. */
export type HandInHow = 'coin' | 'bought' | 'vendor' | 'crafted' | 'drop' | 'unknown'

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
}

// ---------- names ----------

/** A faction name reduced for matching: the wiki writes "Opal Dark Briar", the game "Opal Darkbriar". */
export const factionKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*\(faction\)\s*$/, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')

/** Wiki names that reduce to something else than the game's. */
const FACTION_ALIASES: Record<string, string> = {
  halloftheebonmask: 'ebonmask',
  qrgprotectedanimals: 'surefallprotectedanimals',
  eruditecitizen: 'erudincitizens',
  qeynoscitizen: 'qeynoscitizens',
  citizensofqeynos: 'qeynoscitizens',
  templeofsolro: 'templeofsolusekro',
  shralockorcs: 'shralokorcs',
  neriaktrolls: 'neriaktroll',
  fairie: 'faerie',
  kingaythoxthex: 'kingnaythoxthex',
  newsebilisexpedition: 'newsebilisianexpedition'
}

/** Puts any faction name the way the game writes it, when the game has it; else leaves it be. */
export function factionNamer(gameNames: string[]): (name: string) => string {
  const byKey = new Map(gameNames.map((n) => [factionKey(n), n]))
  return (name) => {
    const k = factionKey(name)
    return byKey.get(FACTION_ALIASES[k] ?? k) ?? name.replace(/\s*\(Faction\)\s*$/i, '').trim()
  }
}

/** Zones the log and the wiki name differently. */
const ZONE_ALIASES: Record<string, string> = {
  northernplainsofkarana: 'northkarana',
  southernplainsofkarana: 'southkarana',
  westernplainsofkarana: 'westkarana',
  easternplainsofkarana: 'eastkarana',
  qeynosaqueductsystem: 'qeynosaqueducts',
  kerraisland: 'kerraisle',
  castlemistmoore: 'castleofmistmoore',
  mistmoorecastle: 'castleofmistmoore',
  crushbone: 'clancrushbone',
  clanrunnyeye: 'liberatedcitadelofrunnyeye',
  mountainsofrathe: 'rathemountains',
  northro: 'northerndesertofro',
  southro: 'southerndesertofro',
  commonlands: 'westcommonlands',
  eastcommons: 'eastcommonlands',
  westcommons: 'westcommonlands',
  thehole: 'ruinsofoldpaineel'
}

/** A zone reduced for "same place": the instance, "The", spacing and punctuation dropped. */
export function zoneKey(zone: string): string {
  const k = baseZone(zone)
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
  return ZONE_ALIASES[k] ?? k
}

/** The cities, where killing the people brings the guards down on you. */
const CITIES = new Set(
  [
    'South Qeynos',
    'North Qeynos',
    'Surefall Glade',
    'West Freeport',
    'North Freeport',
    'East Freeport',
    'Neriak - Foreign Quarter',
    'Neriak - Commons',
    'Neriak - Third Gate',
    'Grobb',
    'Oggok',
    'North Kaladim',
    'South Kaladim',
    "Ak'Anon",
    'Kelethin',
    'Northern Felwithe',
    'Southern Felwithe',
    'North Felwithe',
    'South Felwithe',
    'Erudin',
    'Erudin Palace',
    'Paineel',
    'Halas',
    'Rivervale',
    'Highpass Hold',
    'East Cabilis',
    'West Cabilis',
    'Cabilis East',
    'Cabilis West',
    'Thurgadin',
    'Shar Vahl'
  ].map(zoneKey)
)

/** Whether a zone is a city. */
export const isCity = (zone: string) => CITIES.has(zoneKey(zone))

/** A city's people rather than its vermin: named, or by what they are. */
const CITY_PEOPLE = /\b(?:guards?|guardsman|citizens?|merchant|guildmaster|banker|captain|sentry|sentinel|watchman|lieutenant|sergeant|priest(?:ess)?|paladin|knight|warden)\b/i

// ---------- the catalog ----------

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
}

export interface FactionCatalog {
  activities: PlanActivity[]
  /** The player's kills an hour while killing things that move factions, over the log's runs; null with too few. */
  killsPerHour: number | null
  guesses: Guesses
}

/**
 * What the Plan tab plans from, gathered by the main process. What is still to do is as it was when
 * the catalog was built; the page follows the Standings tab's own view for it (planFor).
 */
export interface FactionPlanData extends PlanFor {
  catalog: FactionCatalog
  /** The factions export the standings come from; null without one, and then they start from 0. */
  export: { file: string; modified: number } | null
  /** The inventory export items on hand are counted from; null without one. */
  inventory: { file: string; modified: number } | null
  /** eqlwiki's faction and quest pages: when read, how many, and why a refresh failed (the pages kept serve meanwhile). */
  wiki: { fetchedAt: number; pages: number; quests: number; error: string }
  /** Kills and hand-ins in the log that moved a faction, and changes nothing around them explained. */
  log: { kills: number; handIns: number; unexplained: number }
  /** The player's other characters whose logs the plan also learns from, and what those saw. */
  shared: { characters: string[]; kills: number; handIns: number }
}

const median = (xs: number[]) => {
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
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
/** "Leatherfoot Raider Skullcap (drop)" → "Leatherfoot Raider Skullcap": the page's disambiguation off. */
const itemName = (page: string) => page.replace(/\s*\((?:drop|quest|item|ground spawn|quest item)\)\s*$/i, '').trim()
/** "a gnoll", "an orc pawn", "clockwork scrubber": one of many alike. The wiki's notes mark single NPCs. */
const isCommon = (name: string, note = '') => (/^(?:a|an)\s/i.test(name) || /^[a-z]/.test(name)) && !/quest|merchant|guildmaster|npc|banker|named/i.test(note)

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
/** The factions the catalog finds ways to raise: the achievements still to do, and with `wide` every faction the character has. */
const wanted = (input: Pick<CatalogInput, 'targets' | 'factions' | 'wide'>) => new Set(input.wide ? [...input.targets, ...input.factions] : input.targets)
/** A camp's mobs kept, most killed first: enough to know it by. */
const MOBS_KEPT = 12
const shortList = (names: string[]) => (names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`)
/** A wiki quest step worth this much or more on one faction is taken to be a one-time reward. */
const ONCE_POINTS = 50

/** Every activity that raises one of the achievements still to do, from the log and the wiki. */
export function buildCatalog(input: CatalogInput): FactionCatalog {
  const name = factionNamer(input.factions)
  const open = wanted(input)
  const guesses = guessesFrom(input.sources)
  const { isThing, isZone } = notItems(input)
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

  // ---- hand-ins from the log ----
  const loggedNpcs = new Map<string, PlanActivity[]>()
  for (const t of acts) {
    if (t.kind !== 'turnin') continue
    const { hits, guessed } = tallyHits(t, name, guesses.handUp, guesses.handDown)
    if (!raisesAny(hits, open)) continue
    const main = Object.entries(t.items ?? {})
      .filter(([, v]) => v.done > 0)
      .sort((a, b) => b[1].done - a[1].done)[0]
    const items: HandInItem[] = main ? [withStock({ name: main[0], count: Math.max(1, Math.round(main[1].count / main[1].done)), ...had(main[0]) })] : []
    // Done once or twice is most likely a quest's one-time reward, and done.
    const repeatable = t.n >= 3
    const a: PlanActivity = {
      id: `turnin:${zoneKey(t.zone)}:${t.name.toLowerCase()}`,
      kind: 'turnin',
      title: t.name,
      zone: t.zone,
      npc: t.name,
      hits,
      ...(guessed.length ? { guessed } : {}),
      source: 'log',
      seen: t.n,
      ...(t.runN >= 5 && t.runMs > 0 ? { measured: clamp(t.runN / (t.runMs / 3_600_000), 1, 72_000) } : {}),
      items,
      ...(repeatable ? {} : { once: `done ${t.n === 1 ? 'once' : 'twice'} in your logs` }),
      ...sharedBy([t])
    }
    activities.push(a)
    const k = t.name.toLowerCase()
    loggedNpcs.set(k, [...(loggedNpcs.get(k) ?? []), a])
  }

  // ---- kill camps from the log: the mobs of a zone that move the same factions ----
  const camps = new Map<string, SourceTally[]>()
  for (const t of acts) {
    if (t.kind !== 'kill') continue
    const { hits } = tallyHits(t, name, guesses.killUp, guesses.killDown)
    if (!raisesAny(hits, open)) continue
    const k = `${zoneKey(t.zone)}|${positives(hits).join('+')}`
    camps.set(k, [...(camps.get(k) ?? []), t])
  }
  const logged = new Set<string>()
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
    if (logged.has(k) || ![...e.raise].some((f) => open.has(f))) continue
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
      page: members[0].page,
      ...(notes.length ? { note: notes.join(', ') } : {}),
      ...(isCity(zone) && members.some((m) => !isCommon(m.mob.name, m.mob.note) || CITY_PEOPLE.test(m.mob.name)) ? { city: true } : {})
    })
  }

  // ---- quests from the wiki, for the achievements still open ----
  const seenSteps = new Set<string>()
  for (const p of input.pages) {
    if (!open.has(name(p.page))) continue
    for (const title of p.raise.quests) {
      const q = input.quests[title]
      if (!q) continue
      q.steps.forEach((s, i) => {
        const id = `quest:${q.page.toLowerCase()}#${i}`
        if (seenSteps.has(id)) return
        seenSteps.add(id)
        const hits: Record<string, number> = {}
        const guessed: string[] = []
        for (const [f, v] of Object.entries(s.hits)) {
          const g = name(f)
          if (s.guessed.includes(f)) {
            hits[g] = v > 0 ? guesses.handUp : guesses.handDown
            guessed.push(g)
          } else hits[g] = v
        }
        if (!raisesAny(hits, open)) return
        const npc = [s.npc, ...q.givers].find((n) => n && !isZone(n)) ?? ''
        // The log's own hand-ins to this NPC that move the same factions say this already, and exactly.
        const sameUp = positives(hits).join('+')
        if ((loggedNpcs.get(npc.toLowerCase()) ?? []).some((a) => positives(a.hits).join('+') === sameUp)) return
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
          // walkthrough says to kill for it, which outranks a merchant (Nillipuss's Jumjum, not the shop's).
          const raw = h.madeOf ? h.madeOf.item : h.item
          const source = h.from ? { how: 'drop' as const, where: h.from, ...(common(h.from) ? {} : { named: 1 }) } : had(raw)
          return withStock({ name: itemName(raw), count: h.count * (h.madeOf?.count ?? 1), ...source, ...(h.madeOf ? { makes: itemName(h.item) } : {}) })
        })
        const top = Math.max(...Object.values(hits))
        const once =
          top >= ONCE_POINTS
            ? `worth ${top} at once`
            : handIn.some((h) => h.given)
              ? 'a step of a chain'
              : handIn.length === 0
                ? 'the walkthrough shows no simple hand-in'
                : handIn.length > 1
                  ? 'wants several different items'
                  : items.every((it) => it.how === 'unknown')
                    ? 'nothing says where its item comes from'
                    : ''
        activities.push({
          id,
          kind: 'quest',
          title: q.page,
          zone: q.zones[0] ?? '',
          ...(npc ? { npc } : {}),
          hits,
          ...(guessed.length ? { guessed } : {}),
          source: 'wiki',
          items,
          ...(once ? { once } : {}),
          ...(s.line ? { line: s.line } : {}),
          page: q.page
        })
      })
    }
  }

  // The player's pace at killing things that move factions, over every zone with enough runs.
  const rates: number[] = []
  for (const z of Object.values(input.sources.zones)) if (z.runN >= 10 && z.runMs > 0) for (let i = 0; i < Math.min(z.runN, 200); i++) rates.push(z.runN / (z.runMs / 3_600_000))
  const killsPerHour = rates.length >= 30 ? Math.round(clamp(median(rates), 10, 400)) : null
  return { activities, killsPerHour, guesses }
}

// ---------- time ----------

export interface PlanSettings {
  /** Getting to a new zone, and set up there. */
  travelMin: number
  /** Kills an hour at a camp of common mobs the log has no pace for. */
  killsPerHour: number
  /** How often a named or single mob comes back. */
  namedRespawnMin: number
  /** A hand-in the log has not timed (Legends takes a whole stack at once). */
  handInSec: number
  /** Gathering one item a hand-in needs from common mobs, foraging or crafting. */
  gatherSec: number
  /** A hand-in when neither the log nor the wiki says what goes in it. */
  unknownSec: number
  /**
   * A point a faction ends below 2000 after being there, as a share of a point on an achievement still
   * to do: 0 is the quickest plan whatever it costs them (the achievements are kept), more keeps them
   * up where another way is not much slower. Where a faction ends is what counts, so a point a later
   * step gives back costs nothing.
   */
  keepMaxed: number
  /** What the plan aims for: the least time, or also as few factions left below zero as it can. */
  goal: PlanGoal
  /** For the 'positive' goal: what one faction ending at 0 or above is worth, in hours of play. */
  positiveHours: number
  /** Leave out kill camps of a city's people (guards, merchants, guildmasters), unless locked in. */
  avoidCity: boolean
}

/** 'fastest': every achievement in the least time. 'positive': every achievement, ending with as many factions at 0 or above as is worth the time. */
export type PlanGoal = 'fastest' | 'positive'

export const KEEP_MAXED = { off: 0, light: 0.1, strong: 0.5 } as const

export const DEFAULT_SETTINGS: PlanSettings = {
  travelMin: 10,
  killsPerHour: 80,
  namedRespawnMin: 20,
  handInSec: 3,
  gatherSec: 45,
  unknownSec: 60,
  keepMaxed: KEEP_MAXED.light,
  goal: 'fastest',
  positiveHours: 3,
  avoidCity: false
}

/** Buying one item from a merchant, in stacks. */
const BUY_ITEM_SEC = 0.15

/** What the player chose: an activity locked to an achievement, activities ruled out, their own pace for some. */
export interface PlanChoices {
  /** Faction → activity id. */
  locks: Record<string, string>
  excluded: string[]
  /** Activity id → kills or hand-ins an hour. */
  perHour: Record<string, number>
}

export const NO_CHOICES: PlanChoices = { locks: {}, excluded: [], perHour: {} }

export interface UnitTime {
  /** Seconds for one kill or hand-in, getting what goes in included. */
  seconds: number
  /** Seconds while what goes in is on hand: just the hand-in. */
  handSeconds: number
  from: 'yours' | 'log' | 'estimate'
}

/** How long one kill or hand-in takes, and where the figure comes from. */
export function unitTime(a: PlanActivity, s: PlanSettings, choices: PlanChoices = NO_CHOICES): UnitTime {
  const own = choices.perHour[a.id]
  if (own > 0) return { seconds: 3600 / own, handSeconds: 3600 / own, from: 'yours' }
  if (a.kind === 'kill') {
    const perHour = a.measured ?? (a.common ? s.killsPerHour : Math.min(s.killsPerHour, (a.named || 1) * (60 / Math.max(1, s.namedRespawnMin))))
    const sec = 3600 / Math.max(0.1, perHour)
    return { seconds: sec, handSeconds: sec, from: a.measured ? 'log' : 'estimate' }
  }
  const hand = a.measured ? Math.max(0.05, 3600 / a.measured) : s.handInSec
  const from = a.measured ? 'log' : 'estimate'
  const items = a.items ?? []
  if (!items.length) return { seconds: Math.max(hand, s.unknownSec), handSeconds: hand, from }
  let get = 0
  for (const it of items) {
    if (it.how === 'bought' || it.how === 'vendor') get += BUY_ITEM_SEC * it.count
    else if (it.how === 'drop') get += (it.named ? (s.namedRespawnMin * 60) / it.named : s.gatherSec) * it.count
    else if (it.how === 'crafted') get += s.gatherSec * it.count
    else if (it.how === 'unknown') get += s.unknownSec
  }
  return { seconds: hand + get, handSeconds: hand, from }
}

/** The copper a hand-in's bought items cost, from what the character last paid. */
export const unitCopper = (a: PlanActivity) => (a.items ?? []).reduce((n, it) => n + (it.how === 'bought' ? (it.each ?? 0) * it.count : 0), 0)

// ---------- the plan ----------

export interface PlanTarget {
  faction: string
  /** The achievement's name ("New Sebilis Expedition" for faction New Sebilisian Expedition). */
  achievement: string
  standing: number
}

/** What a plan is for, read off the Factions page's own view, so the plan and the Standings tab never disagree. */
export interface PlanFor {
  /** The achievements still to do (the Standings tab's "Achievements to Do"), with where each faction stands. */
  targets: PlanTarget[]
  /** Factions at 2000 now. */
  maxed: string[]
  /** Whether the character's achievements export says which are done; without one, an achievement counts as done only while its standing is at 2000. */
  achievementsExport: boolean
  /** Every faction's standing where it is known (the factions export plus the log since): where each ends is counted. */
  standings: Record<string, number>
}

/** The achievements a character has still to do, from its factions view: whichever character it is, whatever it has done. */
export function planFor(view: Pick<FactionView, 'factions'>): PlanFor {
  const targets: PlanTarget[] = []
  const maxed: string[] = []
  const standings: Record<string, number> = {}
  let achievementsExport = false
  for (const r of view.factions) {
    const standing = r.standing?.value ?? 0
    if (r.standing) standings[r.name] = r.standing.value
    if (standing >= STANDING_MAX) maxed.push(r.name)
    if (r.achievement?.from === 'achievements') achievementsExport = true
    if (r.achievement && r.achievement.done !== true) targets.push({ faction: r.name, achievement: r.achievement.name, standing })
  }
  return { targets, maxed, achievementsExport, standings }
}

export interface PlanInput {
  targets: PlanTarget[]
  /** Every faction's standing where known, so where each ends can be counted; the targets' are theirs. */
  standings?: Record<string, number>
  /** Factions at 2000 now that are not achievements to do: lowering one costs a little (the achievement is kept, the standing lost). */
  maxed: string[]
  activities: PlanActivity[]
}

export interface PlanStep {
  activity: PlanActivity
  units: number
  /** Including getting there. */
  seconds: number
  travel: number
  /** Units the items on hand cover. */
  fromStock: number
  /** Copper the bought items cost. */
  copper: number
  /** Achievements done during this step. */
  finishes: string[]
  /** What it does to achievements still open when it starts: points up (to 2000 at most), points down. */
  raises: Record<string, number>
  lowers: Record<string, number>
  /** Factions at 2000 it takes down (achievements kept, standing lost). */
  maxedLowered: Record<string, number>
  /** Factions it brings from below zero to 0 or above, and ones it takes below zero. */
  lifts: string[]
  sinks: string[]
  /** It finishes no achievement: it is there to bring factions back to 0 or above (the 'positive' goal). */
  restores: boolean
  /** Locked achievements among those it finishes. */
  locked: string[]
}

/** One way to raise a faction to 2000 from where it stands, with this alone: how many, and how long with the trip there. */
export interface Way {
  activity: PlanActivity
  units: number
  seconds: number
  unitSeconds: number
  rateFrom: UnitTime['from']
}

export interface PlanOption extends Way {
  /** Open achievements it lowers. */
  lowersOpen: string[]
  /** The plan finishes this achievement with it. */
  chosen: boolean
  /** The plan uses it at all. */
  used: boolean
}

/** A plan's order: each block's activity, the achievements it is there to finish, and the factions it is there to bring back to 0 or above. */
export type PlanShape = { act: string; finish: string[]; lift?: string[] }[]

export interface FactionPlan {
  steps: PlanStep[]
  seconds: number
  /** Achievements nothing known raises (with the choices made). */
  unplanned: string[]
  /** Every way to raise each achievement still open, quickest first. */
  options: Record<string, PlanOption[]>
  /** Locks whose activity no longer raises the achievement, or is gone. */
  staleLocks: string[]
  /** Points factions end below 2000 after being there, over the whole plan: what a later step gives back is not lost. */
  maxedLost: number
  /** Factions below zero, of those whose standing is known: now, and at the end of the plan. */
  belowZero: { now: number; after: number }
  /** The order, to keep while only the standings change (planFactions' `keep`). */
  shape: PlanShape
  /** The order kept was still good, so no search was made. */
  kept: boolean
}

/** A seeded random number, so a plan is the same every time for the same choices. */
function rng(seed: number) {
  let x = seed >>> 0 || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 4294967296
  }
}

interface Act {
  a: PlanActivity
  /** Seconds a unit, and while its item is on hand. */
  unit: number
  hand: number
  /** Its one item's slot in the stock the character holds, or -1; how many a unit takes. */
  slot: number
  per: number
  /** What planning counts a second of it as: evidence from the log is trusted over the wiki's. */
  risk: number
  /** Its zone, as a number: the same number is the same place. */
  zone: number
  /** Factions it moves (the targets first, then the rest whose standing is known): index and amount a unit. */
  touch: { i: number; h: number }[]
}

interface Block {
  act: number
  /** Targets this block is there to finish. */
  finish: number[]
  /** Factions it is there to bring back to 0 or above (the 'positive' goal). */
  lift: number[]
}

/** A plan's state as it goes: standings, targets done, factions that have been at 2000, what is on hand, where the player is. */
interface State {
  s: Float64Array
  done: Uint8Array
  peak: Uint8Array
  stock: Float64Array
  zone: number
}

const EPS = 1e-9
/** A plan that leaves an achievement undone. */
const MISSED = 1e9
/**
 * When two orders take as long, the one that finishes achievements sooner (the sum of when each is
 * done): quick ones first, so stopping part way leaves the most done. Small enough never to cost time.
 */
const FLOW_WEIGHT = 1e-6
/**
 * The local search's work, in blocks simulated over all its starts: the orders it may try is this over
 * the plan's length, so a long plan tries fewer. A tenth of a second or two.
 */
const SEARCH_WORK = 1_500_000
/** Steps the 'positive' goal may add to bring factions back to 0 or above. */
const LIFTS_MAX = 80

/** How much to trust a figure: the log's own, seen often, most; the wiki's guesses least. */
function riskOf(a: PlanActivity, choices: PlanChoices, locked: boolean): number {
  if (locked || choices.perHour[a.id] > 0) return 1
  if (a.source === 'log') return (a.seen ?? 0) >= 10 ? 1 : 1.15
  return a.guessed?.length ? 1.35 : 1.2
}

/** Whether the planner may use an activity: not ruled out, not once only, and not a city camp left out, unless locked in. */
export const plannable = (a: PlanActivity, choices: PlanChoices, settings?: Pick<PlanSettings, 'avoidCity'>) => {
  const locked = Object.values(choices.locks).includes(a.id)
  return locked || (!a.once && !choices.excluded.includes(a.id) && !(settings?.avoidCity && a.city))
}

/**
 * The plan. Every achievement still to do is a must; how the rest is weighed is the goal's: 'fastest'
 * counts time (and, a little, points left off factions that were at 2000), 'positive' also counts
 * every faction that ends at 0 or above, and may add steps at the end to bring factions back there.
 * Where a faction ends is what counts, so a point an early step takes and a later one gives back
 * costs nothing.
 *
 * With `keep`, the order of an earlier plan is kept when it still finishes everything (only the
 * standings have moved since): the steps update, nothing is searched, and nothing is reshuffled under
 * the player's feet. Otherwise, or when it no longer does, the order is searched for afresh.
 */
export function planFactions(input: PlanInput, settings: PlanSettings, choices: PlanChoices = NO_CHOICES, keep?: PlanShape): FactionPlan {
  const { targets, activities } = input
  const travel = settings.travelMin * 60
  const T = targets.length
  /** One faction ending at 0 or above, in seconds; nothing when only time counts. */
  const W = settings.goal === 'positive' ? Math.max(0, settings.positiveHours) * 3600 : 0
  // Every faction whose standing is known: the targets first (index below T), then the rest.
  const names = targets.map((t) => t.faction)
  const index = new Map(names.map((f, i) => [f, i]))
  const known = input.standings ?? {}
  const maxedNow = new Set(input.maxed)
  for (const f of [...Object.keys(known), ...input.maxed]) {
    if (index.has(f)) continue
    index.set(f, names.length)
    names.push(f)
  }
  const F = names.length
  const start = Float64Array.from(names, (f, i) => clamp(i < T ? targets[i].standing : (known[f] ?? (maxedNow.has(f) ? STANDING_MAX : 0)), STANDING_MIN, STANDING_MAX))
  const lockedIds = new Set(Object.values(choices.locks))

  // What each activity does to the factions: one that raises an achievement still to do, and for the
  // 'positive' goal one that raises any faction, to bring it back.
  const acts: Act[] = []
  const zones = new Map<string, number>()
  const slots = new Map<string, number>()
  const held: number[] = []
  const times = new Map<string, UnitTime>()
  const timeOf = (a: PlanActivity) => {
    let t = times.get(a.id)
    if (!t) times.set(a.id, (t = unitTime(a, settings, choices)))
    return t
  }
  for (const a of activities) {
    if (!plannable(a, choices, settings)) continue
    const touch: { i: number; h: number }[] = []
    let raisesTarget = false
    let raisesAny = false
    for (const [f, h] of Object.entries(a.hits)) {
      const i = index.get(f)
      if (i === undefined || !h) continue
      touch.push({ i, h })
      if (h > 0) {
        raisesAny = true
        if (i < T) raisesTarget = true
      }
    }
    if (!raisesTarget && !(W && raisesAny)) continue
    const time = timeOf(a)
    const item = a.items?.length === 1 && a.items[0].have ? a.items[0] : undefined
    let slot = -1
    if (item) {
      const key = itemKey(item.name)
      slot = slots.get(key) ?? -1
      if (slot < 0) {
        slots.set(key, (slot = held.length))
        held.push(item.have ?? 0)
      }
    }
    const zk = zoneKey(a.zone)
    if (!zones.has(zk)) zones.set(zk, zones.size)
    acts.push({ a, unit: time.seconds, hand: time.handSeconds, slot, per: item?.count ?? 1, risk: riskOf(a, choices, lockedIds.has(a.id)), zone: zones.get(zk)!, touch })
  }
  const K = acts.length
  const stock0 = Float64Array.from(held)
  // Per-unit amounts, activity by activity: amt[k * F + i].
  const amt = new Float32Array(K * F)
  acts.forEach((x, k) => x.touch.forEach(({ i, h }) => (amt[k * F + i] = h)))
  const amount = (k: number, i: number) => amt[k * F + i]
  // Which activities raise each faction, for bringing one back.
  const raisers: number[][] = Array.from({ length: F }, () => [])
  if (W) acts.forEach((x, k) => x.touch.forEach(({ i, h }) => h > 0 && raisers[i].push(k)))

  const actIndex = new Map(acts.map((x, k) => [x.a.id, k]))
  // A lock holds when its activity is here and raises the achievement.
  const lockOf = Int32Array.from(targets, (t, i) => {
    const k = actIndex.get(choices.locks[t.faction] ?? '')
    return k !== undefined && amount(k, i) > 0 ? k : -1
  })
  const staleLocks = targets.filter((t, i) => choices.locks[t.faction] !== undefined && lockOf[i] < 0).map((t) => t.faction)
  const credits = (k: number, i: number) => lockOf[i] < 0 || lockOf[i] === k

  // What a point on each achievement is worth: the seconds it takes with its quickest way.
  const worth = new Float64Array(T).fill(Infinity)
  for (let k = 0; k < K; k++) for (const { i, h } of acts[k].touch) if (i < T && h > 0 && credits(k, i)) worth[i] = Math.min(worth[i], (acts[k].unit * acts[k].risk) / h)
  const reachable = Array.from(worth, Number.isFinite)
  const unplanned = targets.filter((_, i) => !reachable[i] && start[i] < STANDING_MAX).map((t) => t.faction)
  // A point a faction ends below 2000 after being there, in seconds.
  const maxedPoint = (median(Array.from(worth).filter(Number.isFinite)) || 1) * settings.keepMaxed

  /** Seconds for n units of k, taking what is on hand first; `take` uses the stock up. The units the stock covered are left in `covered`. */
  let covered = 0
  const timeFor = (k: number, n: number, stock: Float64Array, take: boolean) => {
    const x = acts[k]
    covered = 0
    if (x.slot >= 0) {
      const have = stock[x.slot]
      covered = Math.min(n, Math.floor(have / x.per))
      if (take) stock[x.slot] = have - covered * x.per
    }
    return covered * x.hand + (n - covered) * x.unit
  }
  /** n units of k: standings move; achievements that reach 2000 are done. How many were done by it. */
  const apply = (k: number, n: number, st: State) => {
    let newly = 0
    for (const { i, h } of acts[k].touch) {
      const v = clamp(st.s[i] + n * h, STANDING_MIN, STANDING_MAX)
      st.s[i] = v
      if (v >= STANDING_MAX) {
        st.peak[i] = 1
        if (i < T && !st.done[i]) {
          st.done[i] = 1
          newly++
        }
      }
    }
    return newly
  }
  /** Units a block runs: until the achievements it is there for are done and the factions it lifts are at 0 or above; 0 when they already are. */
  const blockUnits = (b: Block, st: State) => {
    let n = 0
    for (const i of b.finish) if (!st.done[i]) n = Math.max(n, Math.ceil((STANDING_MAX - st.s[i]) / amount(b.act, i) - EPS))
    for (const i of b.lift) if (st.s[i] < 0) n = Math.max(n, Math.ceil(-st.s[i] / amount(b.act, i) - EPS))
    return n
  }
  const fresh = (): State => {
    const st: State = { s: Float64Array.from(start), done: new Uint8Array(T), peak: new Uint8Array(F), stock: Float64Array.from(stock0), zone: -1 }
    for (let i = 0; i < F; i++) {
      if (start[i] < STANDING_MAX) continue
      st.peak[i] = 1
      if (i < T) st.done[i] = 1
    }
    return st
  }
  const peak0 = Uint8Array.from(start, (v) => (v >= STANDING_MAX ? 1 : 0))
  const done0 = peak0.slice(0, T)
  const reset = (st: State) => {
    st.s.set(start)
    st.stock.set(stock0)
    st.peak.set(peak0)
    st.done.set(done0)
    st.zone = -1
  }
  /** What the end of a plan is worth against its time: points off factions that were at 2000, and, for the 'positive' goal, the factions at 0 or above. */
  const ending = (st: State) => {
    let lost = 0
    let up = 0
    for (let i = 0; i < F; i++) {
      if (st.peak[i]) lost += STANDING_MAX - st.s[i]
      if (st.s[i] >= 0) up++
    }
    return lost * maxedPoint - W * up
  }

  // ---- greedy: the achievements ----
  function greedy(noise: number, random: () => number): Block[] {
    const st = fresh()
    for (let i = 0; i < T; i++) if (!reachable[i]) st.done[i] = 1
    const blocks: Block[] = []
    for (let guard = 0; guard < 1000 && st.done.includes(0); guard++) {
      let best = -Infinity
      let pick = -1
      let pickN = 0
      for (let k = 0; k < K; k++) {
        const x = acts[k]
        let n = Infinity
        for (const { i, h } of x.touch) if (i < T && h > 0 && !st.done[i] && credits(k, i)) n = Math.min(n, Math.ceil((STANDING_MAX - st.s[i]) / h - EPS))
        if (!Number.isFinite(n) || n <= 0) continue
        let gain = 0
        let loss = 0
        let kept = 0
        let cross = 0
        for (const { i, h } of x.touch) {
          const v = st.s[i]
          if (i < T && !st.done[i]) {
            if (h > 0 && credits(k, i)) gain += worth[i] * Math.min(STANDING_MAX - v, n * h)
            else if (h < 0 && reachable[i]) loss += worth[i] * Math.min(n * -h, v - STANDING_MIN)
            continue
          }
          const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
          if (st.peak[i]) kept += (v - after) * maxedPoint
          if (W) cross += ((after >= 0 ? 1 : 0) - (v >= 0 ? 1 : 0)) * W
        }
        const time = Math.max(1, timeFor(k, n, st.stock, false) * x.risk + (x.zone === st.zone ? 0 : travel))
        const score = ((gain - loss - kept + cross) / time) * (1 + noise * (random() - 0.5))
        if (score > best) {
          best = score
          pick = k
          pickN = n
        }
      }
      if (pick < 0) break
      const before = Uint8Array.from(st.done)
      timeFor(pick, pickN, st.stock, true)
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
      const finished: number[] = []
      for (let i = 0; i < T; i++) if (st.done[i] && !before[i] && credits(pick, i) && amount(pick, i) > 0) finished.push(i)
      const last = blocks[blocks.length - 1]
      if (last && last.act === pick) last.finish.push(...finished)
      else blocks.push({ act: pick, finish: finished, lift: [] })
    }
    return blocks
  }

  /** The state at the end of an order of blocks. */
  const run = (blocks: Block[], st: State) => {
    reset(st)
    let total = 0
    let flow = 0
    for (const b of blocks) {
      const n = blockUnits(b, st)
      if (n <= 0) continue
      const x = acts[b.act]
      total += timeFor(b.act, n, st.stock, true) * x.risk + (x.zone === st.zone ? 0 : travel)
      st.zone = x.zone
      flow += apply(b.act, n, st) * total
    }
    return { total, flow }
  }

  // ---- simulate an order of blocks ----
  // A locked achievement another activity happened to finish on the way is in no block, so an order
  // that no longer finishes it on the way is as good as no plan.
  const sim = fresh()
  function simulate(blocks: Block[]): number {
    const { total, flow } = run(blocks, sim)
    let missed = 0
    for (let i = 0; i < T; i++) if (reachable[i] && !sim.done[i]) missed += MISSED
    return total + missed + flow * FLOW_WEIGHT + ending(sim)
  }

  // ---- the 'positive' goal: steps at the end that bring factions back to 0 or above ----
  // Each is one activity run until a faction below zero is back at 0, taken when the factions it
  // brings back (less any it takes below) are worth more than its time.
  function addLifts(blocks: Block[]): Block[] {
    if (!W) return blocks
    const out = blocks.slice()
    const st = fresh()
    run(out, st)
    for (let guard = 0; guard < LIFTS_MAX; guard++) {
      let best = 0
      let pick = -1
      let pickN = 0
      let pickI = -1
      for (let i = 0; i < F; i++) {
        if (st.s[i] >= 0) continue
        for (const k of raisers[i]) {
          const n = Math.ceil(-st.s[i] / amount(k, i) - EPS)
          if (n <= 0) continue
          let up = 0
          let lost = 0
          for (const { i: j, h } of acts[k].touch) {
            const v = st.s[j]
            const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
            up += (after >= 0 ? 1 : 0) - (v >= 0 ? 1 : 0)
            const peakAfter = st.peak[j] || after >= STANDING_MAX
            lost += (peakAfter ? STANDING_MAX - after : 0) - (st.peak[j] ? STANDING_MAX - v : 0)
          }
          if (up <= 0) continue
          const value = W * up - timeFor(k, n, st.stock, false) * acts[k].risk - (acts[k].zone === st.zone ? 0 : travel) - lost * maxedPoint
          if (value > best) {
            best = value
            pick = k
            pickN = n
            pickI = i
          }
        }
      }
      if (pick < 0) break
      out.push({ act: pick, finish: [], lift: [pickI] })
      timeFor(pick, pickN, st.stock, true)
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
    }
    return out
  }

  // ---- local search: move blocks, drop a lift, give an achievement to another way ----
  const alternatives = targets.map((_, i) => {
    const ways: { k: number; per: number }[] = []
    for (let k = 0; k < K; k++) if (amount(k, i) > 0 && credits(k, i)) ways.push({ k, per: (acts[k].unit * acts[k].risk) / amount(k, i) })
    return ways
      .sort((p, q) => p.per - q.per)
      .slice(0, 6)
      .map((o) => o.k)
  })
  // A budget of orders tried, not of time: the same choices always give the same plan. Blocks are
  // not changed once made; a trial is a new list sharing the blocks it keeps.
  let tried = 0
  let budget = 0
  const within = () => tried < budget
  function improve(initial: Block[]): { blocks: Block[]; cost: number } {
    let blocks = initial
    let cost = simulate(blocks)
    const take = (trial: Block[]) => {
      tried++
      const c = simulate(trial)
      if (c < cost - 1e-6) {
        blocks = trial
        cost = c
        return true
      }
      return false
    }
    for (let pass = 0; pass < 8 && within(); pass++) {
      let better = false
      // Move one block elsewhere.
      for (let from = 0; from < blocks.length && within(); from++) {
        for (let to = 0; to < blocks.length; to++) {
          if (to === from) continue
          const trial = blocks.slice()
          const [b] = trial.splice(from, 1)
          trial.splice(to, 0, b)
          better = take(trial) || better
        }
      }
      // Drop a step that only brings factions back, when it is not worth its time any more.
      for (let j = blocks.length - 1; j >= 0 && within(); j--) if (!blocks[j].finish.length) better = take(blocks.filter((_, x) => x !== j)) || better
      // Finish one achievement another way: in a block of that activity, or a new block anywhere.
      for (let i = 0; i < T && within(); i++) {
        if (lockOf[i] >= 0) continue
        const at = blocks.findIndex((b) => b.finish.includes(i))
        if (at < 0) continue
        for (const k of alternatives[i]) {
          if (k === blocks[at].act) continue
          const rest = blocks[at].finish.filter((x) => x !== i)
          const without = blocks.flatMap((b, j) => (j !== at ? [b] : rest.length || b.lift.length ? [{ ...b, finish: rest }] : []))
          without.forEach((b, j) => {
            if (b.act !== k) return
            const t = without.slice()
            t[j] = { ...b, finish: [...b.finish, i] }
            better = take(t) || better
          })
          for (let pos = 0; pos <= without.length; pos++) {
            const t = without.slice()
            t.splice(pos, 0, { act: k, finish: [i], lift: [] })
            better = take(t) || better
          }
        }
      }
      if (!better) break
    }
    return { blocks, cost }
  }

  let best: { blocks: Block[]; cost: number } = { blocks: [], cost: Infinity }
  let kept = false
  const open = reachable.some((r, i) => r && start[i] < STANDING_MAX) || (W > 0 && Array.from(start).some((v, i) => v < 0 && raisers[i].length > 0))
  if (keep && open) {
    // The earlier order, less what is done and what is gone; kept when it still finishes everything.
    const blocks = keep.flatMap((b) => {
      const k = actIndex.get(b.act)
      if (k === undefined) return []
      const finish = b.finish.flatMap((f) => {
        const i = index.get(f)
        return i !== undefined && i < T && reachable[i] && start[i] < STANDING_MAX && credits(k, i) && amount(k, i) > 0 ? [i] : []
      })
      const lift = (b.lift ?? []).flatMap((f) => {
        const i = index.get(f)
        return i !== undefined && amount(k, i) > 0 ? [i] : []
      })
      return finish.length || lift.length ? [{ act: k, finish, lift }] : []
    })
    const cost = simulate(blocks)
    if (cost < MISSED) {
      best = { blocks, cost }
      kept = true
    }
  }
  if (!kept && K && open) {
    const random = rng(0x5eed + T * 31 + K)
    const tries: Block[][] = [addLifts(greedy(0, random))]
    for (let r = 0; r < 12; r++) tries.push(addLifts(greedy(0.35, random)))
    const ranked = tries.map((b) => ({ blocks: b, cost: simulate(b) })).sort((p, q) => p.cost - q.cost)
    budget = Math.max(5_000, Math.round(SEARCH_WORK / Math.max(10, ranked[0].blocks.length)))
    for (const cand of ranked.slice(0, 3)) {
      const got = improve(cand.blocks)
      if (got.cost < best.cost) best = got
    }
    // The search may have left factions below zero that more steps would be worth bringing back.
    if (W) {
      const more = addLifts(best.blocks)
      if (more.length > best.blocks.length) best = improve(more)
    }
  }

  // ---- the plan as steps ----
  const steps: PlanStep[] = []
  const st = fresh()
  {
    for (const b of best.blocks) {
      const n = blockUnits(b, st)
      if (n <= 0) continue
      const x = acts[b.act]
      const raises: Record<string, number> = {}
      const lowers: Record<string, number> = {}
      const maxedLowered: Record<string, number> = {}
      const lifts: string[] = []
      const sinks: string[] = []
      for (const { i, h } of x.touch) {
        const f = names[i]
        const v = st.s[i]
        const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
        if (i < T && !st.done[i]) {
          if (h > 0) raises[f] = Math.min(STANDING_MAX - v, n * h)
          else if (h < 0) lowers[f] = Math.min(n * -h, v - STANDING_MIN)
          continue
        }
        if (h < 0 && v >= STANDING_MAX) maxedLowered[f] = v - after
        if (v < 0 && after >= 0) lifts.push(f)
        else if (v >= 0 && after < 0) sinks.push(f)
      }
      const before = Uint8Array.from(st.done)
      const t = timeFor(b.act, n, st.stock, true)
      const fast = covered
      apply(b.act, n, st)
      const finishes = targets.flatMap((tg, i) => (st.done[i] && !before[i] ? [tg.faction] : []))
      const move = x.zone === st.zone ? 0 : travel
      st.zone = x.zone
      const last = steps[steps.length - 1]
      if (last && last.activity.id === x.a.id) {
        last.units += n
        last.seconds += t
        last.fromStock += fast
        last.copper += (n - fast) * unitCopper(x.a)
        last.finishes.push(...finishes)
        last.restores &&= !b.finish.length
        for (const [f, v] of Object.entries(raises)) last.raises[f] = (last.raises[f] ?? 0) + v
        for (const [f, v] of Object.entries(lowers)) last.lowers[f] = (last.lowers[f] ?? 0) + v
        for (const [f, v] of Object.entries(maxedLowered)) last.maxedLowered[f] = (last.maxedLowered[f] ?? 0) + v
        last.lifts = [...new Set([...last.lifts.filter((f) => !sinks.includes(f)), ...lifts])]
        last.sinks = [...new Set([...last.sinks.filter((f) => !lifts.includes(f)), ...sinks])]
      } else {
        steps.push({
          activity: x.a,
          units: n,
          seconds: t + move,
          travel: move,
          fromStock: fast,
          copper: (n - fast) * unitCopper(x.a),
          finishes,
          raises,
          lowers,
          maxedLowered,
          lifts,
          sinks,
          restores: !b.finish.length,
          locked: []
        })
      }
    }
    for (const step of steps) step.locked = step.finishes.filter((f) => choices.locks[f] === step.activity.id)
  }
  const seconds = steps.reduce((n, step) => n + step.seconds, 0)
  let maxedLost = 0
  let belowNow = 0
  let belowAfter = 0
  for (let i = 0; i < F; i++) {
    if (st.peak[i]) maxedLost += STANDING_MAX - st.s[i]
    if (start[i] < 0) belowNow++
    if (st.s[i] < 0) belowAfter++
  }
  const shape: PlanShape = best.blocks.map((b) => ({
    act: acts[b.act].a.id,
    finish: b.finish.map((i) => names[i]),
    ...(b.lift.length ? { lift: b.lift.map((i) => names[i]) } : {})
  }))

  // ---- every way to raise each achievement still open ----
  // (the same reckoning as waysToRaise, with what the plan made of each)
  const chosenFor = new Map<string, string>()
  for (const step of steps) for (const f of step.finishes) if (!chosenFor.has(f)) chosenFor.set(f, step.activity.id)
  const used = new Set(steps.map((step) => step.activity.id))
  const stillOpen = new Set(targets.filter((_, i) => start[i] < STANDING_MAX).map((t) => t.faction))
  const options: Record<string, PlanOption[]> = {}
  for (const t of targets) if (stillOpen.has(t.faction)) options[t.faction] = []
  for (const a of activities) {
    const raised = Object.entries(a.hits).filter(([f, h]) => h > 0 && stillOpen.has(f))
    if (!raised.length) continue
    const unit = timeOf(a)
    const lowered = Object.entries(a.hits)
      .filter(([f, h]) => h < 0 && stillOpen.has(f))
      .map(([f]) => f)
    for (const [f, h] of raised)
      options[f].push({ ...wayFor(a, h, start[index.get(f)!], unit, travel), lowersOpen: lowered, chosen: chosenFor.get(f) === a.id, used: used.has(a.id) })
  }
  // Ways the planner may use first, quickest first; one-time and ruled-out ones after.
  const later = (o: PlanOption) => (plannable(o.activity, choices, settings) ? 0 : 1)
  for (const list of Object.values(options)) list.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
  return { steps, seconds, unplanned, options, staleLocks, maxedLost, belowZero: { now: belowNow, after: belowAfter }, shape, kept }
}

/** A way to raise a faction by `h` a unit from `standing` to 2000: what the character holds goes first, as in the plan. */
function wayFor(a: PlanActivity, h: number, standing: number, unit: UnitTime, travel: number): Way {
  const units = Math.max(0, Math.ceil((STANDING_MAX - standing) / h - EPS))
  const onHand = a.items?.length === 1 && a.items[0].have ? Math.min(units, Math.floor(a.items[0].have / a.items[0].count)) : 0
  return { activity: a, units, seconds: onHand * unit.handSeconds + (units - onHand) * unit.seconds + travel, unitSeconds: unit.seconds, rateFrom: unit.from }
}

/** Every way the catalog knows to raise a faction to 2000 from where it stands: the ones the planner may use first, quickest first. */
export function waysToRaise(activities: PlanActivity[], faction: string, standing: number, settings: PlanSettings, choices: PlanChoices = NO_CHOICES): Way[] {
  const ways = activities.flatMap((a) => {
    const h = a.hits[faction]
    return h > 0 ? [wayFor(a, h, standing, unitTime(a, settings, choices), settings.travelMin * 60)] : []
  })
  const later = (w: Way) => (plannable(w.activity, choices, settings) ? 0 : 1)
  return ways.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
}
