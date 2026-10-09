import type { GameTable } from './gameTables'

// The game's own names for its races, and the other names the same races go by. Slayer counts kills
// by race; the log never says a mob's race, eqlwiki writes races in the names of older race lists
// ("Giant Bat", "Qeynos Citizen", "Skeleton Classic") and the achievements in their own plurals
// ("Corathus Beasts", "Vah Shir"). Every name, from wherever it comes, is brought to one key: the
// client's name for the race (dbstr_us.txt, string type 11), where the old name is known to be one of
// its races. A kill counts toward an achievement when the two keys are the same; no word of one is
// looked for in the other.

/** The client's races, as keys, and the plural it gives each ("Giants", "Lizard Men", "Gingerbread Men") to its race. */
export interface RaceTable {
  races: Set<string>
  plurals: Map<string, string>
}

/** The race names in the client's string table (dbstr_us.txt: id^11^name^0, and id^12^plural^0). */
export const RACE_TABLE: GameTable<RaceTable> = {
  // The string table sits beside Resources, in the game folder itself.
  files: ['../dbstr_us.txt'],
  parse: ([text]) => parseRaceTable(text)
}

/** Every race the client names, as keys, and its plurals. */
export function parseRaceTable(text: string): RaceTable {
  const names = new Map<string, string>()
  const plural = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const p = line.split('^')
    if (p[1] === '11' && p[2]) names.set(p[0], p[2])
    else if (p[1] === '12' && p[2]) plural.set(p[0], p[2])
  }
  const races = new Set<string>()
  const plurals = new Map<string, string>()
  for (const [id, name] of names) {
    const k = raceKey(name)
    if (!k || k === 'unknown race') continue
    races.add(k)
    const pl = plural.get(id)
    if (pl && !plurals.has(normalRace(pl))) plurals.set(normalRace(pl), k)
  }
  return { races, plurals }
}

/** No client tables (no game folder chosen): names are brought to keys by the aliases alone. */
export const NO_RACE_TABLE: RaceTable = { races: new Set(), plurals: new Map() }

/** "Will-O-Wisp", "Will O' Wisp" → "will o wisp"; "Giant (Rallosian mats)" → "giant"; "Ra`tuk" → "ratuk". */
export function normalRace(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/[`']/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Other names of the client's races, by the race ID they are a name of where it is known (the
 * client's name for that ID in brackets is the key). Wiki names come first, then the achievements'.
 * A name whose race is one of several the client names alike (the dragons) keeps its own name, so it
 * still matches itself on the other side.
 */
const ALIASES: Record<string, string> = {
  // The old "giant" vermin: 34 Bat, 36 Rat, 37 Snake, 38 Spider.
  'giant bat': 'bat',
  'giant rat': 'rat',
  'giant rats': 'rat',
  'giant snake': 'snake',
  'giant spider': 'spider',
  // 18, 188, 189 Giant.
  'storm giant': 'giant',
  'frost giant': 'giant',
  'giant/cyclops': 'giant',
  cyclops: 'giant',
  // 40, 59, 137 Goblin.
  'kunark goblin': 'goblin',
  'fire goblin': 'goblin',
  'ice goblin': 'goblin',
  bloodgills: 'goblin',
  // 23, 130 Kerran.
  kerra: 'kerran',
  'vah shir': 'kerran',
  // The city races: 67 and 71 Human, 77 Dark Elf, 78 Erudite, 81 Halfling, 90 Barbarian, 92 Troll, 93 Ogre, 94 Dwarf, 139 Iksar.
  'highpass citizen': 'human',
  'qeynos citizen': 'human',
  'freeport citizen': 'human',
  'neriak citizen': 'dark elf',
  'erudin citizen': 'erudite',
  'paineel citizen': 'erudite',
  'rivervale citizen': 'halfling',
  'halas citizen': 'barbarian',
  'grobb citizen': 'troll',
  'oggok citizen': 'ogre',
  'kaladim citizen': 'dwarf',
  'iksar citizen': 'iksar',
  'cabilis citizen': 'iksar',
  'akanon citizen': 'gnome',
  'felwithe citizen': 'high elf',
  'kelethin citizen': 'wood elf',
  hman: 'human',
  // 44 Freeport, 106 Felwithe and 112 Kelethin guards: the client calls them Guard, not their cities' race.
  'freeport guards': 'guard',
  'freeport guard': 'guard',
  felguard: 'guard',
  fayguard: 'guard',
  // 26, 27, 330 Froglok.
  'old froglok': 'froglok',
  'old froglok ghoul': 'froglok',
  'froglok ghoul': 'froglok',
  'kunark froglok': 'froglok',
  froglock: 'froglok',
  guktan: 'froglok',
  'old froglok tadpole': 'tadpole',
  // 60, 367 Skeleton.
  'skeleton classic': 'skeleton',
  'skeleton new': 'skeleton',
  // 146 Sarnak Spirit, 147 Iksar Spirit; 117, 118 Ghost; 98 Vampire.
  'spectral sarnak': 'sarnak spirit',
  'spectral iksar': 'iksar spirit',
  'erudite ghost': 'ghost',
  'ghost dwarf': 'ghost',
  'elf vampire': 'vampire',
  // One race each, by another name.
  'lava dragon': 'dragon',
  'ice dragon': 'dragon',
  'velious dragon': 'dragon',
  'velious dragons': 'dragon',
  'dragon skeleton': 'dracolich',
  lycanthrope: 'drolvarg',
  'flying monkey': 'holgresh',
  denizen: 'amygdalan',
  doppleganger: 'venril sathir',
  'walrus man': 'walrus',
  dracnid: 'drachnid',
  tentacle: 'tentacle terror',
  'sea horse': 'seahorse',
  'yak man': 'yakkar',
  'fay drake': 'fae drake',
  'human beggar': 'beggar',
  begger: 'beggar',
  'sabertooth cat': 'saber toothed cat',
  sabertooth: 'saber toothed cat',
  'cold spectre': 'ice spectre',
  'kunark fish': 'fish',
  ottermen: 'othmir',
  otterman: 'othmir',
  'rock gem men': 'geonid',
  'rock gem man': 'geonid',
  'iksar scorpion': 'scorpion',
  'wolf elemental': 'wolf',
  'polar bear': 'bear',
  'snow bunny': 'snow rabbit',
  harpie: 'harpy',
  burnyai: 'burynai',
  abhorent: 'abhorrent',
  'were wolf': 'werewolf',
  basalisk: 'basilisk',
  'fire beetle': 'beetle',
  'fire imp': 'imp',
  rhino: 'rhinoceros',
  // The client's own names that are one race to the achievements.
  lizardman: 'lizard man',
  'cliknar queen': 'cliknar',
  'cliknar soldier': 'cliknar',
  'cliknar worker': 'cliknar',
  'greken young': 'greken',
  'greken young adult': 'greken',
  // The achievements' names.
  'corathus beast': 'corathus',
  cube: 'gelatinous cube',
  'elddar elf': 'elddar',
  griffon: 'griffin',
  griffenne: 'griffin',
  statue: 'animated statue',
  tick: 'blood tick',
  wisp: 'will o wisp',
  // Bees, wasps and hornets are the achievements' Insects (unconfirmed: the client calls 109 Wasp).
  wasp: 'insect',
  hornet: 'insect',
  bee: 'insect',
  'giant bee': 'insect'
}

/**
 * Aliases a reading has not settled: a kill placed by one is open to the next export to say
 * otherwise (slayer.ts, learn), as a placement by name is.
 */
const UNSURE: ReadonlySet<string> = new Set([
  'cyclops',
  'giant/cyclops',
  'freeport guards',
  'freeport guard',
  'felguard',
  'fayguard',
  'dragon skeleton',
  'lycanthrope',
  'wasp',
  'hornet',
  'bee',
  'giant bee',
  'polar bear',
  'kerra'
])

/** Wiki races that say nothing of which race: the mob is placed by its name. */
const NO_RACE = new Set([
  'animal',
  'undead',
  'various',
  'varies',
  'humanoid',
  'monster',
  'npc',
  'pet',
  'summoned',
  'invisible',
  'shadow',
  'lizard',
  'hand',
  'csr',
  'n/a',
  'need info',
  'piece of crap',
  'unknown race'
])

/** A race name's key: the client's name for the race where another name is known for it. */
export function raceKey(name: string): string {
  const n = normalRace(name)
  return ALIASES[n] ?? n
}

/** Whether a race name is brought to its key by an alias not yet settled in play. */
export function unsureRace(name: string): boolean {
  return UNSURE.has(normalRace(name))
}

/**
 * The key of the race an eqlwiki page gives; null when it gives none that is one race ("Animal",
 * "?", "Human, Barbarian, Half-Elf", "High Elf OR Dark Elf").
 */
export function wikiRaceKey(race: string): string | null {
  const n = normalRace(race)
  if (!n || /^[?\s]*$/.test(n) || NO_RACE.has(n)) return null
  if (ALIASES[n]) return ALIASES[n]
  if (/,|\/|\bor\b/.test(n)) return null
  return n
}

/** The races "The playable races." stands for. */
export const PLAYABLE = [
  'barbarian',
  'dark elf',
  'drakkin',
  'dwarf',
  'erudite',
  'froglok',
  'gnome',
  'half elf',
  'halfling',
  'high elf',
  'human',
  'iksar',
  'kerran',
  'ogre',
  'troll',
  'wood elf'
]
/** One of the playable races, which one not known: only "The playable races." counts it. */
export const PLAYABLE_MARK = '(playable)'

/**
 * What play settled about mobs whose names, or eqlwiki, mislead (names without the article). The
 * Dervish Cutthroats of Ro and the Commonlands are humanoid bandits of the playable races, not
 * Dervishes, and a Dervish Thug is an Ogre (2026-09-28).
 */
export const MOB_RACES: Record<string, string> = {
  'dervish cutthroat': PLAYABLE_MARK,
  'cutthroat dervish': PLAYABLE_MARK,
  'dervish thug': 'ogre'
}

/** Words in names for a race in other words: the elves' own names and the adjectives. */
export const NAME_WORDS: Record<string, string> = {
  teirdal: 'dark elf',
  koadadal: 'high elf',
  feirdal: 'wood elf',
  ayrdal: 'half elf',
  dwarven: 'dwarf',
  gnomish: 'gnome',
  orcish: 'orc',
  skeletal: 'skeleton',
  ratmen: 'ratman',
  lizardmen: 'lizard man',
  tigress: 'tiger',
  yellowjacket: 'insect',
  frogloks: 'froglok'
}

/**
 * Races the client names that are a calling in a mob's name, not what it is: "a dark elf guard" is a
 * dark elf. (Their own race still comes from eqlwiki.)
 */
export const NAME_CALLINGS: ReadonlySet<string> = new Set(['guard', 'royal guard', 'beggar', 'pirate', 'cultist', 'jokester', 'teleport man', 'invisible man'])

/** The singulars a plural could be, likeliest first: "Wolves" → wolf, "Brownies" → brownie, "Horses" → horse. */
export function singulars(word: string): string[] {
  const w = word.toLowerCase()
  const out: string[] = []
  if (w.endsWith('men')) out.push(`${w.slice(0, -3)}man`)
  else if (w.endsWith('ves')) out.push(`${w.slice(0, -3)}f`, `${w.slice(0, -3)}fe`)
  else if (w.endsWith('ies')) out.push(w.slice(0, -1), `${w.slice(0, -3)}y`)
  else if (/(?:sses|xes|ches|shes|zes|oes)$/.test(w)) out.push(w.slice(0, -2), w.slice(0, -1))
  else if (w.endsWith('es')) out.push(w.slice(0, -1), w.slice(0, -2))
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) out.push(w.slice(0, -1))
  out.push(w)
  return out
}
