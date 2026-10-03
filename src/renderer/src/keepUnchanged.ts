// Settings from main kept part by part where they read the same, for state.tsx (LT-404).

/** Plain data alike, as two copies of settings.json are. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * `next`, keeping each part of `prev` it has unchanged: settings pushed from main are a fresh copy
 * of the whole file, and a page picking `settings.overlays` should not draw again because the
 * audio volume moved.
 */
export function keepUnchanged<T extends object>(prev: T | undefined, next: T): T {
  if (!prev) return next
  let changed = false
  const out = { ...next }
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (same(prev[k], next[k])) out[k] = prev[k]
    else changed = true
  }
  return changed || Object.keys(prev).length !== Object.keys(next).length ? out : prev
}
