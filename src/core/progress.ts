import type { AchievementProgress, ExportSnapshot } from '../shared/ipc'

// Achievements › Progress over time (FEAT-032): the arithmetic of its weeks and exports.

const WEEKS = 12
const WEEK_MS = 7 * 86_400_000

/** The completions of each of the last WEEKS weeks, the newest first, a week ending today. */
export function weeksOf(completions: AchievementProgress['completions'], now: number): { from: number; n: number }[] {
  const end = new Date(now)
  end.setHours(24, 0, 0, 0)
  return Array.from({ length: WEEKS }, (_, i) => {
    const to = end.getTime() - i * WEEK_MS
    const from = to - WEEK_MS
    return { from, n: completions.filter((c) => c.at >= from && c.at < to).length }
  })
}

/** An export against the one before it: achievements done since, Slayer kills it counted since, and the sections that moved most. */
export function exportChange(s: ExportSnapshot, before: ExportSnapshot | undefined): { done: number; slayer: number; sections: [string, number][] } {
  if (!before) return { done: 0, slayer: 0, sections: [] }
  let slayer = 0
  for (const [name, n] of Object.entries(s.slayer)) slayer += Math.max(0, n - (before.slayer[name] ?? 0))
  const sections = Object.entries(s.done)
    .map(([k, n]): [string, number] => [k, n - (before.done[k] ?? 0)])
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  return { done: s.total - before.total, slayer, sections }
}
