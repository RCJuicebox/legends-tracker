import { duration } from './format'
import { respawnEstimate, type RespawnRecord } from './respawns'
import { zoneKey } from './zones'

// What the Respawns records say of a named mob in a few words, and when it is due: for Plan › Hunter,
// the achievements overlay and Plane of Sky's Targets (LT-670, LT-733, LT-735). In core so a feature
// that is not Hunter's may show it too.

/** A mob's name as the spawn tables key it: lower case, no leading article or marks ("Andrew Pine", "a werewolf bandit" → "werewolf bandit"). */
export const mobKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/^[*#]+/, '')
    .replace(/^(?:an?|the)\s+/, '')
    .trim()

export interface Seen {
  text: string
  /** Seconds until it is due back: 0 once it is due or was seen again; undefined when no time is known. */
  dueIn?: number
}

/**
 * What the Respawns records say of a named: "died 6 min ago; back in ~2 min as you timed it" while it
 * is still down, "down 11 min, due" past its time, "died 40 min ago, seen since" once the log saw it
 * again. `timer` is the tables' respawn, where the log has not timed it.
 */
export function seenOf(r: Pick<RespawnRecord, 'lastDeath' | 'pendingSince' | 'gaps'> | undefined, timer: number | undefined, now: number): Seen | undefined {
  if (!r || !r.lastDeath) return undefined
  const ago = `died ${duration(Math.max(0, now - r.lastDeath) / 1000)} ago`
  if (!r.pendingSince) return { text: `${ago}, seen since`, dueIn: 0 }
  const down = Math.max(0, now - r.pendingSince) / 1000
  const timed = respawnEstimate(r)
  const due = timed ?? timer
  if (due === undefined) return { text: `${ago}, still down` }
  if (down >= due) return { text: `down ${duration(down)}, due`, dueIn: 0 }
  return { text: `${ago}; back in ~${duration(due - down)} ${timed !== null ? 'as you timed it' : 'by the tables'}`, dueIn: due - down }
}

/** seenOf over the Respawns records, by zone and name (a spawn point's every name too). */
export function seenFromRecords(records: Readonly<Record<string, RespawnRecord>>, now: number): (zone: string, name: string, timer: number | undefined) => Seen | undefined {
  const byKey = new Map<string, RespawnRecord>()
  for (const r of Object.values(records)) {
    byKey.set(`${zoneKey(r.zone)}|${mobKey(r.name)}`, r)
    // A pinned spawn is one spot of a name others share: what it says is not the name's.
    if (!r.spot) for (const n of r.names ?? []) byKey.set(`${zoneKey(r.zone)}|${mobKey(n)}`, r)
  }
  return (zone, name, timer) => seenOf(byKey.get(`${zoneKey(zone)}|${mobKey(name)}`), timer, now)
}
