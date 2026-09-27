import { app, shell } from 'electron'
import { handle } from './handle'
import { onSend } from '../push'
import { logDir } from '../log'
import { checkGameFolder, findInstall, resolveGameFolder } from '../game'
import { meterOptions, sanitizeCharacter, sanitizeSettings } from '../validate'
import type { AppContext } from '../context'

// The app as a whole: its state, settings, the character, watching the log, the game folder, updates.

export function registerAppIpc(ctx: AppContext): void {
  const { store, engine, windows } = ctx

  handle('app:state', () => ({
    settings: store.settings.get(),
    status: engine.status,
    timers: engine.board.views(),
    feed: engine.feed,
    archive: engine.archive,
    character: engine.character(),
    characterKey: engine.characterKey(),
    voices: ctx.speech.voices,
    speechError: ctx.speech.failed,
    arranging: ctx.overlays.isArranging,
    devices: ctx.audioDevices,
    triggerErrors: engine.triggers.errors
  }))
  handle('app:openLogs', () => shell.openPath(logDir()))
  handle('settings:save', (s) => {
    const clean = sanitizeSettings(s, store.settings.get())
    if (!clean) throw new Error('Settings were not saved: they were not in the expected form.')
    return ctx.saveSettings(clean)
  })
  handle('character:save', (input) => {
    const s = store.settings.get()
    const key = ctx.characterKey()
    if (!key) return
    const c = sanitizeCharacter(input, store.characterOf(s.logFile))
    if (!c) throw new Error('The character was not saved: it was not in the expected form.')
    store.settings.set({ ...s, characters: { ...s.characters, [key]: c } })
    engine.reconfigure()
    windows.toMain('state:character', c)
  })
  handle('watch:start', () => engine.startWatching())
  handle('watch:stop', () => engine.stopWatching())
  handle('simulate', (text) => engine.simulate(text))

  handle('update:status', () => ({ status: ctx.updater.status, version: app.getVersion() }))
  handle('update:check', () => ctx.updater.check())
  handle('update:install', () => ctx.installUpdate())

  handle('game:check', (dir) => checkGameFolder(dir ?? ctx.installDir()))
  handle('game:find', async () => {
    const dir = await findInstall()
    if (dir) ctx.saveSettings({ ...store.settings.get(), installDir: dir })
    return dir
  })
  // Takes the game folder, or a folder in or above it, and returns the game folder it settled on.
  handle('game:choose', async () => {
    const r = await windows.openDialog({
      title: 'Choose your EverQuest Legends folder',
      defaultPath: ctx.installDir() || undefined,
      properties: ['openDirectory']
    })
    if (r.canceled) return { canceled: true, picked: '', dir: '' }
    const dir = resolveGameFolder(r.filePaths[0])
    if (dir) ctx.saveSettings({ ...store.settings.get(), installDir: dir })
    return { canceled: false, picked: r.filePaths[0], dir }
  })
  handle('dialog:folder', async () => {
    const r = await windows.openDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  handle('overlays:arrange', (on) => ctx.setArranging(on === true))
  onSend('overlay:mouse', (id, interactive) => {
    if (typeof id === 'string') ctx.overlays.setMouse(id, interactive === true)
  })
  // A meter overlay's own header changes what it shows; the choice is kept with the overlay.
  onSend('overlay:meter', (id, patch: unknown) => {
    const s = store.settings.get()
    const o = s.overlays.find((x) => x.id === id && x.kind === 'meter')
    if (!o || !patch || typeof patch !== 'object') return
    const meter = meterOptions({ ...o.meter, ...(patch as object) }, o.meter)
    ctx.saveSettings({ ...s, overlays: s.overlays.map((x) => (x.id === id ? { ...x, meter } : x)) })
  })
}
