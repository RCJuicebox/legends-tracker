import { zoneKey } from '../../core/zones'
import type { EpicsTrackView } from '../../shared/tracking'
import { EPIC_LISTS, type EpicList, type EpicState } from './core'
import { classViews, targets } from './views'

// Goals › Epics' "Wanted here": the pieces the character's classes still want that come from the zone
// the player is in, for the achievements overlay's section and the alert said on zoning in. Still
// wanted is what the drop cue (cue.ts) and the Targets tab say: a piece not done, counted the way the
// page counts by default (the higher of the log's and the export's).

type Counts = Pick<EpicState, 'logged' | 'adjust' | 'exported' | 'ticks' | 'classes'>

/** The zones a step names: "Najena or Temple of Cazic-Thule" is either. */
export const stepZones = (zone: string): string[] => zone.split(/\s+or\s+/)

/** Whether a step's zone is the zone given, whatever either calls it. */
export function inZone(stepZone: string, zone: string): boolean {
  const k = zoneKey(zone)
  return stepZones(stepZone).some((z) => zoneKey(z) === k)
}

/** The pieces the character's lists of the kinds given still want from a zone, each once, with every list that wants it. */
export function wantedHere(s: Counts, zone: string, kinds: readonly EpicList['kind'][]): EpicsTrackView['rows'] {
  if (!zone || !kinds.length) return []
  const mine = EPIC_LISTS.filter((c) => kinds.includes(c.kind) && s.classes.includes(c.cls))
  // Each kind counted on its own, as its page counts it.
  const views = kinds.flatMap((kind) =>
    classViews(
      mine.filter((c) => c.kind === kind),
      s,
      'both'
    )
  )
  const by = new Map<string, EpicsTrackView['rows'][number]>()
  for (const t of targets(views))
    if (inZone(t.zone, zone))
      for (const r of t.rows) {
        const had = by.get(r.name)
        by.set(
          r.name,
          had ? { ...had, lists: [...new Set([...had.lists, ...r.classes])] } : { name: r.name, how: r.how, have: r.have, need: r.need, lists: r.classes, unverified: r.unverified }
        )
      }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** The alert on zoning in: "Epic pieces here: Ghoulbane (Shadow Knight), Shadow Silk ×2 (Enchanter)"; null when the zone has none wanted. */
export function hereCue(rows: EpicsTrackView['rows']): string | null {
  if (!rows.length) return null
  const shown = rows.slice(0, 4).map((r) => `${r.name}${r.need - r.have > 1 ? ` ×${r.need - r.have}` : ''} (${r.lists.join(', ')})`)
  return `Epic pieces here: ${shown.join(', ')}${rows.length > shown.length ? `, +${rows.length - shown.length} more` : ''}`
}
