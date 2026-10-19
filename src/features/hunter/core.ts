import type { AchSection } from '../../core/achievements'
import type { SlayerKills } from '../../core/slayer'
import type { HunterTrackView } from '../../shared/tracking'
import { duration } from '../../core/format'
import { respawnEstimate, type RespawnRecord } from '../../core/respawns'
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
  /** What the Respawns records say of it: when it last died and whether it is back (seenText); undefined where the log never saw it die. */
  seen?: string
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

/**
 * On average, how long its spots are cleared before the named pops: its timer over how often it is
 * up. One always up (an orc trainer at every spot) waits nothing: the first kill is there for the
 * taking, and only the next waits a timer (LT-671).
 */
export const namedWait = (spawn: MobSpawn) => (spawn.up >= 1 ? 0 : spawn.timer / Math.max(spawn.up, 1e-6))

/**
 * What the Respawns records say of a named, in a few words: "died 6 min ago; back in ~2 min as you
 * timed it" while it is still down, "down 11 min, due" past its time, "died 40 min ago, seen since"
 * once the log saw it again. `timer` is the tables' respawn, where the log has not timed it (LT-670).
 */
export function seenText(r: Pick<RespawnRecord, 'lastDeath' | 'pendingSince' | 'gaps'> | undefined, timer: number | undefined, now: number): string | undefined {
  if (!r || !r.lastDeath) return undefined
  const ago = `died ${duration(Math.max(0, now - r.lastDeath) / 1000)} ago`
  if (!r.pendingSince) return `${ago}, seen since`
  const down = Math.max(0, now - r.pendingSince) / 1000
  const timed = respawnEstimate(r)
  const due = timed ?? timer
  if (due === undefined) return `${ago}, still down`
  if (down >= due) return `down ${duration(down)}, due`
  return `${ago}; back in ~${duration(due - down)} ${timed !== null ? 'as you timed it' : 'by the tables'}`
}

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
  spawnsOf: (zone: string) => ReadonlyMap<string, MobSpawn> | null = () => null,
  /** What the Respawns records say of a named in a zone, in a few words (seenText); none without records. */
  seenOf: (zone: string, name: string, timer: number | undefined) => string | undefined = () => undefined
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
        .map((c): HunterNamed => {
          const spawn = known?.get(bareName(c.t))
          const seen = seenOf(zone, c.t, spawn?.timer)
          const with_ = seen ? { seen } : {}
          if (spawn) return { name: c.t, spawn, wait: namedWait(spawn), ...with_ }
          const own = legendsSpawnsOf(zone, [c.t])[0]
          return own ? { name: c.t, legends: { spots: own.spots.length, ...(own.ph ? { ph: own.ph } : {}), said: own.said }, ...with_ } : { name: c.t, ...with_ }
        })
      if (!left.length) continue
      // The zone takes as long as its longest wait: the named not up pop side by side, those up wait nothing.
      const waits = left.map((n) => n.wait)
      out.push({ zone, achievement: a.n, left, total: named.length, since, wait: waits.every((w) => w !== undefined) ? Math.max(0, ...(waits as number[])) : null })
    }
  // The quickest to finish first; those the tables cannot time after, the fewest left first.
  return out.sort((a, b) => (a.wait ?? Infinity) - (b.wait ?? Infinity) || a.left.length - b.left.length || a.zone.localeCompare(b.zone))
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

/** seenText over the Respawns records (by zone and name, as respawnKey keys them), for hunterZones. */
export function seenFromRecords(records: Readonly<Record<string, RespawnRecord>>, now: number): (zone: string, name: string, timer: number | undefined) => string | undefined {
  const byKey = new Map<string, RespawnRecord>()
  for (const r of Object.values(records)) {
    byKey.set(`${zoneKey(r.zone)}|${bareName(r.name)}`, r)
    for (const n of r.names ?? []) byKey.set(`${zoneKey(r.zone)}|${bareName(n)}`, r)
  }
  return (zone, name, timer) => seenText(byKey.get(`${zoneKey(zone)}|${bareName(name)}`), timer, now)
}

/**
 * The Hunter named left in the zone the player is in, for the achievements overlay: the export's, less
 * those the live counts have seen killed since (`kills`, by lower-cased mob), each with what the
 * Respawns records say of it (`seenOf`); less the achievements the player has said do not work. Null
 * outside a Hunter zone, or with nothing left there.
 */
export function hunterLive(
  sections: AchSection[],
  exportAt: number,
  zone: string,
  kills: SlayerKills | undefined,
  seenOf: (zone: string, name: string, timer: number | undefined) => string | undefined,
  isBroken: (achievement: string) => boolean
): HunterTrackView | null {
  if (!zone) return null
  const last = new Map<string, number>()
  for (const k of kills?.values() ?? []) last.set(bareName(k.name), Math.max(last.get(bareName(k.name)) ?? 0, k.times.at(-1) ?? 0))
  const rows = hunterHere(
    hunterZones(
      sections,
      (bare) => last.get(bare) ?? 0,
      exportAt,
      () => null,
      seenOf
    ),
    zone
  ).filter((r) => !isBroken(r.achievement))
  return rows.length
    ? {
        zone,
        rows: rows.map((r) => {
          const seen = Object.fromEntries(r.left.flatMap((n) => (n.seen ? [[n.name, n.seen]] : [])))
          return { achievement: r.achievement, left: r.left.map((n) => n.name), total: r.total, since: r.since, ...(Object.keys(seen).length ? { seen } : {}) }
        })
      }
    : null
}
