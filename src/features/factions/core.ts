import type { LogLine } from '../../core/logLine'
import type { AchSection } from '../../shared/character'
import { deityKey, deityName } from '../../shared/game/deities'
import { CLASS_TABLE } from '../../shared/game/classes'

// Faction changes, from the only lines the game writes about them:
//   Your faction standing with King Ak`Anon has been adjusted by -1.
//   Your faction standing with King Ak`Anon could not possibly get any better.
//   Your faction standing with King Ak`Anon could not possibly get any worse.
// The log never prints the standing itself, so what is kept is the net of what the log saw. Each
// stretch of log (an archive, the live log) is tallied on its own and the tallies joined oldest first.
//
// The standing comes from the factions export instead (/outputfile faction; factions works too), which the game writes
// as Kelwyn_neriak-MNK-Factions.txt: a header line, then one line per faction,
//   ID<tab>Name<tab>StandingValue<tab>PointsToMax          e.g. 65, Brownies of Faydwer, -6, 2006
// StandingValue runs from -2000 to 2000 and PointsToMax is what is left to 2000. Factions without a
// name come as "Faction723". The page shows the export's standing plus what the log saw since.

/** Where a faction was last seen stuck: "could not possibly get any better" (top) or "… any worse" (bottom). */
export type FactionCap = 'top' | 'bottom'

export type FactionLine = { faction: string; amount: number } | { faction: string; cap: FactionCap }

const ADJUSTED = /^Your faction standing with (.+) has been adjusted by ([+-]?\d+)\.$/
const CAPPED = /^Your faction standing with (.+) could not possibly get any (better|worse)\.$/

/** A faction line's faction and what it says, or null for any other line. */
export function parseFactionLine(text: string): FactionLine | null {
  if (!text.startsWith('Your faction standing with ')) return null
  const a = ADJUSTED.exec(text)
  if (a) return { faction: a[1], amount: parseInt(a[2], 10) }
  const c = CAPPED.exec(text)
  if (c) return { faction: c[1], cap: c[2] === 'better' ? 'top' : 'bottom' }
  return null
}

/** Adjustments kept per faction for its recent history. */
export const RECENT_KEPT = 20

export interface FactionChange {
  at: number
  amount: number
}

/** One faction over a stretch of log. */
export interface FactionTally {
  /** As the log last wrote it. */
  name: string
  /** The sum of every adjustment. */
  net: number
  /** How many adjustments. */
  changes: number
  /** The first and last line naming it, adjustment or cap. */
  first: number
  last: number
  /** Stuck at a cap, until an ordinary adjustment the other way. */
  cap: FactionCap | null
  /** The last cap line's time, standing or cleared since; 0 for none. A later stretch's cap line outranks an earlier one's. */
  capAt: number
  /** Whether the stretch had an adjustment up, or down: a later stretch's clears an earlier one's cap. */
  up: boolean
  down: boolean
  /** The last adjustments, oldest first. */
  recent: FactionChange[]
}

/** A stretch of log's factions, by lower-cased name. */
export type FactionTallies = Record<string, FactionTally>

const blank = (name: string, at: number): FactionTally => ({ name, net: 0, changes: 0, first: at, last: at, cap: null, capAt: 0, up: false, down: false, recent: [] })

/** Reads one line into a stretch's tallies; anything but a faction line is passed over. */
export function addFactionLine(into: FactionTallies, line: LogLine): void {
  const f = parseFactionLine(line.text)
  if (!f) return
  const t = (into[f.faction.toLowerCase()] ??= blank(f.faction, line.time))
  t.name = f.faction
  t.first = Math.min(t.first, line.time)
  t.last = Math.max(t.last, line.time)
  if ('cap' in f) {
    t.cap = f.cap
    t.capAt = line.time
    return
  }
  t.net += f.amount
  t.changes++
  t.recent.push({ at: line.time, amount: f.amount })
  if (t.recent.length > RECENT_KEPT) t.recent.shift()
  if (f.amount > 0) {
    t.up = true
    if (t.cap === 'bottom') t.cap = null
  } else if (f.amount < 0) {
    t.down = true
    if (t.cap === 'top') t.cap = null
  }
}

/** Two stretches' tallies of one faction as one, `b` being the later. */
function join(a: FactionTally, b: FactionTally): FactionTally {
  // A cap line in the later stretch settles it; else the earlier cap stands unless the later
  // stretch moved the other way.
  const cap = b.capAt ? b.cap : (a.cap === 'top' && b.down) || (a.cap === 'bottom' && b.up) ? null : a.cap
  return {
    name: b.name,
    net: a.net + b.net,
    changes: a.changes + b.changes,
    first: Math.min(a.first, b.first),
    last: Math.max(a.last, b.last),
    cap,
    capAt: Math.max(a.capAt, b.capAt),
    up: a.up || b.up,
    down: a.down || b.down,
    recent: [...a.recent, ...b.recent].slice(-RECENT_KEPT)
  }
}

/** Stretches' tallies as one, given oldest first. */
export function joinFactions(stretches: FactionTallies[]): FactionTallies {
  const all: FactionTallies = {}
  for (const s of stretches) for (const [k, t] of Object.entries(s)) all[k] = all[k] ? join(all[k], t) : t
  return all
}

/** The factions export's file name; [1] is the character key. The class in it is optional, to be safe. */
export const FACTIONS_FILE = /^(.+?)(?:-[a-z]+)?-Factions\.txt$/i

export const STANDING_MAX = 2000
export const STANDING_MIN = -2000

/** One line of the factions export. */
export interface FactionStanding {
  id: number
  name: string
  value: number
  toMax: number
}

const INT = /^-?\d+$/

/** The factions export's lines; the header, and anything else that is not one, is passed over. */
export function parseFactionsExport(text: string): FactionStanding[] {
  const out: FactionStanding[] = []
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const [id, name, value, toMax] = raw.split('\t').map((c) => c.trim())
    if (!INT.test(id ?? '') || !name || !INT.test(value ?? '')) continue
    const v = parseInt(value, 10)
    out.push({ id: parseInt(id, 10), name, value: v, toMax: INT.test(toMax ?? '') ? parseInt(toMax, 10) : STANDING_MAX - v })
  }
  if (!out.length) throw new Error('No factions found. Expected lines like "65<tab>Brownies of Faydwer<tab>-6<tab>2006".')
  return out
}

/** A factions export as read: the file, when the game wrote it, and its lines. */
export interface FactionExport {
  file: string
  modified: number
  standings: FactionStanding[]
}

export type StandingTone = 'ok' | 'plain' | 'warn' | 'bad'

/**
 * How a standing cons, highest first: EQEmu's bands (Ally from 1100, Scowling at -751 and below),
 * which cons seen in play land on to the point (docs/formulas.md).
 */
export const STANDINGS: readonly { min: number; word: string; tone: StandingTone }[] = [
  { min: 1100, word: 'Ally', tone: 'ok' },
  { min: 750, word: 'Warmly', tone: 'ok' },
  { min: 500, word: 'Kindly', tone: 'ok' },
  { min: 100, word: 'Amiably', tone: 'plain' },
  { min: 0, word: 'Indifferent', tone: 'plain' },
  { min: -100, word: 'Apprehensive', tone: 'warn' },
  { min: -500, word: 'Dubious', tone: 'warn' },
  { min: -750, word: 'Threatening', tone: 'bad' },
  { min: -Infinity, word: 'Scowling', tone: 'bad' }
]

/** The band a standing is in, and the next one up with the points still to go (none for Ally). */
export function standingBand(value: number): { word: string; tone: StandingTone; next: { word: string; points: number } | null } {
  const i = STANDINGS.findIndex((s) => value >= s.min)
  const band = STANDINGS[i]
  const up = i > 0 ? STANDINGS[i - 1] : null
  return { word: band.word, tone: band.tone, next: up ? { word: up.word, points: up.min - value } : null }
}

/** A faction name reduced for matching: the wiki writes "Opal Dark Briar", the game "Opal Darkbriar". */
export const factionKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s*\(faction\)\s*$/, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')

// ---------- what a faction cons at ----------
// NPCs con a faction on the standing with the race, class and deity modifiers added: the client's
// Resources/Faction/FactionAssociations.txt holds them, one faction^key^modifier a line, the key a
// class id (1–16), a race's (51–62 for the classic twelve, Iksar 178, Kerran 180, Froglok 661, Drakkin
// 1106) or a deity's (201–216). Seen in play: Tunare's Scouts at 0 conned −950 Scowling for an Iksar of
// Cazic Thule, −750 Threatening for an Agnostic Iksar, −100 Apprehensive for a Wood Elf of Cazic Thule
// and 100 Amiably for an Agnostic Wood Elf. Of a character's three classes, the best modifier counts,
// whichever class it is: an Agnostic Wood Elf Monk/Bard/Enchanter conned Neriak's Dreadguard Inner at
// 2000 as an Ally (1125), where the Monk's −300 would have made it Warmly, and the bards' Song Weavers at
// 0 as Amiably (Bard +50), where with Shadow Knight and Shaman beside the Monk it was Indifferent. The
// race and the classes are the character record's (/who keeps them), and so is the deity (set on the
// Stats page: /who does not show it).

/** The modifier keys of the playable races, by name as the character record writes it (lower-cased). */
export const RACE_KEYS: Record<string, number> = {
  human: 51,
  barbarian: 52,
  erudite: 53,
  'wood elf': 54,
  'high elf': 55,
  'dark elf': 56,
  'half elf': 57,
  dwarf: 58,
  troll: 59,
  ogre: 60,
  halfling: 61,
  gnome: 62,
  iksar: 178,
  // Legends' Kerran have classic EQ's Vah Shir key (180 favours Kerra Isle); 661 favours Gukta's
  // factions, and 1106 is the one left: one key for each of the sixteen playable races.
  kerran: 180,
  'vah shir': 180,
  froglok: 661,
  drakkin: 1106
}

/** Class ids, by the three letters a factions export's name carries (Kelwyn_neriak-MNK-Factions.txt). */
export const CLASS_KEYS: Record<string, number> = {
  WAR: 1,
  CLR: 2,
  PAL: 3,
  RNG: 4,
  SHD: 5,
  DRU: 6,
  MNK: 7,
  BRD: 8,
  ROG: 9,
  SHM: 10,
  NEC: 11,
  WIZ: 12,
  MAG: 13,
  ENC: 14,
  BST: 15,
  BER: 16
}

/** FactionAssociations.txt: each faction's modifiers, by faction id, then key. */
export function parseFactionModifiers(text: string): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>()
  for (const line of String(text).split(/\r?\n/)) {
    const [f, k, m] = line.split('^').map((c) => c.trim())
    if (!INT.test(f ?? '') || !INT.test(k ?? '') || !INT.test(m ?? '')) continue
    const byKey = out.get(parseInt(f, 10)) ?? new Map<number, number>()
    byKey.set(parseInt(k, 10), parseInt(m, 10))
    out.set(parseInt(f, 10), byKey)
  }
  return out
}

/** What the keys a character has (its race's, its class's) add to one faction's con. */
export const modifierOf = (mods: Map<number, Map<number, number>>, factionId: number, keys: number[]) => keys.reduce((n, k) => n + (mods.get(factionId)?.get(k) ?? 0), 0)

/** The class the factions export is named for (Kelwyn_neriak-MNK-Factions.txt → MNK); '' without one. */
export const exportClass = (file: string) => /-([A-Z]{3})-Factions\.txt$/i.exec(file)?.[1].toUpperCase() ?? ''

/** Whose modifiers a con adds: the character's race and deity (its record's) and the class its factions export is named for. */
export interface ConBasis {
  race: string
  /** The classes whose best modifier counts, in the record's order (the first is the player's main one); the one the factions export is named for when the record has none. */
  classes: string[]
  /** As Loadouts names it; '' when the record has none, counted as Agnostic, which has no modifiers. */
  deity: string
}

/** The modifier keys of a con's basis; null where there is none to add. */
export interface ConKeys {
  race: number
  /** The classes' keys, in the basis's order. */
  classes: number[]
  deity: number | null
}

/** What a faction cons at: the standing with the race's, the best class's and the deity's modifiers added. */
export interface FactionCon {
  value: number
  race: number
  /** The best of the classes' modifiers (a class the table has none for counts 0), and which of the basis's classes it is; -1 with none. */
  cls: number
  clsIndex: number
  deity: number
}

/**
 * A character's con basis and keys, from its record's race, classes (by name) and deity; without
 * classes, the one the factions export is named for. Null without a race the table knows, since then
 * the con would be anyone's guess.
 */
export function conBasis(race: string | undefined, classes: string[], exportFile: string | null, deity: string | undefined): { basis: ConBasis; keys: ConKeys } | null {
  const r = (race ?? '').trim()
  const raceKey = RACE_KEYS[r.toLowerCase()]
  if (!raceKey) return null
  const named = CLASS_TABLE.filter((t) => classes.includes(t.name)).sort((a, b) => classes.indexOf(a.name) - classes.indexOf(b.name))
  const code = exportFile ? exportClass(exportFile) : ''
  const list = named.length ? named : CLASS_TABLE.filter((t) => t.code === code)
  return {
    basis: { race: r, classes: list.map((t) => t.name), deity: deityName(deity ?? '') },
    keys: { race: raceKey, classes: list.map((t) => t.number), deity: deityKey(deity ?? '') }
  }
}

/** One faction's con: its standing with the race's, the best class's and the deity's modifiers. */
export function conOf(mods: Map<number, Map<number, number>>, factionId: number, standing: number, keys: ConKeys): FactionCon {
  const of = (k: number | null) => (k === null ? 0 : (mods.get(factionId)?.get(k) ?? 0))
  let cls = 0
  let clsIndex = -1
  // The first class wins a tie: the player's main one.
  keys.classes.forEach((k, i) => {
    const v = of(k)
    if (clsIndex < 0 || v > cls) [cls, clsIndex] = [v, i]
  })
  const [race, deity] = [of(keys.race), of(keys.deity)]
  return { value: standing + race + cls + deity, race, cls, clsIndex, deity }
}

/** The view with each standing's con, and the basis they were worked out on. */
export function withCons(view: FactionView, mods: Map<number, Map<number, number>>, c: { basis: ConBasis; keys: ConKeys }): FactionView {
  return {
    ...view,
    conBasis: c.basis,
    factions: view.factions.map((r) => (r.standing ? { ...r, standing: { ...r.standing, con: conOf(mods, r.standing.id, r.standing.value, c.keys) } } : r))
  }
}

/** A faction's standing now: the export's, plus what the log saw since. */
export interface FactionStandingNow {
  id: number
  /** The export's value plus `since`, held to -2000…2000. */
  value: number
  /** As the export gave it. */
  atExport: number
  /** The net of the changes the log saw after the export was written. */
  since: number
  /**
   * False when `since` may be only part of it: the live log starts after the export, so the changes
   * since come from the tallies, and they saw more than a faction keeps.
   */
  sinceAll: boolean
  /** What NPCs con: the value with the character's race, class and deity modifiers; absent without a race on its record. */
  con?: FactionCon
}

/** One faction as the Factions page shows it. */
export interface FactionRow {
  name: string
  net: number
  changes: number
  /** The first and last line naming it; 0 when the log never did (a faction only the export lists). */
  first: number
  last: number
  cap: FactionCap | null
  /** The last adjustments, newest first. */
  recent: FactionChange[]
  /** From the factions export; null when there is none or it does not list this faction. */
  standing: FactionStandingNow | null
  /** Its EverQuest › Progression achievement, when it has one. */
  achievement: FactionRowAchievement | null
}

export interface FactionRowAchievement {
  id: number
  name: string
  /** Done or not; null when neither export says (no achievements export, no standing). */
  done: boolean | null
  /** Where `done` comes from: the achievements export, the game saying so in the log since, or the standing (2000 is done). */
  from: 'achievements' | 'log' | 'standing' | null
}

export interface FactionView {
  /** Most recently seen first, then the ones only the export lists, by name. */
  factions: FactionRow[]
  /** The factions export the standings came from, when there is one. */
  export: { file: string; modified: number } | null
  /** Why the factions export could not be read; '' when it was, or there is none. */
  exportError: string
  /** Whose modifiers the standings' cons add; absent without a race on the character's record. */
  conBasis?: ConBasis
}

// ---------- faction achievements ----------
// EverQuest › Progression holds one achievement per faction, done by "reaching maximum faction
// standing with X": the raw 2000 of the factions export, not the standing with race, class and deity
// added. The client's Resources/Achievements/AchievementsClient.txt (id^name^description^…) numbers
// each one 80000 + the faction's id; the name can differ from the faction's (New Sebilis Expedition is
// faction 722, New Sebilisian Expedition), so the id is what joins them. The achievements export lists
// only achievements still open (one character's lists 31 of the 83; 45 of the ones it leaves out are at 2000),
// so one it leaves out is done: a standing that dropped since does not undo it.

export const FACTION_ACH_BASE = 80000
const MAX_STANDING = /reaching maximum faction standing with (.+?)\.?\s*$/i

/** One faction's achievement, from the client's achievement list. */
export interface FactionAchievement {
  id: number
  name: string
  factionId: number
  /** As the description names it. */
  faction: string
}

/** The faction achievements in the client's AchievementsClient.txt. */
export function parseFactionAchievements(text: string): FactionAchievement[] {
  const out: FactionAchievement[] = []
  for (const line of String(text).split(/\r?\n/)) {
    const [id, name, description] = line.split('^')
    const m = description && MAX_STANDING.exec(description)
    const n = parseInt(id, 10)
    if (!m || !(n > FACTION_ACH_BASE) || !name) continue
    out.push({ id: n, name: name.trim(), factionId: n - FACTION_ACH_BASE, faction: m[1].trim() })
  }
  return out
}

/**
 * Whether an achievement of a kind the export leaves out is done. The achievements window can hide
 * completed ones, and an export made that way lists only what is open: one it leaves out is done, and
 * a kind it leaves out entirely is all done. An export that lists completed ones too, but none of this
 * kind, says nothing about it (a changed layout, a section the game did not write).
 */
export function leftOutIsDone(sections: AchSection[], ofKind: (section: AchSection, a: AchSection['ach'][number]) => boolean): boolean {
  let listsDone = false
  for (const s of sections) {
    for (const a of s.ach) {
      if (ofKind(s, a)) return true
      if (a.d === true) listsDone = true
    }
  }
  return !listsDone
}

const isProgression = (s: AchSection) => s.cat === 'EverQuest' && s.name === 'Progression'

/**
 * Which faction achievements an achievements export lists, by lower-cased name, and whether each is
 * done. Null without an export, or when it cannot say (see leftOutIsDone); an export of open
 * achievements only with no Progression section lists none, so all are done.
 */
export function progressionStatus(sections: AchSection[] | null): Map<string, boolean> | null {
  if (!sections?.length || !leftOutIsDone(sections, isProgression)) return null
  const sec = sections.find(isProgression)
  return new Map((sec?.ach ?? []).map((a) => [a.n.toLowerCase(), !!a.d]))
}

/** The faction achievements, and what the achievements export says of them. */
export interface FactionAchievements {
  list: FactionAchievement[]
  status: Map<string, boolean> | null
  /** The achievements export read, when there is one: what the game says was completed after it is done too. */
  exported?: ExportMark | null
}

// ---------- since the exports ----------
// A faction's tally keeps only its last few changes, and one evening at a camp or one stack of
// hand-ins makes far more, so where a faction stands now is read from the log itself: every change
// after the factions export. The game writes "Outputfile Complete: <file>" as it writes an export,
// and that line is where the export ends, a change in the same second on either side of it included;
// a log without the line counts the lines stamped after the file's time. An achievement the game says
// was completed after the achievements export is done, though that export still lists it open.

/** How far apart an export's file time and its "Outputfile Complete" line may be. */
export const EXPORT_LINE_MS = 3000

/** An export: its file name, and when the game wrote it. */
export interface ExportMark {
  file: string
  modified: number
}

const OUTPUT_DONE = 'Outputfile Complete: '
const COMPLETED = /^You have completed achievement: (.+?)\.?$/

const isExportLine = (mark: ExportMark | null, file: string, at: number) => !!mark && mark.file.toLowerCase() === file && Math.abs(at - mark.modified) <= EXPORT_LINE_MS

/** What the log saw after the exports, fed its lines in order from a line before the earlier of them. */
export class SinceExports {
  // Each counted twice: from the export's line, and by time for a log without that line.
  private readonly changes = { byLine: new Map<string, number>(), byTime: new Map<string, number>(), line: false }
  private readonly done = { byLine: new Set<string>(), byTime: new Set<string>(), line: false }

  constructor(
    readonly factions: ExportMark | null,
    readonly achievements: ExportMark | null
  ) {}

  add(line: LogLine): void {
    const text = line.text
    if (text.startsWith(OUTPUT_DONE)) {
      const file = text.slice(OUTPUT_DONE.length).trim().toLowerCase()
      if (isExportLine(this.factions, file, line.time)) {
        this.changes.byLine.clear()
        this.changes.line = true
      }
      if (isExportLine(this.achievements, file, line.time)) {
        this.done.byLine.clear()
        this.done.line = true
      }
      return
    }
    if (this.factions && text.startsWith('Your faction standing with ')) {
      const f = parseFactionLine(text)
      if (!f || !('amount' in f)) return
      const k = f.faction.toLowerCase()
      this.changes.byLine.set(k, (this.changes.byLine.get(k) ?? 0) + f.amount)
      if (line.time > this.factions.modified) this.changes.byTime.set(k, (this.changes.byTime.get(k) ?? 0) + f.amount)
      return
    }
    const ach = this.achievements
    const m = ach ? COMPLETED.exec(text) : null
    if (!ach || !m) return
    const k = m[1].trim().toLowerCase()
    this.done.byLine.add(k)
    if (line.time > ach.modified) this.done.byTime.add(k)
  }

  /** Each faction's net since the factions export, by lower-cased name. */
  get factionChanges(): ReadonlyMap<string, number> {
    return this.changes.line ? this.changes.byLine : this.changes.byTime
  }

  /** The achievements the game said were completed since the achievements export, by lower-cased name. */
  get completed(): ReadonlySet<string> {
    return this.done.line ? this.done.byLine : this.done.byTime
  }
}

/** What the log saw after the exports (SinceExports). `changes` is null when the log does not reach back to the factions export. */
export interface SinceView {
  changes: ReadonlyMap<string, number> | null
  completed: ReadonlySet<string>
}

const blankRow = (name: string): FactionRow => ({ name, net: 0, changes: 0, first: 0, last: 0, cap: null, recent: [], standing: null, achievement: null })

/** A standing brought up to date with the log's changes after the export was written: every one when read from the log itself (`read`). */
function standingNow(s: FactionStanding, t: FactionTally | undefined, since: number, read: ReadonlyMap<string, number> | null): FactionStandingNow {
  const sum = read ? (read.get(s.name.toLowerCase()) ?? 0) : t ? t.recent.filter((c) => c.at > since).reduce((n, c) => n + c.amount, 0) : 0
  // The kept changes hold everything since the export if they are every change, or reach back past it.
  const sinceAll = !!read || !t || t.changes <= t.recent.length || t.recent[0].at <= since
  const value = Math.max(STANDING_MIN, Math.min(STANDING_MAX, s.value + sum))
  return { id: s.id, value, atExport: s.value, since: sum, sinceAll }
}

export function factionView(
  tallies: FactionTallies,
  exported: FactionExport | null = null,
  achievements: FactionAchievements | null = null,
  since: SinceView | null = null
): FactionView {
  const row = (t: FactionTally): FactionRow => ({
    name: t.name,
    net: t.net,
    changes: t.changes,
    first: t.first,
    last: t.last,
    cap: t.cap,
    recent: [...t.recent].reverse(),
    standing: null,
    achievement: null
  })
  const rows = new Map(Object.entries(tallies).map(([k, t]) => [k, row(t)]))
  if (exported) {
    for (const s of exported.standings) {
      const key = s.name.toLowerCase()
      const t = tallies[key]
      const standing = standingNow(s, t, exported.modified, since?.changes ?? null)
      const r = rows.get(key) ?? blankRow(s.name)
      r.standing = standing
      // A cap line since the export says where it is stuck; otherwise the standing does.
      if (!(t && t.capAt > exported.modified)) r.cap = standing.value >= STANDING_MAX ? 'top' : standing.value <= STANDING_MIN ? 'bottom' : null
      rows.set(key, r)
    }
  }
  if (achievements) {
    const byId = new Map([...rows.values()].flatMap((r) => (r.standing ? [[r.standing.id, r] as const] : [])))
    for (const a of achievements.list) {
      const key = a.faction.toLowerCase()
      let r = byId.get(a.factionId) ?? rows.get(key)
      if (!r) rows.set(key, (r = blankRow(a.faction)))
      const status = achievements.status
      const exportDone = status ? (status.get(a.name.toLowerCase()) ?? true) : null
      r.achievement = exportDone
        ? { id: a.id, name: a.name, done: true, from: 'achievements' }
        : since?.completed.has(a.name.toLowerCase())
          ? { id: a.id, name: a.name, done: true, from: 'log' }
          : status
            ? { id: a.id, name: a.name, done: false, from: 'achievements' }
            : r.standing
              ? { id: a.id, name: a.name, done: r.standing.value >= STANDING_MAX, from: 'standing' }
              : { id: a.id, name: a.name, done: null, from: null }
    }
  }
  const factions = [...rows.values()].sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
  return { factions, export: exported ? { file: exported.file, modified: exported.modified } : null, exportError: '' }
}

// ---------- what raises a faction ----------
// eqlwiki's faction pages ({{Factionpage}}) list what raises and lowers each faction: zones_raise,
// quests_raise and mobs_raise, one bullet each, a mob with where it is:
//   * [[Guard Korlack]]  <span class='fmz'>(Paineel)</span>
//   * [[Azzar Habbib]] <span class='fmz'>(Paineel - Quest NPC)</span>
// Community-maintained, so leads rather than the game's own list.

/** A mob whose death raises the faction: where it is, and the page's note ("Quest NPC", "Merchant"). */
export interface FactionMob {
  name: string
  zone: string
  note: string
}

export interface FactionSources {
  /** The wiki page it came from. */
  page: string
  mobs: FactionMob[]
  quests: string[]
  zones: string[]
}

/** The template's parameters, each value as written. */
function templateParams(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /(?:^|\n)\|\s*([a-z_]+)\s*=([\s\S]*?)(?=\n\|\s*[a-z_]+\s*=|\n\}\}|$)/g
  for (const m of text.matchAll(re)) out.set(m[1].toLowerCase(), m[2])
  return out
}

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/
const plainText = (s: string) =>
  s
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** A bullet list's lines, without the bullet. */
const bullets = (v: string | undefined) =>
  (v ?? '')
    .split('\n')
    .filter((l) => /^\s*\*/.test(l))
    .map((l) => l.replace(/^\s*\*+\s*/, ''))

/** A bullet's link text (the label, else the page), else its plain text. */
const named = (line: string) => {
  const m = LINK.exec(line)
  return (m ? (m[2] ?? m[1]) : plainText(line)).trim()
}

/** What a page writes where it has no mob to list: "none", "unknown". */
export const NO_MOB = /^(?:none|unknown|n\/?a|various|tbd|\?+|-+)$/i

function mob(line: string): FactionMob | null {
  const name = named(line)
  if (!name || NO_MOB.test(name)) return null
  const span = /<span[^>]*>([\s\S]*?)<\/span>/.exec(line)
  const rest = plainText(span ? span[1] : line.replace(LINK, '')).replace(/^\((.*)\)$/, '$1')
  const cut = rest.indexOf(' - ')
  return { name, zone: (cut < 0 ? rest : rest.slice(0, cut)).trim(), note: cut < 0 ? '' : rest.slice(cut + 3).trim() }
}

/** A bullet's link target, the page it goes to without any #section; else its plain text. */
const linkTarget = (line: string) => {
  const m = LINK.exec(line)
  return (m ? m[1].replace(/#.*$/, '') : plainText(line)).replace(/_/g, ' ').trim()
}

/** What a faction page lists on one side: the mobs, the quest pages and the zones. */
export interface FactionSide {
  mobs: FactionMob[]
  /** Quest page titles, as linked (the label can differ: [[Innoruuk Symbol Quests|Innoruuk Disciple]]). */
  quests: string[]
  zones: string[]
}

/** Everything a faction page lists: what raises the faction and what lowers it. */
export interface FactionPageData {
  page: string
  raise: FactionSide
  lower: FactionSide
}

/** Both sides of a faction page; null when the page is not a faction page. */
export function parseFactionPageFull(page: string, text: string): FactionPageData | null {
  if (!/\{\{\s*Factionpage/i.test(text)) return null
  const p = templateParams(text)
  const side = (which: 'raise' | 'lower'): FactionSide => ({
    mobs: bullets(p.get(`mobs_${which}`))
      .map(mob)
      .filter((m): m is FactionMob => !!m),
    quests: [
      ...new Set(
        bullets(p.get(`quests_${which}`))
          .map(linkTarget)
          .filter(Boolean)
      )
    ],
    zones: bullets(p.get(`zones_${which}`))
      .map(named)
      .filter(Boolean)
  })
  return { page, raise: side('raise'), lower: side('lower') }
}

/** What raises a faction, from its eqlwiki page; null when the page is not a faction page. */
export function parseFactionPage(page: string, text: string): FactionSources | null {
  if (!/\{\{\s*Factionpage/i.test(text)) return null
  const p = templateParams(text)
  const list = (key: string) => bullets(p.get(key)).map(named).filter(Boolean)
  return {
    page,
    mobs: bullets(p.get('mobs_raise'))
      .map(mob)
      .filter((m): m is FactionMob => !!m),
    quests: list('quests_raise'),
    zones: list('zones_raise')
  }
}
