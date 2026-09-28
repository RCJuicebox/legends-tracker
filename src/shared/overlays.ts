import type { MeterOverlayOptions, OverlayConfig } from './types'

// The overlays every install ships with. Main seeds settings from these; the renderer reads the ids to
// know which overlays may be hidden but not removed. Pure data, so both sides can import it.

export const DEFAULT_METER_OPTIONS: MeterOverlayOptions = { mode: 'damage', span: 'fight', scope: 'everyone', rows: 8, combinePet: true, header: true }

export const OVERLAY_BUFFS = 'buffs'
export const OVERLAY_TARGETS = 'targets'
export const OVERLAY_ALERTS = 'alerts'
export const OVERLAY_METER = 'meter'
export const OVERLAY_RESPAWNS = 'respawns'
export const OVERLAY_ACHIEVEMENTS = 'achievements'

export const DEFAULT_OVERLAYS: OverlayConfig[] = [
  { id: OVERLAY_BUFFS, name: 'Buffs', kind: 'timers', x: 2040, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: OVERLAY_TARGETS, name: 'DoTs & Timers', kind: 'timers', x: 2400, y: 420, width: 340, height: 520, opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: OVERLAY_ALERTS, name: 'Alerts', kind: 'alerts', x: 1220, y: 300, width: 1000, height: 220, opacity: 1, fontSize: 30, visible: true, groupByTarget: false },
  {
    id: OVERLAY_METER,
    name: 'Damage meter',
    kind: 'meter',
    x: 40,
    y: 560,
    width: 380,
    height: 300,
    opacity: 1,
    fontSize: 13,
    visible: true,
    groupByTarget: false,
    meter: { ...DEFAULT_METER_OPTIONS }
  },
  { id: OVERLAY_RESPAWNS, name: 'Respawns', kind: 'timers', x: 2040, y: 960, width: 340, height: 260, opacity: 1, fontSize: 15, visible: true, groupByTarget: false },
  // The faction plan's step and the Slayer counts; hidden until asked for (the Optimize tab or the Overlays page).
  { id: OVERLAY_ACHIEVEMENTS, name: 'Achievements', kind: 'achievements', x: 40, y: 200, width: 360, height: 400, opacity: 1, fontSize: 14, visible: false, groupByTarget: false }
]

/** The overlays that can be hidden but not removed: every one the app ships. */
export const BUILTIN_OVERLAYS: readonly string[] = DEFAULT_OVERLAYS.map((o) => o.id)
