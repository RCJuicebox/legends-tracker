import type { AchSection } from '../shared/character'
import { DIED, SLAIN_BY, SLAIN_BY_YOU } from './phrases'
import { MOB_RACES, NAME_CALLINGS, NAME_WORDS, normalRace, PLAYABLE, PLAYABLE_MARK, raceKey, singulars, unsureRace, wikiRaceKey, type RaceTable } from './raceNames'

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

/** How a mob was given its race: what play settled, eqlwiki's page, or its name. */
export interface Placed {
  key: string | null
  by: 'play' | 'wiki' | 'name' | null
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

  /** A mob's race: what play settled, else eqlwiki's (undefined while not looked up), else its name's. */
  place(mob: string, wikiRace: string | null | undefined): Placed {
    const play = MOB_RACES[nameWords(mob)]
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
  completed: Set<string>
): { rows: { counter: SlayerCounter; since: number; guessed: number; last: number; done: boolean }[]; unplaced: { name: string; n: number }[]; unknown: string[] } {
  const since = counters.map(() => 0)
  const guessed = counters.map(() => 0)
  const last = counters.map(() => 0)
  const unplaced: { name: string; n: number }[] = []
  const unknown: string[] = []
  for (const k of kills.values()) {
    const wiki = raceOf(k.name)
    if (wiki === undefined) unknown.push(k.name)
    const p = races.place(k.name, wiki)
    const mob = k.name.toLowerCase()
    // Kills are kept in log order: the newest is the last (no spread of a long grind's list, LT-380).
    const newest = k.times.at(-1) ?? 0
    let any = false
    counters.forEach((c, i) => {
      const fact = facts(mob, c.name.toLowerCase())
      if (!(fact ?? (p.key !== null && races.keys[i].has(p.key)))) return
      any = true
      since[i] += k.times.length
      if (fact === undefined && !p.sure) guessed[i] += k.times.length
      last[i] = Math.max(last[i], newest)
    })
    if (!any && p.key === null && wiki !== undefined) unplaced.push({ name: k.name, n: k.times.length })
  }
  return {
    rows: counters.map((counter, i) => ({ counter, since: since[i], guessed: guessed[i], last: last[i], done: completed.has(counter.name.toLowerCase()) })),
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
  facts: SlayerFacts
): SlayerFact[] {
  const placed = kills.filter((k) => k.n > 0).map((k) => ({ ...k, mob: k.name.toLowerCase(), p: races.place(k.name, raceOf(k.name)) }))
  const out: SlayerFact[] = []
  const n = new Map(placed.map((k) => [k.mob, k.n]))
  after.forEach((c, i) => {
    const name = c.name.toLowerCase()
    const was = before.get(name)
    if (was === undefined || c.count < was) return
    const rise = c.count - was
    const add = (f: { mob: string; counts: boolean }) => out.push({ mob: f.mob, achievement: name, counts: f.counts, kills: n.get(f.mob) ?? 0, rise })
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
    const open = new Set(placed.filter((k) => !k.p.sure || k.p.key === null || races.broader[i].has(k.p.key)).map((k) => k.mob))
    const maybe = placed.filter((k) => facts(k.mob, name) ?? (open.has(k.mob) || races.keys[i].has(k.p.key ?? '')))
    for (const f of forced(
      maybe.map((k) => ({ mob: k.mob, n: k.n })),
      rise
    ))
      if (!done.has(f.mob) && open.has(f.mob)) add(f)
  })
  return out
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
