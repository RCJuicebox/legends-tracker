import { app, shell } from 'electron'
import { isOwnPage } from './push'
import { log } from './log'
import type { AppContext } from './context'

// How the app ends, and what it does about second copies, stray navigation and crashed pages.

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
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
  app.on('render-process-gone', (_e, wc, d) => log.error(`A page stopped (${d.reason}, exit ${d.exitCode}): ${wc.getURL()}`))
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
    ['overlays', () => ctx.overlays.destroy()]
  ] as const) {
    try {
      stop()
    } catch (err) {
      log.warn(`Stopping the ${name} failed`, err)
    }
  }
  const limit = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))
  const r = await Promise.race([Promise.allSettled([ctx.store.flushAll(), ctx.windows.flush()]), limit])
  if (r === 'timeout') log.warn('Saving settings took over 3s; quitting anyway')
}
