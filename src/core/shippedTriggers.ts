import type { Trigger } from '../shared/types'

/**
 * The triggers shipped before new ones joined a profile by themselves. They reached an old profile
 * only through "Add N shipped", so a profile with no record of what it was offered counts these as
 * offered: one missing from its list was taken out, and stays out.
 */
export const OFFERED_BEFORE_RECORD: readonly string[] = [
  '1a2ada15-61e0-4c34-957b-de3f0478d7e9',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40001',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40002',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40003',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40004',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40005',
  'a1f0c9d2-4e3b-4a71-9c58-7d21b8e40043'
]

export interface ShippedOffer {
  /** The shipped triggers to add to the profile's list. */
  add: Trigger[]
  /** The record to keep: every shipped id offered so far. */
  offered: string[]
  /** The record differs from the one read: it is to be written. */
  changed: boolean
}

/**
 * The shipped triggers a profile has not been offered yet, added once each (Dan, 2026-11-11: a new
 * shipped trigger stayed silent until "Add 1 shipped" was found). One the player deletes afterwards
 * stays deleted; "Add N shipped" on the Triggers page brings it back. `offered` is the record read,
 * undefined for a profile from before it was kept.
 */
export function offerShipped(shipped: readonly Trigger[], have: readonly Trigger[], offered: readonly string[] | undefined): ShippedOffer {
  const seen = new Set(offered ?? OFFERED_BEFORE_RECORD)
  const haveIds = new Set(have.map((t) => t.id))
  const add = shipped.filter((t) => !seen.has(t.id) && !haveIds.has(t.id))
  for (const t of shipped) seen.add(t.id)
  const next = [...seen]
  return { add, offered: next, changed: offered === undefined || next.length !== offered.length }
}
