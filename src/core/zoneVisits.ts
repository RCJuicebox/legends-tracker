import { zoneEntered } from './logLine'
import { zoneKey } from './zones'

// The zones a character's log has entered ("You have entered Befallen."), for the Exploration
// achievements: "Befallen Traveler" wants "Visit Befallen", and the export says so only once it is
// written again. Each zone is kept as one place (zoneKey: an instance is its zone), with the name as
// the log first printed it and when it was first and last entered (LT-732).

export type ZoneVisits = Record<string, { zone: string; first: number; last: number }>

/** Counts a line into the visits: a zone line moves its zone's last time (and its first, the first time). */
export function addZoneLine(into: ZoneVisits, text: string, time: number): void {
  const zone = text.startsWith('You have entered ') ? zoneEntered(text) : null
  if (!zone) return
  const k = zoneKey(zone)
  const had = into[k]
  if (!had) into[k] = { zone, first: time, last: time }
  else {
    if (time < had.first) had.first = time
    if (time > had.last) had.last = time
  }
}

/** Stretches' visits as one: the earliest first and the latest last of each place. */
export function joinZoneVisits(stretches: ZoneVisits[]): ZoneVisits {
  const out: ZoneVisits = {}
  for (const s of stretches)
    for (const [k, v] of Object.entries(s)) {
      const had = out[k]
      if (!had) out[k] = { ...v }
      else {
        if (v.first < had.first) had.first = v.first
        if (v.last > had.last) {
          had.last = v.last
          had.zone = v.zone
        }
      }
    }
  return out
}

/** The places entered after `since` (an export's time), by zoneKey, each with when it was last entered. */
export function visitedSince(visits: ZoneVisits, since: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(visits)) if (v.last > since) out[k] = v.last
  return out
}

/** "Visit Befallen": the place an Exploration objective wants, as zoneKey; null for any other objective. */
export function visitObjective(text: string): string | null {
  return text.startsWith('Visit ') ? zoneKey(text.slice('Visit '.length).trim()) : null
}
