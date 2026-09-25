import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, protocol, screen, session, shell, Tray, type Rectangle } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from 'node:fs'
import { release } from 'node:os'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { Store, characterKey } from './store'
import { Engine, type AudioCommand } from './engine'
import { appEngineEnv } from './engineEnv'
import { SpeechWorker } from './speech'
import { AzureSpeech, VoiceRouter } from './azureSpeech'
import { IconSource } from './icons'
import { appUserModelId, ensureSourceShortcut } from './appIdentity'
import { OverlayManager } from './overlays'
import { GameWatcher, overlaysVisible } from './gameWatcher'
import { Updater } from './updater'
import { yieldPriority } from './priority'
import { AchievementFiles } from './achievements'
import { InventoryFiles } from './inventory'
import { ItemCatalog } from './items'
import { GameTables, readAasFromLog } from './stats'
import { WikiCatalog } from './wikiCatalog'
import { captureScreens, discardScreens, ocrImage } from './ocr'
import { composeRows, countsFromComposite, findMoteRows, rows as ocrRows, statsWindowFromScreen } from '../core/screenText'
import { checkGameFolder, findInstall, listLogs, logIsIn, resolveGameFolder } from './game'
import { summarize } from '../core/spells'
import { castableSpells, focusReport, focusSpec } from '../core/itemFocus'
import { CastHistory } from './castHistory'
import { RecipeBook } from './recipes'
import { PurchaseHistory } from './purchases'
import { TradeFavorites } from './tradeFavorites'
import { focusFromSpell, isDurationFocus } from '../core/focus'
import { testTrigger } from '../core/triggers'
import { respawnTrigger, respawnTriggerId } from '../core/respawns'
import { petSpells, petSummonName } from '../core/pets'
import { PetStore, PetWiki, scanPetLog } from './pets'
import { timerKey } from '../core/spellTracker'
import { CombatMeter } from '../core/combatMeter'
import { parseLogLine } from '../core/logLine'
import type { AppSettings, CharacterSettings, CharacterSheet, SpellRule, Trigger } from '../shared/types'
import type { AchMarks } from '../core/achievements'
import { initLog, log, logDir } from './log'
import { isCharacterKey, meterOptions, sanitizeCharacter, sanitizeRespawnTimer, sanitizeSettings, sanitizeTrigger, sanitizeTriggers } from './validate'

// Settings live in %APPDATA%\Legends Tracker. EQL_USER_DATA points a development or test run at a
// separate profile, so a trial never touches real settings.
app.setPath('userData', process.env['EQL_USER_DATA'] || join(app.getPath('appData'), 'Legends Tracker'))
// Each profile keeps its own diagnostic log beside its settings.
initLog(join(app.getPath('userData'), 'logs'))
log.info(`Legends Tracker ${app.getVersion()}${app.isPackaged ? '' : ' (development)'} on Windows ${release()} ${process.arch}, Electron ${process.versions.electron}`)
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e))
process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e))
if (!process.env['EQL_USER_DATA']) carryOverSettings(join(app.getPath('appData'), 'EQL Audio Triggers'), app.getPath('userData'))

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

protocol.registerSchemesAsPrivileged([{ scheme: 'eqicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
// --quit with nothing running to quit: there is nothing to do, and a restart script must not wait on this copy.
else if (process.argv.includes('--quit')) app.exit(0)

const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '../..')
const preload = join(__dirname, '../preload/index.js')

let mainWindow: BrowserWindow | null = null
let audioWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let audioDevices: { deviceId: string; label: string }[] = []

const store = new Store(join(resources, 'defaults', 'triggers.json'))
const petStore = new PetStore()
const petWiki = new PetWiki()
/** Characters whose log has been read back for the pet this session; after that the live log keeps it. */
const petScanned = new Set<string>()
const appIcon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(resources, 'build', 'icon.png')
const updater = new Updater((s) => {
  toMain('state:update', s)
  if (s.state === 'downloading') {
    announceUpdate(`found:${s.version}`, `Legends Tracker ${s.version} is available`, 'Downloading it now. You can restart into it once it has arrived.', () => showMain())
  } else if (s.state === 'ready') {
    engine.pushFeed('info', `Version ${s.version} is ready: restart to update.`)
    announceUpdate(`ready:${s.version}`, `Legends Tracker ${s.version} is ready`, 'Click to restart and update. Your settings and overlays stay as they are.', () => updater.install())
  }
})

/** Each step of one version is announced once: an hourly check must not nag. */
const announced = new Set<string>()

/** A Windows notification about an update, said once per key. Clicking it runs `onClick`. */
function announceUpdate(key: string, title: string, body: string, onClick: () => void): void {
  if (announced.has(key)) return
  announced.add(key)
  if (!Notification.isSupported()) return
  try {
    const n = new Notification({ title, body, icon: appIcon })
    n.on('click', () => {
      try {
        onClick()
      } catch (e) {
        log.warn('The update notification\'s action failed:', e)
      }
    })
    n.show()
  } catch (e) {
    log.warn('Could not show the update notification:', e)
  }
}
const speech = new SpeechWorker()
/** Microsoft's neural voices, with the player's own Azure key; the Windows voices otherwise. */
const azure = new AzureSpeech()
const icons = new IconSource(() => store.settings.get().installDir)
const achievementFiles = new AchievementFiles(
  () => store.settings.get().installDir,
  (view) => toMain('state:achievements', view)
)
const gameTables = new GameTables(() => store.settings.get().installDir)
const wikiCatalog = new WikiCatalog((p) => toMain('state:catalog', p))
const castHistory = new CastHistory(join(app.getPath('userData'), 'cast-history.json'))
const recipeBook = new RecipeBook((p) => toMain('state:recipes', p))
const purchases = new PurchaseHistory(join(app.getPath('userData'), 'purchases.json'))
const tradeFavorites = new TradeFavorites(join(app.getPath('userData'), 'tradeskills.json'))
const inventoryFiles = new InventoryFiles(
  () => store.settings.get().installDir,
  new ItemCatalog(),
  (view) => toMain('state:inventory', view)
)

function load(win: BrowserWindow, page: 'index' | 'overlay' | 'audio', query: Record<string, string> = {}): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev) {
    const qs = new URLSearchParams(query).toString()
    void win.loadURL(`${dev}/${page}.html${qs ? `?${qs}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', `${page}.html`), { query })
  }
}

const overlays = new OverlayManager({
  preload,
  load,
  onBoundsChanged: (id, b) => {
    const s = store.settings.get()
    store.settings.set({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, x: b.x, y: b.y, width: b.width, height: b.height } : o)) })
    toMain('state:settings', store.settings.get())
  }
})

const watcher = new GameWatcher((state, previous) => {
  if (previous.gameRunning && !state.gameRunning) engine.gameClosed()
  if (!previous.gameRunning && state.gameRunning) engine.gameStarted()
  refreshOverlayVisibility()
})

function refreshOverlayVisibility(): void {
  overlays.setShown(
    overlaysVisible({
      onlyWithGame: store.settings.get().overlaysOnlyWithGame,
      arranging: overlays.isArranging,
      state: watcher.state,
      ownPid: process.pid
    })
  )
}

function toMain(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

function toAudio(cmd: AudioCommand | { kind: 'config' }): void {
  if (!audioWindow || audioWindow.isDestroyed()) return
  if (cmd.kind === 'config') audioWindow.webContents.send('audio:config', store.settings.get().audio)
  else audioWindow.webContents.send('audio:play', cmd)
}

const engine = new Engine(
  store,
  new VoiceRouter(speech, azure),
  {
    timers: (views) => {
      overlays.timers(views)
      toMain('state:timers', views)
    },
    alert: (p) => overlays.alert(p),
    audio: (cmd) => toAudio(cmd),
    status: (s) => toMain('state:status', s),
    feed: (item) => toMain('state:feed', item),
    archive: (a) => toMain('state:archive', a),
    motes: (m) => toMain('state:motes', m),
    moteScan: (s) => toMain('state:moteScan', s),
    stock: (s) => toMain('state:stock', s),
    combat: (snap) => {
      overlays.combat(snap)
      toMain('state:combat', snap)
    },
    loot: (view) => toMain('state:loot', view),
    respawns: (view) => toMain('state:respawns', view),
    pet: (update) => {
      const character = characterKey(store.settings.get().logFile)
      if (!character) return
      void petStore.merge(character, update).then(async (changed) => changed && toMain('state:pet', { character, ...(await petStore.get(character)) }))
    },
    buffs: (view) => toMain('state:buffs', view)
  },
  appEngineEnv({
    dataDir: app.getPath('userData'),
    soundDirs: () => {
      const install = store.settings.get().installDir
      return [join(app.getPath('userData'), 'sounds'), join(install, 'AudioTriggers', 'default'), join(install, 'AudioTriggers', 'shared')]
    }
  })
)

interface WindowPlace {
  bounds: Rectangle
  maximized: boolean
}

const windowPlaceFile = () => join(app.getPath('userData'), 'window.json')

/** Where the main window was last, if that spot is still on a connected monitor. */
function savedWindowPlace(): WindowPlace | null {
  try {
    const place = JSON.parse(readFileSync(windowPlaceFile(), 'utf8')) as WindowPlace
    const b = place.bounds
    // Enough of the title bar must land on some display to grab it; otherwise use the default spot.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x + b.width - 100 > a.x && b.x + 100 < a.x + a.width && b.y >= a.y - 10 && b.y + 30 < a.y + a.height
    })
    return visible ? place : null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('Could not read the saved window position', e)
    return null
  }
}

let placeTimer: NodeJS.Timeout | undefined
function rememberWindowPlace(now = false): void {
  clearTimeout(placeTimer)
  const write = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    const place: WindowPlace = { bounds: mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }
    try {
      writeFileSync(windowPlaceFile(), JSON.stringify(place))
    } catch (e) {
      // Not worth interrupting anything over; the window opens in the default spot next time.
      log.warn('Could not save the window position', e)
    }
  }
  if (now) write()
  else placeTimer = setTimeout(write, 500)
}

function createMainWindow(): void {
  const place = savedWindowPlace()
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    ...(place?.bounds ?? {}),
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0f1117',
    title: 'Legends Tracker',
    icon: appIcon,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1117', symbolColor: '#9aa3b2', height: 38 },
    webPreferences: { preload, sandbox: true }
  })
  mainWindow.on('ready-to-show', () => {
    if (place?.maximized) mainWindow?.maximize()
    mainWindow?.show()
  })
  for (const event of ['move', 'resize', 'maximize', 'unmaximize'] as const) mainWindow.on(event as 'move', () => rememberWindowPlace())
  mainWindow.on('close', (e) => {
    rememberWindowPlace(true)
    if (!quitting) {
      // Overlays and audio keep running from the tray.
      e.preventDefault()
      mainWindow?.hide()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(mainWindow, 'index')
}

function createAudioWindow(): void {
  audioWindow = new BrowserWindow({
    show: false,
    webPreferences: { preload, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  })
  audioWindow.webContents.on('did-finish-load', () => toAudio({ kind: 'config' }))
  load(audioWindow, 'audio')
}

async function createTray(): Promise<void> {
  tray = new Tray(nativeImage.createFromPath(appIcon).resize({ width: 16, height: 16 }))
  tray.setToolTip('Legends Tracker')
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Open', click: () => showMain() },
      { label: overlays.isArranging ? 'Lock overlays' : 'Arrange overlays', click: () => setArranging(!overlays.isArranging) },
      { label: store.settings.get().audio.muted ? 'Unmute' : 'Mute', click: () => toggleMute() },
      ...(updater.status.state === 'ready'
        ? [{ label: `Restart to update to ${updater.status.version}`, click: () => updater.install() }]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  tray.on('click', () => showMain())
  tray.on('right-click', () => tray?.popUpContextMenu(menu()))
}

function showMain(): void {
  if (!mainWindow) createMainWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

function setArranging(on: boolean): void {
  overlays.setArranging(on)
  refreshOverlayVisibility()
  toMain('state:arranging', on)
}

function toggleMute(): void {
  const s = store.settings.get()
  saveSettings({ ...s, audio: { ...s.audio, muted: !s.audio.muted } })
}

/**
 * Every process of this app at below-normal priority while the setting is on, apart from audio:
 * the audio window and Chromium's audio service stay normal so alerts never stutter.
 */
function applyPriority(): void {
  const on = store.settings.get().yieldToGame
  const keep = new Set([audioWindow?.webContents.getOSProcessId()])
  for (const m of app.getAppMetrics()) {
    if (keep.has(m.pid) || /audio/i.test(m.serviceName ?? '')) continue
    yieldPriority(m.pid, on)
  }
}

function saveSettings(next: AppSettings): AppSettings {
  const prev = store.settings.get()
  store.settings.set(next)
  if (next.yieldToGame !== prev.yieldToGame) applyPriority()
  overlays.apply(next.overlays)
  refreshOverlayVisibility()
  toAudio({ kind: 'config' })
  engine.reconfigure()
  if (next.installDir !== prev.installDir) {
    void engine.loadSpells()
    // A log from the old folder no longer fits; follow the newest character log in the new one.
    if (!logIsIn(next.logFile, next.installDir)) void followNewestLog(next.installDir)
  }
  if (next.logFile !== prev.logFile && (engine.status.watching || next.autoStart)) void engine.startWatching()
  toMain('state:settings', next)
  return next
}

async function followNewestLog(dir: string): Promise<void> {
  const newest = (await listLogs(dir))[0]?.path ?? ''
  const s = store.settings.get()
  if (s.installDir === dir && s.logFile !== newest && !logIsIn(s.logFile, dir)) saveSettings({ ...s, logFile: newest })
}

/** Dialogs sit on the main window when there is one. */
function openDialog(opts: Electron.OpenDialogOptions) {
  return mainWindow && !mainWindow.isDestroyed() ? dialog.showOpenDialog(mainWindow, opts) : dialog.showOpenDialog(opts)
}

function saveDialog(opts: Electron.SaveDialogOptions) {
  return mainWindow && !mainWindow.isDestroyed() ? dialog.showSaveDialog(mainWindow, opts) : dialog.showSaveDialog(opts)
}

function showError(message: string, detail: string): void {
  const opts: Electron.MessageBoxOptions = { type: 'error', title: 'Legends Tracker', message, detail }
  void (mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, opts) : dialog.showMessageBox(opts))
}

/** Whether `path` is `dir` or somewhere inside it. */
function isInside(dir: string, path: string): boolean {
  const r = relative(resolve(dir), resolve(path))
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

function registerIpc(): void {
  // A handler that fails is logged under its channel; the page still sees the rejection.
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...(args as A))
      } catch (e) {
        log.error(`${channel} failed:`, e)
        throw e
      }
    })

  handle('app:state', () => ({
    settings: store.settings.get(),
    status: engine.status,
    timers: engine.board.views(),
    feed: engine.feed,
    archive: engine.archive,
    character: engine.character(),
    characterKey: engine.characterKey(),
    voices: speech.voices,
    speechError: speech.failed,
    arranging: overlays.isArranging,
    devices: audioDevices,
    triggerErrors: engine.triggers.errors
  }))
  handle('app:openLogs', () => shell.openPath(logDir()))
  handle('settings:save', (s: AppSettings) => {
    const clean = sanitizeSettings(s, store.settings.get())
    if (!clean) throw new Error('Settings were not saved: they were not in the expected form.')
    return saveSettings(clean)
  })
  handle('character:save', (input: CharacterSettings) => {
    const s = store.settings.get()
    const key = characterKey(s.logFile)
    if (!key) return
    const c = sanitizeCharacter(input, store.characterOf(s.logFile))
    if (!c) throw new Error('The character was not saved: it was not in the expected form.')
    store.settings.set({ ...s, characters: { ...s.characters, [key]: c } })
    engine.reconfigure()
    toMain('state:character', c)
  })
  handle('watch:start', () => engine.startWatching())
  handle('watch:stop', () => engine.stopWatching())
  handle('simulate', (text: string) => engine.simulate(text))

  handle('triggers:get', () => store.triggers.get())
  handle('triggers:save', (input: Trigger[]) => {
    const list = sanitizeTriggers(input)
    if (!list) throw new Error('Triggers were not saved: they were not a list.')
    store.triggers.set(list)
    engine.reconfigure()
    engine.triggersChanged()
    return engine.triggers.errors
  })
  handle('triggers:test', (input: Trigger, line: string) => {
    const t = sanitizeTrigger(input)
    if (!t) throw new Error('Not a trigger.')
    return testTrigger(t, typeof line === 'string' ? line : '', engine.status.character || 'You')
  })
  // A file that is not a trigger list gets a message box and null, the same as cancelling.
  handle('triggers:import', async () => {
    const r = await openDialog({ filters: [{ name: 'Trigger files', extensions: ['json'] }], properties: ['openFile'] })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch (e) {
      log.warn(`Trigger import: could not read ${file}`, e)
      showError(`${basename(file)} could not be imported.`, e instanceof SyntaxError ? `It is not valid JSON: ${e.message}` : (e as Error).message)
      return null
    }
    const inner = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { triggers?: unknown }).triggers : parsed
    const list = sanitizeTriggers(inner)
    if (!list) {
      showError(`${basename(file)} could not be imported.`, 'It holds no list of triggers: expected a JSON list, or an object with a "triggers" list.')
      return null
    }
    return list
  })
  handle('triggers:export', async (input: Trigger[]) => {
    const list = sanitizeTriggers(input)
    if (!list) throw new Error('Nothing to export: not a list of triggers.')
    const r = await saveDialog({ defaultPath: 'eql-triggers.json', filters: [{ name: 'Trigger files', extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return false
    await fs.writeFile(r.filePath, JSON.stringify(list, null, 2), 'utf8')
    return true
  })

  handle('spells:known', () => engine.knownSpells())
  handle('spells:search', (q: string) => engine.book?.search(q).map(summarize) ?? [])
  handle('spells:explain', (rankedName: string) => engine.explain(rankedName))
  handle('spells:rule', (name: string, rule: SpellRule | null) => {
    const rules = { ...store.rules.get() }
    if (rule && Object.values(rule).some((v) => v !== undefined && v !== '')) rules[name] = rule
    else delete rules[name]
    store.rules.set(rules)
    engine.reconfigure()
    return engine.knownSpells()
  })
  handle('spells:checkLog', (mb: number) => engine.checkLog(mb))
  // Duration focus effects from the spell book, e.g. "Extended Enhancement II", with their limits.
  handle('focus:search', (q: string) =>
    (engine.book?.search(q, 200, true) ?? []).filter(isDurationFocus).slice(0, 30).map((s) => focusFromSpell(s, 'item', ''))
  )

  handle('logs:list', () => listLogs(store.settings.get().installDir))
  handle('logs:overview', () => engine.logsOverview())
  handle('logs:archive', (path: string) => engine.archiveNow(path))
  handle('logs:compress', (path: string) => engine.compressLoose(path))
  // Only a file in the game's Logs folder or the archive folder is shown; anything else opens the archive folder.
  handle('logs:reveal', (path: string) => {
    const installDir = store.settings.get().installDir
    const archive = engine.archiveDir()
    const allowed = typeof path === 'string' && !!path && ((!!installDir && isInside(join(installDir, 'Logs'), path)) || isInside(archive, path))
    if (allowed && existsSync(path)) return shell.showItemInFolder(path)
    return shell.openPath(archive)
  })

  handle('overlays:arrange', (on: boolean) => setArranging(on))
  handle('overlays:demo', () => demoTimers())
  ipcMain.on('overlay:mouse', (_e, id: string, interactive: boolean) => {
    if (typeof id === 'string') overlays.setMouse(id, interactive === true)
  })
  // A meter overlay's own header changes what it shows; the choice is kept with the overlay.
  ipcMain.on('overlay:meter', (_e, id: string, patch: unknown) => {
    const s = store.settings.get()
    const o = s.overlays.find((x) => x.id === id && x.kind === 'meter')
    if (!o || !patch || typeof patch !== 'object') return
    const meter = meterOptions({ ...o.meter, ...(patch as object) }, o.meter)
    saveSettings({ ...s, overlays: s.overlays.map((x) => (x.id === id ? { ...x, meter } : x)) })
  })

  handle('combat:get', () => engine.combatSnapshot())
  handle('combat:segment', (id: string) => (typeof id === 'string' ? engine.combatSegment(id) : null))
  handle('combat:newSession', () => engine.newCombatSession())
  handle('combat:addMember', (name: string) => {
    if (typeof name === 'string') engine.meter.addMember(name.slice(0, 64))
    return engine.combatSnapshot()
  })
  handle('combat:removeMember', (name: string) => {
    if (typeof name === 'string') engine.meter.removeMember(name)
    return engine.combatSnapshot()
  })
  handle('combat:rebuild', (minutes: number) => engine.rebuildCombat(Math.max(1, Math.min(1440, Number(minutes) || 60))))
  handle('loot:get', () => engine.lootView())
  handle('respawns:get', () => engine.respawnView())
  handle('buffs:get', () => engine.buffView())
  handle('buffs:setWanted', (list: unknown) =>
    engine.setWantedBuffs(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 2000) : null)
  )
  // Tradeskills: the wiki's recipes, what the character paid for things, and the favourites.
  handle('trade:recipes', async () => {
    const file = await recipeBook.stored()
    return { file, stale: recipeBook.isStale(file), progress: recipeBook.progress }
  })
  handle('trade:refresh', async () => {
    const file = await recipeBook.refresh()
    return { file, stale: recipeBook.isStale(file), progress: recipeBook.progress }
  })
  handle('trade:purchases', async (character: unknown) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    const installDir = store.settings.get().installDir
    if (!installDir) return {}
    return purchases.latest({ logPath: join(installDir, 'Logs', `eqlog_${character}.txt`), archiveDir: engine.archiveDir(), stem: `eqlog_${character}` })
  })
  handle('trade:favorites', () => tradeFavorites.get())
  handle('trade:saveFavorites', (input: unknown) => tradeFavorites.set(input))
  // The pet: what it wears and which one it is, from the log (read back once a session per
  // character, then followed live), and every pet the character's classes can summon.
  handle('pet:state', async (character: unknown, classes: unknown, level: unknown) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    const ids = Array.isArray(classes) ? classes.filter((c): c is string => typeof c === 'string') : []
    const lvl = typeof level === 'number' ? level : 50
    const book = engine.book
    if (!petScanned.has(character) && book) {
      petScanned.add(character)
      const logFile = store.settings.get().logFile
      const path = characterKey(logFile) === character ? logFile : join(dirname(logFile), `eqlog_${character}.txt`)
      if (logFile) await petStore.merge(character, await scanPetLog(path, (name) => petSummonName(book, name)))
    }
    return { character, ...(await petStore.get(character)), spells: book ? petSpells(book, ids, lvl) : [], spellsLoaded: !!book }
  })
  handle('pet:profile', (spell: unknown, force: unknown) => {
    if (typeof spell !== 'string' || !spell.trim()) throw new Error('Not a spell.')
    return petWiki.profile(spell.trim(), force === true).then((profile) => ({ spell: spell.trim(), profile }))
  })
  // A respawn timer is an ordinary trigger, made or remade here and editable on the Triggers page.
  handle('respawns:setTimer', (input: unknown) => {
    const spec = sanitizeRespawnTimer(input)
    if (!spec) throw new Error('The timer was not saved: it needs a name and a length.')
    const list = store.triggers.get()
    const id = respawnTriggerId(spec.name)
    const existing = list.find((t) => t.id === id)
    const trigger = respawnTrigger(spec, existing)
    store.triggers.set(existing ? list.map((t) => (t.id === id ? trigger : t)) : [...list, trigger])
    engine.reconfigure()
    engine.triggersChanged()
    return engine.respawnView()
  })
  handle('respawns:removeTimer', (name: unknown) => {
    if (typeof name !== 'string') throw new Error('Not a name.')
    const id = respawnTriggerId(name)
    store.triggers.set(store.triggers.get().filter((t) => t.id !== id))
    engine.reconfigure()
    engine.triggersChanged()
    return engine.respawnView()
  })
  handle('respawns:forget', (key: unknown) => {
    if (typeof key === 'string') engine.respawns.forget(key)
    return engine.respawnView()
  })

  handle('motes:get', () => engine.moteView())
  handle('motes:start', () => engine.motes.startManual(Date.now()))
  handle('motes:stop', () => engine.motes.stop(Date.now()))
  handle('motes:rescan', () => engine.rebuildMoteHistory())
  handle('stock:get', () => engine.stockView())
  handle('stock:counts', (counts: Record<string, number>) => engine.setStockCounts(counts))
  handle('stock:item', (item: { name: string; lvl: number; xp: number; to: number }) => engine.setStockItem(item))
  handle('stock:autoAdd', (on: boolean) => engine.setStockAutoAdd(on))
  handle('stock:apply', () => engine.applyPlan())
  handle('stock:readScreen', () => readMotesFromScreen())
  handle('motes:pause', (at?: number) => engine.motes.pause(at ?? Date.now(), Date.now()))
  handle('motes:resume', () => engine.motes.resume(Date.now()))
  handle('motes:forget', (id: string) => {
    engine.motes.state.sessions = engine.motes.state.sessions.filter((s) => s.id !== id)
    store.motes.set(engine.motes.state)
    return engine.moteView()
  })

  handle('update:status', () => ({ status: updater.status, version: app.getVersion() }))
  handle('update:check', () => updater.check())
  handle('update:install', () => updater.install())

  handle('audio:test', (text: string) => engine.speak(text, true))
  handle('audio:azure', async () => {
    await azure.load()
    return azure.status()
  })
  handle('audio:setAzure', (region: unknown, key: unknown) => {
    if (typeof region !== 'string' || typeof key !== 'string' || key.length > 200 || region.length > 40) throw new Error('Not a region and key.')
    return azure.configure(region, key)
  })
  // engine.playSound reads any file it is given, absolute paths included; it only ever plays it.
  handle('audio:sound', (file: string) => engine.playSound(String(file), 1))
  handle('audio:sounds', () => engine.listSounds())
  handle('audio:mute', () => toggleMute())

  handle('achievements:characters', async () => ({
    current: characterKey(store.settings.get().logFile),
    available: (await checkGameFolder(store.settings.get().installDir)).achievements
  }))
  handle('achievements:load', (character: string) => achievementFiles.load(character))
  handle('achievements:marks', (character: string, marks: AchMarks) => achievementFiles.saveMarks(character, marks))
  handle('achievements:exportPath', (character: string) => achievementFiles.exportPath(character))

  // Which characters have a given export, and which one is being played.
  handle('character:exports', async () => {
    const check = await checkGameFolder(store.settings.get().installDir)
    return { current: characterKey(store.settings.get().logFile), achievements: check.achievements, inventory: check.inventory }
  })
  handle('inventory:load', (character: string, refresh?: boolean) => inventoryFiles.load(character, !!refresh))
  handle('inventory:lookup', (names: string[]) => inventoryFiles.lookup(names))
  handle('character:sheet', (character: string) => inventoryFiles.sheet(character))
  handle('character:saveSheet', (character: string, sheet: CharacterSheet) => inventoryFiles.saveSheet(character, sheet))

  // The upgrade finder's catalog: what is stored, and a download when asked (or when none is stored).
  handle('gear:catalog', async () => {
    const file = await wikiCatalog.stored()
    return { file, stale: wikiCatalog.isStale(file), progress: wikiCatalog.progress }
  })
  handle('gear:catalogRefresh', async () => {
    const file = await wikiCatalog.refresh()
    return { file, stale: wikiCatalog.isStale(file), progress: wikiCatalog.progress }
  })

  // Focus effects on gear, read from the game's spell file: each one's line and strength for these
  // classes at this level, and which of their spells each line improves.
  // Judged on what the character casts: their casts over the last `days` days of play, from the log
  // and its archives.
  handle('gear:foci', async (names: string[], classes: string[], level: number, character: string, days: number) => {
    const book = engine.book
    if (!book) return null
    const specs = [...new Set(names)].map((n) => book.named(n)).flatMap((s) => (s ? [focusSpec(s)] : [])).filter((f) => f !== null)
    const installDir = store.settings.get().installDir
    const recent = character
      ? await castHistory
          .recent({ logPath: join(installDir, 'Logs', `eqlog_${character}.txt`), archiveDir: engine.archiveDir(), stem: `eqlog_${character}`, days })
          .catch(() => null)
      : null
    // "Envenomed Bolt X" is Envenomed Bolt at rank X: one spell, whatever the rank.
    const casts: Record<string, number> = {}
    for (const [name, n] of Object.entries(recent?.counts ?? {})) {
      const spell = book.resolve(name)?.spell.name
      if (spell) casts[spell] = (casts[spell] ?? 0) + n
    }
    const report = focusReport(specs, castableSpells(book.all(), classes, level), classes, level, casts)
    return { ...report, window: recent ? { total: recent.total, from: recent.from, to: recent.to } : null }
  })

  handle('stats:caps', async (classes: string[], level: number) => ({
    skills: await gameTables.skillCaps(classes, level),
    ac: await gameTables.acCaps(classes, level),
    factors: await gameTables.classFactors(classes, level)
  }))
  handle('stats:readAAs', () => readAasFromLog(store.settings.get().logFile))
  handle('stats:readScreen', () => readStatsFromScreen())

  handle('game:check', (dir?: string) => checkGameFolder(dir ?? store.settings.get().installDir))
  handle('game:find', async () => {
    const dir = await findInstall()
    if (dir) saveSettings({ ...store.settings.get(), installDir: dir })
    return dir
  })
  // Takes the game folder, or a folder in or above it, and returns the game folder it settled on.
  handle('game:choose', async () => {
    const s = store.settings.get()
    const r = await openDialog({
      title: 'Choose your EverQuest Legends folder',
      defaultPath: s.installDir || undefined,
      properties: ['openDirectory']
    })
    if (r.canceled) return { canceled: true, picked: '', dir: '' }
    const dir = resolveGameFolder(r.filePaths[0])
    if (dir) saveSettings({ ...store.settings.get(), installDir: dir })
    return { canceled: false, picked: r.filePaths[0], dir }
  })

  handle('dialog:folder', async () => {
    const r = await openDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.on('audio:devices', (_e, devices: { deviceId: string; label: string }[]) => {
    audioDevices = devices
    toMain('state:devices', devices)
  })
}

/**
 * Reads mote counts off the screen: the game's currency window, open wherever it is. This window
 * steps aside for a moment so it does not cover the game, then every monitor is captured and read
 * with Windows' OCR. Nothing here touches the game's process.
 *
 * Two reads: the first finds the mote rows; the second reads a small image rebuilt from just those
 * rows, each name set close beside its count, because OCR misses lone digits far out in a column.
 */
/** Steps this window aside, captures every monitor, and hands the captures over. */
async function withScreens<T>(read: (shots: string[]) => Promise<T>): Promise<T> {
  const wasVisible = !!mainWindow?.isVisible()
  mainWindow?.hide()
  let shots: string[] = []
  try {
    await new Promise((r) => setTimeout(r, 900))
    shots = await captureScreens()
    return await read(shots)
  } finally {
    void discardScreens(shots)
    if (wasVisible) {
      mainWindow?.show()
      mainWindow?.focus()
    }
  }
}

/**
 * Reads the in-game Inventory window's Stats tab: a first read of each monitor finds the window, a
 * second reads just that area at four times the size, where the small font's slashes survive better.
 */
function readStatsFromScreen() {
  return withScreens(async (shots) => {
    // Only the monitor the window is on counts: other windows can carry a stray "AC" or "Luck".
    let best: { path: string; first: ReturnType<typeof statsWindowFromScreen> } | null = null
    for (const path of shots) {
      const first = statsWindowFromScreen(await ocrImage(path, 2))
      if (first.area && Object.keys(first.values).length > Object.keys(best?.first.values ?? {}).length) best = { path, first }
    }
    if (!best) return { values: {}, rows: [], screens: shots.length }
    const a = best.first.area!
    const second = statsWindowFromScreen(await ocrImage(best.path, 4, { width: a.w, height: a.h, rowHeight: a.h, pieces: [{ from: a, x: 0, y: 0 }] }))
    return { values: { ...best.first.values, ...second.values }, rows: second.rows.length ? second.rows : best.first.rows, screens: shots.length }
  })
}

async function readMotesFromScreen() {
  return withScreens(async (shots) => {
    const found: Record<string, number> = {}
    const rowsRead: string[] = []
    let sample: string[] = []
    for (const path of shots) {
      const words = await ocrImage(path, 2)
      const moteRows = findMoteRows(words)
      if (moteRows.length) {
        const layout = composeRows(moteRows)
        const second = countsFromComposite(await ocrImage(path, 3, layout), moteRows, layout)
        moteRows.forEach((row, i) => {
          const n = second[i] ?? row.count
          if (n === null) return
          found[row.rank] = n
          rowsRead.push(`${row.text.replace(/\s*\d[\d,.]*$/, '')} → ${n}`)
        })
      }
      if (!sample.length) sample = ocrRows(words).map((x) => x.text).filter((t) => /potential|mote/i.test(t)).slice(0, 20)
    }
    return { counts: found, rows: rowsRead, nearMisses: rowsRead.length ? [] : sample, screens: shots.length }
  })
}

/** A first install gets its overlays laid out on the primary monitor, not wherever the defaults point. */
function placeOverlaysForNewInstall(): void {
  const a = screen.getPrimaryDisplay().workArea
  const s = store.settings.get()
  const place: Record<string, { x: number; y: number; width: number; height: number }> = {
    alerts: { x: a.x + Math.round(a.width / 2) - 400, y: a.y + Math.round(a.height * 0.18), width: 800, height: 180 },
    buffs: { x: a.x + a.width - 720, y: a.y + Math.round(a.height * 0.3), width: 340, height: 420 },
    targets: { x: a.x + a.width - 370, y: a.y + Math.round(a.height * 0.3), width: 340, height: 420 },
    meter: { x: a.x + 40, y: a.y + a.height - 360, width: 380, height: 300 }
  }
  store.settings.set({ ...s, overlays: s.overlays.map((o) => (place[o.id] ? { ...o, ...place[o.id] } : o)) })
}

function demoTimers(): void {
  const book = engine.book
  const now = Date.now()
  const add = (spellName: string, rank: number, target: string, seconds: number, overlay: string) => {
    const s = book?.named(spellName)
    engine.board.upsert({
      key: timerKey(`demo ${spellName}`, target),
      id: engine.board.nextId(),
      label: spellName,
      target,
      source: 'spell',
      spell: spellName,
      category: s?.category ?? 'buff',
      icon: s?.icon,
      color: s?.beneficial ? '#3fb6a8' : '#b46ae0',
      overlay,
      startedAt: now,
      endsAt: now + seconds * 1000,
      exact: seconds % 2 === 0,
      warnSec: 10,
      rank,
      onWarn: [],
      onExpire: [],
      warned: true,
      graceMs: 0
    })
  }
  add('Spirit of the Puma', 10, 'You', 45, 'buffs')
  add('Slugs Healing', 5, 'Aldric', 22, 'buffs')
  add('Envenomed Bolt', 10, 'A ratman warrior', 54, 'targets')
  add('Odium', 10, 'A ratman warrior', 12, 'targets')
  add('Plague', 7, 'Slizik the Mighty', 96, 'targets')
  overlays.alert({ text: 'Demo alert — overlays are here', color: '#ffd84d', durationSec: 6 })
  demoCombat()
}

/**
 * A made-up fight for the meter windows, run through a meter of its own so the real one keeps its
 * fights. The next real snapshot replaces it.
 */
function demoCombat(): void {
  const me = engine.status.character || 'Kelwyn'
  const meter = new CombatMeter({ fightGapSec: 10, newSessionOnZone: true })
  meter.setSelf(me)
  const stamp = (t: number) => {
    const d = new Date(t)
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
    const two = (n: number) => String(n).padStart(2, '0')
    return `${day} ${mon} ${String(d.getDate()).padStart(2, ' ')} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} ${d.getFullYear()}`
  }
  const t0 = Date.now() - 42_000
  const lines: [number, string][] = [
    [0, 'You have entered The Plane of Fear 4 (Refined).'],
    [1, "Jobarab told you, 'Attacking a fetid fiend Master.'"],
    [1, 'Aldric has joined the group.'],
    [1, 'You punch a fetid fiend for 142 points of damage.'],
    [1, 'Jobarab slashes a fetid fiend for 61 points of damage.'],
    [2, 'A fetid fiend hits YOU for 95 points of damage.'],
    [2, 'You kick a fetid fiend for 611 points of damage. (Critical)'],
    [3, 'Aldric hit a fetid fiend for 402 points of magic damage by Ice Spear.'],
    [4, 'You try to punch a fetid fiend, but miss!'],
    [4, 'A fetid fiend tries to hit YOU, but YOU dodge!'],
    [5, 'A fetid fiend has taken 525 damage from your Envenomed Bolt X.'],
    [6, 'Brenna slashes a fetid fiend for 88 points of damage.'],
    [7, 'Aldric healed Kelwyn for 320 (410) hit points by Superior Healing.'],
    [8, 'You strike a fetid fiend for 129 points of damage. (Critical)'],
    [9, 'A fetid fiend is pierced by YOUR thorns for 3 points of non-melee damage.'],
    [11, 'A fetid fiend has taken 534 damage from your Envenomed Bolt X.'],
    [12, 'Jobarab hit a fetid fiend for 200 points of prismatic damage by Puma Maw V.'],
    [14, 'You punch a fetid fiend for 156 points of damage.'],
    [15, 'A fetid fiend hits YOU for 122 points of damage.'],
    [17, 'A fetid fiend has taken 540 damage from your Envenomed Bolt X.'],
    [18, 'Brenna hit a fetid fiend for 260 points of cold damage by Frost Spear.'],
    [20, 'You bash a fetid fiend for 214 points of damage.'],
    [21, 'You have slain a fetid fiend!']
  ]
  for (const [sec, text] of lines) {
    const line = parseLogLine(`[${stamp(t0 + sec * 1000)}] ${text.replace(/Kelwyn/g, me)}`)
    if (line) meter.handle(line)
  }
  const snap = meter.snapshot()
  overlays.combat(snap)
  toMain('state:combat', snap)
}

// A second copy started with --quit is a request to shut this one down properly (settings written,
// overlays closed), from a script or a launcher about to start a fresh one; any other second copy
// just brings this one to the front.
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quit')) {
    log.info('Quitting: another copy asked with --quit')
    app.quit()
  } else showMain()
})
app.on('render-process-gone', (_e, wc, d) => log.error(`A page stopped (${d.reason}, exit ${d.exitCode}): ${wc.getURL()}`))
app.on('child-process-gone', (_e, d) => {
  if (d.reason !== 'clean-exit') log.warn(`${d.type} process${d.name ? ` (${d.name})` : ''} stopped: ${d.reason}, exit ${d.exitCode}`)
})

// Quitting waits (up to a few seconds) for settings to reach disk: a change saved just before Quit is
// still in its 400 ms wait. The first before-quit holds the quit, shuts down, writes, then quits again.
// An update's quitAndInstall comes through here the same way.
let shutDown = false
let shuttingDown = false
app.on('before-quit', (e) => {
  quitting = true
  // A second copy started by mistake quits at once and must not write over the first one's files.
  if (shutDown || !primaryInstance) return
  e.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  log.info('Quitting')
  for (const [name, stop] of [
    ['engine', () => engine.shutdown()],
    ['updater', () => updater.stop()],
    ['game watcher', () => watcher.stop()],
    ['speech', () => speech.stop()],
    ['overlays', () => overlays.destroy()]
  ] as const) {
    try {
      stop()
    } catch (err) {
      log.warn(`Stopping the ${name} failed`, err)
    }
  }
  const limit = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000))
  void Promise.race([Promise.allSettled([store.flushAll()]), limit]).then((r) => {
    if (r === 'timeout') log.warn('Saving settings took over 3s; quitting anyway')
    shutDown = true
    app.quit()
  })
})
app.on('window-all-closed', () => {
  // Stay resident in the tray; Quit from the tray menu ends the app.
})

void app.whenReady().then(async () => {
  app.setAppUserModelId(appUserModelId())
  ensureSourceShortcut(appIcon)
  const ownPage = (url: string) => url.startsWith('file:') || url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\u0000')
  // Output-device names are only visible to pages granted 'media'; grant it to our own pages only.
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!wc && ownPage(wc.getURL()))
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && ownPage(wc.getURL())))
  protocol.handle('eqicon', async (req) => {
    const url = new URL(req.url)
    const n = Number(url.pathname.replace(/\//g, ''))
    const png = !Number.isFinite(n) ? null : url.hostname === 'item' ? await icons.itemPng(n) : await icons.png(n)
    return png ? new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' } }) : new Response(null, { status: 404 })
  })
  registerIpc()
  createAudioWindow()
  createMainWindow()
  void speech.start().then(() => toMain('state:voices', { voices: speech.voices, error: speech.failed }))
  await engine.init()
  if (store.recovered.length) {
    const names = store.recovered.map((f) => basename(f)).join(', ')
    engine.pushFeed('warn', `Some saved settings could not be read and were set aside (${names}, in the app's data folder); defaults are in use for them.`)
  }
  if (store.settingsFresh) placeOverlaysForNewInstall()
  overlays.apply(store.settings.get().overlays)
  watcher.start()
  updater.start()
  // New windows (overlays, the main window reopened) start at normal priority; catch them up.
  applyPriority()
  // Renderers start a moment after their windows; look again once they have.
  for (const ms of [3000, 10_000]) setTimeout(applyPriority, ms).unref()
  app.on('browser-window-created', () => setTimeout(applyPriority, 1500))
  setInterval(applyPriority, 60_000).unref()
  await createTray()
})
