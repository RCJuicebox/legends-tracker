import type { LogLine } from '../../core/logLine'

// Faction changes, from the only lines the game writes about them:
//   Your faction standing with King Ak`Anon has been adjusted by -1.
//   Your faction standing with King Ak`Anon could not possibly get any better.
//   Your faction standing with King Ak`Anon could not possibly get any worse.
// The game never prints the standing itself, so what is kept is the net of what the log saw. Each
// stretch of log (an archive, the live log) is tallied on its own and the tallies joined oldest first.

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

/** One faction as the Factions page shows it. */
export interface FactionRow {
  name: string
  net: number
  changes: number
  first: number
  last: number
  cap: FactionCap | null
  /** The last adjustments, newest first. */
  recent: FactionChange[]
}

export interface FactionView {
  /** Most recently seen first. */
  factions: FactionRow[]
}

export function factionView(tallies: FactionTallies): FactionView {
  const factions = Object.values(tallies)
    .map((t) => ({ name: t.name, net: t.net, changes: t.changes, first: t.first, last: t.last, cap: t.cap, recent: [...t.recent].reverse() }))
    .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
  return { factions }
}
