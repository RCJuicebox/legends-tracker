// Arguments a page sends, and the character keys and paths they name.

export type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * A character key as the game names its files, `Name_server`. Whatever a file name may hold is
 * allowed (accented names, hyphens); only what could reach outside the app's folders is not: path
 * separators, drive colons, wildcards, dot-only names. listLogs goes by the same rule.
 */
export function isCharacterKey(v: unknown): v is string {
  if (typeof v !== 'string' || !v.length || v.length > 64 || /[\\/:*?"<>|]/.test(v) || /^\.+$/.test(v)) return false
  // Nor a name Windows keeps for a device ("CON.json" is the console), nor one that is an object's own.
  if (DEVICE_NAME.test(v) || !isRecordKey(v)) return false
  // No control characters either: a file name cannot hold them.
  return ![...v].some((c) => c.charCodeAt(0) < 32)
}

/** Throws unless `v` is a character key (isCharacterKey): for a handler that is asked about a character. */
export function assertCharacterKey(v: unknown): asserts v is string {
  if (!isCharacterKey(v)) throw new Error('Not a character.')
}

/** CON, PRN, AUX, NUL, COM1-9 and LPT1-9, with or without an extension, in any case. */
export const DEVICE_NAME = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i

/** A string that is safe as a key of a plain object: not `__proto__`, `constructor` or `prototype`. */
export function isRecordKey(v: unknown, max = 120): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && v !== '__proto__' && v !== 'constructor' && v !== 'prototype'
}

/** Text a page sends, cut to `max`; '' for anything that is not a string. */
export function textArg(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/** A whole number a page sends, held between `lo` and `hi`; `fb` for anything that is not a finite number. */
export function intArg(v: unknown, lo: number, hi: number, fb: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fb
}

/** A list of short strings a page sends (class names, item names), at most `max` of them. */
export function stringsArg(v: unknown, max: number, len = 120): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= len).slice(0, max) : []
}

/** A full Windows path: a drive ("E:\…") or a share ("\\server\…"). Not "E:folder", which depends on the drive's current folder. */
export function isFullPath(v: unknown): v is string {
  return typeof v === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\[^\\/])/.test(v)
}

/** `...\Logs\eqlog_Kelwyn_neriak.txt` → `Kelwyn_neriak` */
export function characterKey(logFile: string): string {
  const m = /eqlog_(.+)\.txt$/i.exec(logFile)
  return m ? m[1] : ''
}
