import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, screen, session, shell, Tray, type Rectangle } from 'electron'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Store, characterKey } from './store'
import { Engine, type AudioCommand } from './engine'
import { SpeechWorker } from './speech'
import { IconSource } from './icons'
import { OverlayManager } from './overlays'
import { GameWatcher, overlaysVisible } from './gameWatcher'
import { Updater } from './updater'
import { yieldPriority } from './priority'
import { AchievementFiles } from './achievements'
import { InventoryFiles } from './inventory'
import { ItemCatalog } from './items'
import { GameTables, readAasFromLog } from './stats'
import { captureScreens, ocrImage } from './ocr'
import { composeRows, countsFromComposite, findMoteRows, rows as ocrRows, statsWindowFromScreen } from '../core/screenText'
import { checkGameFolder, findInstall, listLogs, logIsIn, resolveGameFolder } from './game'
import { summarize } from '../core/spells'
import { focusFromSpell, isDurationFocus } from '../core/focus'
import { testTrigger } from '../core/triggers'
import { timerKey } from '../core/spellTracker'
import type { AppSettings, CharacterSettings, CharacterSheet, SpellRule, Trigger } from '../shared/types'
import type { AchMarks } from '../core/achievements'

// Settings live in %APPDATA%\Legends Tracker. EQL_USER_DATA points a development or test run at a
// separate profile, so a trial never touches real settings.
app.setPath('userData', process.env['EQL_USER_DATA'] || join(app.getPath('appData'), 'Legends Tracker'))
if (!process.env['EQL_USER_DATA']) carryOverSettings(join(app.getPath('appData'), 'EQL Audio Triggers'), app.getPath('userData'))

/** The app was called EQL Audio Triggers until 2026-09-24; bring its settings across once. The old folder is left as it was. */
function carryOverSettings(from: string, to: string): void {
  if (existsSync(join(to, 'settings.json')) || !existsSync(join(from, 'settings.json'))) return
  mkdirSync(to, { recursive: true })
  for (const f of ['settings.json', 'triggers.json', 'spell-rules.json', 'casts.json', 'motes.json']) {
    if (existsSync(join(from, f))) cpSync(join(from, f), join(to, f))
  }
  if (existsSync(join(from, 'sounds'))) cpSync(join(from, 'sounds'), join(to, 'sounds'), { recursive: true })
}

protocol.registerSchemesAsPrivileged([{ scheme: 'eqicon', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (!app.requestSingleInstanceLock()) app.quit()

const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '../..')
const preload = join(__dirname, '../preload/index.js')

let mainWindow: BrowserWindow | null = null
let audioWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let audioDevices: { deviceId: string; label: string }[] = []

const store = new Store(join(resources, 'defaults', 'triggers.json'))
const appIcon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(resources, 'build', 'icon.png')
const updater = new Updater((s) => {
  toMain('state:update', s)
  if (s.state === 'ready') engine.pushFeed('info', `Version ${s.version} is ready: restart to update.`)
})
const speech = new SpeechWorker()
const icons = new IconSource(() => store.settings.get().installDir)
const achievementFiles = new AchievementFiles(
  () => store.settings.get().installDir,
  (view) => toMain('state:achievements', view)
)
const gameTables = new GameTables(() => store.settings.get().installDir)
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
  speech,
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
    stock: (s) => toMain('state:stock', s)
  },
  () => {
    const install = store.settings.get().installDir
    return [join(app.getPath('userData'), 'sounds'), join(install, 'AudioTriggers', 'default'), join(install, 'AudioTriggers', 'shared')]
  }
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
  } catch {
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
    } catch {
      // Not worth interrupting anything over; the window opens in the default spot next time.
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

function registerIpc(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))

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
  handle('settings:save', (s: AppSettings) => saveSettings(s))
  handle('character:save', (c: CharacterSettings) => {
    const s = store.settings.get()
    const key = characterKey(s.logFile)
    if (!key) return
    store.settings.set({ ...s, characters: { ...s.characters, [key]: c } })
    engine.reconfigure()
    toMain('state:character', c)
  })
  handle('watch:start', () => engine.startWatching())
  handle('watch:stop', () => engine.stopWatching())
  handle('simulate', (text: string) => engine.simulate(text))

  handle('triggers:get', () => store.triggers.get())
  handle('triggers:save', (list: Trigger[]) => {
    store.triggers.set(list)
    engine.reconfigure()
    return engine.triggers.errors
  })
  handle('triggers:test', (t: Trigger, line: string) => testTrigger(t, line, engine.status.character || 'You'))
  handle('triggers:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { filters: [{ name: 'Trigger files', extensions: ['json'] }], properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const parsed = JSON.parse(await fs.readFile(r.filePaths[0], 'utf8'))
    const list = Array.isArray(parsed) ? parsed : parsed.triggers
    return Array.isArray(list) ? (list as Trigger[]) : null
  })
  handle('triggers:export', async (list: Trigger[]) => {
    const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: 'eql-triggers.json', filters: [{ name: 'Trigger files', extensions: ['json'] }] })
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
  handle('logs:reveal', (path: string) => (existsSync(path) ? shell.showItemInFolder(path) : shell.openPath(engine.archiveDir())))

  handle('overlays:arrange', (on: boolean) => setArranging(on))
  handle('overlays:demo', () => demoTimers())

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
  handle('audio:sound', (file: string) => engine.playSound(file, 1))
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

  handle('stats:caps', async (classes: string[], level: number) => ({
    skills: await gameTables.skillCaps(classes, level),
    ac: await gameTables.acCaps(classes, level)
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
    const r = await dialog.showOpenDialog(mainWindow!, {
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
    const r = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
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
  try {
    await new Promise((r) => setTimeout(r, 900))
    return await read(await captureScreens())
  } finally {
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
    targets: { x: a.x + a.width - 370, y: a.y + Math.round(a.height * 0.3), width: 340, height: 420 }
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
}

app.on('second-instance', () => showMain())
app.on('before-quit', () => {
  quitting = true
  engine.shutdown()
  updater.stop()
  watcher.stop()
  speech.stop()
  overlays.destroy()
  void store.flushAll()
})
app.on('window-all-closed', () => {
  // Stay resident in the tray; Quit from the tray menu ends the app.
})

void app.whenReady().then(async () => {
  app.setAppUserModelId('legends.tracker')
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
