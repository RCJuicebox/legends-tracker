import { CONSIDERED, EXPERIENCE, LEVEL_GAINED, SLAIN_BY_YOU } from '../../core/phrases'
import { zoneEntered, type LogLine } from '../../core/logLine'
import { mobKey } from '../../core/respawnSeen'
import { zoneKey } from '../../core/zones'
import { CRAWL_DONE, createdInstance, isInstance } from './core'

// Motes › Crawl XP: the experience each run in an instance brought, read from the log. Every kill that
// gives experience says how much of a level it was ("You gain experience! (0.553%)"); a run's kills are
// added up from entering the instance to leaving it. What the completion pays is never said: measured
// on 2026-11-23 (three Nagafen's Lair crawls, D0, D1 and D4, the bar read before and after), it is a
// fifth of what the run's kills gave up to that point, so it is worked out, not read.
//
// A kill /con'd just before it also says what a mob of that level is worth at the player's level: kept
// as the value at difficulty 0, since each step of difficulty adds a tenth (D1 ×1.1, D4 ×1.4, measured
// the same day), so the page can show what each level of mob is worth.

/** What the completion pays, as a share of the experience the run's kills gave until then (measured, docs/formulas.md). */
export const CRAWL_REWARD_SHARE = 0.2
/** What each step of difficulty adds to every kill (D4 = ×1.4, measured). */
export const TIER_STEP = 0.1
/** A /con this long before a kill is of the mob killed: same-named mobs differ in level, so an older one says nothing. */
const CON_FRESH_MS = 60_000
/** A run this old is not the one being entered again. */
const RUN_STALE_MS = 6 * 3600_000
/** "Player Kelwyn creating instance Kedge Keep 453.", "Kelwyn has been added to Kedge Keep - Group.": the next instance entered is a new one. */
const NEW_INSTANCE = /^(?:Player .+ creating instance .+ \d+\.|.+ has been (?:added to|removed from) .+\.)$/
/** "Player Kelwyn creating instance Kedge Keep 453.": only the player makes one, so this names them. */
const CREATOR = /^Player (\S+) creating instance /
/** The player's own /who line, "[44 PAL/SHM/WIZ] Kelwyn (Dark Elf) <Guild> ZONE: Kedge Keep (kedge)": level, name. */
const WHO_LEVEL = /^\[(\d+) [A-Z]{3}(?:\/[A-Z]{3})*\] (\S+) \(/
/** A reincarnation's race rank (one a reincarnation): every class and the race start again at level 1. */
const REINCARNATED = /^You have (?:gained the ability "|improved )Race Reincarnation: /
/** "Nagafen's Lair 4 (Refined)", "Kedge Keep - Solo 1 (Awakened)": the difficulty is the number before the name in brackets. */
const TIER = / (\d+) \(\w+\)$/

/** The difficulty of an instance by its name: 0 for one without a number (D0, or the open zone). */
export const tierOf = (zone: string): number => Number(TIER.exec(zone)?.[1] ?? 0)

/** One run in an instance: from entering it until a new one is made, as the log shows it. */
export interface XpRun {
  /** The instance, as the log names it (a base instance has the zone's own name). */
  zone: string
  tier: number
  /** When the instance was entered. */
  startedAt: number
  /** The last kill that gave experience (startedAt before any). */
  lastAt: number
  /** When the game said the crawl was completed. */
  doneAt?: number
  /** Kills that gave experience. */
  kills: number
  /** What those kills gave, in percent of a level, added up (across a level gained, each in its own level's terms). */
  xp: number
  /** What the kills had given when the crawl was completed: what the reward is a fifth of. */
  xpDone?: number
  /** Levels gained during the run (joinXp: every log's level lines in time order). */
  levels?: number
  /** The player's level on entering, when a log has said it (joinXp). */
  level?: number
}

/** A level the log said, and when: gained ("Welcome to level"), else seen (the player's own /who, 1 on reincarnating). */
export type XpLevel = [at: number, level: number, gained: 0 | 1]

/** A kill /con'd just before it: when its experience came, the mob's level, and what it gave taken back to difficulty 0. */
export type XpKill = [at: number, mobLevel: number, worth: number]

/** What one stretch of log holds: its runs, and what reading it goes on with (a live log is read a piece at a time). */
export interface XpTally {
  /** Runs over and done with: a newer one was started after them. */
  runs: XpRun[]
  /** The latest run, which may go on. */
  open: XpRun | null
  /** The player is in the open run's instance. */
  inside: boolean
  /** The zone the player is in, for the difficulty of a kill outside a run. */
  zone: string
  /** An instance was just made (or the player added to one): the next one entered is new. */
  fresh: boolean
  /** The zone an instance was just made of, until entered: a base instance carries the zone's own name. */
  created: string
  /** The player's levels as this stretch's lines said them, in order. */
  levels: XpLevel[]
  /** The player's name, from an instance they made: what tells their own /who line from another's. */
  self: string
  /** The last experience gained, waiting for the kill line after it: percent, the difficulty, when. */
  pending: [number, number, number] | null
  /** /cons not yet matched to a kill, by mob: level, when. */
  cons: Record<string, [number, number]>
  /** The kills /con'd just before, in order: what each level of mob is worth (joinXp puts the player's level to them). */
  kills: XpKill[]
}

export const emptyXpTally = (): XpTally => ({ runs: [], open: null, inside: false, zone: '', fresh: false, created: '', levels: [], self: '', pending: null, cons: {}, kills: [] })

const newRun = (zone: string, at: number): XpRun => ({ zone, tier: tierOf(zone), startedAt: at, lastAt: at, kills: 0, xp: 0 })

/** A run that is neither completed nor long over: one a step outside and back goes on with. */
const going = (run: XpRun, at: number) => !run.doneAt && at - run.startedAt <= RUN_STALE_MS

/** Rounded as the log shows it, so adding many kills does not grow a tail of digits. */
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** One more line of a stretch of log, into its tally (a LogHistory consumer's reader). */
export function readXpLine(line: LogLine, t: XpTally): void {
  const { text, time: at } = line
  if (NEW_INSTANCE.test(text)) {
    t.fresh = true
    t.created = createdInstance(text) ?? ''
    t.self = CREATOR.exec(text)?.[1] ?? t.self
    return
  }
  if (text.startsWith('[')) {
    const m = WHO_LEVEL.exec(text)
    if (m && m[2] === t.self) t.levels.push([at, Number(m[1]), 0])
    return
  }
  if (REINCARNATED.test(text)) {
    t.levels.push([at, 1, 0])
    return
  }
  const entered = zoneEntered(text)
  if (entered) {
    const run = t.open
    // The zone's own name is an instance right after the line creating one of it, and again on stepping
    // back into the run in hand while it goes on; without either it is the open zone.
    const base = zoneKey(t.created) === zoneKey(entered) || (!t.fresh && run?.zone === entered && going(run, at))
    t.inside = isInstance(entered) || base
    t.zone = entered
    t.created = ''
    if (t.inside && (t.fresh || !run || run.zone !== entered || at - run.startedAt > RUN_STALE_MS)) {
      if (run?.kills) t.runs.push(run)
      t.open = newRun(entered, at)
    }
    t.fresh = false
    return
  }
  const run = t.inside ? t.open : null
  if (text.startsWith('You gain ')) {
    const m = EXPERIENCE.exec(text)
    if (!m?.[1]) return
    const pct = Number(m[1])
    t.pending = [pct, run ? run.tier : tierOf(t.zone), at]
    if (run) {
      run.kills++
      run.xp = round3(run.xp + pct)
      run.lastAt = at
    }
    return
  }
  if (text.startsWith('You have gained a level')) {
    const m = LEVEL_GAINED.exec(text)
    if (!m) return
    t.levels.push([at, Number(m[1]), 1])
    return
  }
  if (run && !run.doneAt && CRAWL_DONE.test(text)) {
    run.doneAt = at
    run.xpDone = run.xp
    return
  }
  if (text.endsWith(')') && text.includes('(Lvl: ')) {
    const c = CONSIDERED.exec(text)
    if (!c) return
    for (const [k, [, when]] of Object.entries(t.cons)) if (at - when > CON_FRESH_MS) delete t.cons[k]
    t.cons[mobKey(c[1])] = [Number(c[2]), at]
    return
  }
  if (text.startsWith('You have slain ')) {
    const m = SLAIN_BY_YOU.exec(text)
    const pending = t.pending
    t.pending = null
    if (!m || !pending) return
    const k = mobKey(m[1])
    const con = t.cons[k]
    delete t.cons[k]
    const [pct, tier, gainedAt] = pending
    if (!con || at - con[1] > CON_FRESH_MS) return
    t.kills.push([gainedAt, con[0], Math.round((pct / (1 + TIER_STEP * tier)) * 10_000) / 10_000])
  }
}

/** What the completion paid, worked out (CRAWL_REWARD_SHARE); 0 for a run not completed. */
export const runReward = (run: XpRun): number => (run.doneAt ? round3((run.xpDone ?? run.xp) * CRAWL_REWARD_SHARE) : 0)

/** How long a run took: to its completion, else to its last kill. */
export const runTime = (run: XpRun): number => (run.doneAt ?? run.lastAt) - run.startedAt

/** A run's experience with the reward, per hour of it; null for a run too short to say (under a minute). */
export function runPerHour(run: XpRun): number | null {
  const ms = runTime(run)
  return ms < 60_000 ? null : ((run.xp + runReward(run)) * 3_600_000) / ms
}

/** What a kill is worth at one player level: by mob level, at difficulty 0. */
export type XpValues = Record<number, Record<number, number>>

/** The player's level at a time, from every log's level lines in time order: the last said at or before it. */
function levelAt(levels: XpLevel[], at: number): number | undefined {
  let lo = 0
  let hi = levels.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (levels[mid][0] <= at) lo = mid + 1
    else hi = mid
  }
  return lo ? levels[lo - 1][1] : undefined
}

/**
 * Every stretch's runs as one list, newest first (a run open at the end of an archive is over), each
 * with the player's level and the levels gained, from every stretch's level lines together (a level
 * gained on another PC is in its log, not this one's); and what a kill of each level is worth at each
 * of the player's levels, the newest kill of each kept (a reincarnation since changes it). Another
 * PC's copy of a run or a line (both PCs' logs hold the same lines) is kept once.
 */
export function joinXp(tallies: XpTally[]): { runs: XpRun[]; values: XpValues; level: number | null } {
  const levels = tallies.flatMap((t) => t.levels).sort((a, b) => a[0] - b[0])
  const gained = levels.filter((l) => l[2])
  const seen = new Set<string>()
  const runs: XpRun[] = []
  for (const t of tallies)
    for (const r of [...t.runs, ...(t.open?.kills ? [t.open] : [])]) {
      const id = `${r.zone}|${r.startedAt}`
      if (seen.has(id)) continue
      seen.add(id)
      const level = levelAt(levels, r.startedAt)
      const end = r.doneAt ?? r.lastAt
      // Gained in the run: a level line twice in one second is one level, written by both PCs.
      const up = new Set(gained.filter(([at]) => at > r.startedAt && at <= end + 1000).map(([, l]) => `${l}`)).size
      runs.push({ ...r, levels: up, ...(level ? { level } : {}) })
    }
  runs.sort((a, b) => b.startedAt - a.startedAt)
  const values: XpValues = {}
  const when: Record<string, number> = {}
  for (const t of tallies)
    for (const [at, ml, worth] of t.kills) {
      // A kill in the second a level was gained may be the one that gained it, its experience split
      // across the two levels (the game prints the level line before or after it): worth nothing here.
      if (gained.some(([g]) => Math.abs(g - at) < 1000)) continue
      const pl = levelAt(levels, at)
      const k = `${pl}:${ml}`
      if (!pl || (when[k] ?? -1) > at) continue
      when[k] = at
      ;(values[pl] ??= {})[ml] = worth
    }
  return { runs, values, level: levels.at(-1)?.[1] ?? null }
}

/** What Motes › Crawl XP shows. */
export interface CrawlXpData {
  /** The runs, newest first. */
  runs: XpRun[]
  /** The run in hand, while the player is in its instance. */
  current: XpRun | null
  /** The player's level, as the logs last said it; null before one did. */
  level: number | null
  values: XpValues
}
