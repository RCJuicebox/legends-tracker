import { placeZones, type AchSection } from '../../core/achievements'
import type { SlayerKills } from '../../core/slayer'
import type { HunterTrackView } from '../../shared/tracking'
import type { Seen } from '../../core/respawnSeen'
import { zoneKey } from '../../core/zones'
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
  /** What the Respawns records say of it: when it last died and whether it is back (seenOf); undefined where the log never saw it die. */
  seen?: string
  /** Seconds until it is due back by those records: 0 when it is (LT-733); undefined where they say nothing. */
  dueIn?: number
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
  /** Seconds until the first named left is up, by the Respawns records: 0 when one is up or nothing says it is down (LT-733). */
  dueIn: number
}

export interface HunterPlanData {
  character: string
  export: { file: string; modified: number } | null
  /** Not done, and not said not to work. */
  zones: HunterZone[]
  /** The Hunter achievements the player has said do not work in Legends: left out until they say they do. */
  broken: string[]
  /** A named still wanted that dies in your zone starts its respawn timer by itself (FEAT-038). */
  autoTimers: boolean
}

/**
 * The named a kill should start a timer for (FEAT-038): each one still wanted in the zone, by bare
 * name, with how long it takes, what the log timed before the tables. One with no length is left out.
 */
export function wantedTimers(rows: readonly { left: readonly string[] }[], length: (name: string) => number | null): Map<string, { name: string; seconds: number }> {
  const out = new Map<string, { name: string; seconds: number }>()
  for (const r of rows)
    for (const name of r.left) {
      const seconds = length(name)
      if (seconds && seconds > 0) out.set(bareName(name), { name, seconds })
    }
  return out
}

/**
 * On average, how long its spots are cleared before the named pops: its timer over how often it is
 * up. One always up (an orc trainer at every spot) waits nothing: the first kill is there for the
 * taking, and only the next waits a timer (LT-671).
 */
export const namedWait = (spawn: MobSpawn) => (spawn.up >= 1 ? 0 : spawn.timer / Math.max(spawn.up, 1e-6))

/** An objective that is another achievement: "Complete the achievement …", or a region's "Hunter of Crushbone". */
const LINK = /^(?:\(Optional\)\s*)?(?:Complete the achievement |(?:Hunter|Conqueror) of )/i

/**
 * "Hunter of Befallen", and Raids' "Conqueror of The Plane of Fear": named mobs in a place, which the
 * tables, the Respawns records and the maps treat alike (LT-731). "Hunter of The Ruins of Old Paineel
 * or The Hole": the zone Legends has is the first.
 */
const PLACE = /^(?:Hunter|Conqueror) of (.+)$/i

/**
 * Each Hunter achievement not done, with the named it still wants: the export's open objectives, less
 * those killed since the export (`killedAt`, by a name as the log gives it: 0 for never). `spawnsOf`
 * gives a place's mobs as the spawn tables have them, by bareName; null for a place they lack.
 */
export function hunterZones(
  sections: AchSection[],
  killedAt: (bare: string) => number,
  exportAt: number,
  spawnsOf: (zone: string) => ReadonlyMap<string, MobSpawn> | null = () => null,
  /** What the Respawns records say of a named in a zone (seenOf); none without records. */
  seenOf: (zone: string, name: string, timer: number | undefined) => Seen | undefined = () => undefined,
  /** Keeps an achievement whose named were all killed since the export, with none left: the Live page says they died. */
  keepKilled = false
): HunterZone[] {
  const out: HunterZone[] = []
  for (const sec of sections)
    for (const a of sec.ach) {
      const zone = PLACE.exec(a.n)?.[1].split(/\s+or\s+/)[0]
      if (!zone || a.d) continue
      const named = a.c.filter((c) => !c.o && !LINK.test(c.t))
      const open = named.filter((c) => !c.d)
      const since = open.filter((c) => killedAt(bareName(c.t)) > exportAt).map((c) => c.t)
      const known = spawnsOf(zone)
      const left = open
        .filter((c) => !since.includes(c.t))
        .map((c): HunterNamed => {
          const spawn = known?.get(bareName(c.t))
          const seen = seenOf(zone, c.t, spawn?.timer)
          const with_ = seen ? { seen: seen.text, ...(seen.dueIn !== undefined ? { dueIn: seen.dueIn } : {}) } : {}
          if (spawn) return { name: c.t, spawn, wait: namedWait(spawn), ...with_ }
          const own = legendsSpawnsOf(zone, [c.t])[0]
          return own ? { name: c.t, legends: { spots: own.spots.length, ...(own.ph ? { ph: own.ph } : {}), said: own.said }, ...with_ } : { name: c.t, ...with_ }
        })
      if (!left.length && !(keepKilled && since.length)) continue
      // The zone takes as long as its longest wait: the named not up pop side by side, those up wait nothing.
      const waits = left.map((n) => n.wait)
      // Up now unless the records say it died and is not back: the zone is due when its first named is.
      const dueIn = left.length ? Math.min(...left.map((n) => n.dueIn ?? 0)) : 0
      out.push({ zone, achievement: a.n, left, total: named.length, since, wait: waits.every((w) => w !== undefined) ? Math.max(0, ...(waits as number[])) : null, dueIn })
    }
  // What is up now first (a zone whose named died two minutes ago sinks until it is due, LT-733); then
  // the quickest to finish; those the tables cannot time after, the fewest left first.
  return out.sort((a, b) => a.dueIn - b.dueIn || (a.wait ?? Infinity) - (b.wait ?? Infinity) || a.left.length - b.left.length || a.zone.localeCompare(b.zone))
}

/** The Hunter achievements of the zone the player is in, for the overlay. */
export function hunterHere(zones: HunterZone[], zone: string): HunterZone[] {
  const k = zoneKey(campZone(zone))
  return k ? zones.filter((z) => zoneKey(z.zone) === k) : []
}

/**
 * Whether a Hunter achievement answers a search: every word typed is found in its zone, its name or a
 * named still wanted, any case ("west karana" finds The Western Plains of Karana).
 */
export function hunterMatch(z: Pick<HunterZone, 'zone' | 'achievement' | 'left'>, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const text = [z.zone, z.achievement, ...z.left.map((n) => n.name)].join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

/**
 * The Hunter named left in the zone the player is in, for the achievements overlay: the export's, less
 * those the live counts have seen killed since (`kills`, by lower-cased mob), each with what the
 * Respawns records say of it (`seenOf`); less the achievements the player has said do not work. One
 * whose last named died since the export stays, with none left, so the Live page can say so. Null
 * outside a Hunter zone, or with nothing open there.
 */
export function hunterLive(
  sections: AchSection[],
  exportAt: number,
  zone: string,
  kills: SlayerKills | undefined,
  seenOf: (zone: string, name: string, timer: number | undefined) => Seen | undefined,
  isBroken: (achievement: string) => boolean,
  /** How far and which way the nearest spot of a named is, from the player's last /loc here; undefined without one. */
  near: (name: string) => string | undefined = () => undefined
): HunterTrackView | null {
  if (!zone) return null
  // Only kills here count: a same-named mob elsewhere is another zone's named (LT-520).
  const here = placeZones(zone)
  const last = new Map<string, number>()
  for (const k of kills?.values() ?? []) {
    const b = bareName(k.name)
    k.times.forEach((t, i) => {
      const z = k.zones?.[i]
      if ((!z || here.has(zoneKey(z))) && t > (last.get(b) ?? 0)) last.set(b, t)
    })
  }
  const rows = hunterHere(
    hunterZones(
      sections,
      (bare) => last.get(bare) ?? 0,
      exportAt,
      () => null,
      seenOf,
      true
    ),
    zone
  ).filter((r) => !isBroken(r.achievement))
  return rows.length
    ? {
        zone,
        rows: rows.map((r) => {
          const seen = Object.fromEntries(r.left.flatMap((n) => (n.seen ? [[n.name, n.seen]] : [])))
          const far = Object.fromEntries(
            r.left.flatMap((n) => {
              const t = near(n.name)
              return t ? [[n.name, t]] : []
            })
          )
          return {
            achievement: r.achievement,
            left: r.left.map((n) => n.name),
            total: r.total,
            since: r.since,
            ...(r.since.length ? { killed: Object.fromEntries(r.since.map((n) => [n, last.get(bareName(n)) ?? 0])) } : {}),
            ...(Object.keys(seen).length ? { seen } : {}),
            ...(Object.keys(far).length ? { near: far } : {})
          }
        })
      }
    : null
}
