import type { LogLine } from './logLine'

// A character's progression, from the lines the game writes about it:
//   You have gained a level! Welcome to level 44!          (older wording: "You have reached level 44")
//   You LOST a level! You are now level 43!
//   You have become better at Dual Wield! (152)
//   You have improved Burst of Power 2 at a cost of 6 ability points.
//   You have gained the ability "Burst of Power" at a cost of 3 ability points.
//   You have gained an ability point!  You now have 11 ability points.
//   You have gained 2 ability point(s)!  You now have 4 ability point(s).
//   You have reached the AA point cap, and cannot gain any further experience until …
//   You gain experience!          You gain experience! (0.051%)
//   You gain party experience!    You gain party experience! (0.090%)
//   You gained reward experience from the Dungeon Crawl!
//   You receive no experience for defeating this creature as you are in a raid.
// EQL prints no experience amounts. Some experience lines end with a percentage (of a level, going by
// the logs: a level's lines add up to about 100%), many do not, so "experience" here is how many
// lines said so, and the percentages are only ever the sum of those printed. A level line never names
// the class, and EQL levels each class on its own. Each stretch of log (an archive, the live log) is
// tallied on its own and the tallies joined oldest first, as factions are.

export type ProgressLine =
  | { kind: 'level'; level: number; lost: boolean }
  | { kind: 'skill'; skill: string; value: number }
  | { kind: 'aa'; name: string; rank: number | null; cost: number }
  | { kind: 'points'; gained: number; total: number }
  | { kind: 'aaCap' }
  | { kind: 'xp'; source: XpSource; pct: number | null }
  | { kind: 'noXp' }

/** Experience from a kill of your own, a group's kill, or a reward (the Dungeon Crawl's). */
export type XpSource = 'solo' | 'party' | 'reward'

const LEVEL = /^You have (?:gained a level! Welcome to|reached) level (\d+)/
const LOST = /^You LOST a level! You are now level (\d+)!/
const SKILL = /^You have become better at (.+)! \((\d+)\)$/
const IMPROVED = /^You have improved (.+) (\d+) at a cost of (\d+) ability points?\.$/
const NEW_AA = /^You have gained the ability "(.+)" at a cost of (\d+) ability points?\.$/
const POINTS = /^You have gained (an|\d+) ability point(?:\(s\)|s)?!\s+You now have (\d+) ability point/
const XP = /^You gain (party )?experience!(?: \((\d+(?:\.\d+)?)%\))?$/
const REWARD = /^You gained reward experience\b/
const NO_XP = /^You receive no experience\b/

/** A progression line's meaning, or null for any other line. */
export function parseProgressLine(text: string): ProgressLine | null {
  if (!text.startsWith('You ')) return null
  let m = XP.exec(text)
  if (m) return { kind: 'xp', source: m[1] ? 'party' : 'solo', pct: m[2] !== undefined ? parseFloat(m[2]) : null }
  if ((m = SKILL.exec(text))) return { kind: 'skill', skill: m[1], value: parseInt(m[2], 10) }
  if ((m = POINTS.exec(text))) return { kind: 'points', gained: m[1] === 'an' ? 1 : parseInt(m[1], 10), total: parseInt(m[2], 10) }
  if ((m = IMPROVED.exec(text))) return { kind: 'aa', name: m[1], rank: parseInt(m[2], 10), cost: parseInt(m[3], 10) }
  if ((m = NEW_AA.exec(text))) return { kind: 'aa', name: m[1], rank: null, cost: parseInt(m[2], 10) }
  if ((m = LEVEL.exec(text))) return { kind: 'level', level: parseInt(m[1], 10), lost: false }
  if ((m = LOST.exec(text))) return { kind: 'level', level: parseInt(m[1], 10), lost: true }
  if (REWARD.test(text)) return { kind: 'xp', source: 'reward', pct: null }
  if (NO_XP.test(text)) return { kind: 'noXp' }
  if (text.startsWith('You have reached the AA point cap') || text.startsWith('You must spend some of your ability points')) return { kind: 'aaCap' }
  return null
}

/** Lines further apart than this are two sessions of play. */
export const SESSION_GAP_MS = 30 * 60_000

/** One sitting: log lines no more than SESSION_GAP_MS apart, and what they recorded. */
export interface ProgressSession {
  /** The first and last line of any kind. */
  start: number
  end: number
  /** Experience lines, by where the experience came from. */
  solo: number
  party: number
  reward: number
  /** How many experience lines printed a percentage, and those percentages added up. */
  pctLines: number
  pct: number
  /** Kills that gave none ("as you are in a raid"). */
  noXp: number
  /** Ability points the "You have gained … ability point" lines gave. */
  aaPoints: number
  /** Ability purchases, and the points they cost. */
  aaBought: number
  aaSpent: number
  levels: number
  skillUps: number
}

export interface LevelEvent {
  at: number
  level: number
  /** "You LOST a level!": `level` is the one gone back to. */
  lost: boolean
}

export interface SkillTally {
  /** As the log last wrote it. */
  name: string
  /** The value the last skill-up gave. */
  value: number
  ups: number
  first: number
  last: number
}

export interface AaPurchase {
  at: number
  name: string
  /** The rank bought; null for a first rank bought as "You have gained the ability …". */
  rank: number | null
  cost: number
}

/** A stretch of log's progression. */
export interface ProgressTally {
  /** Oldest first. */
  levels: LevelEvent[]
  /** By lower-cased skill name. */
  skills: Record<string, SkillTally>
  /** Oldest first. */
  purchases: AaPurchase[]
  /** The last "You now have N ability points", and when. */
  points: { at: number; total: number } | null
  /** The last time the game said the AA point pool was full; 0 for never. */
  capAt: number
  /** Oldest first. */
  sessions: ProgressSession[]
}

export const emptyProgress = (): ProgressTally => ({ levels: [], skills: {}, purchases: [], points: null, capAt: 0, sessions: [] })

const blankSession = (at: number): ProgressSession => ({
  start: at,
  end: at,
  solo: 0,
  party: 0,
  reward: 0,
  pctLines: 0,
  pct: 0,
  noXp: 0,
  aaPoints: 0,
  aaBought: 0,
  aaSpent: 0,
  levels: 0,
  skillUps: 0
})

/** Reads one line into a stretch's tally. Every line counts toward the sessions; only progression lines toward the rest. */
export function addProgressLine(into: ProgressTally, line: LogLine): void {
  let s = into.sessions[into.sessions.length - 1]
  if (!s || line.time - s.end >= SESSION_GAP_MS) into.sessions.push((s = blankSession(line.time)))
  // A line stamped a little earlier (the hour the clocks go back) stays in the session it follows.
  else s.end = Math.max(s.end, line.time)

  const p = parseProgressLine(line.text)
  if (!p) return
  switch (p.kind) {
    case 'xp':
      s[p.source]++
      if (p.pct !== null) {
        s.pctLines++
        s.pct += p.pct
      }
      return
    case 'noXp':
      s.noXp++
      return
    case 'skill': {
      const k = p.skill.toLowerCase()
      const t = (into.skills[k] ??= { name: p.skill, value: p.value, ups: 0, first: line.time, last: line.time })
      t.name = p.skill
      t.value = p.value
      t.ups++
      t.first = Math.min(t.first, line.time)
      t.last = Math.max(t.last, line.time)
      s.skillUps++
      return
    }
    case 'level':
      into.levels.push({ at: line.time, level: p.level, lost: p.lost })
      if (!p.lost) s.levels++
      return
    case 'aa':
      into.purchases.push({ at: line.time, name: p.name, rank: p.rank, cost: p.cost })
      s.aaBought++
      s.aaSpent += p.cost
      return
    case 'points':
      into.points = { at: line.time, total: p.total }
      s.aaPoints += p.gained
      return
    case 'aaCap':
      into.capAt = line.time
  }
}

const SESSION_SUMS = ['solo', 'party', 'reward', 'pctLines', 'pct', 'noXp', 'aaPoints', 'aaBought', 'aaSpent', 'levels', 'skillUps'] as const

/** Two sessions as one, `b` being the later. */
function joinSession(a: ProgressSession, b: ProgressSession): ProgressSession {
  const s = { ...a, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
  for (const k of SESSION_SUMS) s[k] = a[k] + b[k]
  return s
}

/** Two stretches' tallies as one, `b` being the later. */
function join(a: ProgressTally, b: ProgressTally): ProgressTally {
  const skills: Record<string, SkillTally> = { ...a.skills }
  for (const [k, t] of Object.entries(b.skills)) {
    const e = skills[k]
    skills[k] = e ? { name: t.name, value: t.value, ups: e.ups + t.ups, first: Math.min(e.first, t.first), last: Math.max(e.last, t.last) } : t
  }
  // A session cut in two where one stretch ends and the next begins is one session.
  const sessions = [...a.sessions]
  const [head, ...rest] = b.sessions
  const tail = sessions[sessions.length - 1]
  if (head && tail && head.start - tail.end < SESSION_GAP_MS) sessions[sessions.length - 1] = joinSession(tail, head)
  else if (head) sessions.push(head)
  sessions.push(...rest)
  return {
    levels: [...a.levels, ...b.levels],
    skills,
    purchases: [...a.purchases, ...b.purchases],
    points: b.points ?? a.points,
    capAt: Math.max(a.capAt, b.capAt),
    sessions
  }
}

/** Stretches' tallies as one, given oldest first. */
export function joinProgress(stretches: ProgressTally[]): ProgressTally {
  return stretches.reduce(join, emptyProgress())
}

// ---- The page's view ----

/** A session this long or longer gets per-hour rates; a shorter one's would mislead. */
export const RATE_MIN_MS = 10 * 60_000

const WEEK_MS = 7 * 86_400_000

export interface SessionRow extends ProgressSession {
  /** Experience lines of every kind. */
  xp: number
  /** Per hour of the session, or null for one under RATE_MIN_MS. */
  xpPerHour: number | null
  aaPerHour: number | null
}

/**
 * A run of level-ups one after another (11, 12, 13 …), most likely one class: a level-up joins the
 * run it follows on from, else starts one. The log never names the class, so this is a guess.
 */
export interface LevelRun {
  from: number
  to: number
  first: number
  last: number
  count: number
}

export interface LevelRow extends LevelEvent {
  /** Which run it joined, by its place in `runs`. */
  run: number
}

export interface PointsNow {
  /** The last total the game reported, and when. */
  total: number
  at: number
  /** Points spent on purchases since that report. */
  spentSince: number
  /** The total less what was spent since: what should be left. */
  unspent: number
  /** The game last said the pool was full, with nothing bought since. */
  atCap: boolean
}

export interface ProgressionView {
  /** Newest first. */
  levels: LevelRow[]
  /** Most recently raised first. */
  runs: LevelRun[]
  highest: number | null
  skills: SkillTally[]
  /** Newest first. */
  purchases: AaPurchase[]
  points: PointsNow | null
  /** Newest first. */
  sessions: SessionRow[]
  /** Sessions begun in the last seven days, added up. */
  week: { sessions: number; xp: number; aaPoints: number; levels: number; skillUps: number }
}

function levelRuns(levels: LevelEvent[]): { runs: LevelRun[]; rows: LevelRow[] } {
  const runs: LevelRun[] = []
  const rows: LevelRow[] = []
  for (const e of levels) {
    // The run most recently raised that this level follows on from (or, for a level lost, steps back from).
    let i = -1
    let best = -Infinity
    runs.forEach((r, j) => {
      if ((e.lost ? r.to === e.level + 1 : r.to === e.level - 1) && r.last >= best) {
        best = r.last
        i = j
      }
    })
    if (i < 0) {
      i = runs.length
      runs.push({ from: e.level, to: e.level, first: e.at, last: e.at, count: e.lost ? 0 : 1 })
    } else {
      const r = runs[i]
      r.to = e.level
      r.last = e.at
      if (!e.lost) r.count++
    }
    rows.push({ ...e, run: i })
  }
  return { runs, rows }
}

export function progressionView(t: ProgressTally, now: number): ProgressionView {
  const { runs, rows } = levelRuns(t.levels)
  const order = runs.map((r, i) => ({ r, i })).sort((a, b) => b.r.last - a.r.last)
  const place = new Map(order.map((o, k) => [o.i, k]))
  const levels = rows.map((l) => ({ ...l, run: place.get(l.run)! })).reverse()
  const gained = t.levels.filter((l) => !l.lost).map((l) => l.level)

  let points: PointsNow | null = null
  if (t.points) {
    const since = t.purchases.filter((p) => p.at >= t.points!.at)
    const spentSince = since.reduce((n, p) => n + p.cost, 0)
    const lastBuy = t.purchases.length ? t.purchases[t.purchases.length - 1].at : 0
    points = { total: t.points.total, at: t.points.at, spentSince, unspent: Math.max(0, t.points.total - spentSince), atCap: t.capAt > 0 && t.capAt >= lastBuy }
  }

  const sessions = t.sessions
    .map((s): SessionRow => {
      const xp = s.solo + s.party + s.reward
      const ms = s.end - s.start
      const hours = ms / 3_600_000
      return { ...s, xp, xpPerHour: ms >= RATE_MIN_MS ? xp / hours : null, aaPerHour: ms >= RATE_MIN_MS ? s.aaPoints / hours : null }
    })
    .reverse()
  const week = { sessions: 0, xp: 0, aaPoints: 0, levels: 0, skillUps: 0 }
  for (const s of sessions) {
    if (s.start < now - WEEK_MS) break
    week.sessions++
    week.xp += s.xp
    week.aaPoints += s.aaPoints
    week.levels += s.levels
    week.skillUps += s.skillUps
  }

  return {
    levels,
    runs: order.map((o) => o.r),
    highest: gained.length ? Math.max(...gained) : null,
    skills: Object.values(t.skills).sort((a, b) => b.last - a.last || a.name.localeCompare(b.name)),
    purchases: [...t.purchases].reverse(),
    points,
    sessions,
    week
  }
}
