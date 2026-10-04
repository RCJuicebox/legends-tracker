// What the faction planner (features/factions: names.ts and catalog.ts) knows that neither the game's
// tables nor the wikis tell it: names the wikis and the log write differently, and what players have
// found in play and on Allakhazam (everquest.allakhazam.com) where eqlwiki misleads for Legends or says
// nothing. Pure data; each entry says where it comes from, and when, where that is known. A line
// here is a finding: one that play turns out wrong is fixed here, and the planner follows.

/** How an item handed in is come by. */
export type HandInHow = 'coin' | 'bought' | 'vendor' | 'crafted' | 'drop' | 'unknown'

/** How a hand-in item is come by where play knows better than the wikis. */
export interface ItemInPlay {
  how: HandInHow
  /** A merchant (and zone), or where it drops. */
  where: string
  /** Dropped only by named mobs: how many different ones. */
  named?: number
  /** Seconds to come by one. */
  sec?: number
}

/** A con a quest wants: of which faction, the band's word, and the lowest and highest con allowed. */
export interface Need {
  faction: string
  band: string
  min?: number
  max?: number
  /** Seen to hold below Indifferent too: the NPC eats the hand-in under it, so faking a con does not help. */
  real?: boolean
}

// ---------- names ----------

/** Wiki names that reduce to something else than the game's. */
export const FACTION_ALIASES: Record<string, string> = {
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
  newsebilisexpedition: 'newsebilisianexpedition',
  merchantsofogguk: 'merchantsofoggok',
  oggukresidents: 'oggokresident'
}

/** Zones the log and the wiki name differently. */
export const ZONE_ALIASES: Record<string, string> = {
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

// ---------- places ----------

/** The cities, where killing the people brings the guards down on you. */
export const CITY_ZONES = [
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
]

/** A city's people rather than its vermin: named, or by what they are. */
export const CITY_PEOPLE =
  /\b(?:guards?|guardsman|citizens?|merchant|guildmaster|banker|captain|sentry|sentinel|watchman|lieutenant|sergeant|priest(?:ess)?|paladin|knight|warden)\b/i

// ---------- found in play, or on Allakhazam ----------

// Where the wikis mislead for Legends, as players have found it in play; and what Allakhazam's faction
// pages (everquest.allakhazam.com/db/faction.html) add: the con a quest's NPC wants before taking it,
// amounts eqlwiki leaves out, and mobs it does not list. Dated as found.

/** Quests that cannot be done over and over, by page (lower-cased), and why: planned at most once unless locked in. */
export const ONCE_IN_PLAY: Record<string, string> = {
  // From play (2026-09-29).
  'illegible cantrip quest': 'cannot be done over and over'
}

/** Quests whose NPC takes the hand-in only at or above a con, by page (lower-cased). A con can be faked as far as Indifferent, not past it (from play). */
export const NEEDS: Record<string, Need> = {
  // Allakhazam (2026-09-29).
  'tunare scouts dagger': { faction: "Tunare's Scouts", band: 'Amiable', min: 100 },
  // Sylia Windlehands took nothing from a Wood Elf Monk/Shadowknight/Shaman at Indifferent (55: "You need to
  // prove your dedication"), and took the silk from the same Wood Elf as a Monk/Enchanter/Bard at Amiable
  // (105), five minutes later (2026-09-29).
  'spiderling silks': { faction: 'Song Weavers', band: 'Amiable', min: 100 }
}

/** Amounts a quest page leaves out, by page (lower-cased), then faction. */
export const AMOUNTS: Record<string, Record<string, number>> = {
  // Allakhazam's +1, which play makes +5 (138 hand-ins to Tylfon, 2026-09-29).
  'tunare scouts dagger': { "Tunare's Scouts": 5 }
}

/**
 * Quests known from play as one repeatable time round, where the walkthroughs split them into steps that
 * look one-time: each unit is the whole round, its amounts the log's, and the site's where the log never
 * saw a step; its time a round the log's pace.
 */
export interface Cycle {
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

export const CYCLES: Cycle[] = [
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
    // Messages For Neriak over and over (eqlwiki's walkthrough; pointed out as a good one for The Dead,
    // 2026-10-03): ask Kizdean Gix in West Commonlands (by the toll booth at -162, 262; one of his two
    // spawns has a message) "Do you have any messages for Neriak?" for a Sealed Letter, and hand it to
    // Loveal S`Nez on the second floor of the Lodge of the Dead in Neriak Third Gate: The Dead +10, Queen
    // Cristanos Thex +5, Primordial Malice -20, King Naythox Thex, Keepers of the Art and Eldritch
    // Collective -1. The quest wants Amiable with The Dead (eqlwiki and Allakhazam), and Kizdean, The
    // Dead's own, attacks one it scowls at. The letter is taken to be lore, so one a round trip (a
    // guess, as Innoruuk Disciple's: set your own pace on it).
    page: 'Messages For Neriak',
    zone: 'West Commonlands',
    npc: 'Loveal S`Nez',
    hits: {
      'The Dead': 10,
      'Queen Cristanos Thex': 5,
      'King Naythox Thex': -1,
      'Keepers of the Art': -1,
      'Eldritch Collective': -1,
      'Primordial Malice': -20
    },
    guessed: [],
    items: [{ name: 'Sealed Letter', count: 1, how: 'drop', where: 'Kizdean Gix (West Commonlands), for "Do you have any messages for Neriak?"; lore, one a trip', sec: 240 }],
    needs: { faction: 'The Dead', band: 'Amiable', min: 100 },
    replaces: true,
    line: 'Ask Kizdean Gix in West Commonlands (by the toll booth at -162, 262) "Do you have any messages for Neriak?" for a Sealed Letter, and hand it to Loveal S`Nez on the second floor of the Lodge of the Dead in Neriak Third Gate. The quest wants Amiable with The Dead, and Kizdean attacks anyone The Dead hates.'
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
export const CAMPS: { zone: string; mobs: string[]; hits: Record<string, number>; guessed: string[] }[] = [
  {
    // 2026-09-29.
    zone: 'Greater Faydark',
    mobs: ['a mature arborean', 'an arborean sapling'],
    hits: { "Tunare's Scouts": 1, 'Emerald Warriors': 1, 'Soldiers of Tunare': 1, 'Faydarks Champions': 1, 'Arboreans of the Faydark': -1 },
    guessed: ['Emerald Warriors', 'Soldiers of Tunare', 'Faydarks Champions', 'Arboreans of the Faydark']
  }
]

/** Hand-in items that come from elsewhere than the wikis say, by lower-cased name. */
export const ITEMS_IN_PLAY: Record<string, ItemInPlay> = {
  // The walkthrough says goblins in several zones (2026-09-29).
  'small piece of high quality ore': { how: 'drop', where: 'the Goblin Janitor (Runnyeye)', named: 1 },
  // For Rephas's Rat Ear Pie Quest, the one way to raise Arcane Scientists that repeats: five came
  // from eighteen rats in Misty Thicket in about twenty minutes (2026-09-29).
  'rat ears': { how: 'drop', where: 'rats, such as in Misty Thicket', sec: 240 },
  // For Xelha's Cyclops Eye: they do drop in classic after all, two from nine seafury cyclopes in Ocean of
  // Tears in about seventeen minutes there (2026-10-02).
  'cyclops eye': { how: 'drop', where: 'seafury cyclopes (Ocean of Tears)', sec: 510 },
  // Easy to come by (2026-10-03): nearly every skeleton drops them, a couple at a time, and 69 came in
  // under six minutes of skeletons in play (2026-10-01); eqlwiki lists them only as a drop.
  'bone chips': { how: 'drop', where: 'skeletons, in most zones', sec: 5 }
}

/** A quest's hand-in item that is another than the one the wikis' item page is about, by quest page (lower-cased), then item. */
export const QUEST_ITEMS_IN_PLAY: Record<string, Record<string, ItemInPlay>> = {
  // Jeet's is the Scrap Metal Cleaner VII drops in North Kaladim, lore and no drop, so one a kill of
  // him; eqlwiki's item page puts it together with others, rogue clockworks' among them (2026-09-29).
  "miner's cap": { 'scrap metal': { how: 'drop', where: 'Cleaner VII (North Kaladim), lore: one at a time', named: 1 } }
}

/** Coin a quest's hand-in wants with its item, where the walkthrough says it in words the quest reader passes over, by quest page (lower-cased). */
export const QUEST_COIN: Record<string, { name: string; count: number }> = {
  // "hand him the Ogre Head and 300 Gold" (eqlwiki's walkthrough, 2026-09-29)
  'miners pick': { name: 'Gold', count: 300 },
  // Two Rusty Daggers and two Gold a hand-in to Tylfon, in play (2026-09-30).
  'tunare scouts dagger': { name: 'Gold', count: 2 }
}

/**
 * Mobs with "a" or "an" before the name that are only a few spawns in their zone, as found in play, and how
 * many, by the name without the article or what the wikis add after it ("an elven slave (male)" → "elven slave"):
 * a camp of them goes at their respawn, not at a camp's pace.
 */
export const FEW_IN_PLAY = new Map([
  // Crushbone has three elven slaves (2026-09-30): Indigo Brotherhood +5 a kill. Its elven priest gave
  // no Indigo Brotherhood in play, only Clerics of Tunare and King Tearis Thex -10
  // (how many there are is a guess).
  ['elven slave', 3],
  ['elven priest', 1]
])
