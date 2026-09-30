import { app, shell } from 'electron'
import { handle } from './handle'
import { onSend } from '../push'
import { logDir } from '../log'
import { diagnostics } from '../diagnostics'
import { sources } from '../sources/registry'
import { jobs } from '../sources/jobs'
import { checkGameFolder, findInstall, isGameFolder, resolveGameFolder } from '../game'
import { isCharacterKey, meterOptions, sanitizeCharacter, sanitizeSettings } from '../../core/validate'
import { className } from '../../shared/game/classes'
import type { CharacterSettings } from '../../shared/types'
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
    triggerErrors: engine.triggers.errors,
    hotkeysTaken: ctx.hotkeysTaken
  }))
  handle('app:openLogs', () => shell.openPath(logDir()))
  handle('app:diagnostics', () => diagnostics(ctx))
  handle('sources:list', () => sources.list())
  handle('sources:refresh', (id) => sources.refresh(String(id)))
  handle('jobs:list', () => jobs.list())
  handle('jobs:cancel', (id) => jobs.cancel(String(id)))
  handle('settings:save', (s) => {
    const prev = store.settings.get()
    const clean = sanitizeSettings(s, prev)
    if (!clean) throw new Error('Settings were not saved: they were not in the expected form.')
    // Character records are saved on their own (character:save, character:put), and a page's copy of
    // them can be behind: the pages' settings never change them.
    clean.characters = prev.characters
    // Nor can a page's older copy undo the overlays having been arranged (set by setArranging).
    clean.setup = { ...clean.setup, arranged: clean.setup.arranged || prev.setup.arranged }
    // The game folder is chosen or found (game:choose, game:find), each checked; a page cannot set another.
    if (clean.installDir !== prev.installDir && clean.installDir && !isGameFolder(clean.installDir)) clean.installDir = prev.installDir
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
  handle('character:get', async (key) => {
    if (!isCharacterKey(key)) throw new Error('Not a character.')
    const c = store.characterByKey(key)
    if (Object.keys(c.classLevels).length || c.race) return c
    // Before one record held them, the Stats page kept a character's classes, level and race in its
    // own sheet: brought across once.
    const stats = (await ctx.inventoryFiles.sheet(key)).stats as { classes?: unknown; level?: unknown; race?: unknown }
    const ids = Array.isArray(stats.classes) ? stats.classes.filter((x): x is string => typeof x === 'string' && !!x) : []
    if (!ids.length) return c
    const level = typeof stats.level === 'number' ? stats.level : c.level
    const seeded = sanitizeCharacter({ ...c, level, classLevels: Object.fromEntries(ids.map((id) => [className(id), level])), race: stats.race === 'iksar' ? 'Iksar' : '' }, c)
    return seeded ? saveCharacterRecord(key, seeded) : c
  })
  handle('character:put', (key, input) => {
    if (!isCharacterKey(key)) throw new Error('Not a character.')
    const c = sanitizeCharacter(input, store.characterByKey(key))
    if (!c) throw new Error('The character was not saved: it was not in the expected form.')
    return saveCharacterRecord(key, c)
  })
  /** Stores a character's record; the one being played is taken up at once. */
  const saveCharacterRecord = (key: string, c: CharacterSettings) => {
    const s = store.settings.get()
    store.settings.set({ ...s, characters: { ...s.characters, [key]: c } })
    if (key === ctx.characterKey()) {
      engine.reconfigure()
      windows.toMain('state:character', c)
    }
    return c
  }
  handle('watch:start', () => engine.startWatching())
  handle('watch:stop', () => engine.stopWatching())
  handle('simulate', (text) => engine.simulate(text))

  handle('update:status', () => ({ status: ctx.updater.status, version: app.getVersion() }))
  handle('update:check', () => ctx.updater.check())
  handle('update:install', () => ctx.installUpdate())

  // Another folder is looked into only when it is a game folder.
  handle('game:check', (dir) => checkGameFolder(dir === undefined ? ctx.installDir() : typeof dir === 'string' && isGameFolder(dir) ? dir : ''))
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
  handle('overlay:hostState', (display) => ctx.overlays.hostState(Number(display)))
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
