import { app, protocol } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { initLog, log } from './log'

// What has to happen before anything else is built: where settings and the log live, the icon scheme,
// and whether this copy is the one that runs. Imported first by index.ts, for its side effects.

// Settings live in %APPDATA%\Legends Tracker. EQL_USER_DATA points a development or test run at a
// separate profile, so a trial never touches real settings.
app.setPath('userData', process.env['EQL_USER_DATA'] || join(app.getPath('appData'), 'Legends Tracker'))
// Each profile keeps its own diagnostic log beside its settings.
initLog(join(app.getPath('userData'), 'logs'))
log.info(`Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'} on Windows ${release()} ${process.arch}, Electron ${process.versions.electron}`)
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e))
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e))

protocol.registerSchemesAsPrivileged([{ scheme: 'eqicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

/**
 * Whether this copy runs the app. A second copy hands its arguments to the first and quits; so does
 * --quit with nothing running, since there is nothing to quit and a restart script must not wait on
 * it. Neither builds anything, so neither can write over the running copy's files.
 */
export const primaryInstance = app.requestSingleInstanceLock() && !process.argv.includes('--quit')
if (!primaryInstance) app.quit()
else if (!process.env['EQL_USER_DATA']) carryOverSettings(join(app.getPath('appData'), 'EQL Audio Triggers'), app.getPath('userData'))

/** The app's own files: the resources folder installed, the checkout in development. */
export const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '../..')
export const preloadPath = join(__dirname, '../preload/index.js')
export const appIcon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(resources, 'build', 'icon.png')

/** The app was called EQL Audio Triggers until 2026-09-24; bring its settings across once. The old folder is left as it was. */
function carryOverSettings(from: string, to: string): void {
  if (existsSync(join(to, 'settings.json')) || !existsSync(join(from, 'settings.json'))) return
  try {
    mkdirSync(to, { recursive: true })
    for (const f of ['settings.json', 'triggers.json', 'spell-rules.json', 'casts.json', 'motes.json']) {
      if (existsSync(join(from, f))) cpSync(join(from, f), join(to, f))
    }
    if (existsSync(join(from, 'sounds'))) cpSync(join(from, 'sounds'), join(to, 'sounds'), { recursive: true })
    log.info(`Carried settings over from ${from}`)
  } catch (e) {
    log.warn(`Could not carry settings over from ${from}`, e)
  }
}
