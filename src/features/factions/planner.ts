import { itemKey } from '../../core/inventory'
import type { ItemInfo } from '../../shared/types'
import { baseZone, usualAmount, type FactionSourceTallies, type SharedFrom, type SourceTally } from './attribution'
import { factionKey, NO_MOB, STANDING_MAX, STANDING_MIN, standingBand, type FactionMob, type FactionPageData, type FactionView } from './core'
import type { QuestHandIn, QuestPage } from './questPages'
import { allaKills, allaNeeds, allaQuestAmounts, questKey, type AllaFaction, type AllaKill, type Need } from './allakhazam'
import type { RaceUnlock } from './unlocks'

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

// ---------- names ----------

export { factionKey }

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
  /** Allakhazam's faction pages: how many of the factions wanted are read (they come a page every twenty seconds), and why reading stopped. */
  alla: { read: number; wanted: number; error: string }
  /** Whether Agnostic, the deity the plan counts everyone as, is unlocked to pick in Loadouts; null when no achievements export says. */
  agnostic: boolean | null
  /** The races the character can swap to in Loadouts; null when no achievements export says, and then every race is counted. */
  races: string[] | null
  /** Every race unlock, done or not, with its factions (as the achievements export has them, else as the standings say). */
  unlocks: RaceUnlock[]
  /** The character's race and what each race it could be adds to its cons, as an Agnostic of its classes; null without a race on its record. */
  raceMods: { own: string; mods: Record<string, Record<string, number>> } | null
  /** The game folder has no achievement list (Resources/Achievements/AchievementsClient.txt): a wrong folder, not everything done. */
  noAchievementList?: boolean
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

// Where the wikis mislead for Legends, as players have found it in play.

/** Quests that cannot be done over and over, by page (lower-cased), and why: planned at most once unless locked in. */
const ONCE_IN_PLAY: Record<string, string> = {
  'illegible cantrip quest': 'cannot be done over and over',
  // From play (2026-09-29): cyclops eyes do not seem to drop in the classic zones.
  "xelha's cyclops eye": 'cyclops eyes do not drop in classic'
}

// What Allakhazam's faction pages (everquest.allakhazam.com/db/faction.html) add: the con a quest's
// NPC wants before taking it, amounts eqlwiki leaves out, and mobs it does not list.

/** Quests whose NPC takes the hand-in only at or above a con, by page (lower-cased). A con can be faked as far as Indifferent, not past it (from play). */
const NEEDS: Record<string, Need> = {
  'tunare scouts dagger': { faction: "Tunare's Scouts", band: 'Amiable', min: 100 },
  // Sylia Windlehands took nothing from a Wood Elf Monk/Shadowknight/Shaman at Indifferent (55: "You need to
  // prove your dedication"), and took the silk from the same Wood Elf as a Monk/Enchanter/Bard at Amiable
  // (105), five minutes later (2026-09-29).
  'spiderling silks': { faction: 'Song Weavers', band: 'Amiable', min: 100 }
}

/** Amounts a quest page leaves out, by page (lower-cased), then faction. */
const AMOUNTS: Record<string, Record<string, number>> = {
  // Allakhazam's +1, which play makes +5 (138 hand-ins to Tylfon, 2026-09-29).
  'tunare scouts dagger': { "Tunare's Scouts": 5 }
}

/**
 * Quests known from play as one repeatable time round, where the walkthroughs split them into steps that
 * look one-time: each unit is the whole round, its amounts the log's, and the site's where the log never
 * saw a step; its time a round the log's pace.
 */
interface Cycle {
  page: string
  /** Told apart from another round on the same page: its id's end. */
  key?: string
  zone: string
  npc: string
  hits: Record<string, number>
  guessed: string[]
  /** What goes in each round: bought or held as the log and inventory say, or come by as given (`sec` a round). */
  items: { name: string; count: number; how?: HandInHow; where?: string; sec?: number; to?: string }[]
  /** Where the log saw it done: how many rounds, and seconds a round. */
  log?: { seen: number; sec: number }
  /** Where the facts come from otherwise. */
  site?: string
  needs?: Need
  /**
   * What the log sees of a round as kills and hand-ins of their own (the mob that takes the note and
   * dies, the note handed in): the round's, so not ways of their own. A hand-in only as far as it is of
   * `item`.
   */
  parts?: { name: string; item?: string }[]
  /** The page's own walkthrough reads wrong, so its steps are left out for this round. */
  replaces?: boolean
  line: string
}

const CYCLES: Cycle[] = [
  {
    // Message Intercept the evil way (Allakhazam quest 587). From the log (Aug 31, the good way: 115
    // milks, 112 notes, one to Sir Lucan D`Lere at a time, some 20 s a round): a Bottle of Milk to Mojax
    // Hikspin in the Commonlands gives Knights of Truth +5, Priests of Marr +5, Steel Warriors +5, Dismal
    // Rage -1 and The Freeport Militia -1; *Duggin Scumber takes the note and dies to one blow, Knights of
    // Truth +5, Priests of Marr +5, The Freeport Militia -2, Coalition of Tradefolk Underground -1. The note
    // to Raltur Caliskon in East Freeport the log never saw: Allakhazam's Dismal Rage +20, Knights of Truth
    // -3 and Opal Darkbriar +4, which play makes +5 as it does every small gain (+1 and +3 came as +5).
    page: 'Message Intercept',
    zone: 'West Commonlands',
    npc: 'Raltur Caliskon',
    hits: {
      'Dismal Rage': 19,
      'Opal Darkbriar': 5,
      'Knights of Truth': 7,
      'Priests of Marr': 10,
      'Steel Warriors': 5,
      'The Freeport Militia': -3,
      'Coalition of Tradefolk Underground': -1
    },
    guessed: ['Opal Darkbriar'],
    items: [{ name: 'Bottle of Milk', count: 1, to: 'Mojax Hikspin' }],
    log: { seen: 112, sec: 20 },
    needs: { faction: 'Dismal Rage', band: 'Amiable', min: 100 },
    parts: [{ name: 'Duggin Scumber' }],
    line: 'A Bottle of Milk to Mojax Hikspin (Commonlands), kill *Duggin Scumber for the Note, and hand the Note to Raltur Caliskon in East Freeport.'
  },
  {
    // Message Intercept the good way, all from the log (Aug 31): the same milk and *Duggin, then the
    // note to Sir Lucan D`Lere in West Freeport, The Freeport Militia +25, Coalition of Tradefolk
    // Underground +5, Knights of Truth -2 and Priests of Marr -2 (96 notes, one at a time). The note goes
    // one way or the other, so a round here or Raltur's is the player's choice each time: Freeport
    // Militia and Knights of Truth this way (two of Human's Freeport race unlock), Dismal Rage that way.
    page: 'Message Intercept',
    key: 'lucan',
    zone: 'West Commonlands',
    npc: 'Sir Lucan D`Lere',
    hits: {
      'The Freeport Militia': 22,
      'Knights of Truth': 8,
      'Priests of Marr': 8,
      'Steel Warriors': 5,
      'Coalition of Tradefolk Underground': 4,
      'Dismal Rage': -1
    },
    guessed: [],
    items: [{ name: 'Bottle of Milk', count: 1, to: 'Mojax Hikspin' }],
    log: { seen: 96, sec: 20 },
    parts: [{ name: 'Duggin Scumber' }, { name: 'Sir Lucan D`Lere', item: 'Note' }],
    line: 'A Bottle of Milk to Mojax Hikspin (Commonlands), kill *Duggin Scumber for the Note, and hand the Note to Sir Lucan D`Lere in West Freeport.'
  },
  {
    // The hail-and-deliver step of Innoruuk Disciple, for The Spurned (a comment on Allakhazam, taken up
    // 2026-09-29): /say "I will assist you" to Wallin Slyfoot in West Commonlands (the north-west, between
    // the lake and the Kithicor zone line) for a note, and hand it to Draxiz N`Ryt in Neriak Commons; The
    // Spurned +10, The Dead -1. The note is lore and no drop, so one a round trip, some 3 minutes (a guess;
    // set your own pace on it). Draxiz is The Spurned's own: eqlwiki has him taking it at Dubious and
    // eating it at Threatening, so that holds whatever faking a con does. Allakhazam has the whole quest
    // wanting Amiable with Priests of Innoruuk, which the hail-and-deliver step does not.
    page: 'Innoruuk Disciple',
    zone: 'West Commonlands',
    npc: 'Draxiz N`Ryt',
    hits: { 'The Spurned': 10, 'The Dead': -1 },
    guessed: [],
    items: [{ name: 'Note', count: 1, how: 'drop', where: 'Wallin Slyfoot (West Commonlands), for /say I will assist you; lore, one a trip', sec: 180 }],
    site: 'Allakhazam',
    needs: { faction: 'The Spurned', band: 'Dubious', min: -500, real: true },
    line: 'Say "I will assist you" to Wallin Slyfoot in West Commonlands for a note, and hand it to Draxiz N`Ryt in Neriak Commons, who eats it below Dubious with The Spurned; the note is lore, so one a trip.'
  },
  {
    // The first step of Innoruuk Recommendation, over and over (eqlwiki's walkthrough, taken up
    // 2026-09-29): /say "I am devoted to Innoruuk" to Saxarivza Zaxun in the tunnels under East Freeport
    // (at any con, even from above ground over her at -93, -175) or to Savarixsa Zexus in Grobb's shaman
    // guild (at Dubious) for a note to her brother Perrir Zexus in Neriak Third Gate: Priests of Innoruuk
    // +200, and Primordial Malice -800. Perrir takes it only above Threatening, which a faked con does
    // (sneak or invisibility for the trade). She gives a note for each /say, one held or not (found in
    // play, 2026-09-30), so a trip takes them all: a few seconds a note, the trip to Neriak the step's.
    page: 'Innoruuk Recommendation',
    zone: 'East Freeport',
    npc: 'Perrir Zexus',
    hits: {
      'Priests of Innoruuk': 200,
      'King Naythox Thex': 30,
      'Priests of Marr': -70,
      'Clerics of Tunare': -50,
      'Priests of Life': -30,
      'Primordial Malice': -800
    },
    guessed: [],
    items: [{ name: 'Note', count: 1, how: 'drop', where: 'Saxarivza Zaxun (East Freeport tunnels), for /say I am devoted to Innoruuk, one a /say', sec: 5 }],
    needs: { faction: 'Priests of Innoruuk', band: 'Dubious', min: -500 },
    line: 'Say "I am devoted to Innoruuk" to Saxarivza Zaxun in the tunnels under East Freeport (from above ground over her at -93, -175, at any con) for a note, once for every note needed, and hand them all to Perrir Zexus in Neriak Third Gate at 408, -781: he wants better than Threatening, so sneak or be invisible for the trade, or be a race he likes.'
  },
  {
    // Track, Stalk, Hunt with Bone Chips (eqlwiki's walkthrough, taken up 2026-09-30): four Bone Chips to
    // Vexia D`Ynth in Neriak Commons, each four its own task: Indigo Brotherhood, Dread Slayers, Dreadguard
    // Outer and Dreadguard Inner +5, Guardians of the Vale and Wolves of the North -1. She wants
    // Indifferent, which a faked con does. The page reads as one Giant Bat Fur handed to Guardians of the Vale, so its steps are left out.
    page: 'Track, Stalk, Hunt',
    key: 'bone chips',
    zone: 'Neriak Commons',
    npc: 'Vexia D`Ynth',
    hits: {
      'Indigo Brotherhood': 5,
      'Dread Slayers': 5,
      'Dreadguard Outer': 5,
      'Dreadguard Inner': 5,
      'Guardians of the Vale': -1,
      'Wolves of the North': -1
    },
    guessed: [],
    items: [{ name: 'Bone Chips', count: 4 }],
    replaces: true,
    line: 'Hand Bone Chips to Vexia D`Ynth in Neriak Commons, four a task (try a whole stack in one trade); she wants Indifferent, so sneak or be invisible for the trade if you con worse.'
  },
  {
    // Merchants of Erudin without Peace Keepers (a comment on Allakhazam's Peacekeeper Staff, taken up
    // 2026-09-29): Small Lanterns to Jyle Windshot in West Freeport (the Hogcallers' Inn, upstairs;
    // Faydarks Champions, who gives only at Indifferent or better) give Wooden Shards back (Allakhazam's
    // Treant Wood), a Wooden Heart now and then (4 in 35 lanterns in play); Wooden Shards to Emil
    // Parsini, in the hut just outside Erudin in Toxxulia Forest, raise Merchants of Erudin +5 and High
    // Council of Erudin +5 a shard, and High Guard of Erudin (the log, 2026-09-29: 16 shards, a stack of 12
    // taken in one trade, a Treant Resin given back for each; High Guard was at its cap, so its amount is
    // eqlwiki's). Jyle takes the lanterns four to a trade. No merchant in West Freeport sells them: the
    // nearest is Innkeep Palola in North Freeport, just past the zone line by the inn. Jyle's amounts are
    // still guesses (the log saw only caps): eqlwiki's +1s, which play makes +5 as it does every small gain.
    page: 'Peacekeeper Staff Quest',
    zone: 'Toxxulia Forest',
    npc: 'Emil Parsini',
    hits: {
      'Merchants of Erudin': 5,
      'High Council of Erudin': 5,
      'High Guard of Erudin': 5,
      'Faydarks Champions': 5,
      'King Tearis Thex': 5,
      'Clerics of Tunare': 5,
      'Soldiers of Tunare': 5,
      'Crushbone Orcs': -1
    },
    guessed: ['High Guard of Erudin', 'Faydarks Champions', 'King Tearis Thex', 'Clerics of Tunare', 'Soldiers of Tunare', 'Crushbone Orcs'],
    items: [{ name: 'Small Lantern', count: 1, to: 'Jyle Windshot' }],
    site: 'Allakhazam',
    needs: { faction: 'Faydarks Champions', band: 'Indifferent', min: 0, real: true },
    parts: [{ name: 'Emil Parsini', item: 'Wooden Shards' }],
    line: "Give Small Lanterns (nearest: Innkeep Palola, North Freeport) to Jyle Windshot in West Freeport's Hogcallers' Inn, four to a trade, for Wooden Shards (a Wooden Heart now and then), and hand the shards to Emil Parsini in the hut outside Erudin, a whole stack at once."
  }
]

/** Kill camps eqlwiki does not list: the faction's own amount as given, the others' guessed. */
const CAMPS: { zone: string; mobs: string[]; hits: Record<string, number>; guessed: string[] }[] = [
  {
    zone: 'Greater Faydark',
    mobs: ['a mature arborean', 'an arborean sapling'],
    hits: { "Tunare's Scouts": 1, 'Emerald Warriors': 1, 'Soldiers of Tunare': 1, 'Faydarks Champions': 1, 'Arboreans of the Faydark': -1 },
    guessed: ['Emerald Warriors', 'Soldiers of Tunare', 'Faydarks Champions', 'Arboreans of the Faydark']
  }
]

/**
 * Why a quest cannot be done yet: its NPC wants a con the character is not at. A con can be faked as
 * far as Indifferent (0), not past it, so a need at or below that never stops one; one that wants a con
 * no better than some band stops one above it.
 */
/**
 * A Loadouts swap that keeps the race and puts one more class in the trio ("Wood Elf + Bard"): a con
 * takes the best of the trio's class modifiers, so one class an NPC likes opens what the trio does not.
 * The plan counts it as a race of its own, there from the start.
 */
export const classSwapName = (race: string, cls: string) => `${race} + ${cls}`

/** The class a swap puts in the trio; null for a swap of race. */
export const classSwapOf = (name: string) => / \+ (.+)$/.exec(name)?.[1] ?? null

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

function blockedBy(need: Need, cons: Record<string, number> | undefined): string {
  const con = cons?.[need.faction]
  if (con === undefined) return ''
  if (need.min !== undefined && (need.min > 0 || need.real) && con < need.min)
    return `needs ${need.band} with ${need.faction}; you con ${standingBand(con).word} (${con}), ${need.min - con} short`
  if (need.max !== undefined && con > need.max) return `wants no better than ${need.band} with ${need.faction}; you con ${standingBand(con).word} (${con})`
  return ''
}

/** Hand-in items that come from elsewhere than the wikis say, by lower-cased name. */
const ITEMS_IN_PLAY: Record<string, Pick<HandInItem, 'how' | 'where' | 'named' | 'sec'>> = {
  // The walkthrough says goblins in several zones.
  'small piece of high quality ore': { how: 'drop', where: 'the Goblin Janitor (Runnyeye)', named: 1 },
  // For Rephas's Rat Ear Pie Quest, the one way to raise Arcane Scientists that repeats: five came
  // from eighteen rats in Misty Thicket in about twenty minutes.
  'rat ears': { how: 'drop', where: 'rats, such as in Misty Thicket', sec: 240 }
}
/** A quest's hand-in item that is another than the one the wikis' item page is about, by quest page (lower-cased), then item. */
const QUEST_ITEMS_IN_PLAY: Record<string, Record<string, Pick<HandInItem, 'how' | 'where' | 'named' | 'sec'>>> = {
  // Jeet's is the Scrap Metal Cleaner VII drops in North Kaladim, lore and no drop, so one a kill of
  // him; eqlwiki's item page puts it together with others, rogue clockworks' among them.
  "miner's cap": { 'scrap metal': { how: 'drop', where: 'Cleaner VII (North Kaladim), lore: one at a time', named: 1 } }
}

/** Coin a quest's hand-in wants with its item, where the walkthrough says it in words the quest reader passes over, by quest page (lower-cased). */
const QUEST_COIN: Record<string, { name: string; count: number }> = {
  // "hand him the Ogre Head and 300 Gold"
  'miners pick': { name: 'Gold', count: 300 },
  // Two Rusty Daggers and two Gold a hand-in to Tylfon, in play.
  'tunare scouts dagger': { name: 'Gold', count: 2 }
}

/** "a gnoll", "an orc pawn", "clockwork scrubber": one of many alike. The wiki's notes mark single NPCs. */
/**
 * Mobs with "a" or "an" before the name that are only a few spawns in their zone, as found in play, and how
 * many, by the name without the article or what the wikis add after it ("an elven slave (male)" → "elven slave"):
 * a camp of them goes at their respawn, not at a camp's pace.
 */
const FEW_IN_PLAY = new Map([
  // Crushbone has three elven slaves (2026-09-30): Indigo Brotherhood +5 a kill. Its elven priest gave
  // no Indigo Brotherhood in play, only Clerics of Tunare and King Tearis Thex -10
  // (how many there are is a guess).
  ['elven slave', 3],
  ['elven priest', 1]
])

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
  /** Swapping race in Loadouts for a quest the character's own race's con keeps closed: planned or not. */
  raceSwaps: boolean
  /** Minutes a swap takes, there and back. */
  swapMin: number
  /** Race unlocks before the rest: each one done sooner counts as time saved. */
  unlocksFirst: boolean
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
  raceSwaps: true,
  swapMin: 5,
  unlocksFirst: false
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
    const respawn = (n: number) => n * (60 / Math.max(1, s.namedRespawnMin))
    const pace = a.measured ?? (a.common ? s.killsPerHour : Math.min(s.killsPerHour, respawn(a.named || 1)))
    // A few spawns go at their respawn once killed, however quickly the log saw the first of them go.
    const perHour = a.few ? Math.min(pace, respawn(a.few)) : pace
    const sec = 3600 / Math.max(0.1, perHour)
    return { seconds: sec, handSeconds: sec, from: a.measured ? 'log' : 'estimate' }
  }
  const hand = (a.measured ? Math.max(0.05, 3600 / a.measured) : s.handInSec) * (a.handIns ?? 1)
  const from = a.measured ? 'log' : 'estimate'
  const items = a.items ?? []
  if (!items.length) return { seconds: Math.max(hand, s.unknownSec), handSeconds: hand, from }
  let get = 0
  for (const it of items) {
    if (it.sec) get += it.sec * it.count
    else if (it.how === 'bought' || it.how === 'vendor') get += BUY_ITEM_SEC * it.count
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
  /** The race unlocks still to do: achievements too, and each one done is one more race to swap to. */
  unlocks?: UnlockGoal[]
  /**
   * What each race the character could be adds to its cons. With it, a quest opens as the standings
   * reach the con its NPC wants, as the character's own race or one it can swap to, and the plan may
   * raise a faction to get there; without it, a quest is open or not as the catalog found it.
   */
  races?: RaceMods
}

/** A race unlock still to do, as the planner takes it. */
export interface UnlockGoal {
  /** "Race Unlock - Barbarian". */
  achievement: string
  /** The race it unlocks in Loadouts. */
  race: string
  /** The factions still to max for it, by the game's names. */
  factions: string[]
  /** Done when any of these race unlocks is, rather than by factions (Half Elf's, with Human's or Wood Elf's). */
  anyOf?: string[]
}

/** The races a character could be, for the cons its NPCs give. */
export interface RaceMods {
  /** Its race now. */
  own: string
  /** The races it can swap to in Loadouts now; null when no achievements export says, and then every race counts. */
  unlocked: string[] | null
  /** By race (its own among them), by faction: the race's modifier and the best of its classes' (the plan counts everyone Agnostic, which adds none). 0s left out. */
  mods: Record<string, Record<string, number>>
}

export interface PlanStep {
  activity: PlanActivity
  units: number
  /** Including getting there, and any race swap. */
  seconds: number
  travel: number
  /** Swapping race in Loadouts for it and back; 0 when the character's own race will do. */
  swap: number
  /** Units the items on hand cover. */
  fromStock: number
  /** Copper the bought items cost. */
  copper: number
  /** Achievements done during this step (and factions a race unlock wanted maxed). */
  finishes: string[]
  /** Race unlocks done during this step. */
  unlocks: string[]
  /**
   * Factions it raises to the con a later step's NPC wants: the standing to reach, that con's word, and
   * that step's activity. A step there only for this finishes nothing itself: it opens a quicker way.
   */
  reaches: { faction: string; to: number; band: string; opens: string }[]
  /** The race it is done as, swapped to in Loadouts, when not the character's own. */
  race?: string
  /** Then: the first con its NPC wants that the character's own race would fall short of there. */
  why?: { faction: string; band: string; con: number }
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
  /**
   * Achievements locked in to another activity that this step gets to 2000 first, with that activity's
   * title: standing rises with whatever raises it, so the lock is not needed for them any more.
   */
  onTheWay: Record<string, string>
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

/**
 * Why the plan leaves an achievement undone: nothing known raises it; only quests done once do (a lock
 * plans one); every way is ruled out; every way's NPC wants a con the plan cannot get to, as the
 * character's race or one it can swap to; or the ways it may use do not get it to 2000.
 */
export type Unplanned = 'nothing known' | 'once only' | 'ruled out' | 'gated' | 'not reached'

/**
 * A plan's order: each block's activity, the achievements it is there to finish, the factions it is
 * there to bring back to 0 or above, and those it is there to raise to what another activity's NPC wants.
 */
export type PlanShape = { act: string; finish: string[]; lift?: string[]; reach?: { faction: string; to: number; for: string }[] }[]

export interface FactionPlan {
  steps: PlanStep[]
  seconds: number
  /** What it is for: the achievements to do, then the factions only a race unlock wants maxed. */
  targets: PlanTarget[]
  /** Of those, what the plan does not get done: nothing it may use raises them (with the choices made), or opens a way that does. */
  unplanned: string[]
  /** Why, for each of them. */
  unplannedWhy: Record<string, Unplanned>
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

/** The cons an activity's NPC wants, as standings: each race's lowest and highest for each faction. */
interface Gate {
  /** The factions (their index), and each con's word ("Amiable"). */
  i: Int32Array
  bands: string[]
  /** The standing race r needs with faction j, at least and at most: [r * needs + j]. */
  lo: Float64Array
  hi: Float64Array
  /** The other races to swap to, the ones its NPC likes best first. */
  order: Int32Array
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
  /** What its NPC wants, where the races' modifiers are known; null when it wants nothing. */
  gate: Gate | null
  /** Locked in: done whatever its NPC wants (the player says it can be). */
  locked: boolean
  /** Without the races' modifiers, as the catalog found it: 0 open, 1 open to another race, for `swap` seconds. */
  fixed: number
  swap: number
}

/** A faction a block raises to the standing another activity's NPC wants (`for`, that activity). */
interface Reach {
  i: number
  v: number
  for: number
}

interface Block {
  act: number
  /** Targets this block is there to finish. */
  finish: number[]
  /** Factions it is there to bring back to 0 or above (the 'positive' goal). */
  lift: number[]
  /** Factions it is there to raise to what a later block's NPC wants. */
  reach: Reach[]
}

/** A plan's state as it goes: standings, targets done, factions that have been at 2000, what is on hand, where the player is and as what. */
interface State {
  s: Float64Array
  done: Uint8Array
  peak: Uint8Array
  stock: Float64Array
  zone: number
  /** The activity last worked on. */
  act: number
  /** The race it was done as (0 the character's own): going on as that race needs no new swap. */
  race: number
  /** The races the character can be, a bit each: its own always, others as they are unlocked. */
  races: number
  /** Race unlocks done, and when (seconds into the plan). */
  goal: Uint8Array
  goalAt: Float64Array
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
 * the plan's length, so a long plan tries fewer. A third of a second for all 83 achievements, where ten
 * times as much finds a plan no more than 0.2% quicker.
 */
const SEARCH_WORK = 3_000_000
/** Steps the 'positive' goal may add to bring factions back to 0 or above. */
const LIFTS_MAX = 80
/** While race unlocks come first, the greedy build counts a point on one's factions this many times over. */
const UNLOCK_BOOST = 3
/** While race unlocks come first, a second sooner for the average race unlock is worth a second of play. */
const UNLOCK_WEIGHT = 1

/** How much to trust a figure: the log's own, seen often, most; the wiki's guesses least. */
function riskOf(a: PlanActivity, choices: PlanChoices, locked: boolean): number {
  if (locked || choices.perHour[a.id] > 0) return 1
  if (a.source === 'log') return (a.seen ?? 0) >= 10 ? 1 : 1.15
  return a.guessed?.length ? 1.35 : 1.2
}

/**
 * Whether the planner may use an activity: not ruled out and not once only, unless locked in. One whose
 * NPC does not take it yet is the planner's when it knows what the NPC wants (it may raise a faction to
 * get there, or swap race), or, without that, when another race opens it and `swaps` plans race swaps.
 */
export const plannable = (a: PlanActivity, choices: PlanChoices, swaps = false) => {
  const locked = Object.values(choices.locks).includes(a.id)
  return locked || (!a.once && !choices.excluded.includes(a.id) && (!a.blocked || !!a.gate?.length || (swaps && !!a.swap?.length)))
}

/** Seconds to swap race in Loadouts for an activity and back: one its own race's con keeps closed and another's opens, when swaps are planned; else 0. */
export const swapSeconds = (a: PlanActivity, s: PlanSettings) => (s.raceSwaps && a.blocked && a.swap?.length ? Math.max(0, s.swapMin) * 60 : 0)

/**
 * The plan. Every achievement still to do is a must, and so is every race unlock's faction; how the rest
 * is weighed is the goal's: 'fastest' counts time (and, a little, points left off factions that were at
 * 2000), 'positive' also counts every faction that ends at 0 or above, and may add steps at the end to
 * bring factions back there. Where a faction ends is what counts, so a point an early step takes and a
 * later one gives back costs nothing. With race unlocks first, each unlock done sooner counts as well.
 *
 * Where the races' modifiers are known (`input.races`), a quest whose NPC wants a con opens as the
 * standings get there, as the character's own race or one it can swap to (the ones unlocked, and each
 * one a race unlock in the plan unlocks); and the plan may add a step that raises a faction to what a
 * quicker quest's NPC wants, where that saves time.
 *
 * With `keep`, the order of an earlier plan is kept when it still finishes everything (only the
 * standings have moved since): the steps update, nothing is searched, and nothing is reshuffled under
 * the player's feet. Otherwise, or when it no longer does, the order is searched for afresh.
 */
export function planFactions(input: PlanInput, settings: PlanSettings, choices: PlanChoices = NO_CHOICES, keep?: PlanShape): FactionPlan {
  const { activities } = input
  const known = input.standings ?? {}
  // A race unlock's factions are to do too; nearly all of them are achievements anyway.
  const openGoals = (input.unlocks ?? []).filter((g) => g.factions.length > 0 || (g.anyOf?.length ?? 0) > 0)
  const targets: PlanTarget[] = [...input.targets]
  for (const g of openGoals)
    for (const f of g.factions) if (!targets.some((t) => t.faction === f)) targets.push({ faction: f, achievement: g.achievement, standing: known[f] ?? 0 })
  const travel = settings.travelMin * 60
  const T = targets.length
  /** One faction ending at 0 or above, in seconds; nothing when only time counts. */
  const W = settings.goal === 'positive' ? Math.max(0, settings.positiveHours) * 3600 : 0
  // Every faction whose standing is known: the targets first (index below T), then the rest, then the ones only an NPC's con wants.
  const names = targets.map((t) => t.faction)
  const index = new Map(names.map((f, i) => [f, i]))
  const add = (f: string) => {
    let i = index.get(f)
    if (i === undefined) {
      index.set(f, (i = names.length))
      names.push(f)
    }
    return i
  }
  const maxedNow = new Set(input.maxed)
  for (const f of [...Object.keys(known), ...input.maxed]) add(f)
  const races = input.races
  // The factions NPCs want a con with, of quests that raise an achievement: raising one may open a quicker way.
  const gateWanted = new Set<number>()
  if (races)
    for (const a of activities) {
      if (!a.gate?.length) continue
      const g = a.gate.map((n) => add(n.faction))
      if (Object.entries(a.hits).some(([f, h]) => h > 0 && (index.get(f) ?? T) < T)) g.forEach((i) => gateWanted.add(i))
    }
  const F = names.length
  const start = Float64Array.from(names, (f, i) => clamp(i < T ? targets[i].standing : (known[f] ?? (maxedNow.has(f) ? STANDING_MAX : 0)), STANDING_MIN, STANDING_MAX))
  const lockedIds = new Set(Object.values(choices.locks))

  // ---- races: the character's own (0), and the others it could be ----
  const raceNames = races
    ? [
        races.own,
        ...Object.keys(races.mods)
          .filter((r) => r !== races.own)
          .sort()
      ]
    : []
  const RN = raceNames.length
  const modOf = (r: number, f: string) => races?.mods[raceNames[r]]?.[f] ?? 0
  // The races it can be at the start: its own, and with swaps planned the ones it has unlocked and its own with another class.
  let races0 = 1
  if (races && settings.raceSwaps) for (let r = 1; r < RN; r++) if (races.unlocked === null || races.unlocked.includes(raceNames[r]) || classSwapOf(raceNames[r])) races0 |= 1 << r
  const swapSec = Math.max(0, settings.swapMin) * 60

  // What each activity does to the factions: one that raises an achievement still to do, one that
  // raises what a quest's NPC wants, and for the 'positive' goal one that raises any faction, to bring it back.
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
    const locked = lockedIds.has(a.id)
    if (!locked && (a.once || choices.excluded.includes(a.id))) continue
    // Without the races' modifiers, as the catalog found it: closed unless another race opens it and swaps are planned.
    let fixed = 0
    if (!races && a.blocked && !locked) {
      if (!(settings.raceSwaps && a.swap?.length)) continue
      fixed = 1
    }
    const touch: { i: number; h: number }[] = []
    let raisesTarget = false
    let raisesAny = false
    let raisesGate = false
    for (const [f, h] of Object.entries(a.hits)) {
      const i = index.get(f)
      if (i === undefined || !h) continue
      touch.push({ i, h })
      if (h > 0) {
        raisesAny = true
        if (i < T) raisesTarget = true
        if (gateWanted.has(i)) raisesGate = true
      }
    }
    if (!raisesTarget && !raisesGate && !(W && raisesAny)) continue
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
    // What its NPC wants, as the standing each race needs: its con less the race's modifiers.
    let gate: Gate | null = null
    if (races && a.gate?.length) {
      const N = a.gate.length
      const i = new Int32Array(N)
      const lo = new Float64Array(RN * N)
      const hi = new Float64Array(RN * N)
      a.gate.forEach((n, j) => {
        i[j] = index.get(n.faction)!
        for (let r = 0; r < RN; r++) {
          const m = modOf(r, n.faction)
          lo[r * N + j] = n.min !== undefined && (n.min > 0 || n.real) ? n.min - m : -Infinity
          hi[r * N + j] = n.max !== undefined ? n.max - m : Infinity
        }
      })
      const liking = (r: number) => a.gate!.reduce((s, n) => s + modOf(r, n.faction), 0)
      const order = Int32Array.from(Array.from({ length: Math.max(0, RN - 1) }, (_, x) => x + 1).sort((p, q) => liking(q) - liking(p) || p - q))
      gate = { i, bands: a.gate.map((n) => n.band), lo, hi, order }
    }
    acts.push({
      a,
      unit: time.seconds,
      hand: time.handSeconds,
      slot,
      per: item?.count ?? 1,
      risk: riskOf(a, choices, locked),
      zone: zones.get(zk)!,
      touch,
      gate,
      locked,
      fixed,
      swap: fixed ? swapSeconds(a, settings) : 0
    })
  }
  const K = acts.length
  const stock0 = Float64Array.from(held)
  // Per-unit amounts, activity by activity: amt[k * F + i].
  const amt = new Float32Array(K * F)
  acts.forEach((x, k) => x.touch.forEach(({ i, h }) => (amt[k * F + i] = h)))
  const amount = (k: number, i: number) => amt[k * F + i]
  // Which activities raise each faction: to bring one back, or to open a quest.
  const raisers: number[][] = Array.from({ length: F }, () => [])
  acts.forEach((x, k) => x.touch.forEach(({ i, h }) => h > 0 && raisers[i].push(k)))

  const actIndex = new Map(acts.map((x, k) => [x.a.id, k]))
  // A lock holds when its activity is here and raises the achievement.
  const lockOf = Int32Array.from(targets, (t, i) => {
    const k = actIndex.get(choices.locks[t.faction] ?? '')
    return k !== undefined && amount(k, i) > 0 ? k : -1
  })
  const staleLocks = targets.filter((t, i) => choices.locks[t.faction] !== undefined && lockOf[i] < 0).map((t) => t.faction)
  const credits = (k: number, i: number) => lockOf[i] < 0 || lockOf[i] === k

  // ---- which race an activity is done as ----
  /** Whether race r is one the character can be at this point: its own, or one unlocked. */
  const can = (r: number, st: State) => r === 0 || ((st.races >>> r) & 1) === 1
  const meets = (g: Gate, r: number, s: Float64Array) => {
    const N = g.i.length
    for (let j = 0; j < N; j++) {
      const v = s[g.i[j]]
      if (v < g.lo[r * N + j] || v > g.hi[r * N + j]) return false
    }
    return true
  }
  /**
   * The race k is done as at this point: the character's own (0), one it swaps to, or -1 while no race
   * it can be meets what its NPC wants. A race already swapped to goes on, else the one its NPC likes best.
   */
  const raceFor = (k: number, st: State): number => {
    const x = acts[k]
    if (!races) return x.fixed
    const g = x.gate
    if (!g || meets(g, 0, st.s)) return 0
    if (st.race > 0 && can(st.race, st) && meets(g, st.race, st.s)) return st.race
    for (const r of g.order) if (can(r, st) && meets(g, r, st.s)) return r
    return x.locked ? 0 : -1
  }
  /** Starting on k as race r: the trip there from another zone, and a race swap there and back unless swapped to it already. */
  const setup = (k: number, st: State, r: number) =>
    (acts[k].zone === st.zone ? 0 : travel) + (r > 0 ? (races ? (st.race === r ? 0 : swapSec) : st.act === k ? 0 : acts[k].swap) : 0)

  // ---- race unlocks ----
  // Each is done once its factions have all been at 2000 (Half Elf's once one of its others is), and
  // its race is then one more the character can be. Those done by others go last, so one pass sees them.
  const goals = [...openGoals].sort((p, q) => (p.anyOf?.length ? 1 : 0) - (q.anyOf?.length ? 1 : 0))
  const G = goals.length
  const goalNames = goals.map((g) => g.achievement)
  const members = goals.map((g) => g.factions.map((f) => index.get(f)!))
  const anyOf = goals.map((g) => (g.anyOf ?? []).map((n) => goalNames.indexOf(n)))
  // One of its others that is not still to do is done: then so is this one.
  const anyDone = anyOf.map((xs) => xs.some((h) => h < 0))
  const goalRace = Int32Array.from(goals, (g) => raceNames.indexOf(g.race))
  const checkGoals = (st: State, t: number) => {
    for (let g = 0; g < G; g++) {
      if (st.goal[g]) continue
      let done = true
      if (anyOf[g].length) done = anyDone[g] || anyOf[g].some((h) => h >= 0 && st.goal[h] === 1)
      else
        for (const i of members[g])
          if (!st.peak[i]) {
            done = false
            break
          }
      if (!done) continue
      st.goal[g] = 1
      st.goalAt[g] = t
      if (goalRace[g] > 0 && settings.raceSwaps) st.races |= 1 << goalRace[g]
    }
  }

  const base: State = {
    s: Float64Array.from(start),
    done: new Uint8Array(T),
    peak: new Uint8Array(F),
    stock: Float64Array.from(stock0),
    zone: -1,
    act: -1,
    race: 0,
    races: races0,
    goal: new Uint8Array(G),
    goalAt: new Float64Array(G)
  }
  for (let i = 0; i < F; i++) {
    if (start[i] < STANDING_MAX) continue
    base.peak[i] = 1
    if (i < T) base.done[i] = 1
  }
  checkGoals(base, 0)
  const fresh = (): State => ({
    ...base,
    s: base.s.slice(),
    done: base.done.slice(),
    peak: base.peak.slice(),
    stock: base.stock.slice(),
    goal: base.goal.slice(),
    goalAt: base.goalAt.slice()
  })
  const reset = (st: State) => {
    st.s.set(base.s)
    st.done.set(base.done)
    st.peak.set(base.peak)
    st.stock.set(base.stock)
    st.goal.set(base.goal)
    st.goalAt.set(base.goalAt)
    st.zone = -1
    st.act = -1
    st.race = 0
    st.races = base.races
  }

  // Whether each activity can come to be done at all: open now to a race the character can be (or may
  // unlock in the plan), or opened by raising the one faction its NPC wants more of with an activity
  // that is open now.
  let hope = base.races
  if (settings.raceSwaps) for (let g = 0; g < G; g++) if (goalRace[g] > 0) hope |= 1 << goalRace[g]
  const openTo = (k: number, s: Float64Array, mask: number) => {
    const g = acts[k].gate
    if (!g || acts[k].locked) return true
    for (let r = 0; r < RN; r++) if ((mask >>> r) & 1 && meets(g, r, s)) return true
    return false
  }
  const mayOpen = acts.map((x, k) => {
    const g = x.gate
    if (!g || x.locked) return true
    const N = g.i.length
    for (let r = 0; r < RN; r++) {
      if (!((hope >>> r) & 1)) continue
      let short = -1
      let ok = true
      for (let j = 0; j < N && ok; j++) {
        const v = start[g.i[j]]
        if (v > g.hi[r * N + j]) ok = false
        else if (v < g.lo[r * N + j]) {
          if (short >= 0) ok = false
          short = j
        }
      }
      if (!ok) continue
      if (short < 0 || raisers[g.i[short]].some((j) => j !== k && openTo(j, start, hope))) return true
    }
    return false
  })

  // What a point on each achievement is worth: the seconds it takes with its quickest way.
  const worth = new Float64Array(T).fill(Infinity)
  for (let k = 0; k < K; k++) {
    if (!mayOpen[k]) continue
    for (const { i, h } of acts[k].touch) if (i < T && h > 0 && credits(k, i)) worth[i] = Math.min(worth[i], (acts[k].unit * acts[k].risk) / h)
  }
  const reachable = Array.from(worth, Number.isFinite)
  // A point a faction ends below 2000 after being there, in seconds.
  const maxedPoint = (median(Array.from(worth).filter(Number.isFinite)) || 1) * settings.keepMaxed

  // The race unlocks the plan can get done, and with race unlocks first, what each of their factions weighs.
  const doable = new Uint8Array(G)
  for (let g = 0; g < G; g++)
    if (!base.goal[g]) doable[g] = anyOf[g].length ? (anyOf[g].some((h) => h >= 0 && doable[h] === 1) ? 1 : 0) : members[g].every((i) => reachable[i] || base.peak[i]) ? 1 : 0
  const counted = goals.flatMap((_, g) => (doable[g] ? [g] : []))
  const first = settings.unlocksFirst && counted.length > 0
  const memberOf: number[][] = Array.from({ length: T }, () => [])
  for (const g of counted) for (const i of members[g]) memberOf[i].push(g)
  const boost = (i: number, st: State) => (first && memberOf[i].some((g) => !st.goal[g]) ? 1 + UNLOCK_BOOST : 1)

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
  /** Units a block runs: until the achievements it is there for are done, the factions it lifts are at 0 or above and the ones it raises for a quest are there; 0 when they already are. */
  const blockUnits = (b: Block, st: State) => {
    let n = 0
    for (const i of b.finish) if (!st.done[i]) n = Math.max(n, Math.ceil((STANDING_MAX - st.s[i]) / amount(b.act, i) - EPS))
    for (const i of b.lift) if (st.s[i] < 0) n = Math.max(n, Math.ceil(-st.s[i] / amount(b.act, i) - EPS))
    for (const q of b.reach) if (st.s[q.i] < q.v) n = Math.max(n, Math.ceil((q.v - st.s[q.i]) / amount(b.act, q.i) - EPS))
    return n
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
  /**
   * What n units of k do for the plan, in seconds of work: points on achievements still to do (a race
   * unlock's weigh more while they come first), less points taken off them and off factions that were
   * at 2000, and for the 'positive' goal factions crossing 0.
   */
  const valueOf = (k: number, n: number, st: State) => {
    let gain = 0
    let loss = 0
    let kept = 0
    let cross = 0
    for (const { i, h } of acts[k].touch) {
      const v = st.s[i]
      if (i < T && !st.done[i]) {
        if (h > 0 && credits(k, i)) gain += worth[i] * boost(i, st) * Math.min(STANDING_MAX - v, n * h)
        else if (h < 0 && reachable[i]) loss += worth[i] * boost(i, st) * Math.min(n * -h, v - STANDING_MIN)
        continue
      }
      const after = clamp(v + n * h, STANDING_MIN, STANDING_MAX)
      if (st.peak[i]) kept += (v - after) * maxedPoint
      if (W) cross += ((after >= 0 ? 1 : 0) - (v >= 0 ? 1 : 0)) * W
    }
    return gain - loss - kept + cross
  }
  /** Units of k until the next achievement it is there for is done; Infinity when it serves none. */
  const toNext = (k: number, st: State) => {
    let n = Infinity
    for (const { i, h } of acts[k].touch) if (i < T && h > 0 && !st.done[i] && credits(k, i)) n = Math.min(n, Math.ceil((STANDING_MAX - st.s[i]) / h - EPS))
    return n
  }
  interface Opening {
    /** The activity that opens it, how many of it, and the race each is done as. */
    j: number
    n: number
    r: number
    rk: number
    reach: Reach
    /** Seconds the opening takes, with the trip. */
    t: number
  }
  /** The quickest way to open k, which no race the character can be may do yet: raise the one faction its NPC wants more of with an activity open now. */
  const opening = (k: number, st: State): Opening | null => {
    const g = acts[k].gate
    if (!g) return null
    const N = g.i.length
    let best: Opening | null = null
    for (let r = 0; r < RN; r++) {
      if (!can(r, st)) continue
      let short = -1
      let ok = true
      for (let j = 0; j < N && ok; j++) {
        const v = st.s[g.i[j]]
        if (v > g.hi[r * N + j]) ok = false
        else if (v < g.lo[r * N + j]) {
          if (short >= 0) ok = false
          short = j
        }
      }
      if (!ok || short < 0) continue
      const i = g.i[short]
      const v = g.lo[r * N + short]
      for (const j of raisers[i]) {
        if (j === k) continue
        const rj = raceFor(j, st)
        if (rj < 0) continue
        const n = Math.ceil((v - st.s[i]) / amount(j, i) - EPS)
        if (n <= 0) continue
        const t = timeFor(j, n, st.stock, false) * acts[j].risk + setup(j, st, rj)
        if (!best || t < best.t) best = { j, n, r: rj, rk: r, reach: { i, v, for: k }, t }
      }
    }
    return best
  }

  function greedy(noise: number, random: () => number): Block[] {
    const st = fresh()
    for (let i = 0; i < T; i++) if (!reachable[i]) st.done[i] = 1
    const blocks: Block[] = []
    for (let guard = 0; guard < 1000 && st.done.includes(0); guard++) {
      let best = -Infinity
      let pick = -1
      let pickN = 0
      let pickR = 0
      let opened: Opening | null = null
      for (let k = 0; k < K; k++) {
        if (!mayOpen[k]) continue
        const n = toNext(k, st)
        if (!Number.isFinite(n) || n <= 0) continue
        const jitter = 1 + noise * (random() - 0.5)
        const r = raceFor(k, st)
        if (r >= 0) {
          const time = Math.max(1, timeFor(k, n, st.stock, false) * acts[k].risk + setup(k, st, r))
          const score = (valueOf(k, n, st) / time) * jitter
          if (score > best) {
            best = score
            pick = k
            pickN = n
            pickR = r
            opened = null
          }
          continue
        }
        // Its NPC does not take it yet: worth raising what it wants first, and then doing it?
        const o = opening(k, st)
        if (!o) continue
        const then = (acts[k].zone === acts[o.j].zone ? 0 : travel) + (o.rk > 0 && o.rk !== o.r ? swapSec : 0)
        const time = Math.max(1, o.t + timeFor(k, n, st.stock, false) * acts[k].risk + then)
        const score = ((valueOf(o.j, o.n, st) + valueOf(k, n, st)) / time) * jitter
        if (score > best) {
          best = score
          pick = o.j
          pickN = o.n
          pickR = o.r
          opened = o
        }
      }
      if (pick < 0) break
      const before = Uint8Array.from(st.done)
      timeFor(pick, pickN, st.stock, true)
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
      st.act = pick
      st.race = pickR
      checkGoals(st, 0)
      const finished: number[] = []
      for (let i = 0; i < T; i++) if (st.done[i] && !before[i] && credits(pick, i) && amount(pick, i) > 0) finished.push(i)
      const reach = opened ? [opened.reach] : []
      const last = blocks[blocks.length - 1]
      if (last && last.act === pick && !reach.length) last.finish.push(...finished)
      else blocks.push({ act: pick, finish: finished, lift: [], reach })
    }
    return blocks
  }

  /** The state at the end of an order of blocks. A block whose NPC no race the character can be then pleases is left out. */
  const run = (blocks: Block[], st: State) => {
    reset(st)
    let total = 0
    let flow = 0
    for (const b of blocks) {
      const n = blockUnits(b, st)
      if (n <= 0) continue
      const r = raceFor(b.act, st)
      if (r < 0) continue
      const x = acts[b.act]
      total += timeFor(b.act, n, st.stock, true) * x.risk + setup(b.act, st, r)
      st.zone = x.zone
      st.act = b.act
      st.race = r
      flow += apply(b.act, n, st) * total
      checkGoals(st, total)
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
    // Race unlocks first: when the average one is done counts too (one not done, as late as the plan ends).
    let soon = 0
    if (first) {
      for (const g of counted) soon += sim.goal[g] ? sim.goalAt[g] : total
      soon = (soon / counted.length) * UNLOCK_WEIGHT
    }
    return total + missed + flow * FLOW_WEIGHT + ending(sim) + soon
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
      let pickR = 0
      for (let i = 0; i < F; i++) {
        if (st.s[i] >= 0) continue
        for (const k of raisers[i]) {
          const n = Math.ceil(-st.s[i] / amount(k, i) - EPS)
          if (n <= 0) continue
          const r = raceFor(k, st)
          if (r < 0) continue
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
          const value = W * up - timeFor(k, n, st.stock, false) * acts[k].risk - setup(k, st, r) - lost * maxedPoint
          if (value > best) {
            best = value
            pick = k
            pickN = n
            pickI = i
            pickR = r
          }
        }
      }
      if (pick < 0) break
      out.push({ act: pick, finish: [], lift: [pickI], reach: [] })
      timeFor(pick, pickN, st.stock, true)
      apply(pick, pickN, st)
      st.zone = acts[pick].zone
      st.act = pick
      st.race = pickR
      checkGoals(st, 0)
    }
    return out
  }

  // ---- local search: move blocks, drop a step that is only there for others, give an achievement to another way ----
  const alternatives = targets.map((_, i) => {
    const ways: { k: number; per: number }[] = []
    for (let k = 0; k < K; k++) if (mayOpen[k] && amount(k, i) > 0 && credits(k, i)) ways.push({ k, per: (acts[k].unit * acts[k].risk) / amount(k, i) })
    return ways
      .sort((p, q) => p.per - q.per)
      .slice(0, 6)
      .map((o) => o.k)
  })
  // For a way its NPC does not take at the start, the quickest way to open it there.
  const openers = acts.map((_, k) => (races && mayOpen[k] && raceFor(k, base) < 0 ? opening(k, base) : null))
  /**
   * Where a new block of these activities is worth trying in an order: first, last, where the block it
   * takes over from was (`at`), and beside a block in the same zone, where it needs no trip of its own.
   * The moves that follow put it anywhere else it is better.
   */
  const spots = (order: Block[], ks: number[], at: number) => {
    const out = new Set([0, order.length, Math.min(at, order.length)])
    order.forEach((b, j) => {
      if (!ks.some((k) => acts[k].zone === acts[b.act].zone)) return
      out.add(j)
      out.add(j + 1)
    })
    return [...out].sort((p, q) => p - q)
  }
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
      // Move a block that opens a quest together with the quest's block, side by side: along the way
      // somewhere else, where its faction does not have to be raised back first.
      for (let from = 0; from < blocks.length && within(); from++) {
        const opens = blocks[from].reach.map((q) => q.for)
        const then = blocks.findIndex((b, j) => j > from && opens.includes(b.act))
        if (then < 0) continue
        const rest = blocks.filter((_, j) => j !== from && j !== then)
        for (let to = 0; to <= rest.length; to++) {
          if (to === from && then === from + 1) continue
          const trial = rest.slice()
          trial.splice(to, 0, blocks[from], blocks[then])
          better = take(trial) || better
        }
      }
      // Drop a step that finishes nothing (it brings factions back, or opens a quest), when it is not worth its time any more.
      for (let j = blocks.length - 1; j >= 0 && within(); j--) if (!blocks[j].finish.length) better = take(blocks.filter((_, x) => x !== j)) || better
      // Finish one achievement another way: in a block of that activity, or a new block anywhere, opened first where it must be.
      for (let i = 0; i < T && within(); i++) {
        if (lockOf[i] >= 0) continue
        const at = blocks.findIndex((b) => b.finish.includes(i))
        if (at < 0) continue
        for (const k of alternatives[i]) {
          if (k === blocks[at].act) continue
          const rest = blocks[at].finish.filter((x) => x !== i)
          const without = blocks.flatMap((b, j) => (j !== at ? [b] : rest.length || b.lift.length || b.reach.length ? [{ ...b, finish: rest }] : []))
          without.forEach((b, j) => {
            if (b.act !== k) return
            const t = without.slice()
            t[j] = { ...b, finish: [...b.finish, i] }
            better = take(t) || better
          })
          for (const pos of spots(without, [k], at)) {
            const t = without.slice()
            t.splice(pos, 0, { act: k, finish: [i], lift: [], reach: [] })
            better = take(t) || better
          }
          const o = openers[k]
          if (!o) continue
          for (const pos of spots(without, [o.j, k], at)) {
            const t = without.slice()
            t.splice(pos, 0, { act: o.j, finish: [], lift: [], reach: [o.reach] }, { act: k, finish: [i], lift: [], reach: [] })
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
    const blocks = keep.flatMap((b): Block[] => {
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
      const reach = (b.reach ?? []).flatMap((q) => {
        const i = index.get(q.faction)
        const to = actIndex.get(q.for)
        return i !== undefined && to !== undefined && amount(k, i) > 0 ? [{ i, v: q.to, for: to }] : []
      })
      return finish.length || lift.length || reach.length ? [{ act: k, finish, lift, reach }] : []
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
    const work = Math.max(5_000, Math.round(SEARCH_WORK / Math.max(10, ranked[0].blocks.length)))
    const starts = ranked.slice(0, 3)
    starts.forEach((cand, n) => {
      // Each start its share of what is left: one that settles early leaves the rest to the next.
      budget = tried + Math.ceil((work - tried) / (starts.length - n))
      const got = improve(cand.blocks)
      if (got.cost < best.cost) best = got
    })
    budget = work
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
      const r = raceFor(b.act, st)
      if (r < 0) continue
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
      // Done as another race: what the character's own would con there, with the first thing its NPC wants that it falls short of.
      let why: PlanStep['why']
      if (r > 0 && x.gate) {
        const g = x.gate
        for (let j = 0; j < g.i.length && !why; j++) {
          const v = st.s[g.i[j]]
          if (v < g.lo[j] || v > g.hi[j]) why = { faction: names[g.i[j]], band: g.bands[j], con: Math.round(v + modOf(0, names[g.i[j]])) }
        }
      }
      const before = Uint8Array.from(st.done)
      const goalsBefore = st.goal.slice()
      const move = x.zone === st.zone ? 0 : travel
      const swap = setup(b.act, st, r) - move
      const t = timeFor(b.act, n, st.stock, true)
      const fast = covered
      apply(b.act, n, st)
      checkGoals(st, 0)
      const finishes = targets.flatMap((tg, i) => (st.done[i] && !before[i] ? [tg.faction] : []))
      const unlocks = goalNames.filter((_, g) => st.goal[g] && !goalsBefore[g])
      const reaches = b.reach.map((q) => {
        const g = acts[q.for].gate
        const j = g ? g.i.indexOf(q.i) : -1
        return { faction: names[q.i], to: Math.ceil(q.v - EPS), band: g && j >= 0 ? g.bands[j] : '', opens: acts[q.for].a.title }
      })
      const race = r > 0 ? (races ? raceNames[r] : x.a.swap?.[0]) : undefined
      st.zone = x.zone
      st.act = b.act
      st.race = r
      const last = steps[steps.length - 1]
      if (last && last.activity.id === x.a.id) {
        last.units += n
        last.seconds += t
        last.fromStock += fast
        last.copper += (n - fast) * unitCopper(x.a)
        last.finishes.push(...finishes)
        last.unlocks.push(...unlocks)
        last.reaches.push(...reaches)
        last.restores &&= !b.finish.length && !b.reach.length
        for (const [f, v] of Object.entries(raises)) last.raises[f] = (last.raises[f] ?? 0) + v
        for (const [f, v] of Object.entries(lowers)) last.lowers[f] = (last.lowers[f] ?? 0) + v
        for (const [f, v] of Object.entries(maxedLowered)) last.maxedLowered[f] = (last.maxedLowered[f] ?? 0) + v
        last.lifts = [...new Set([...last.lifts.filter((f) => !sinks.includes(f)), ...lifts])]
        last.sinks = [...new Set([...last.sinks.filter((f) => !lifts.includes(f)), ...sinks])]
      } else {
        steps.push({
          activity: x.a,
          units: n,
          seconds: t + move + swap,
          travel: move,
          swap,
          fromStock: fast,
          copper: (n - fast) * unitCopper(x.a),
          finishes,
          unlocks,
          reaches,
          raises,
          lowers,
          maxedLowered,
          lifts,
          sinks,
          restores: !b.finish.length && !b.reach.length,
          locked: [],
          onTheWay: {},
          ...(race ? { race } : {}),
          ...(why ? { why } : {})
        })
      }
    }
    const at = new Map(targets.map((t, i) => [t.faction, i]))
    for (const step of steps) {
      step.locked = step.finishes.filter((f) => choices.locks[f] === step.activity.id)
      for (const f of step.finishes) {
        const i = at.get(f)
        const k = i === undefined ? -1 : lockOf[i]
        if (k >= 0 && acts[k].a.id !== step.activity.id) step.onTheWay[f] = acts[k].a.title
      }
    }
  }
  const seconds = steps.reduce((n, step) => n + step.seconds, 0)
  // What nothing the planner may use gets done, as the plan stands.
  const unplanned = targets.filter((_, i) => start[i] < STANDING_MAX && !st.done[i]).map((t) => t.faction)
  const unplannedWhy: Record<string, Unplanned> = {}
  targets.forEach((t, i) => {
    if (start[i] >= STANDING_MAX || st.done[i]) return
    const ways = activities.filter((a) => (a.hits[t.faction] ?? 0) > 0)
    const usable = ways.filter((a) => lockedIds.has(a.id) || (!a.once && !choices.excluded.includes(a.id)))
    const opens = acts.some((x, k) => mayOpen[k] && credits(k, i) && x.touch.some((u) => u.i === i && u.h > 0))
    unplannedWhy[t.faction] = !ways.length
      ? 'nothing known'
      : !usable.length
        ? ways.some((a) => choices.excluded.includes(a.id))
          ? 'ruled out'
          : 'once only'
        : opens
          ? 'not reached'
          : 'gated'
  })
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
    ...(b.lift.length ? { lift: b.lift.map((i) => names[i]) } : {}),
    ...(b.reach.length ? { reach: b.reach.map((q) => ({ faction: names[q.i], to: q.v, for: acts[q.for].a.id })) } : {})
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
      options[f].push({
        ...wayFor(a, h, start[index.get(f)!], unit, travel + swapSeconds(a, settings)),
        lowersOpen: lowered,
        chosen: chosenFor.get(f) === a.id,
        used: used.has(a.id)
      })
  }
  // Ways the planner may use first, quickest first; one-time and ruled-out ones after.
  const later = (o: PlanOption) => (plannable(o.activity, choices, settings.raceSwaps) ? 0 : 1)
  for (const list of Object.values(options)) list.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
  return { steps, seconds, targets, unplanned, unplannedWhy, options, staleLocks, maxedLost, belowZero: { now: belowNow, after: belowAfter }, shape, kept }
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
    return h > 0 ? [wayFor(a, h, standing, unitTime(a, settings, choices), settings.travelMin * 60 + swapSeconds(a, settings))] : []
  })
  const later = (w: Way) => (plannable(w.activity, choices, settings.raceSwaps) ? 0 : 1)
  return ways.sort((p, q) => later(p) - later(q) || p.seconds - q.seconds)
}
