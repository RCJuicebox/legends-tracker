import type { AchSection } from '../shared/character'
import { COMPLETED_ACHIEVEMENT, DIED, PET_ATTACKING, SLAIN_BY, SLAIN_BY_YOU } from './phrases'
import {
  ACHIEVEMENT_RACES,
  MOB_RACES,
  NAME_CALLINGS,
  NAME_WORDS,
  normalRace,
  PLAYABLE,
  PLAYABLE_MARK,
  RACE_MIX,
  raceKey,
  singulars,
  unsureRace,
  wikiRaceKey,
  ZONE_MOB_RACES,
  zoneWords,
  type RaceTable
} from './raceNames'

// Slayer achievements count kills of races of creature: "Kobolds", "Orcs and Wereorcs.", "Beetles,
// Cliknars, Corathus Beasts, … Ursarachnids." The achievements export gives each open one's count as
// it was when written; the log names every kill but never its race. So each mob killed since is given
// one race, and counts toward the achievements that list that race: the race eqlwiki's page for it
// gives ("Cleric of Innoruuk": Neriak Citizen, the client's Dark Elf), or failing that the race its
// name ends on ("a fire giant warrior": Giant; "a giant bat": Bat). Names, the wiki's races and the
// achievements' lists are all brought to the client's own race names first (raceNames.ts), so a race
// is the same race or not, never a word found in another. Each new export then says what really
// counted: the kills between two exports are set against the counts' rise, and what the numbers force
// (ten giant bats and Giants not moved: bats are not Giants) is kept and outranks any placing.

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

/** Kinds a "Clockwork:" list names that are clockwork by their own name. */
const CLOCKWORK_OWN = new Set(['gnomework', 'tin soldier'])

/**
 * The races an achievement lists, as keys, and those of them the client has no race by that name for
 * (kept as they are: a wiki race written the same way still matches). "Clockwork: Beetles, …" lists
 * clockwork kinds, and any clockwork besides.
 */
export function achievementRaces(text: string, game: RaceTable): { keys: Set<string>; unnamed: string[]; broader: Set<string> } {
  const t = text.trim().replace(/\.$/, '')
  if (/^the playable races$/i.test(t)) return { keys: new Set([...PLAYABLE, PLAYABLE_MARK]), unnamed: [], broader: new Set() }
  const cw = /^clockwork:\s*(.*)$/i.exec(t)
  const prefix = cw ? 'clockwork ' : ''
  const keys = new Set<string>(cw ? ['clockwork'] : [])
  const unnamed: string[] = []
  const broader = new Set<string>()
  for (const raw of (cw ? cw[1] : t).split(/,\s*(?:and\s+)?|\s+and\s+/)) {
    const item = normalRace(raw.replace(/\s+of\s+.*$/i, ''))
    if (!item) continue
    const named = ACHIEVEMENT_RACES[item]
    if (named) {
      for (const r of named) keys.add(r)
      continue
    }
    const words = item.split(' ')
    const head = words.slice(0, -1).join(' ')
    const forms = singulars(words[words.length - 1]).map((s) => (head ? `${head} ${s}` : s))
    // A clockwork kind is the client's "Clockwork X" (Rats are clockwork rats, never rats), but for
    // those already named for what they are made of.
    const own = !prefix || forms.some((f) => CLOCKWORK_OWN.has(f))
    const at = own ? '' : prefix
    // The client's own plural first ("Lizard Men"), then the singulars the word could be ("Shissar", "Pegasus").
    const hit = game.plurals.get(at + item) ?? forms.map((f) => raceKey(at + f)).find((k) => game.races.has(k))
    if (hit) keys.add(hit)
    else {
      const k = raceKey(at + forms[0])
      keys.add(k)
      unnamed.push(k)
      // "True Dragons", "Kylong Iksars": some of a race the client names as one ("Dragon", "Iksar").
      const wide = raceKey(forms[0].split(' ').at(-1) ?? '')
      if (!prefix && head && game.races.has(wide)) broader.add(wide)
    }
  }
  return { keys, unnamed, broader }
}

/** How a mob was given its race: what play settled (for the zone it was in, or anywhere), eqlwiki's page, or its name. */
export interface Placed {
  key: string | null
  by: 'zone' | 'play' | 'wiki' | 'name' | null
  /** Placed by play, or by a wiki race that is the client's name or a settled alias; a name is a guess. */
  sure: boolean
}

/** Kinds that names run together with a word before them: rattlesnake, firebeetle, timberwolf. */
const COMPOUNDED = new Set(['snake', 'spider', 'beetle', 'fish', 'wolf', 'crab', 'shark', 'scorpion', 'wasp'])

/** "*A Kobold Runt" → "kobold runt": a name as its words, the log's marks and the article off. */
function nameWords(mob: string): string {
  return normalRace(mob.replace(/^\*+/, ''))
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:an?|the)\s+/, '')
    .replace(/\s+pet$/, '')
}

/** The open Slayer achievements' races, and the placing of a mob in one race. */
export class SlayerRaces {
  /** Per counter, the race keys it counts. */
  readonly keys: Set<string>[]
  /** Per counter, the races it lists that the client does not name. */
  readonly unnamed: string[][]
  /**
   * Per counter, the client's races some of which it lists ("Dragon", for "True Dragons"): a mob of
   * one does not count on its race alone, but an export can say it does.
   */
  readonly broader: Set<string>[]
  /** Every race a name can end on: the client's and the achievements'. */
  private readonly vocab: Set<string>
  private readonly longest: number

  constructor(
    counters: Pick<SlayerCounter, 'races'>[],
    private readonly game: RaceTable
  ) {
    const each = counters.map((c) => achievementRaces(c.races, game))
    this.keys = each.map((e) => e.keys)
    this.unnamed = each.map((e) => e.unnamed)
    this.broader = each.map((e) => e.broader)
    this.vocab = new Set([...game.races, ...PLAYABLE, ...each.flatMap((e) => [...e.keys])])
    this.vocab.delete(PLAYABLE_MARK)
    this.longest = Math.max(1, ...[...this.vocab, ...NAME_CALLINGS].map((w) => w.split(' ').length))
  }

  /**
   * The race a mob's name says: the last race its words name, for the race comes last ("a giant
   * spider", "a fire giant warrior", "a skeletal wolf"); null when none does.
   */
  byName(mob: string): string | null {
    const tokens = nameWords(mob).split(' ').filter(Boolean)
    let last: string | null = null
    for (let i = 0; i < tokens.length;) {
      let took = 0
      for (let len = Math.min(this.longest, tokens.length - i); len >= 1 && !took; len--) {
        const phrase = tokens.slice(i, i + len).join(' ')
        // "a dark elf guard" is a dark elf: a calling is not the race.
        if (NAME_CALLINGS.has(phrase)) took = len
        else {
          const plural = this.game.plurals.get(phrase)
          const k = [NAME_WORDS[phrase] ?? phrase, ...(plural ? [plural] : []), ...(len === 1 ? singulars(phrase).slice(0, -1) : [])].map(raceKey).find((w) => this.vocab.has(w))
          if (k) {
            last = k
            took = len
          }
        }
      }
      if (!took) {
        // A word made of a race and a little more: rattlesnake, firebeetle, spiderling, lioness.
        const t = tokens[i]
        for (const w of this.vocab) {
          if (w.includes(' ') || w.length < 3) continue
          const suffix = COMPOUNDED.has(w) && t.length >= w.length + 3 && t.endsWith(w)
          const stem = t.startsWith(w) && /^(?:ling|lings|ess|let|lets)$/.test(t.slice(w.length))
          if (suffix || stem) {
            last = raceKey(w)
            break
          }
        }
      }
      i += took || 1
    }
    // A clockwork is a clockwork, whatever it is made to look like.
    if (tokens.includes('clockwork') && !last?.startsWith('clockwork ')) return 'clockwork'
    return last
  }

  /** A race as the spawn tables or eqlwiki name it ("Human", "Half Elf"), placed on its own: no mob's name in it. */
  raceOf(race: string): string | null {
    const w = wikiRaceKey(race)
    if (!w) return null
    return this.vocab.has(w) ? w : (this.byName(race) ?? w)
  }

  /**
   * Whether a placement is open to what an export says for counter `i`: a guess, none, a race the
   * achievement lists some of, or a compound race whose last word it lists ("Earth Elemental" under
   * Elementals, "Dire Wolf" under Wolves: a client race of its own, never counted on the plural, so
   * only an export can say, LT-531; suspected until one does).
   */
  open(i: number, p: Placed): boolean {
    if (!p.sure || p.key === null || this.broader[i].has(p.key)) return true
    const words = p.key.split(' ')
    return words.length > 1 && !this.keys[i].has(p.key) && this.keys[i].has(words[words.length - 1])
  }

  /** Whether play settled that a mob is several races under one name (a dervish cutthroat): its kills are placed by its zone's race mix. */
  mixed(mob: string): boolean {
    return MOB_RACES[nameWords(mob)] === RACE_MIX
  }

  /** Whether play settled a mob's race for some zone: its kills are placed zone by zone. */
  zoned(mob: string): boolean {
    const words = nameWords(mob)
    return Object.values(ZONE_MOB_RACES).some((z) => words in z)
  }

  /**
   * A mob's race: what play settled for the zone it was killed in, else what play settled anywhere,
   * else eqlwiki's (undefined while not looked up), else its name's.
   */
  place(mob: string, wikiRace: string | null | undefined, zone = ''): Placed {
    const here = zone ? ZONE_MOB_RACES[zoneWords(zone)]?.[nameWords(mob)] : undefined
    if (here) return { key: here, by: 'zone', sure: true }
    const play = MOB_RACES[nameWords(mob)]
    // Several races under the name, as play settled: placed by its zone's race mix, not here.
    if (play === RACE_MIX) return { key: null, by: 'play', sure: false }
    if (play) return { key: play, by: 'play', sure: true }
    const wiki = wikiRace ? wikiRaceKey(wikiRace) : null
    if (wikiRace && wiki) {
      if (this.vocab.has(wiki)) return { key: wiki, by: 'wiki', sure: !unsureRace(wikiRace) }
      // A race no list names ("Dark Elf Guard", "Undead Gnoll"): read as a name is, and a guess.
      return { key: this.byName(wikiRace) ?? wiki, by: 'wiki', sure: false }
    }
    const k = this.byName(mob)
    return k ? { key: k, by: 'name', sure: false } : { key: null, by: null, sure: false }
  }
}

/** What the exports settled: whether a mob (lower-cased) counts toward an achievement (lower-cased), undefined where nothing has. */
export type SlayerFacts = (mob: string, achievement: string) => boolean | undefined

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
  // A pet of one word: a charmed mob's name ("a gnoll") is every other gnoll's too.
  m = PET_ATTACKING.exec(text)
  if (m && !m[1].includes(' ')) return { pet: m[1], engaged: m[2] }
  m = YOU_HIT.exec(text) ?? TAKEN_BY.exec(text)
  if (m) return { engaged: m[1] }
  m = COMPLETED_ACHIEVEMENT.exec(text)
  if (m) return { completed: m[1] }
  return null
}

/** A mob's kills split by the zone each was in ('' where not known), each part in log order. */
function byZone(times: readonly number[], zones: readonly string[]): { zone: string; times: number[]; zones: string[] }[] {
  const out = new Map<string, { zone: string; times: number[]; zones: string[] }>()
  times.forEach((t, i) => {
    const zone = zones[i] ?? ''
    const part = out.get(zone) ?? { zone, times: [], zones: [] }
    part.times.push(t)
    part.zones.push(zone)
    out.set(zone, part)
  })
  return [...out.values()]
}

/** Kills since the export, by mob (lower-cased): its name as the log gave it, when each was, and the zone each was in ('' not known; missing from older counts). */
export type SlayerKills = Map<string, { name: string; times: number[]; zones?: string[] }>

/** The races a mob's name is in a zone's spawn tables, each by its share of the spawns; null where they lack it (spawns.ts raceMixer). */
export type RaceMix = (mob: string, zone: string) => { race: string; share: number }[] | null

/**
 * For a mob nothing else places (no race on eqlwiki or in its name): how many of its kills counted
 * toward each achievement, by the race mix of the zone each was in. Classic's "a bandit" is Human,
 * Half Elf or Barbarian under the one name, so a kill counts toward What Keeps Mankind Alive? only as
 * far as the zone's bandits are Human or Barbarian. Legends may have changed them (its West Karana
 * bandits all counted, 2026-10-13): a guess, until an export settles the mob whole, as for any other.
 * Null when the tables do not know the name.
 */
export function mixCredits(name: string, zones: readonly string[], races: SlayerRaces, mixOf: RaceMix): number[] | null {
  const byZone = new Map<string, number>()
  for (const z of zones) byZone.set(z, (byZone.get(z) ?? 0) + 1)
  const out = races.keys.map(() => 0)
  let known = false
  for (const [zone, n] of byZone) {
    const mix = mixOf(name, zone)
    if (!mix) continue
    known = true
    for (const { race, share } of mix) {
      const key = races.raceOf(race)
      if (key !== null) races.keys.forEach((keys, i) => keys.has(key) && (out[i] += n * share))
    }
  }
  return known ? out : null
}

/**
 * The counts: each open achievement's export count and the kills since that count toward it. A mob
 * is placed by `raceOf` (eqlwiki's race, null for none known, undefined while not yet looked up: its
 * name places it meanwhile); what nothing places is left over. `guessed` is how many of a row's kills
 * only a name, or an alias not yet settled, put there.
 */
export function slayerCounts(
  counters: SlayerCounter[],
  races: SlayerRaces,
  kills: SlayerKills,
  raceOf: (mob: string) => string | null | undefined,
  facts: SlayerFacts,
  completed: Set<string>,
  mixOf?: RaceMix
): { rows: { counter: SlayerCounter; since: number; guessed: number; last: number; done: boolean }[]; unplaced: { name: string; n: number }[]; unknown: string[] } {
  const since = counters.map(() => 0)
  const guessed = counters.map(() => 0)
  const last = counters.map(() => 0)
  const unplaced: { name: string; n: number }[] = []
  const unknown: string[] = []
  for (const k of kills.values()) {
    const wiki = raceOf(k.name)
    if (wiki === undefined) unknown.push(k.name)
    const mob = k.name.toLowerCase()
    // A mob play placed for some zone: its kills there by that, the rest as anywhere.
    const parts = races.zoned(k.name) && k.zones ? byZone(k.times, k.zones) : [{ zone: '', times: k.times, zones: k.zones ?? k.times.map(() => '') }]
    let any = false
    let placedAny = false
    for (const part of parts) {
      const p = races.place(k.name, wiki, part.zone)
      if (p.key !== null) placedAny = true
      // Kills are kept in log order: the newest is the last (no spread of a long grind's list, LT-380).
      const newest = part.times.at(-1) ?? 0
      // Nothing places it: the spawn tables' race mix where it was killed, a share of each kill (a guess).
      const mix = p.key === null && mixOf ? mixCredits(k.name, part.zones, races, mixOf) : null
      if (mix) placedAny = true
      counters.forEach((c, i) => {
        // What play settled for the zone stands over what the exports settled of the name, which may be another zone's.
        const fact = p.by === 'zone' ? undefined : facts(mob, c.name.toLowerCase())
        const n = fact !== undefined ? (fact ? part.times.length : 0) : p.key !== null ? (races.keys[i].has(p.key) ? part.times.length : 0) : (mix?.[i] ?? 0)
        if (n <= 0) return
        any = true
        since[i] += n
        if (fact === undefined && !p.sure) guessed[i] += n
        last[i] = Math.max(last[i], newest)
      })
    }
    if (!any && !placedAny && wiki !== undefined) unplaced.push({ name: k.name, n: k.times.length })
  }
  return {
    // A share of a kill is a guess: the counts stay whole kills.
    rows: counters.map((counter, i) => ({ counter, since: Math.round(since[i]), guessed: Math.round(guessed[i]), last: last[i], done: completed.has(counter.name.toLowerCase()) })),
    unplaced: unplaced.sort((a, b) => b.n - a.n),
    unknown
  }
}

/** Something an export settled: a mob's kills do, or do not, count toward an achievement. */
export interface SlayerFact {
  mob: string
  achievement: string
  counts: boolean
  /** The mob's kills between the two exports, and how far the achievement's count rose. */
  kills: number
  rise: number
}

/**
 * How far an export's count may stand from the log's kills and still be the same kills: the log
 * misses a few (a kill the line for came after the export was read, a damage-over-time death with
 * no line; up to 4 in 55 over a day, 2026-09-28) and may credit a group kill the game did not.
 */
const slack = (rise: number) => Math.max(2, Math.ceil(rise * 0.15))

/** The most work one achievement's check may take: mobs × mobs × count. */
const MAX_WORK = 30_000_000

/**
 * Of the mobs that may have counted, those the rise forces in (no way to reach it without them) or
 * out (no way to reach it with them), each kill counting once.
 */
export function forced(mobs: { mob: string; n: number }[], rise: number): { mob: string; counts: boolean }[] {
  const tol = slack(rise)
  const lo = Math.max(0, rise - tol)
  const hi = rise + tol
  if (!mobs.length || mobs.length * mobs.length * (hi + 1) > MAX_WORK) return []
  /** Which totals up to `hi` some of the mobs (all but `skip`) make. */
  const reach = (skip: number) => {
    const r = new Uint8Array(hi + 1)
    r[0] = 1
    mobs.forEach((m, j) => {
      if (j === skip) return
      for (let s = hi; s >= m.n; s--) if (r[s - m.n]) r[s] = 1
    })
    return r
  }
  const hits = (r: Uint8Array, add: number) => {
    for (let s = Math.max(0, lo - add); s + add <= hi; s++) if (r[s]) return true
    return false
  }
  // The kills cannot make the rise at all (kills the log did not show): nothing to learn.
  if (!hits(reach(-1), 0)) return []
  const out: { mob: string; counts: boolean }[] = []
  mobs.forEach((m, j) => {
    const r = reach(j)
    if (!hits(r, 0)) out.push({ mob: m.mob, counts: true })
    else if (!hits(r, m.n)) out.push({ mob: m.mob, counts: false })
  })
  return out
}

/**
 * What a new export settles. `before` is each achievement's count (by lower-cased name) at the
 * earlier export, `after` the new export's open achievements (and `races` built from them), `kills`
 * each mob's kills between the two. Each achievement still open in both is checked on its own; a mob
 * may have counted unless settled otherwise or surely placed in a race the achievement does not list.
 */
export function learnFromExport(
  before: ReadonlyMap<string, number>,
  after: SlayerCounter[],
  races: SlayerRaces,
  kills: { name: string; n: number }[],
  raceOf: (mob: string) => string | null | undefined,
  facts: SlayerFacts,
  mixOf?: RaceMix
): SlayerFact[] {
  const placed = kills.filter((k) => k.n > 0).map((k) => ({ ...k, mob: k.name.toLowerCase(), p: races.place(k.name, raceOf(k.name)) }))
  const out: SlayerFact[] = []
  const n = new Map(placed.map((k) => [k.mob, k.n]))
  const zoned = new Set(placed.filter((k) => races.zoned(k.name)).map((k) => k.mob))
  // A mob nothing places whose name is several races in the spawn tables: the share of it each achievement's races are.
  const shares = new Map<string, number[]>()
  if (mixOf)
    for (const k of placed)
      if (k.p.key === null) {
        const m = mixCredits(k.name, [''], races, mixOf)
        if (m) shares.set(k.mob, m)
      }
  after.forEach((c, i) => {
    const name = c.name.toLowerCase()
    const was = before.get(name)
    if (was === undefined || c.count < was) return
    const rise = c.count - was
    // A mob play placed zone by zone is not settled by name: what holds in one zone may not in another.
    // Nor is a mob of several races ruled out of an achievement some of its races feed: all of them
    // counting may be more than the rise, a share of them not (422 dervish cutthroats, 48 of them orcs).
    const add = (f: { mob: string; counts: boolean }) =>
      !zoned.has(f.mob) && (f.counts || !((shares.get(f.mob)?.[i] ?? 0) > 0)) && out.push({ mob: f.mob, achievement: name, counts: f.counts, kills: n.get(f.mob) ?? 0, rise })
    // First on the numbers alone: any mob not settled out may have counted.
    const first = forced(
      placed.filter((k) => facts(k.mob, name) !== false).map((k) => ({ mob: k.mob, n: k.n })),
      rise
    )
    first.forEach(add)
    // Then taking eqlwiki's races for true, to settle the rest: a mob surely of a race the
    // achievement lists counted, one surely of a race it does not list did not, and only the others
    // (a name's guess, an alias not settled, a race the achievement lists some of) are learned of.
    const done = new Set(first.map((f) => f.mob))
    const open = new Set(placed.filter((k) => races.open(i, k.p)).map((k) => k.mob))
    const maybe = placed.filter((k) => facts(k.mob, name) ?? (open.has(k.mob) || races.keys[i].has(k.p.key ?? '')))
    for (const f of forced(
      maybe.map((k) => ({ mob: k.mob, n: k.n })),
      rise
    ))
      if (!done.has(f.mob) && open.has(f.mob)) add(f)
  })
  return out
}

/**
 * Whether a learned fact tells the counts anything the race placement does not: the mob's placement
 * is open (a guess, none, play's by zone, or a race the achievement lists only some of), or the fact
 * goes against it, and every one that counts. One that restates a sure race ("an orc pawn does not count toward Swordfish
 * Mermaid") changes no count, and is not kept (LT-532). An achievement not open for this character
 * cannot be judged here, and its facts stay for the others.
 */
export function factTells(
  races: SlayerRaces,
  counters: Pick<SlayerCounter, 'name'>[],
  raceOf: (mob: string) => string | null | undefined,
  fact: { mob: string; achievement: string; counts: boolean }
): boolean {
  const i = counters.findIndex((c) => c.name.toLowerCase() === fact.achievement)
  if (fact.counts || i < 0 || races.zoned(fact.mob) || races.mixed(fact.mob)) return true
  const p = races.place(fact.mob, raceOf(fact.mob))
  if (races.open(i, p)) return true
  return fact.counts !== races.keys[i].has(p.key ?? '')
}

/**
 * The titles eqlwiki may keep a mob's page under: as the log writes it ("Lesser blade fiend",
 * "Cleric of Innoruuk"), and each word capitalised ("Lesser Blade Fiend", "Magi P`Tasa"). A title is
 * matched exactly past its first letter.
 */
export function wikiTitles(mob: string): string[] {
  const t = mob.replace(/^\*+/, '').trim()
  const first = t.charAt(0).toUpperCase() + t.slice(1)
  const words = t.replace(/(^|[\s`'-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase())
  // Each way of writing it, then each with its backtick dropped or made an apostrophe (Ambassador DVinn, Tani N`Mar): the faction pages' rule and the Slayer's, as one (LT-624).
  const cases = words === first ? [first] : [first, words]
  return [...new Set([...cases, ...cases.map((c) => c.replace(/`/g, '')), ...cases.map((c) => c.replace(/`/g, "'"))])]
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
