import { zoneEntered, type LogLine } from '../../core/logLine'
import { DIED, SLAIN_BY, SLAIN_BY_YOU } from '../../core/phrases'
import { parseFactionLine } from './core'

// What caused each faction change in the log: a kill or a hand-in. The game writes a kill's faction
// lines in the second of the kill, just before the line that names it:
//   Your faction standing with Guards of Qeynos has been adjusted by 5.
//   Your faction standing with Bloodsabers has been adjusted by -1.
//   You have slain a putrid skeleton!          (or "… has been slain by Vonartik!", "… died.")
// and a hand-in's just after what was handed over and what the NPC said:
//   You offered 2 Bone Chips to Lashun Novashine.
//   Lashun Novashine says, 'Very well, young one. …'
//   Your faction standing with Priests of Life has been adjusted by 5.
// Legends takes a whole stack at once: "You offered 700 Bandages to Joogl Honeybugger." is followed
// by 700 completions in the same second, each the NPC's line and its faction lines.
//
// So each change (the faction lines of one second, up to the next other line) is put down to the
// kill or hand-in around it, and tallied per zone and mob or NPC: what it did to each faction, how
// often, what was handed over, and how fast it came while the player was at it.

export type SourceKind = 'kill' | 'turnin'

export interface SourceTally {
  kind: SourceKind
  /** The zone, without an instance's " - Group 4 (Refined)". */
  zone: string
  /** The mob as the log names it, first letter capitalised, or the NPC handed to. */
  name: string
  /** Kills, or completed hand-ins. */
  n: number
  /** Per faction: each amount seen ("5", "-1") and how often. */
  hits: Record<string, Record<string, number>>
  /** Factions the game said could get no better (or no worse) instead of giving an amount. */
  top: string[]
  bottom: string[]
  /** Hand-ins: what was offered, by item: how many, and how many completions followed. */
  items?: Record<string, { count: number; done: number }>
  first: number
  last: number
  /** Completions within a run of the one before, and the time between them: the pace while at it. */
  runN: number
  runMs: number
}

/** Kills that moved a faction in a zone, with the time between them while the player was killing there. */
export interface ZoneKills {
  n: number
  runN: number
  runMs: number
  last: number
}

/**
 * A trade whose completions are still being counted: what went in, a stack in one line or one item at
 * a time into the trade window (Tylfon's two Rusty Daggers and two Gold are three lines), until the NPC
 * has answered or the trade is over.
 */
interface Offer {
  npc: string
  items: Record<string, number>
  at: number
  done: number
  /** The trade is over ("You complete the trade with …"): what is offered next is another. */
  closed?: boolean
}

/** One change being put together: its faction lines, and the lines around them. */
interface OpenChange {
  at: number
  zone: string
  hits: Record<string, number>
  top: string[]
  bottom: string[]
  /** Lines just before (text, time), then lines after, until the change is settled. */
  before: [string, number][]
  after: [string, number][]
}

/** A stretch of log's faction sources. */
export interface FactionSourceTallies {
  /** By kind|zone|name, lower-cased. */
  acts: Record<string, SourceTally>
  /** By lower-cased zone. */
  zones: Record<string, ZoneKills>
  /** Changes nothing around them explained. */
  unexplained: number
  /** Where the stretch ended: the zone, a change still waiting for its cause, the NPC last handed to
   * and any offer still being counted. The live log's next read goes on from here. */
  zone?: string
  open?: OpenChange | null
  lastTurnin?: { npc: string; zone: string; at: number } | null
  offers?: Offer[]
}

export const emptySources = (): FactionSourceTallies => ({ acts: {}, zones: {}, unexplained: 0 })

/** Kills further apart than this are separate outings; hand-ins, separate visits. */
const KILL_RUN_MS = 10 * 60_000
const TURNIN_RUN_MS = 2 * 60_000
/** How far back an offer or an NPC's line can be and still be what a change came from. */
const OFFER_MS = 8_000
const NEAR_MS = 1_000
const COMBAT_MS = 3_000
/** A change with no cause of its own right after hand-ins to one NPC is another of those. */
const FOLLOW_MS = 60_000
/** Lines kept from before a change, and lines looked at after it. */
const BEFORE_KEPT = 12
const AFTER_MAX = 8

// "The Plane of Hate - Group 1 (Awakened)", "Kerra Isle 4 (Refined)", "Befallen 1 (Awakened)".
const INSTANCE = /^(.+?)(?: - (?:Solo|Group))?(?: \d+)? \((?:Refined|Awakened|Adaptive|Fused)\)$/

/** A zone's name without the instance it is one of. */
export function baseZone(zone: string): string {
  return INSTANCE.exec(zone)?.[1] ?? zone
}

const OFFERED = /^You offered (\d+) (.+) to (.+)\.$/
/** Items put into one trade window come this close together. */
const TRADE_MS = 60_000
const TRADED = /^You complete the trade with (.+)\.$/
const SAYS = /^(.+?) says,? '/
const CORPSE = /^(.+?)'s corpse (?:says|falls)/
const VERBS =
  'hits?|punch(?:es)?|kicks?|slash(?:es)?|crush(?:es)?|pierces?|bash(?:es)?|strikes?|cleaves?|reaves?|backstabs?|bites?|claws?|mauls?|gores?|stings?|smash(?:es)?|rends?|shoots?|slices?|frenz(?:y|ies) on|burns?|slams?'
const HIT = new RegExp(`^(?:You|.+?) (?:${VERBS}) (.+?) for \\d+ points? of`)
const TRIED = /^(?:You|.+?) tr(?:y|ies) to \w+(?: on)? (.+?), but/
const TAKEN = /^(.+?) has taken \d+ damage/
/** A lone capitalised word is as likely a groupmate as a mob, so fighting lines do not name it a kill. */
const LONE_NAME = /^[A-Z][a-z]+$/
/** Pets and the like, which die without moving a faction: "Aldric`s warder". */
const PET = /^\S+[`']s (?:warder|pet|familiar|companion|servant|minion|guardian|spirit)\b/i
const NOT_A_MOB = /^(?:you|yourself|itself|himself|herself)$/i

const mobName = (s: string) => {
  const t = s.replace(/^\*/, '').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const isMob = (s: string) => !!s && !NOT_A_MOB.test(s) && !PET.test(s)

/** The mob a kill line names, or null for any other line. */
function killed(text: string): string | null {
  const by = SLAIN_BY.exec(text)
  // "Vonartik has been slain by a gnoll!": a mob killed one of the player's side.
  if (by && /^an?\s/i.test(by[2])) return null
  const m = SLAIN_BY_YOU.exec(text) ?? by ?? DIED.exec(text) ?? CORPSE.exec(text)
  return m && isMob(m[1]) ? mobName(m[1]) : null
}

/** Of the mobs the kill lines around a change name, the one it came from: a lone name ("Aldric") only when nothing else is named. */
function pickKilled(names: string[]): string | null {
  return names.find((n) => !LONE_NAME.test(n)) ?? names[0] ?? null
}

/** The mob a fighting line is aimed at, or null. */
function foughtWith(text: string): string | null {
  const m = HIT.exec(text) ?? TRIED.exec(text) ?? TAKEN.exec(text)
  return m && isMob(m[1]) && !LONE_NAME.test(m[1]) ? mobName(m[1]) : null
}

const key = (kind: SourceKind, zone: string, name: string) => `${kind}|${zone.toLowerCase()}|${name.toLowerCase()}`

function tallyOf(into: FactionSourceTallies, kind: SourceKind, zone: string, name: string, at: number): SourceTally {
  const k = key(kind, zone, name)
  return (into.acts[k] ??= { kind, zone, name, n: 0, hits: {}, top: [], bottom: [], first: at, last: at, runN: 0, runMs: 0 })
}

function count(into: FactionSourceTallies, c: OpenChange, kind: SourceKind, name: string): void {
  const zone = baseZone(c.zone)
  const t = tallyOf(into, kind, zone, name, c.at)
  const gap = c.at - t.last
  if (t.n > 0 && gap >= 0 && gap <= (kind === 'kill' ? KILL_RUN_MS : TURNIN_RUN_MS)) {
    t.runN++
    t.runMs += gap
  }
  t.n++
  t.first = Math.min(t.first, c.at)
  t.last = Math.max(t.last, c.at)
  for (const [f, amount] of Object.entries(c.hits)) {
    const byAmount = (t.hits[f] ??= {})
    byAmount[amount] = (byAmount[amount] ?? 0) + 1
  }
  for (const f of c.top) if (!t.top.includes(f)) t.top.push(f)
  for (const f of c.bottom) if (!t.bottom.includes(f)) t.bottom.push(f)
  if (kind === 'kill') {
    const z = (into.zones[zone.toLowerCase()] ??= { n: 0, runN: 0, runMs: 0, last: c.at })
    const zg = c.at - z.last
    if (z.n > 0 && zg >= 0 && zg <= KILL_RUN_MS) {
      z.runN++
      z.runMs += zg
    }
    z.n++
    z.last = Math.max(z.last, c.at)
  }
}

/** A trade's completions, added to its NPC's tally once it is over: each item's count, and the completions it went into. */
function closeOffer(into: FactionSourceTallies, o: Offer, zone: string): void {
  if (!o.done) return
  const t = into.acts[key('turnin', baseZone(zone), o.npc)]
  if (!t) return
  for (const [item, count] of Object.entries(o.items)) {
    const it = ((t.items ??= {})[item] ??= { count: 0, done: 0 })
    it.count += count
    it.done += o.done
  }
}

/** Why a change happened: a kill of a mob, a hand-in to an NPC, or nothing that can be told. */
function causeOf(c: OpenChange, into: FactionSourceTallies): { kind: SourceKind; name: string } | null {
  const near = (at: number, ms: number) => Math.abs(at - c.at) <= ms
  // A kill line in the same second, after the faction lines or just before them.
  const slain: string[] = []
  for (const [text, at] of c.after) {
    if (!near(at, NEAR_MS)) break
    const mob = killed(text)
    if (mob) slain.push(mob)
  }
  for (let i = c.before.length - 1; i >= 0; i--) {
    const [text, at] = c.before[i]
    if (!near(at, NEAR_MS)) break
    const mob = killed(text)
    if (mob) slain.push(mob)
  }
  const victim = pickKilled(slain)
  if (victim) return { kind: 'kill', name: victim }
  // A hand-in: what was offered, or the trade.
  for (let i = c.before.length - 1; i >= 0; i--) {
    const [text, at] = c.before[i]
    if (c.at - at > OFFER_MS) break
    const m = OFFERED.exec(text)
    if (m) return { kind: 'turnin', name: m[3] }
  }
  for (const [text, at] of c.after) {
    if (!near(at, 3_000)) break
    const m = TRADED.exec(text)
    if (m) return { kind: 'turnin', name: m[1] }
  }
  // Fighting just before: a kill whose line the log left out (a groupmate's, with party experience).
  const fought = new Map<string, number>()
  for (const [text, at] of c.before) {
    if (c.at - at > COMBAT_MS) continue
    const mob = foughtWith(text)
    if (mob) fought.set(mob, (fought.get(mob) ?? 0) + 1)
  }
  if (fought.size) return { kind: 'kill', name: [...fought].sort((a, b) => b[1] - a[1])[0][0] }
  // An NPC talking in the same second: a completion of a stack, or a hand-in the log wrote no offer for.
  for (let i = c.before.length - 1; i >= 0; i--) {
    const [text, at] = c.before[i]
    if (!near(at, NEAR_MS)) break
    const m = SAYS.exec(text)
    if (m && !m[1].includes("'s corpse")) return { kind: 'turnin', name: m[1] }
  }
  for (const [text, at] of c.after) {
    if (!near(at, NEAR_MS)) break
    const m = SAYS.exec(text)
    if (m && !m[1].includes("'s corpse")) return { kind: 'turnin', name: m[1] }
  }
  // Straight after hand-ins to one NPC, in the same zone: another of those.
  const last = into.lastTurnin
  if (last && last.zone === c.zone && c.at - last.at >= 0 && c.at - last.at <= FOLLOW_MS) return { kind: 'turnin', name: last.npc }
  return null
}

/**
 * A reader for one stretch of log, as a LogHistory consumer's. What it is in the middle of when the
 * stretch ends is kept in the tallies, so the live log's next read picks it up.
 */
export function sourceReader(): (line: LogLine, into: FactionSourceTallies) => void {
  const recent: [string, number][] = []
  let started = false

  const settle = (into: FactionSourceTallies) => {
    const c = into.open
    if (!c) return
    into.open = null
    const cause = causeOf(c, into)
    if (!cause) {
      into.unexplained++
      return
    }
    count(into, c, cause.kind, cause.name)
    if (cause.kind === 'turnin') {
      into.lastTurnin = { npc: cause.name, zone: c.zone, at: c.at }
      const o = into.offers?.find((x) => x.npc === cause.name)
      if (o && c.at - o.at <= 10 * 60_000) o.done++
    }
  }

  return (line, into) => {
    if (!started) {
      started = true
      into.unexplained ??= 0
      into.zones ??= {}
    }
    const text = line.text
    if (text.startsWith('Your faction standing with ')) {
      const f = parseFactionLine(text)
      if (!f) return
      let c = into.open
      // The lines of one change come together; anything else in between starts another.
      if (c && (c.after.length || line.time - c.at > NEAR_MS)) {
        settle(into)
        c = null
      }
      if (!c) {
        c = into.open = { at: line.time, zone: into.zone ?? '', hits: {}, top: [], bottom: [], before: recent.filter(([, at]) => line.time - at <= OFFER_MS), after: [] }
      }
      if ('amount' in f) c.hits[f.faction] = (c.hits[f.faction] ?? 0) + f.amount
      else (f.cap === 'top' ? c.top : c.bottom).push(f.faction)
      return
    }
    const zone = text.startsWith('You have entered ') ? zoneEntered(text) : null
    if (zone) {
      settle(into)
      for (const o of into.offers ?? []) closeOffer(into, o, into.zone ?? '')
      into.offers = []
      into.zone = zone
      into.lastTurnin = null
      recent.length = 0
      return
    }
    const c = into.open
    if (c) {
      if (line.time - c.at > 2_000 || c.after.length >= AFTER_MAX) settle(into)
      else c.after.push([text, line.time])
    }
    if (text.startsWith('You offered ')) {
      const m = OFFERED.exec(text)
      if (m) {
        // A change still waiting for its cause is over now that something else is offered: put it down
        // first, so the completion goes to the trade it came from, not to this next one.
        if (into.open) settle(into)
        const offers = (into.offers ??= [])
        const i = offers.findIndex((o) => o.npc === m[3])
        // Another item into the same trade window, until the NPC has answered or the trade is over.
        if (i >= 0 && (offers[i].done > 0 || offers[i].closed || line.time - offers[i].at > TRADE_MS)) closeOffer(into, offers.splice(i, 1)[0], into.zone ?? '')
        const o = offers.find((x) => x.npc === m[3])
        if (o) o.items[m[2]] = (o.items[m[2]] ?? 0) + Number(m[1])
        else offers.push({ npc: m[3], items: { [m[2]]: Number(m[1]) }, at: line.time, done: 0 })
      }
    } else if (text.startsWith('You complete the trade with ')) {
      const m = TRADED.exec(text)
      const o = m ? into.offers?.find((x) => x.npc === m[1]) : undefined
      if (o) o.closed = true
    }
    recent.push([text, line.time])
    if (recent.length > BEFORE_KEPT) recent.shift()
  }
}

/** A stretch's tallies with what it was in the middle of finished off, for a view: the stretch itself is left as it was. */
function finished(s: FactionSourceTallies): FactionSourceTallies {
  if (!s.open && !s.offers?.length) return s
  const copy = structuredClone(s)
  const read = sourceReader()
  // A line in another second settles the waiting change.
  if (copy.open) read({ time: copy.open.at + 10_000, text: '' }, copy)
  for (const o of copy.offers ?? []) closeOffer(copy, o, copy.zone ?? '')
  copy.offers = []
  return copy
}

function joinTally(a: SourceTally, b: SourceTally): SourceTally {
  const hits = structuredClone(a.hits)
  for (const [f, amounts] of Object.entries(b.hits)) {
    const into = (hits[f] ??= {})
    for (const [amount, n] of Object.entries(amounts)) into[amount] = (into[amount] ?? 0) + n
  }
  let items = a.items ? structuredClone(a.items) : undefined
  for (const [item, v] of Object.entries(b.items ?? {})) {
    items ??= {}
    const it = (items[item] ??= { count: 0, done: 0 })
    it.count += v.count
    it.done += v.done
  }
  return {
    ...b,
    n: a.n + b.n,
    hits,
    top: [...new Set([...a.top, ...b.top])],
    bottom: [...new Set([...a.bottom, ...b.bottom])],
    ...(items ? { items } : {}),
    first: Math.min(a.first, b.first),
    last: Math.max(a.last, b.last),
    runN: a.runN + b.runN,
    runMs: a.runMs + b.runMs
  }
}

/** Stretches' tallies as one, given oldest first. */
export function joinSources(stretches: FactionSourceTallies[]): FactionSourceTallies {
  const all = emptySources()
  for (const raw of stretches) {
    const s = finished(raw)
    for (const [k, t] of Object.entries(s.acts)) all.acts[k] = all.acts[k] ? joinTally(all.acts[k], t) : t
    for (const [k, z] of Object.entries(s.zones ?? {})) {
      const had = all.zones[k]
      all.zones[k] = had ? { n: had.n + z.n, runN: had.runN + z.runN, runMs: had.runMs + z.runMs, last: Math.max(had.last, z.last) } : { ...z }
    }
    all.unexplained += s.unexplained ?? 0
  }
  return all
}

/** What another character's log saw, shared: by tally key, the other characters that saw it and whether this one did too. */
export type SharedFrom = Record<string, { others: string[]; own: boolean }>

/**
 * A character's tallies with what the player's other characters' logs saw added in. What a kill or a
 * hand-in does to a faction is the game's, whoever does it, and so is how fast a stack goes in; how
 * fast one character kills is its own, so their kill runs are left out (the zones stay this one's).
 */
export function shareSources(own: FactionSourceTallies, others: { character: string; sources: FactionSourceTallies }[]): { sources: FactionSourceTallies; from: SharedFrom } {
  const acts: Record<string, SourceTally> = { ...own.acts }
  const from: SharedFrom = {}
  for (const o of others) {
    for (const [k, t] of Object.entries(o.sources.acts)) {
      const theirs = t.kind === 'kill' ? { ...t, runN: 0, runMs: 0 } : t
      acts[k] = acts[k] ? joinTally(acts[k], theirs) : theirs
      const f = (from[k] ??= { others: [], own: k in own.acts })
      if (!f.others.includes(o.character)) f.others.push(o.character)
    }
  }
  return { sources: { ...own, acts }, from }
}

/** The amount a tally saw most often for a faction; ties go to the larger. */
export function usualAmount(amounts: Record<string, number>): number {
  let best = 0
  let seen = -1
  for (const [a, n] of Object.entries(amounts)) {
    const v = Number(a)
    if (n > seen || (n === seen && Math.abs(v) > Math.abs(best))) {
      best = v
      seen = n
    }
  }
  return best
}
