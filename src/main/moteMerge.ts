import { MOTE_RANKS, MoteTracker, type MoteCounts, type MoteSession, type MoteState } from '../core/motes'
import type { CharacterScan, MoteScanResult } from './moteHistory'

// Mote history is one record across characters: live tracking keeps whichever character's log is
// being watched. A rebuild reads every character's logs, so its result is merged into what is kept
// rather than replacing it: sessions the logs no longer hold (a deleted log, a manual session) stay.

export interface RebuiltMotes {
  sessions: MoteSession[]
  daily: Record<string, MoteCounts>
  /** Days the logs read have any line on: for those days the logs' counts are the truth. */
  days: string[]
  active: MoteSession | null
}

/**
 * Puts each character's rebuilt history together. Runs still open are closed as of each log's last
 * line, except the watched character's while the game is running: that one may still be going.
 */
export function combineScans(scan: MoteScanResult, watchedLog: string, gameRunning: boolean): RebuiltMotes {
  const sessions: MoteSession[] = []
  const daily: Record<string, MoteCounts> = {}
  let active: MoteSession | null = null
  for (const c of scan.characters) {
    const watched = samePath(c.logPath, watchedLog)
    const state = closeOpenRun(c, !(watched && gameRunning))
    sessions.push(...state.sessions)
    if (watched) active = state.active
    for (const [day, counts] of Object.entries(state.daily)) {
      const into = (daily[day] ??= {})
      for (const r of MOTE_RANKS) if (counts[r.key]) into[r.key] = (into[r.key] ?? 0) + counts[r.key]!
    }
  }
  return { sessions, daily, days: scan.days, active }
}

function closeOpenRun(c: CharacterScan, close: boolean): MoteState {
  const a = c.state.active
  if (!close || !a || a.kind === 'manual') return c.state
  const t = new MoteTracker(c.state, { onChange: () => {} })
  t.gameClosed(c.lastTime)
  return t.state
}

/**
 * Merges a rebuild into the kept history. A rebuilt run replaces any kept run of the same instance
 * that overlaps it in time; kept runs nothing rebuilt overlaps, and every manual session, stay.
 * Days the logs cover take the logs' counts; other days keep theirs. Merging the same rebuild
 * twice gives the same history.
 */
export function mergeRebuilt(current: MoteState, rebuilt: RebuiltMotes): MoteState {
  const overlaps = (a: MoteSession, b: MoteSession) =>
    a.name === b.name && a.startedAt <= (b.endedAt ?? Infinity) && b.startedAt <= (a.endedAt ?? Infinity)
  const fresh = rebuilt.active ? [...rebuilt.sessions, rebuilt.active] : rebuilt.sessions
  const known = (s: MoteSession) => fresh.some((r) => overlaps(r, s))
  const kept = current.sessions.filter((s) => s.kind === 'manual' || !known(s))
  const sessions = [...rebuilt.sessions, ...kept].sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))

  const covered = new Set(rebuilt.days)
  const daily: Record<string, MoteCounts> = {}
  for (const [day, counts] of Object.entries(current.daily)) if (!covered.has(day)) daily[day] = counts
  for (const [day, counts] of Object.entries(rebuilt.daily)) daily[day] = counts

  // A manual session is the player's own doing; it keeps running over the rebuilt history.
  const a = current.active
  const active = a?.kind === 'manual' ? a : (rebuilt.active ?? (a && !known(a) ? a : null))
  return { ...current, active, sessions, daily }
}

export function samePath(a: string, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase()
}
