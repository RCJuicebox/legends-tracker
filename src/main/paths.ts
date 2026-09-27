import { app } from 'electron'
import { join } from 'node:path'

// Where the app keeps things, apart from settings (app.getPath('userData')).

let cache = ''

/**
 * Downloaded and derived data that can always be fetched or read again (wiki pages, the item catalog,
 * spoken phrases, log counts, OCR scratch images): kept out of the roaming profile, which syncs.
 */
export function cacheDir(): string {
  const scratch = process.env['EQL_USER_DATA']
  // Not "cache" inside a scratch profile: that is Chromium's own Cache folder there, names being case-blind.
  return (cache ||= scratch ? join(scratch, 'local') : join(process.env['LOCALAPPDATA'] || app.getPath('appData'), 'Legends Tracker'))
}
