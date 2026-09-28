import type { AchSection } from '../shared/character'
import { DIED, SLAIN_BY, SLAIN_BY_YOU } from './phrases'

// Slayer achievements count kills of kinds of creature: "Kobolds", "Orcs and Wereorcs.", "Beetles,
// Cliknars, Corathus Beasts, … Ursarachnids." The achievements export gives each open one's count as
// it was when written; the log names every kill but never its kind. So each kill since is put to a
// kind by the mob's name ("a kobold runt", "an orc centurion", "a fire giant warrior"), or by the
// race eqlwiki's page for it gives ("Cleric of Innoruuk": Dark Elf), and counted on. What neither
// places is listed as such. The counts are the export's plus these, until the next export.

/** An open Slayer achievement, with its count when the achievements export was written. */
export interface SlayerCounter {
  section: string
  name: string
  /** What it counts, as the achievement says. */
  races: string
  count: number
  max: number
}

/** The open Slayer achievements the achievements export lists. */
export function slayerCounters(sections: AchSection[]): SlayerCounter[] {
  const out: SlayerCounter[] = []
  for (const sec of sections) {
    if (sec.cat !== 'Slayer') continue
    for (const a of sec.ach) {
      if (a.d) continue
      const c = a.c.find((o) => o.p && !o.o && !o.d)
      if (!c?.p || c.p[1] <= 0) continue
      out.push({ section: `${sec.cat}: ${sec.name}`, name: a.n, races: c.t, count: c.p[0], max: c.p[1] })
    }
  }
  return out
}

/** The races "The playable races." stands for. */
const PLAYABLE = [
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
  'ogre',
  'troll',
  'vah shir',
  'wood elf'
]

/** Words that name a race in other words: the elves' own names, and an adjective or two. */
const WORD_ALIASES: Record<string, string> = {
  "teir'dal": 'dark elf',
  "koada'dal": 'high elf',
  "feir'dal": 'wood elf',
  "ayr'dal": 'half elf',
  dwarven: 'dwarf',
  gnomish: 'gnome',
  orcish: 'orc',
  skeletal: 'skeleton',
  ratman: 'ratman',
  ratmen: 'ratman',
  lizardman: 'lizard man',
  lizardmen: 'lizard man',
  tentacle: 'tentacle terror',
  tigress: 'tiger',
  wasp: 'insect',
  hornet: 'insect',
  bee: 'insect',
  froglok: 'froglok',
  frogloks: 'froglok'
}

/** Races eqlwiki writes otherwise than the achievements do. */
const RACE_ALIASES: Record<string, string> = {
  'dragon skeleton': 'dracoliche',
  'lava dragon': 'dragon',
  'ice dragon': 'dragon',
  'kaladim citizen': 'dwarf',
  'rivervale citizen': 'halfling',
  'halas citizen': 'barbarian',
  'freeport citizen': 'human',
  'qeynos citizen': 'human',
  'erudin citizen': 'erudite',
  'paineel citizen': 'erudite',
  'neriak citizen': 'dark elf',
  'oggok citizen': 'ogre',
  'grobb citizen': 'troll',
  "ak'anon citizen": 'gnome',
  'felwithe citizen': 'high elf',
  'kelethin citizen': 'wood elf',
  'cabilis citizen': 'iksar'
}

/** Kinds that names run together with a word before them: rattlesnake, firebeetle, timberwolf. */
const COMPOUNDED = new Set(['snake', 'spider', 'beetle', 'fish', 'wolf', 'crab', 'shark', 'scorpion', 'wasp'])

/** Adjectives a race list puts before a kind that a name or a race gives bare: "True Dragons", "Evil Eyes". */
const LOOSE = new Set(['true', 'evil', 'gelatinous'])

/** The singular a plural could be: "Wolves" → wolf, "Brownies" → brownie or browny, "Horses" → horse or hors. */
function singulars(word: string): string[] {
  const w = word.toLowerCase()
  const out = [w]
  if (w.endsWith('men')) out.push(`${w.slice(0, -3)}man`)
  else if (w.endsWith('ves')) out.push(`${w.slice(0, -3)}f`, `${w.slice(0, -3)}fe`)
  else if (w.endsWith('ies')) out.push(`${w.slice(0, -3)}y`, w.slice(0, -1))
  else if (w.endsWith('es')) out.push(w.slice(0, -2), w.slice(0, -1))
  else if (w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1))
  return out
}

/** The words each race an achievement lists could appear as in a name or a race, singular or plural. */
export function raceWords(text: string): string[] {
  const t = text.trim().replace(/\.$/, '').toLowerCase()
  if (/^the playable races$/.test(t)) return [...PLAYABLE]
  if (t.startsWith('clockwork:')) return ['clockwork']
  const out = new Set<string>()
  for (const raw of t.split(/,\s*(?:and\s+)?|\s+and\s+/)) {
    const item = raw.replace(/\s+of\s+.*$/, '').trim()
    if (!item) continue
    const words = item.split(/\s+/)
    const head = words.slice(0, -1).join(' ')
    for (const s of singulars(words[words.length - 1])) {
      out.add(head ? `${head} ${s}` : s)
      if (head && LOOSE.has(words[0]) && words.length === 2) out.add(s)
    }
  }
  return [...out]
}

/** Which Slayer counters each race word belongs to, and the matching of names and races against them. */
export class RaceIndex {
  private readonly words = new Map<string, number[]>()
  private readonly longest: number

  constructor(counters: Pick<SlayerCounter, 'races'>[]) {
    counters.forEach((c, i) => {
      for (const w of raceWords(c.races)) {
        const list = this.words.get(w) ?? []
        if (!list.includes(i)) list.push(i)
        this.words.set(w, list)
      }
    })
    this.longest = Math.max(1, ...[...this.words.keys()].map((w) => w.split(' ').length))
  }

  /** The counters whose races the words name, longest phrases first; `name` holds to a mob's name's rules. */
  private scan(tokens: string[], name: boolean): number[] {
    const found = new Set<number>()
    for (let i = 0; i < tokens.length;) {
      let took = 0
      for (let len = Math.min(this.longest, tokens.length - i); len >= 1 && !took; len--) {
        const phrase = tokens.slice(i, i + len).join(' ')
        const hit = this.words.get(WORD_ALIASES[phrase] ?? phrase)
        if (!hit) continue
        // "a giant spider" is a spider; "a hill giant" and "a fire giant warrior" are giants.
        if (name && phrase === 'giant' && i === 0 && tokens.length > 1) continue
        hit.forEach((c) => found.add(c))
        took = len
      }
      if (!took && name) {
        // A word made of a race and a little more: rattlesnake, firebeetle, spiderling, lioness.
        const t = tokens[i]
        for (const [w, list] of this.words) {
          if (w.includes(' ') || w.length < 3) continue
          const suffix = COMPOUNDED.has(w) && t.length >= w.length + 3 && t.endsWith(w)
          const stem = t.startsWith(w) && /^(?:ling|lings|ess|let|lets)$/.test(t.slice(w.length))
          if (suffix || stem) list.forEach((c) => found.add(c))
        }
      }
      i += took || 1
    }
    return [...found]
  }

  /** The counters a mob's name places it in: "a kobold runt", "an orc centurion". */
  byName(mob: string): number[] {
    const t = mob
      .toLowerCase()
      .replace(/^\*+/, '')
      .replace(/`/g, "'")
      .replace(/^(?:an?|the)\s+/, '')
      .replace(/\s+pet$/, '')
    const tokens: string[] = t.match(/[a-z']+/g) ?? []
    // A clockwork is a clockwork, whatever it is made to look like: "a clockwork spider".
    const clockwork = tokens.includes('clockwork') ? this.words.get('clockwork') : undefined
    return clockwork ? [...clockwork] : this.scan(tokens, true)
  }

  /** The counters a race from eqlwiki places a mob in: "Dark Elf", "Dragon Skeleton". */
  byRace(race: string): number[] {
    const r = race.toLowerCase().replace(/`/g, "'").trim()
    const t = RACE_ALIASES[r] ?? r
    return this.scan(t.match(/[a-z']+/g) ?? [], false)
  }
}

/** "Vonartik told you, 'Attacking a minotaur slaver Master.'": the pet's name, and what it goes for. */
const PET_TELL = /^(\S+) told you, 'Attacking (.+) Master\.'$/
/** "You have completed achievement: Bear With Me". */
const COMPLETED = /^You have completed achievement: (.+?)\.?$/
/** "You punch a lion for 75 points of damage.", "You hit a bixie for 45 points of poison damage by Envenomed Bolt.". */
const YOU_HIT = /^You \w+ (.+?) for \d+ points? of /
/** "A samhain has taken 100 damage by Rotting Flesh.": the player's damage over time. */
const TAKEN_BY = /^(.+?) has taken \d+ damage by /

/** What one log line means to the Slayer counts. */
export type SlayerLine = { kill: { mob: string; by: string } } | { pet: string; engaged: string } | { engaged: string } | { died: string } | { completed: string } | null

/**
 * A kill (by "You", or who dealt it), a pet saying who it is and what it goes for, a mob the player
 * is hurting, one that died with no killer named (a damage-over-time kill), or an achievement
 * completed; null for any other line.
 */
export function slayerLine(text: string): SlayerLine {
  let m = SLAIN_BY_YOU.exec(text)
  if (m) return { kill: { mob: m[1], by: 'You' } }
  m = SLAIN_BY.exec(text)
  // "Kelwyn has been slain by a gnoll!": a mob killed one of the player's side.
  if (m) return /^(?:an?|the)\s/i.test(m[2]) ? null : { kill: { mob: m[1], by: m[2] } }
  m = DIED.exec(text)
  if (m) return { died: m[1] }
  m = PET_TELL.exec(text)
  if (m) return { pet: m[1], engaged: m[2] }
  m = YOU_HIT.exec(text) ?? TAKEN_BY.exec(text)
  if (m) return { engaged: m[1] }
  m = COMPLETED.exec(text)
  if (m) return { completed: m[1] }
  return null
}

/** Kills since the export, by mob (lower-cased): its name as the log gave it and when each was. */
export type SlayerKills = Map<string, { name: string; times: number[] }>

/**
 * The counts: each open achievement's export count and the kills since that its races take in. A
 * mob the name does not place is placed by `raceOf` (eqlwiki's word, null for none known, undefined
 * while not yet looked up); what neither places is left over.
 */
export function slayerCounts(
  counters: SlayerCounter[],
  index: RaceIndex,
  kills: SlayerKills,
  raceOf: (mob: string) => string | null | undefined,
  completed: Set<string>
): { rows: { counter: SlayerCounter; since: number; last: number; done: boolean }[]; unplaced: { name: string; n: number }[]; unknown: string[] } {
  const since = counters.map(() => 0)
  const last = counters.map(() => 0)
  const unplaced: { name: string; n: number }[] = []
  const unknown: string[] = []
  for (const k of kills.values()) {
    let at = index.byName(k.name)
    if (!at.length) {
      const race = raceOf(k.name)
      if (race === undefined) {
        // Still being looked up.
        unknown.push(k.name)
        continue
      }
      // A race the wiki gives that no open achievement counts is counted nowhere, and rightly.
      if (race) at = index.byRace(race)
      else unplaced.push({ name: k.name, n: k.times.length })
      if (!at.length) continue
    }
    const newest = Math.max(...k.times)
    for (const c of at) {
      since[c] += k.times.length
      last[c] = Math.max(last[c], newest)
    }
  }
  return {
    rows: counters.map((counter, i) => ({ counter, since: since[i], last: last[i], done: completed.has(counter.name.toLowerCase()) })),
    unplaced: unplaced.sort((a, b) => b.n - a.n),
    unknown
  }
}

/** The race a {{Namedmobpage}} gives, links and markup taken off; null when it gives none. */
export function wikiRace(wikitext: string): string | null {
  const m = /\|\s*race\s*=\s*((?:\[\[[^\]]*\]\]|[^\n|}])*)/i.exec(wikitext)
  if (!m) return null
  const race = m[1]
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .trim()
  return race || null
}
