import { app, dialog, protocol } from 'electron'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { initLog, log } from './log'
import { cacheDir } from './paths'

// What has to happen before anything else is built: where settings and the log live, the icon scheme,
// and whether this copy is the one that runs. Imported first by index.ts, for its side effects.

// Settings live in %APPDATA%\Legends Tracker. EQL_USER_DATA points a development or test run at a
// separate profile, so a trial never touches real settings.
app.setPath('userData', process.env['EQL_USER_DATA'] || join(app.getPath('appData'), 'Legends Tracker'))
// Each profile keeps its own diagnostic log beside its settings.
initLog(join(app.getPath('userData'), 'logs'))
log.info(`Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'} on Windows ${release()} ${process.arch}, Electron ${process.versions.electron}`)
// Something unexpected: logged, and shown once with where the log is, since the app may now be in a
// state nobody meant. A second one ends it rather than carry on further. The box does not wait to be
// closed: timers, the log and the overlays carry on behind it.
let uncaught = 0
process.on('uncaughtException', (e) => {
  log.error('Uncaught exception:', e)
  if (++uncaught > 1) {
    app.exit(1)
    return
  }
  const title = 'Legends Tracker hit an unexpected error'
  const detail = `${e instanceof Error ? e.message : String(e)}\n\nIt keeps running, but if it misbehaves, restart it. The details are in ${join(app.getPath('userData'), 'logs', 'main.log')}.`
  if (app.isReady()) void dialog.showMessageBox({ type: 'error', title: 'Legends Tracker', message: title, detail }).catch(() => undefined)
  else
    try {
      // Before the app is ready only the plain box can be shown; nothing is running yet for it to hold up.
      dialog.showErrorBox(title, detail)
    } catch {
      // Too early for any dialog; the log has it.
    }
})
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

if (primaryInstance) moveCaches(app.getPath('userData'), cacheDir())

/** Caches used to live beside the settings; they move once, and a copy that cannot move is left to be fetched again. */
function moveCaches(from: string, to: string): void {
  try {
    mkdirSync(to, { recursive: true })
  } catch (e) {
    log.warn(`Could not make the cache folder ${to}`, e)
    return
  }
  for (const name of ['item-cache.json', 'item-catalog.json', 'tradeskill-recipes.json', 'pet-wiki.json', 'log-history.json', 'speech-cache']) {
    const src = join(from, name)
    if (!existsSync(src) || existsSync(join(to, name))) continue
    try {
      renameSync(src, join(to, name))
    } catch {
      try {
        // Another drive: copy, then remove the old one.
        cpSync(src, join(to, name), { recursive: true })
        rmSync(src, { recursive: true, force: true })
      } catch (e) {
        log.warn(`Could not move ${name} to the cache folder`, e)
      }
    }
  }
}

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
