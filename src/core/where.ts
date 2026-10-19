import { num } from './format'

// Where the player is, from the game's /loc (FEAT-023): "Your Location is 661.88, -301.44, -40.42",
// y then x then z, as /waypoint takes them. The game's map files draw a point at (-x, -y), so on a
// map north is up (-y) and east is right (+x).

/** "Your Location is -158.74, 646.67, -25.66": y, x, z. */
const YOUR_LOCATION = /^Your Location is (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)$/

/** A /loc as the game prints it. */
export interface Loc {
  y: number
  x: number
  z: number
}

/** A point as the game's map files draw it. */
export interface MapPoint {
  x: number
  y: number
}

export function parseLoc(text: string): Loc | null {
  if (!text.startsWith('Your Location is ')) return null
  const m = YOUR_LOCATION.exec(text)
  return m ? { y: Number(m[1]), x: Number(m[2]), z: Number(m[3]) } : null
}

/** A /loc where the map draws it. */
export const locPoint = (l: Pick<Loc, 'x' | 'y'>): MapPoint => ({ x: -l.x, y: -l.y })

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** How far a map point is from another, and which way, in eight points of the compass. */
export function bearing(from: MapPoint, to: MapPoint): { dist: number; dir: string } {
  const east = to.x - from.x
  const north = from.y - to.y
  const deg = (Math.atan2(east, north) * 180) / Math.PI
  return { dist: Math.round(Math.hypot(east, north)), dir: DIRS[(Math.round(deg / 45) + 8) % 8] }
}

/** The nearest of these map points, how far and which way; null for none. */
export function nearest(from: MapPoint, spots: MapPoint[]): { spot: MapPoint; dist: number; dir: string } | null {
  let best: { spot: MapPoint; dist: number; dir: string } | null = null
  for (const spot of spots) {
    const b = bearing(from, spot)
    if (!best || b.dist < best.dist) best = { spot, ...b }
  }
  return best
}

/** "≈ 320 to the north-east (your /loc 4 min ago)": the nearest spot, as the overlay says it. */
export function nearText(n: { dist: number; dir: string }, locAt: number, now: number): string {
  const mins = Math.max(0, Math.round((now - locAt) / 60_000))
  return `≈ ${num(n.dist)} to the ${n.dir} (your /loc ${mins ? `${mins} min ago` : 'just now'})`
}
