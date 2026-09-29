import type { AaSummary } from './aa'
import type { LogLine } from './logLine'

// The AAs a character bought, from the lines the game writes when it happens:
//   You have gained the ability "Burst of Power" at a cost of 3 ability points.     its first rank
//   You have improved Burst of Power 2 at a cost of 6 ability points.
//   The alternate ability Master of All has been refunded.
//   You have gained an ability point!  You now have 11 ability points.
//   You have gained 2 ability point(s)!  You now have 4 ability point(s).
//   You have reached the AA point cap, and cannot gain any further experience until …
//   You must spend some of your ability points. You will no longer gain ability points.
// A rank that cost nothing is one the game gave (a class's own abilities come that way), not one
// bought. A toggled ability names its state ("Symphonic Aura: Disabled") and each rank is written
// under the state it was in, so the state is left off the name. Only what the log recorded is here:
// ranks bought before the oldest log, or with logging off, are missing, so a total can read low.
// Each stretch of log (an archive, the live log) is tallied on its own and the tallies joined oldest
// first, as skills and factions are.

/** A rank bought or given, or a refund of every rank of an ability. */
export type AaEvent = { kind: 'rank'; at: number; name: string; rank: number; cost: number } | { kind: 'refund'; at: number; name: string }

/** A stretch of log's AA lines. */
export interface AaTally {
  /** In log order. */
  events: AaEvent[]
  /** The last "You now have N ability points": the total, when, and how many events came before it. */
  points: { at: number; total: number; after: number } | null
  /** The last time the game said the pool of points was full, and how many events came before it. */
  cap: { at: number; after: number } | null
  /** The newest /alternateadv list: its first line (the time the list is known by) and its last so far. */
  list: { at: number; last: number } | null
  /** The stretch's first line; 0 for none. */
  from: number
}

export const emptyAaTally = (): AaTally => ({ events: [], points: null, cap: null, list: null, from: 0 })

/** "Ability #" lines further apart than this are two lists (as aa.ts splits them). */
const LIST_GAP_MS = 5000

export type AaLine =
  { kind: 'rank'; name: string; rank: number; cost: number } | { kind: 'refund'; name: string } | { kind: 'points'; total: number } | { kind: 'cap' } | { kind: 'list' }

const IMPROVED = /^You have improved (.+) (\d+) at a cost of (\d+) ability points?\.$/
const GAINED = /^You have gained the ability "(.+)" at a cost of (\d+) ability points?\.$/
const POINTS = /^You have gained (?:an|\d+) ability point(?:\(s\)|s)?!\s+You now have (\d+) ability point/
const REFUNDED = /^The alternate ability (.+) has been refunded\.$/

/** "Symphonic Aura: Disabled" → "Symphonic Aura". */
export const abilityName = (name: string): string => name.replace(/: (?:Enabled|Disabled)$/, '').trim()

/** An AA line's meaning, or null for any other line. Every line of a log comes through here, so it looks at the start first. */
export function parseAaLine(text: string): AaLine | null {
  if (text.startsWith('You have ')) {
    let m = IMPROVED.exec(text)
    if (m) return { kind: 'rank', name: abilityName(m[1]), rank: parseInt(m[2], 10), cost: parseInt(m[3], 10) }
    if ((m = GAINED.exec(text))) return { kind: 'rank', name: abilityName(m[1]), rank: 1, cost: parseInt(m[2], 10) }
    if ((m = POINTS.exec(text))) return { kind: 'points', total: parseInt(m[1], 10) }
    return text.startsWith('You have reached the AA point cap') ? { kind: 'cap' } : null
  }
  if (text.startsWith('You must spend some of your ability points')) return { kind: 'cap' }
  if (text.startsWith('Ability #')) return { kind: 'list' }
  if (!text.startsWith('The alternate ability ')) return null
  const m = REFUNDED.exec(text)
  return m ? { kind: 'refund', name: abilityName(m[1]) } : null
}

/** Reads one line into a stretch's tally. */
export function addAaLine(into: AaTally, line: LogLine): void {
  if (!into.from) into.from = line.time
  const p = parseAaLine(line.text)
  if (!p) return
  switch (p.kind) {
    case 'rank':
      into.events.push({ kind: 'rank', at: line.time, name: p.name, rank: p.rank, cost: p.cost })
      return
    case 'refund':
      into.events.push({ kind: 'refund', at: line.time, name: p.name })
      return
    case 'points':
      into.points = { at: line.time, total: p.total, after: into.events.length }
      return
    case 'cap':
      into.cap = { at: line.time, after: into.events.length }
      return
    case 'list':
      if (into.list && line.time - into.list.last <= LIST_GAP_MS) into.list.last = line.time
      else into.list = { at: line.time, last: line.time }
  }
}

/** Two stretches' tallies as one, `b` being the later. */
function join(a: AaTally, b: AaTally): AaTally {
  const n = a.events.length
  return {
    events: [...a.events, ...b.events],
    points: b.points ? { ...b.points, after: b.points.after + n } : a.points,
    cap: b.cap ? { ...b.cap, after: b.cap.after + n } : a.cap,
    list: b.list ?? a.list,
    from: a.from || b.from
  }
}

/** Stretches' tallies as one, given oldest first. */
export function joinAaTallies(stretches: AaTally[]): AaTally {
  return stretches.reduce(join, emptyAaTally())
}

// ---- The Stats page's view ----

export interface AaRank {
  at: number
  rank: number
  cost: number
  /** Given back by a refund since. */
  refunded: boolean
}

export interface AaAbility {
  name: string
  /** The rank the log last gave it; 0 once refunded, or when only the /alternateadv list knows it. */
  rank: number
  /** Points spent on it that no refund gave back. */
  spent: number
  /** Every rank the log recorded, oldest first. */
  ranks: AaRank[]
  /** When it was last raised or refunded; 0 when the log has no line of it. */
  last: number
  /** When refunds gave its ranks back, oldest first. */
  refunds: number[]
  /** Refunded and not bought again since: when; 0 otherwise. */
  refundedAt: number
  /** No rank of it cost a point: the game gave it. */
  granted: boolean
  /** Known only from the /alternateadv list: bought before the log began, or with logging off. */
  listOnly: boolean
}

export interface AaPoints {
  /** The last total the game reported, and when. */
  total: number
  at: number
  /** Points spent since that report. */
  spentSince: number
  /** The total less what was spent since: what should be left. */
  unspent: number
  /** A refund since the report gave back points that no line counts, so there may be more. */
  refundSince: boolean
}

export interface AaHistoryView {
  /** Abilities that cost points, most recently raised first. */
  bought: AaAbility[]
  /** Abilities the game gave, most recently raised first. */
  granted: AaAbility[]
  /** Points the log shows spent, less what refunds gave back. */
  spent: number
  points: AaPoints | null
  /** The game said the pool of points was full and nothing has been bought since: when; 0 otherwise. */
  capAt: number
  /** When the newest /alternateadv list in the log was typed (its first line); 0 for none. */
  listAt: number
  /** The first line of the oldest log read: nothing bought before it is known. */
  from: number
}

const byRecent = (a: AaAbility, b: AaAbility) => b.last - a.last || a.name.localeCompare(b.name)

export function aaHistoryView(t: AaTally): AaHistoryView {
  const abilities = new Map<string, AaAbility>()
  for (const e of t.events) {
    const k = e.name.toLowerCase()
    let a = abilities.get(k)
    if (!a) abilities.set(k, (a = { name: e.name, rank: 0, spent: 0, ranks: [], last: 0, refunds: [], refundedAt: 0, granted: false, listOnly: false }))
    a.last = Math.max(a.last, e.at)
    if (e.kind === 'refund') {
      for (const r of a.ranks) r.refunded = true
      a.rank = 0
      a.spent = 0
      a.refunds.push(e.at)
      a.refundedAt = e.at
      continue
    }
    a.name = e.name
    a.ranks.push({ at: e.at, rank: e.rank, cost: e.cost, refunded: false })
    a.rank = e.rank
    a.spent += e.cost
    a.refundedAt = 0
  }
  const all = [...abilities.values()]
  for (const a of all) a.granted = a.ranks.length > 0 && a.ranks.every((r) => r.cost === 0)

  let points: AaPoints | null = null
  if (t.points) {
    const since = t.events.slice(t.points.after)
    const spentSince = since.reduce((n, e) => n + (e.kind === 'rank' ? e.cost : 0), 0)
    points = { total: t.points.total, at: t.points.at, spentSince, unspent: Math.max(0, t.points.total - spentSince), refundSince: since.some((e) => e.kind === 'refund') }
  }
  // Full until a point is spent; a point gained later means it no longer was.
  const cap = t.cap
  const capAt = cap && !t.events.slice(cap.after).some((e) => e.kind === 'rank' && e.cost > 0) && !(t.points && t.points.at > cap.at) ? cap.at : 0

  return {
    bought: all.filter((a) => !a.granted).sort(byRecent),
    granted: all.filter((a) => a.granted).sort(byRecent),
    spent: all.reduce((n, a) => n + a.spent, 0),
    points,
    capAt,
    listAt: t.list?.at ?? 0,
    from: t.from
  }
}

/**
 * The view with the abilities an /alternateadv list holds that the log never saw bought: ones bought
 * before the log began or with logging off. They come last, with no rank or cost known.
 */
export function withAaList(view: AaHistoryView, list: AaSummary | null): AaHistoryView {
  if (!list) return view
  const known = new Set([...view.bought, ...view.granted].map((a) => a.name.toLowerCase()))
  const bought = [...view.bought]
  const granted = [...view.granted]
  for (const l of list.abilities) {
    const name = abilityName(l.name)
    if (known.has(name.toLowerCase())) continue
    known.add(name.toLowerCase())
    const row: AaAbility = { name, rank: 0, spent: 0, ranks: [], last: 0, refunds: [], refundedAt: 0, granted: l.cost === 0, listOnly: true }
    if (row.granted) granted.push(row)
    else bought.push(row)
  }
  return { ...view, bought, granted }
}
