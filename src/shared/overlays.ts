import type { AchievementOverlayOptions, MeterOverlayOptions, OverlayConfig } from './types'

// The overlays every install ships with. Main seeds settings from these; the renderer reads the ids to
// know which overlays may be hidden but not removed. Pure data, so both sides can import it.

export const DEFAULT_METER_OPTIONS: MeterOverlayOptions = { mode: 'damage', span: 'fight', scope: 'everyone', rows: 8, combinePet: true, header: true }

export const DEFAULT_ACHIEVEMENT_OPTIONS: AchievementOverlayOptions = { factionPlan: true }

export const OVERLAY_BUFFS = 'buffs'
export const OVERLAY_TARGETS = 'targets'
const OVERLAY_ALERTS = 'alerts'
const OVERLAY_METER = 'meter'
const OVERLAY_RESPAWNS = 'respawns'
const OVERLAY_ACHIEVEMENTS = 'achievements'

/** A monitor's work area: where overlays can go, in screen coordinates. */
export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

/** A 1080p monitor less the taskbar: where the shipped defaults sit until a monitor is known. */
const FULL_HD: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 }

/**
 * How much larger than the shipped sizes overlays and their text start on a monitor, by its height in
 * Windows' scaled pixels: 1 at 1080p, 1.25 at 1440p, at most 1.5. A 13 px meter row is some 3 mm
 * on a 27-inch 1440p screen (LT-355).
 */
export function overlayScale(a: WorkArea): number {
  return Math.min(1.5, Math.max(1, Math.round((a.height / 1040) * 4) / 4))
}

/**
 * Where the built-in overlays go on a monitor, none over another: the alerts high in the middle,
 * buffs and DoTs at the right under them, respawns under the buffs, the meter at the lower left and
 * achievements above it. A small screen gets shorter bars and narrower alerts; a tall one, larger
 * overlays (`scale`). A new install gets this for its primary monitor.
 */
export function defaultPlacement(a: WorkArea, scale = overlayScale(a)): Record<string, WorkArea> {
  const s = (n: number) => Math.round(n * scale)
  const top = a.y + Math.round(a.height * 0.18)
  // Narrower on a narrow screen, so they clear the achievements at the left.
  const alertsWidth = Math.min(s(800), a.width - s(880))
  // The bars start under the alerts and share what height is left with the respawns.
  const bars = top + s(180) + 20
  const room = a.y + a.height - 20 - bars
  const barsHeight = Math.min(s(420), Math.round((room - 20) * 0.62))
  const meterY = a.y + a.height - s(300) - 60
  const bar = s(340)
  return {
    [OVERLAY_ALERTS]: { x: a.x + Math.round((a.width - alertsWidth) / 2), y: top, width: alertsWidth, height: s(180) },
    [OVERLAY_BUFFS]: { x: a.x + a.width - 2 * bar - 40, y: bars, width: bar, height: barsHeight },
    [OVERLAY_TARGETS]: { x: a.x + a.width - bar - 30, y: bars, width: bar, height: barsHeight },
    [OVERLAY_RESPAWNS]: { x: a.x + a.width - 2 * bar - 40, y: bars + barsHeight + 20, width: bar, height: Math.min(s(260), room - barsHeight - 20) },
    [OVERLAY_METER]: { x: a.x + 40, y: meterY, width: s(380), height: s(300) },
    [OVERLAY_ACHIEVEMENTS]: { x: a.x + 40, y: top, width: s(360), height: Math.min(s(400), meterY - 20 - top) }
  }
}

const AT = defaultPlacement(FULL_HD)

export const DEFAULT_OVERLAYS: OverlayConfig[] = [
  { id: OVERLAY_BUFFS, name: 'Buffs', kind: 'timers', ...AT[OVERLAY_BUFFS], opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: OVERLAY_TARGETS, name: 'DoTs & Timers', kind: 'timers', ...AT[OVERLAY_TARGETS], opacity: 1, fontSize: 15, visible: true, groupByTarget: true },
  { id: OVERLAY_ALERTS, name: 'Alerts', kind: 'alerts', ...AT[OVERLAY_ALERTS], opacity: 1, fontSize: 30, visible: true, groupByTarget: false },
  {
    id: OVERLAY_METER,
    name: 'Damage meter',
    kind: 'meter',
    ...AT[OVERLAY_METER],
    opacity: 1,
    fontSize: 13,
    visible: true,
    groupByTarget: false,
    meter: { ...DEFAULT_METER_OPTIONS }
  },
  { id: OVERLAY_RESPAWNS, name: 'Respawns', kind: 'timers', ...AT[OVERLAY_RESPAWNS], opacity: 1, fontSize: 15, visible: true, groupByTarget: false },
  // The faction plan's step and the Slayer counts; hidden until asked for (the Plan tab or the Overlays page).
  {
    id: OVERLAY_ACHIEVEMENTS,
    name: 'Achievements',
    kind: 'achievements',
    ...AT[OVERLAY_ACHIEVEMENTS],
    opacity: 1,
    fontSize: 14,
    visible: false,
    groupByTarget: false,
    achievements: { ...DEFAULT_ACHIEVEMENT_OPTIONS }
  }
]

/**
 * Where an overlay added on the Overlays page goes: `base` on the primary monitor, stepped down and
 * right past any overlay already there, so a second one added is not drawn over the first.
 */
export function newOverlaySpot(base: { x: number; y: number }, overlays: readonly { x: number; y: number }[]): { x: number; y: number } {
  let at = { ...base }
  while (overlays.some((o) => Math.abs(o.x - at.x) < 24 && Math.abs(o.y - at.y) < 24)) at = { x: at.x + 32, y: at.y + 32 }
  return at
}

/**
 * What an overlay's opacity fades. The alerts are text alone, so it fades them; every other overlay
 * keeps its text and bars as they are and fades the dark panel behind them, down to none.
 */
export function opacityStyle(c: Pick<OverlayConfig, 'kind' | 'opacity'>): Record<string, number> {
  return c.kind === 'alerts' ? { opacity: c.opacity } : { '--ov-panel': c.opacity }
}

/** The lowest opacity the Overlays page offers: a panel may go, alert text must stay readable. */
export const minOpacity = (kind: OverlayConfig['kind']): number => (kind === 'alerts' ? 0.2 : 0)

/** The overlays that can be hidden but not removed: every one the app ships. */
export const BUILTIN_OVERLAYS: readonly string[] = DEFAULT_OVERLAYS.map((o) => o.id)
