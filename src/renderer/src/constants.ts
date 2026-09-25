// Fixed ids and limits the pages share.

/** The overlays every install has; they can be hidden but not removed. */
export const OVERLAY_BUFFS = 'buffs'
export const OVERLAY_TARGETS = 'targets'
export const OVERLAY_ALERTS = 'alerts'
export const BUILTIN_OVERLAYS: readonly string[] = [OVERLAY_BUFFS, OVERLAY_TARGETS, OVERLAY_ALERTS]

/** How many activity lines the Live page keeps. */
export const FEED_MAX = 300
