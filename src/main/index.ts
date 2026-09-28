// The main process. bootstrap.ts runs first: it sets up the log and settings folder and decides
// whether this copy runs at all; a second copy stops there, having built nothing.
import { primaryInstance } from './bootstrap'
import { app, dialog, protocol, screen, session } from 'electron'
import { basename, join } from 'node:path'
import { createContext, type AppContext } from './context'
import { registerLifecycle } from './lifecycle'
import { registerAppIpc } from './ipc/app'
import { registerTriggerIpc } from './ipc/triggers'
import { registerSpellIpc } from './ipc/spells'
import { registerLogIpc } from './ipc/logs'
import { registerPlayIpc } from './ipc/play'
import { registerAudioIpc } from './ipc/audio'
import { registerCharacterIpc } from './ipc/character'
import { registerDemoIpc } from './demo'
import { registerFactionIpc } from '../features/factions/main'
import { appUserModelId, ensureSourceShortcut } from './appIdentity'
import { appIcon } from './bootstrap'
import { isOwnPage } from './push'
import { log, logDir } from './log'

if (primaryInstance) {
  const ctx = createContext()
  registerLifecycle(ctx)
  void app.whenReady().then(async () => {
    try {
      await start(ctx)
    } catch (e) {
      log.error('Start failed:', e)
      dialog.showErrorBox(
        'Legends Tracker could not start',
        `${e instanceof Error ? e.message : String(e)}\n\nThe details are in ${join(logDir(), 'main.log')}. Legends Tracker will close now.`
      )
      app.quit()
    }
  })
}

async function start(ctx: AppContext): Promise<void> {
  const { store, engine, windows } = ctx
  app.setAppUserModelId(appUserModelId())
  ensureSourceShortcut(appIcon)
  // Output-device names are only visible to pages granted 'media', and navigator.clipboard.writeText
  // (the Copy buttons) needs 'clipboard-sanitized-write'; both go to our own pages only.
  const granted = new Set(['media', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionCheckHandler((wc, permission) => granted.has(permission) && !!wc && isOwnPage(wc.getURL()))
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(granted.has(permission) && isOwnPage(wc.getURL())))
  protocol.handle('eqicon', async (req) => {
    const url = new URL(req.url)
    const n = Number(url.pathname.replace(/\//g, ''))
    const png = !Number.isFinite(n) ? null : url.hostname === 'item' ? await ctx.icons.itemPng(n) : await ctx.icons.png(n)
    return png ? new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' } }) : new Response(null, { status: 404 })
  })
  for (const register of [
    registerAppIpc,
    registerTriggerIpc,
    registerSpellIpc,
    registerLogIpc,
    registerPlayIpc,
    registerAudioIpc,
    registerCharacterIpc,
    registerFactionIpc,
    registerDemoIpc
  ]) {
    register(ctx)
  }
  // The tray comes first: closing the window hides it, so without a tray icon a failed start below
  // would leave a process nobody can reach.
  windows.createTray({
    arranging: () => ctx.overlays.isArranging,
    setArranging: ctx.setArranging,
    muted: () => store.settings.get().audio.muted,
    toggleMute: ctx.toggleMute,
    updateReady: () => (ctx.updater.status.state === 'ready' ? ctx.updater.status.version : ''),
    installUpdate: () => void ctx.installUpdate()
  })
  windows.createAudio()
  windows.createMain()
  await engine.init()
  ctx.logSettings()
  if (store.recovered.length) {
    const names = store.recovered.map((f) => basename(f)).join(', ')
    engine.pushFeed('warn', `Some saved settings could not be read and were set aside (${names}, in the app's data folder); defaults are in use for them.`)
  }
  if (store.newer.length) {
    engine.pushFeed(
      'warn',
      `${store.newer.join(', ')} ${store.newer.length === 1 ? 'was' : 'were'} saved by a newer version of Legends Tracker. They are read, but changes made in this version are not saved to them; update to keep changes.`
    )
  }
  if (store.settingsFresh) placeOverlaysForNewInstall(ctx)
  ctx.overlays.apply(store.settings.get().overlays)
  ctx.watcher.start()
  ctx.updater.start()
  ctx.applyHotkeys()
  // New windows (overlays, the main window reopened) start at normal priority; catch them up.
  ctx.applyPriority()
  // Renderers start a moment after their windows; look again once they have.
  for (const ms of [3000, 10_000]) setTimeout(ctx.applyPriority, ms).unref()
  app.on('browser-window-created', () => setTimeout(ctx.applyPriority, 1500))
  setInterval(ctx.applyPriority, 60_000).unref()
}

/** A first install gets its overlays laid out on the primary monitor, not wherever the defaults point. */
function placeOverlaysForNewInstall(ctx: AppContext): void {
  const a = screen.getPrimaryDisplay().workArea
  const s = ctx.store.settings.get()
  const place: Record<string, { x: number; y: number; width: number; height: number }> = {
    alerts: { x: a.x + Math.round(a.width / 2) - 400, y: a.y + Math.round(a.height * 0.18), width: 800, height: 180 },
    buffs: { x: a.x + a.width - 720, y: a.y + Math.round(a.height * 0.3), width: 340, height: 420 },
    targets: { x: a.x + a.width - 370, y: a.y + Math.round(a.height * 0.3), width: 340, height: 420 },
    meter: { x: a.x + 40, y: a.y + a.height - 360, width: 380, height: 300 },
    // Under the buffs, kept above the bottom edge on a short screen.
    respawns: { x: a.x + a.width - 720, y: Math.min(a.y + Math.round(a.height * 0.3) + 440, a.y + a.height - 270), width: 340, height: 260 }
  }
  ctx.store.settings.set({ ...s, overlays: s.overlays.map((o) => (place[o.id] ? { ...o, ...place[o.id] } : o)) })
}
