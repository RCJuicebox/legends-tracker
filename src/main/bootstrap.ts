import { app, crashReporter, dialog, protocol } from 'electron'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { flushLogSync, initLog, log } from './log'
import { cacheDir } from './paths'
import { profileName, settingsFolder } from '../core/profile'

// What has to happen before anything else is built: where settings and the log live, the icon scheme,
// and whether this copy is the one that runs. Imported first by index.ts, for its side effects.

// Settings live in %APPDATA%\Legends Tracker. EQL_USER_DATA points a development or test run at a
// separate profile, so a trial never touches real settings; --profile <name> gives a second player on
// the PC one of their own under it (FEAT-041).
app.setPath('userData', settingsFolder(process.argv, app.getPath('appData'), process.env['EQL_USER_DATA'] || undefined))

/**
 * Whether this copy runs the app. A second copy hands its arguments to the first and quits; so does
 * --quit with nothing running, since there is nothing to quit and a restart script must not wait on
 * it. Neither builds anything, so neither can write over the running copy's files, nor its log: a
 * second copy's start line in the running copy's log read as a restart that never was, and could roll
 * the file under it (LT-605).
 */
export const primaryInstance = app.requestSingleInstanceLock() && !process.argv.includes('--quit')
// Each profile keeps its own diagnostic log beside its settings.
if (primaryInstance) {
  initLog(join(app.getPath('userData'), 'logs'))
  log.info(`Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'} on Windows ${release()} ${process.arch}, Electron ${process.versions.electron}`)
  // A native crash (koffi, the GPU, a page) leaves a dump in the profile's Crashpad folder, sent nowhere;
  // Copy diagnostics says how many there are and the newest (LT-619).
  crashReporter.start({ uploadToServer: false })
}
// Something unexpected: logged, and shown once with where the log is, since the app may now be in a
// state nobody meant. A second one ends it rather than carry on further. The box does not wait to be
// closed: timers, the log and the overlays carry on behind it.
let uncaught = 0
/** What has to be written before the app ends on a second uncaught error: set once the store exists. */
let saveOnFault: (() => Promise<unknown>) | null = null
export function onFatalSave(save: () => Promise<unknown>): void {
  saveOnFault = save
}
process.on('exit', () => flushLogSync())
process.on('uncaughtException', (e) => {
  log.error('Uncaught exception:', e)
  if (++uncaught > 1) {
    // Ends, but writes the settings and the rest first, given two seconds (LT-437).
    if (uncaught > 2) return
    const exit = () => {
      flushLogSync()
      app.exit(1)
    }
    const save = saveOnFault?.().catch(() => undefined) ?? Promise.resolve()
    void Promise.race([save, new Promise((r) => setTimeout(r, 2000))]).then(exit, exit)
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

if (!primaryInstance) app.quit()
else if (!process.env['EQL_USER_DATA'] && !profileName(process.argv)) carryOverSettings(join(app.getPath('appData'), 'EQL Audio Triggers'), app.getPath('userData'))

/** Chromium's caches in a profile from before LT-620: derived, so removed once the session data has its own folder. */
const CHROMIUM_CACHES = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GPUPersistentCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary'
]

if (primaryInstance) moveCaches(app.getPath('userData'), cacheDir())
// Chromium's own caches (GPU, shaders, the HTTP cache) are derived data too: out of the roaming
// profile with the rest, the remembered page state (Local Storage) brought across once (LT-620).
if (primaryInstance) app.setPath('sessionData', chromiumData(app.getPath('userData'), cacheDir()))

/** Where Chromium keeps its session data: the cache folder's own, with Local Storage carried over from the profile the first time. */
function chromiumData(profile: string, cache: string): string {
  const to = join(cache, 'chromium')
  try {
    if (!existsSync(to)) {
      mkdirSync(to, { recursive: true })
      const ls = join(profile, 'Local Storage')
      if (existsSync(ls)) cpSync(ls, join(to, 'Local Storage'), { recursive: true })
      // What is left in the profile is fetched or built again by Chromium, and goes.
      for (const name of CHROMIUM_CACHES) rmSync(join(profile, name), { recursive: true, force: true })
      log.info(`Chromium's session data now kept in ${to}`)
    }
    return to
  } catch (e) {
    log.warn(`Could not move Chromium's session data to ${to}; it stays in the profile`, e)
    return profile
  }
}

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
