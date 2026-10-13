import type { AchSection } from '../../core/achievements'
import { zoneKey } from '../factions/names'
import { bareName, campZone } from '../slayer/core'
import { legendsSpawnsOf, type MobSpawn } from '../slayer/spawns'

// Plan › Hunter: the named each Hunter achievement ("Hunter of Befallen") still wants, zone by zone,
// with what classic's spawn tables say of each (its spots, how often it rolls, its timer: TAKP, in
// Legends' terms as the Slayer plan puts them, spawns.ts), the zones quickest to finish first. The
// achievements overlay shows the zone the player is in.

/** A named still wanted, and what its spawns allow. */
export interface HunterNamed {
  name: string
  spawn?: MobSpawn
  /** Seconds of clearing its spots, on average, before it pops: its timer over how many of it are up at once. */
  wait?: number
  /** A named of Legends' own, which TAKP's tables lack: the spots the player found, what it pops in place of, who said so. */
  legends?: { spots: number; ph?: string[]; said: string }
}

/** A Hunter achievement not done: its place, the named left, how many it wants in all. */
export interface HunterZone {
  zone: string
  achievement: string
  left: HunterNamed[]
  total: number
  /** Named the log has seen killed since the export, the export not knowing yet. */
  since: string[]
  /** The longest wait of the named left (they pop side by side); null when any is not in the tables. */
  wait: number | null
}

export interface HunterPlanData {
  character: string
  export: { file: string; modified: number } | null
  /** Not done, and not said not to work. */
  zones: HunterZone[]
  /** The Hunter achievements the player has said do not work in Legends: left out until they say they do. */
  broken: string[]
}

/** On average, how long its spots are cleared before the named pops: one up at once or more, a timer's worth. */
export const namedWait = (spawn: MobSpawn) => spawn.timer / Math.min(1, Math.max(spawn.up, 1e-6))

/** An objective that is another achievement: "Complete the achievement …", or a region's "Hunter of Crushbone". */
const LINK = /^(?:\(Optional\)\s*)?(?:Complete the achievement |Hunter of )/i

/**
 * Each Hunter achievement not done, with the named it still wants: the export's open objectives, less
 * those killed since the export (`killedAt`, by a name as the log gives it: 0 for never). `spawnsOf`
 * gives a place's mobs as the spawn tables have them, by bareName; null for a place they lack.
 */
export function hunterZones(
  sections: AchSection[],
  killedAt: (bare: string) => number,
  exportAt: number,
  spawnsOf: (zone: string) => ReadonlyMap<string, MobSpawn> | null = () => null
): HunterZone[] {
  const out: HunterZone[] = []
  for (const sec of sections)
    for (const a of sec.ach) {
      // "Hunter of The Ruins of Old Paineel or The Hole": the zone Legends has is the first.
      const zone = /^Hunter of (.+)$/i.exec(a.n)?.[1].split(/\s+or\s+/)[0]
      if (!zone || a.d) continue
      const named = a.c.filter((c) => !c.o && !LINK.test(c.t))
      const open = named.filter((c) => !c.d)
      const since = open.filter((c) => killedAt(bareName(c.t)) > exportAt).map((c) => c.t)
      const known = spawnsOf(zone)
      const left = open
        .filter((c) => !since.includes(c.t))
        .map((c) => {
          const spawn = known?.get(bareName(c.t))
          if (spawn) return { name: c.t, spawn, wait: namedWait(spawn) }
          const own = legendsSpawnsOf(zone, [c.t])[0]
          return own ? { name: c.t, legends: { spots: own.spots.length, ...(own.ph ? { ph: own.ph } : {}), said: own.said } } : { name: c.t }
        })
      if (!left.length) continue
      const waits = left.map((n) => n.wait)
      out.push({ zone, achievement: a.n, left, total: named.length, since, wait: waits.every((w) => w !== undefined) ? Math.max(...(waits as number[])) : null })
    }
  // The quickest to finish first; those the tables cannot time after, the fewest left first.
  return out.sort((a, b) => (a.wait ?? Infinity) - (b.wait ?? Infinity) || a.left.length - b.left.length || a.zone.localeCompare(b.zone))
}

/** The Hunter achievements of the zone the player is in, for the overlay. */
export function hunterHere(zones: HunterZone[], zone: string): HunterZone[] {
  const k = zoneKey(campZone(zone))
  return k ? zones.filter((z) => zoneKey(z.zone) === k) : []
}
