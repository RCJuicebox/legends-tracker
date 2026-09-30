import { app, globalShortcut, powerMonitor, shell } from 'electron'
import { isOwnPage } from './push'
import { log } from './log'
import type { AppContext } from './context'

// How the app ends, and what it does about second copies, stray navigation and crashed pages.

/** A crashed page is made again this many times in CRASH_WINDOW_MS; after that it is left closed. */
const CRASHES_RECOVERED = 3
const CRASH_WINDOW_MS = 5 * 60_000

export function registerLifecycle(ctx: AppContext): void {
  // A second copy started with --quit is a request to shut this one down properly (settings written,
  // overlays closed), from a script or a launcher about to start a fresh one; any other second copy
  // just brings this one to the front.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) {
      log.info('Quitting: another copy asked with --quit')
      app.quit()
    } else ctx.windows.showMain()
  })

  // No window of ours goes anywhere but our own pages, and none opens another: a web link goes to the
  // default browser instead.
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (ev, url) => {
      if (!isOwnPage(url)) ev.preventDefault()
    })
    // A page's own errors and warnings belong in the diagnostic log, not just its console.
    wc.on('console-message', (ev) => {
      if (ev.level !== 'error' && ev.level !== 'warning') return
      const where = ev.sourceId ? ` (${ev.sourceId.split('/').pop()}:${ev.lineNumber})` : ''
      ;(ev.level === 'error' ? log.error : log.warn)(`Page ${wc.getURL().split('/').pop()}: ${ev.message}${where}`)
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  // A page that crashed is loaded again: the main window reloads, an overlay or the audio window is
  // made afresh. Not while quitting, and not for a page that closed normally. One that keeps crashing
  // (as it loads, say) is left closed after a few, rather than made again every second all evening.
  const crashes = new Map<string, number[]>()
  app.on('render-process-gone', (_e, wc, d) => {
    const url = wc.getURL()
    log.error(`A page stopped (${d.reason}, exit ${d.exitCode}): ${url}`)
    if (ctx.windows.quitting || d.reason === 'clean-exit') return
    const now = Date.now()
    const recent = (crashes.get(url) ?? []).filter((t) => now - t < CRASH_WINDOW_MS)
    recent.push(now)
    crashes.set(url, recent)
    if (recent.length > CRASHES_RECOVERED) {
      if (recent.length === CRASHES_RECOVERED + 1) {
        const page = url.split('/').pop()?.split('?')[0] ?? url
        log.error(`${page} crashed ${recent.length} times in five minutes; left closed until the app is restarted`)
        ctx.engine.pushFeed('warn', `A window (${page}) kept crashing and was left closed. Restart the app to bring it back; main.log has the details.`)
      }
      return
    }
    setTimeout(() => {
      if (ctx.windows.quitting) return
      if (ctx.windows.recover(wc)) return
      ctx.overlays.recover(wc)
    }, 1000)
  })

  // Asleep, timers ran on in the game's world: one that ended while the PC slept is cleared without a
  // word, rather than every warning and fade of the night spoken at once on waking.
  powerMonitor.on('resume', () => {
    const n = ctx.engine.board.endWhere((t) => t.endsAt < Date.now(), 'expired').length
    log.info(`Woke from sleep${n ? `; cleared ${n} timer${n === 1 ? '' : 's'} that ran out meanwhile` : ''}`)
    if (n) ctx.engine.pushFeed('info', `Back from sleep: cleared ${n} timer${n === 1 ? '' : 's'} that ran out meanwhile.`)
  })
  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') log.warn(`${d.type} process${d.name ? ` (${d.name})` : ''} stopped: ${d.reason}, exit ${d.exitCode}`)
  })

  // Quitting waits (up to a few seconds) for settings to reach disk: a change saved just before Quit is
  // still in its 400 ms wait. The first before-quit holds the quit, shuts down, writes, then quits again.
  let shutDown = false
  let shuttingDown = false
  app.on('before-quit', (e) => {
    ctx.windows.quitting = true
    if (shutDown) return
    e.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void stopAndSave(ctx).then(() => {
      shutDown = true
      app.quit()
    })
  })
  app.on('window-all-closed', () => {
    // Stay resident in the tray; Quit from the tray menu ends the app.
  })

  // Restarts into a downloaded update. Everything is written first: quitAndInstall starts the
  // installer straight away, so a flush left to before-quit would race it.
  ctx.installUpdate = async () => {
    if (ctx.updater.status.state !== 'ready' || shuttingDown) return
    ctx.windows.quitting = true
    shuttingDown = true
    await stopAndSave(ctx)
    shutDown = true
    ctx.updater.install()
  }
}

/** Stops every timer and poller and writes whatever changed; never rejects, and gives up waiting after 3 s. */
async function stopAndSave(ctx: AppContext): Promise<void> {
  log.info('Quitting')
  for (const [name, stop] of [
    ['engine', () => ctx.engine.shutdown()],
    ['updater', () => ctx.updater.stop()],
    ['game watcher', () => ctx.watcher.stop()],
    ['achievement export poller', () => ctx.achievementFiles.stop()],
    ['inventory export poller', () => ctx.inventoryFiles.stop()],
    ['speech', () => ctx.speech.stop()],
    ['overlays', () => ctx.overlays.destroy()],
    ['hotkeys', () => globalShortcut.unregisterAll()]
  ] as const) {
    try {
      stop()
    } catch (err) {
      log.warn(`Stopping the ${name} failed`, err)
    }
  }
  const limit = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))
  const r = await Promise.race([Promise.allSettled([ctx.store.flushAll(), ctx.windows.flush(), ctx.liveAchievements.flush(), ctx.factionAlla.flush()]), limit])
  if (r === 'timeout') log.warn('Saving settings took over 3s; quitting anyway')
}
