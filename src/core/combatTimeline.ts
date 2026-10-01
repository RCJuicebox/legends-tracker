import type { Segment, StitchedTimeline } from '../shared/types'

// A fight's damage second by second, for the meter's chart: yours, your pet's, the rest of your
// side's, and what hit you. A session's chart is its fights end to end.

/** A fight's per-second timeline stops growing past an hour. */
const TIMELINE_MAX = 3600
/** Quiet seconds between two fights in a session's chart. */
const STITCH_GAP_SEC = 3

export type Lane = keyof NonNullable<Segment['timeline']>

/** Adds damage to its second on a fight's timeline (a session has none). */
export function book(seg: Segment, at: number, lane: Lane, amount: number): void {
  if (!seg.timeline) return
  const b = Math.floor((at - seg.startedAt) / 1000)
  if (b >= 0 && b < TIMELINE_MAX) seg.timeline[lane][b] = (seg.timeline[lane][b] ?? 0) + amount
}

/**
 * Fights' timelines end to end, oldest first, with a few quiet seconds between them, so a chart shows
 * the fighting and not the minutes between pulls; where each fight begins is marked.
 */
export function stitch(fights: Segment[]): StitchedTimeline {
  const out: StitchedTimeline = { you: [], pet: [], group: [], inc: [], marks: [] }
  const keys = ['you', 'pet', 'group', 'inc'] as const
  for (const f of [...fights].filter((x) => x.timeline).sort((a, b) => a.startedAt - b.startedAt)) {
    const tl = f.timeline!
    if (out.you.length) for (const k of keys) out[k].push(...new Array<number>(STITCH_GAP_SEC).fill(0))
    out.marks.push({ at: out.you.length, name: f.name })
    // A fight's timeline has holes for its quiet seconds.
    const len = Math.max(...keys.map((k) => tl[k].length))
    for (const k of keys) for (let i = 0; i < len; i++) out[k].push(tl[k][i] ?? 0)
  }
  return out
}
