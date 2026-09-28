import { app, globalShortcut, nativeTheme, Notification } from 'electron'
import { HOTKEYS } from '../shared/hotkeys'
import { promises as fs, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { Store } from './store'
import { Engine } from './engine'
import { appEngineEnv } from './engineEnv'
import { SpeechWorker } from './speech'
import { AzureSpeech, VoiceRouter } from './azureSpeech'
import { IconSource } from './icons'
import { OverlayManager } from './overlays'
import { GameWatcher, overlaysVisible } from './gameWatcher'
import { Updater } from './updater'
import { yieldPriority } from './priority'
import { AchievementFiles } from './achievements'
import { InventoryFiles } from './inventory'
import { ItemCatalog } from './items'
import { GameTables } from './stats'
import { WikiCatalog } from './wikiCatalog'
import { CastHistory, castCounter, dayConsumer } from './castHistory'
import { meleeCounter } from '../core/meleeTally'
import { RecipeBook } from './recipes'
import { PurchaseHistory, purchaseConsumer } from './purchases'
import { FactionBook, FactionHistory, FactionSourceHistory, FactionWiki, factionConsumer, factionSourceConsumer } from '../features/factions/main'
import { LogHistory, type HistoryWhere } from './sources/logHistory'
import { TradeFavorites } from './tradeFavorites'
import { LiveAchievements } from './liveAchievements'
import { SkillHistory, skillConsumer } from './skillHistory'
import { PetStore, PetWiki } from './pets'
import { listLogs, logIsIn } from './game'
import { Windows, loadPage } from './windows'
import { appIcon, preloadPath, resources } from './bootstrap'
import { log } from './log'
import { sources } from './sources/registry'
import { jobs } from './sources/jobs'
import { settingsSummary } from './diagnostics'
import type { AppSettings, Trigger, WatchStatus } from '../shared/types'
import type { AudioDevice } from '../shared/ipc'
import { cacheDir } from './paths'
import { logFileFor, logStem } from './storeCore'

/**
 * Everything the main process runs, built once. The IPC handlers, the lifecycle and the start-up all
 * work through this, so none of them keeps state of its own.
 */
export interface AppContext {
  store: Store
  engine: Engine
  windows: Windows
  overlays: OverlayManager
  watcher: GameWatcher
  updater: Updater
  speech: SpeechWorker
  azure: AzureSpeech
  icons: IconSource
  achievementFiles: AchievementFiles
  inventoryFiles: InventoryFiles
  gameTables: GameTables
  wikiCatalog: WikiCatalog
  castHistory: CastHistory
  /** The character's own melee day by day, read the way casts are: what worn effects and procs are weighed against. */
  meleeHistory: CastHistory
  recipeBook: RecipeBook
  purchases: PurchaseHistory
  /** Faction changes over the character's log and archives, for the Factions page. */
  factions: FactionHistory
  factionWiki: FactionWiki
  /** What caused each faction change, kill or hand-in, for the Factions page's plan. */
  factionSources: FactionSourceHistory
  /** eqlwiki's faction pages and the quest pages they name, for the plan. */
  factionBook: FactionBook
  /** The faction plan followed and the Slayer counts, for the achievements overlay. */
  liveAchievements: LiveAchievements
  /** Each skill's last value the log gave, for the skill achievements. */
  skills: SkillHistory
  tradeFavorites: TradeFavorites
  petStore: PetStore
  petWiki: PetWiki
  /** Characters whose log has been read back for the pet this session; after that the live log keeps it. */
  petScanned: Set<string>
  /** The audio window's output devices, as it last reported them. */
  audioDevices: AudioDevice[]

  installDir(): string
  /** The character being played: `Name_server`, or '' with no log chosen. */
  characterKey(): string
  /** A character's log, with its archives: where the log-history pages read from. */
  historyOf(character: string): HistoryWhere
  /** Stores settings and makes everything follow them: overlays, audio, priority, the engine. */
  saveSettings(next: AppSettings): AppSettings
  /** Stores the trigger list and makes the engine use it. */
  saveTriggers(list: Trigger[]): void
  setArranging(on: boolean): void
  toggleMute(): void
  applyPriority(): void
  refreshOverlayVisibility(): void
  /** Registers the global hotkeys, or removes them, as the setting says. */
  applyHotkeys(): void
  /** Hotkeys another program already holds, from the last registration. */
  hotkeysTaken: string[]
  /** Writes a summary of the settings to the diagnostic log, when it has changed. */
  logSettings(): void
  /** Set by the lifecycle: restarts into a downloaded update after everything is written. */
  installUpdate(): Promise<void>
}

export function createContext(): AppContext {
  const store = new Store(join(resources, 'defaults', 'triggers.json'))
  const dataDir = app.getPath('userData')
  const installDir = () => store.settings.get().installDir
  const speech = new SpeechWorker()
  // Microsoft's neural voices, with the player's own Azure key; the Windows voices otherwise.
  const azure = new AzureSpeech()
  // The theme is Windows' own setting for this app's windows, so every page's prefers-color-scheme
  // follows it: System, or Light or Dark whatever Windows says.
  nativeTheme.themeSource = store.settings.get().theme
  const windows = new Windows({ preload: preloadPath, icon: appIcon, audioSettings: () => store.settings.get().audio, uiScale: () => store.settings.get().uiScale })
  const toMain = windows.toMain.bind(windows)
  // Item pages the Gear page looked up, kept a week; a catalog download refreshes them in passing.
  const itemCatalog = new ItemCatalog(cacheDir())
  // Casts, the melee tally, purchases and faction changes over each character's log and archives,
  // read in one pass.
  // Each had a cache file of its own before; log-history.json replaces them.
  for (const f of ['cast-history.json', 'melee-history.json', 'purchases.json']) rmSync(join(dataDir, f), { force: true })
  const logHistory = new LogHistory(join(cacheDir(), 'log-history.json'), {
    casts: dayConsumer(castCounter),
    melee: dayConsumer(meleeCounter),
    purchases: purchaseConsumer,
    factions: factionConsumer,
    factionSources: factionSourceConsumer,
    skills: skillConsumer
  })

  const ctx = {
    store,
    windows,
    speech,
    azure,
    installDir,
    icons: new IconSource(installDir),
    achievementFiles: new AchievementFiles(dataDir, installDir, (view) => toMain('state:achievements', view)),
    gameTables: new GameTables(installDir),
    wikiCatalog: new WikiCatalog(
      (p) => toMain('state:catalog', p),
      (pages) => void itemCatalog.refreshFrom(pages)
    ),
    castHistory: new CastHistory(logHistory, 'casts'),
    meleeHistory: new CastHistory(logHistory, 'melee'),
    recipeBook: new RecipeBook((p) => toMain('state:recipes', p)),
    purchases: new PurchaseHistory(logHistory, 'purchases'),
    factions: new FactionHistory(logHistory, 'factions'),
    factionWiki: new FactionWiki(),
    factionSources: new FactionSourceHistory(logHistory, 'factionSources'),
    factionBook: new FactionBook(),
    skills: new SkillHistory(logHistory, 'skills'),
    tradeFavorites: new TradeFavorites(join(dataDir, 'tradeskills.json')),
    inventoryFiles: new InventoryFiles(dataDir, installDir, itemCatalog, (view) => toMain('state:inventory', view)),
    petStore: new PetStore(),
    petWiki: new PetWiki(),
    petScanned: new Set<string>(),
    audioDevices: [],
    installUpdate: async () => undefined
  } as unknown as AppContext

  ctx.overlays = new OverlayManager({
    preload: preloadPath,
    load: loadPage,
    onBoundsChanged: (id, b) => {
      const s = store.settings.get()
      store.settings.set({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, x: b.x, y: b.y, width: b.width, height: b.height } : o)) })
      toMain('state:settings', store.settings.get())
    }
  })

  ctx.watcher = new GameWatcher((state, previous) => {
    if (previous.gameRunning && !state.gameRunning) ctx.engine.gameClosed()
    if (!previous.gameRunning && state.gameRunning) ctx.engine.gameStarted()
    ctx.refreshOverlayVisibility()
  })

  let lastUpdate = 'idle'
  ctx.updater = new Updater((s) => {
    toMain('state:update', s)
    const was = lastUpdate
    lastUpdate = s.state
    if (s.state === 'error') sources.fail('updates', new Error(s.message))
    else if (s.state === 'idle') sources.ok('updates', s.checkedAt ? `Up to date, checked ${new Date(s.checkedAt).toLocaleTimeString()}` : 'Up to date')
    else if (s.state === 'ready') sources.ok('updates', `${s.version} downloaded; installs at restart`)
    else if (s.state === 'downloading') sources.reading('updates', `Downloading ${s.version}, ${s.percent}%`)
    else if (s.state === 'dev') sources.missing('updates', 'Running from source: only the installed app updates.')
    if (s.state === 'error' && was === 'downloading') {
      // A download that failed is said once; the next hourly check tries again.
      ctx.engine.pushFeed('warn', `The update could not be downloaded: ${s.message}. It will be tried again within the hour.`)
      announceUpdate(
        `failed:${Date.now() - (Date.now() % 86_400_000)}`,
        'Legends Tracker could not download its update',
        `${s.message}. It will be tried again within the hour.`,
        () => windows.showMain()
      )
    } else if (s.state === 'downloading') {
      announceUpdate(`found:${s.version}`, `Legends Tracker ${s.version} is available`, 'Downloading it now. You can restart into it once it has arrived.', () =>
        windows.showMain()
      )
    } else if (s.state === 'ready') {
      ctx.engine.pushFeed('info', `Version ${s.version} is ready: restart to update.`)
      announceUpdate(
        `ready:${s.version}`,
        `Legends Tracker ${s.version} is ready`,
        'Click to restart and update. Your settings and overlays stay as they are.',
        () => void ctx.installUpdate()
      )
    }
  })

  ctx.engine = new Engine(
    store,
    new VoiceRouter(speech, azure),
    {
      timers: (views) => {
        ctx.overlays.timers(views)
        toMain('state:timers', views)
      },
      alert: (p) => ctx.overlays.alert(p),
      audio: (cmd) => windows.toAudio(cmd),
      status: (s) => {
        toMain('state:status', s)
        reportStatus(s)
      },
      feed: (item) => toMain('state:feed', item),
      archive: (a) => toMain('state:archive', a),
      motes: (m) => toMain('state:motes', m),
      moteScan: (s) => toMain('state:moteScan', s),
      stock: (s) => toMain('state:stock', s),
      combat: (snap) => {
        ctx.overlays.combat(snap)
        toMain('state:combat', snap)
      },
      loot: (view) => toMain('state:loot', view),
      respawns: (view) => toMain('state:respawns', view),
      pet: (update) => {
        const character = ctx.characterKey()
        if (!character) return
        void ctx.petStore.merge(character, update).then(async (changed) => changed && toMain('state:pet', { character, ...(await ctx.petStore.get(character)) }))
      },
      buffs: (view) => toMain('state:buffs', view),
      // A /who of yourself names your race: kept on the character record when it has none yet.
      selfSeen: (who) => {
        const key = ctx.characterKey()
        const rec = key ? store.characterByKey(key) : null
        if (!rec || rec.race || !who.race) return
        const next = { ...rec, race: who.race }
        const s = store.settings.get()
        store.settings.set({ ...s, characters: { ...s.characters, [key]: next } })
        ctx.engine.reconfigure()
        toMain('state:character', next)
      }
    },
    appEngineEnv({
      dataDir,
      soundDirs: () => [join(dataDir, 'sounds'), join(installDir(), 'AudioTriggers', 'default'), join(installDir(), 'AudioTriggers', 'shared')]
    })
  )

  ctx.characterKey = () => ctx.engine.characterKey()
  ctx.historyOf = (character) => ({ logPath: logFileFor(installDir(), character), archiveDir: ctx.engine.archiveDir(), stem: logStem(character) })
  // After everything the engine has of its own: it reads the standings and the log as they settle.
  ctx.liveAchievements = new LiveAchievements(ctx)
  ctx.engine.use(ctx.liveAchievements.feature)

  ctx.refreshOverlayVisibility = () =>
    ctx.overlays.setShown(
      overlaysVisible({
        onlyWithGame: store.settings.get().overlaysOnlyWithGame,
        arranging: ctx.overlays.isArranging,
        state: ctx.watcher.state,
        ownPid: process.pid
      })
    )

  ctx.setArranging = (on) => {
    ctx.overlays.setArranging(on)
    ctx.refreshOverlayVisibility()
    toMain('state:arranging', on)
  }

  ctx.toggleMute = () => {
    const s = store.settings.get()
    ctx.saveSettings({ ...s, audio: { ...s.audio, muted: !s.audio.muted } })
  }

  // Every process of this app at below-normal priority while the setting is on, apart from audio:
  // the audio window and Chromium's audio service stay normal so alerts never stutter.
  ctx.applyPriority = () => {
    const on = store.settings.get().yieldToGame
    const keep = new Set([windows.audioPid()])
    for (const m of app.getAppMetrics()) {
      if (keep.has(m.pid) || /audio/i.test(m.serviceName ?? '')) continue
      yieldPriority(m.pid, on)
    }
  }

  ctx.saveSettings = (next) => {
    const prev = store.settings.get()
    store.settings.set(next)
    if (next.yieldToGame !== prev.yieldToGame) ctx.applyPriority()
    if (next.uiScale !== prev.uiScale) windows.applyScale()
    if (next.theme !== prev.theme) {
      nativeTheme.themeSource = next.theme
      windows.applyTheme()
    }
    if (next.hotkeys !== prev.hotkeys) ctx.applyHotkeys()
    ctx.overlays.apply(next.overlays)
    ctx.refreshOverlayVisibility()
    windows.audioConfig()
    ctx.engine.reconfigure()
    if (next.installDir !== prev.installDir) {
      void ctx.engine.loadSpells()
      // A log from the old folder no longer fits; follow the newest character log in the new one.
      if (!logIsIn(next.logFile, next.installDir)) void followNewestLog(next.installDir)
    }
    if (next.logFile !== prev.logFile && (ctx.engine.status.watching || next.autoStart)) void ctx.engine.startWatching()
    toMain('state:settings', next)
    ctx.logSettings()
    return next
  }

  let loggedSummary = ''
  ctx.logSettings = () => {
    const summary = settingsSummary(store.settings.get(), store.triggers.get().length)
    if (summary === loggedSummary) return
    loggedSummary = summary
    log.info(`Settings: ${summary}`)
  }

  async function followNewestLog(dir: string): Promise<void> {
    const newest = (await listLogs(dir))[0]?.path ?? ''
    const s = store.settings.get()
    if (s.installDir === dir && s.logFile !== newest && !logIsIn(s.logFile, dir)) ctx.saveSettings({ ...s, logFile: newest })
  }

  ctx.saveTriggers = (list) => {
    store.triggers.set(list)
    ctx.engine.reconfigure()
    ctx.engine.triggersChanged()
    ctx.logSettings()
  }

  ctx.hotkeysTaken = []
  ctx.applyHotkeys = () => {
    globalShortcut.unregisterAll()
    ctx.hotkeysTaken = []
    if (!store.settings.get().hotkeys) return
    for (const [accel, run] of [
      [HOTKEYS.mute, () => ctx.toggleMute()],
      [HOTKEYS.newSession, () => void ctx.engine.newCombatSession()],
      [HOTKEYS.arrange, () => ctx.setArranging(!ctx.overlays.isArranging)]
    ] as const) {
      if (!globalShortcut.register(accel, run)) ctx.hotkeysTaken.push(accel)
    }
    if (ctx.hotkeysTaken.length) log.warn(`Hotkeys another program holds: ${ctx.hotkeysTaken.join(', ')}`)
  }

  registerSources(ctx)
  return ctx
}

/** The chat log's and the spell data's rows follow the engine's status. */
function reportStatus(s: WatchStatus): void {
  if (s.watching) sources.ok('log', `${basename(s.logFile)}${s.lastLineAt ? `, last line ${new Date(s.lastLineAt).toLocaleTimeString()}` : ''}`)
  else if (s.logFile) sources.missing('log', `${basename(s.logFile)} is not being watched. Start watching on the Live page.`)
  else sources.missing('log', 'No character log chosen (Settings).')
  if (s.spellError) sources.fail('spells', new Error(s.spellError))
  else if (s.spellsLoaded) sources.ok('spells', `${s.spellsLoaded.toLocaleString()} spells`)
}

/** Every source the Data Sources page lists, with what it is and how to refresh it. */
function registerSources(ctx: AppContext): void {
  sources.add('log', {
    label: 'Chat log',
    kind: 'log',
    what: "Your character's eqlog file, read as the game writes it. Timers, the meter, loot, motes and buffs all come from it.",
    refresh: () => ctx.engine.startWatching()
  })
  sources.add('spells', {
    label: 'Spell data',
    kind: 'game file',
    what: "spells_us.txt and its strings file: every spell's duration, category, effects and messages. Read again when the game updates it.",
    refresh: () => reloadGameData(ctx, 'Read again by hand')
  })
  sources.add('tables', {
    label: 'Game tables',
    kind: 'game file',
    what: "The Resources folder's skill caps, AC soft caps and stat values, for the Stats and Gear pages.",
    refresh: async () => {
      ctx.gameTables.clear()
      await ctx.gameTables.acCaps([], 1)
    }
  })
  sources.add('icons', { label: 'Icons', kind: 'game file', what: "The game's spell and item icon sheets.", refresh: async () => ctx.icons.clear() })
  sources.add('exports', {
    label: 'Character exports',
    kind: 'game file',
    what: 'The inventory, achievements and factions files the game writes when you type /outputfile inventory, /outputfile achievements or /outputfile faction. Watched for new ones while their page is open.'
  })
  sources.add('history', {
    label: 'Log history',
    kind: 'log',
    what: 'Casts, melee, purchases, faction changes and the kills and hand-ins behind them, counted over your log and its archives, for the Gear, Spell upgrades, Tradeskills and Factions pages. Only what the log gains is read again.'
  })
  sources.add('motes', {
    label: 'Mote history',
    kind: 'log',
    what: 'Every mote looted and every instance run, from your logs and archives.',
    refresh: () => ctx.engine.rebuildMoteHistory()
  })
  sources.add('items', { label: 'Item lookups', kind: 'wiki', what: 'eqlwiki pages for the items you wear and look at, kept a week.' })
  sources.add('catalog', {
    label: 'Item catalog',
    kind: 'wiki',
    what: 'Every piece of equipment on eqlwiki, for the upgrade finder and optimizer. Refreshed weekly, reading only pages edited since.',
    refresh: () => ctx.wikiCatalog.refresh()
  })
  sources.add('recipes', {
    label: 'Recipes',
    kind: 'wiki',
    what: "Every player-crafted recipe on eqlwiki, for the Tradeskills page and crafted items' eras.",
    refresh: () => ctx.recipeBook.refresh()
  })
  sources.add('factionWiki', {
    label: 'Faction pages',
    kind: 'wiki',
    what: "eqlwiki's faction pages and the quest pages they name, for what raises a faction and the Factions page's plan. Kept a week.",
    refresh: () => ctx.factionBook.get(true)
  })
  sources.add('petWiki', { label: 'Pet pages', kind: 'wiki', what: "eqlwiki's Pet Guide and each pet's summon page, for the pet gear planner." })
  sources.add('speech', {
    label: 'Windows voices',
    kind: 'app',
    what: "Windows' own speech engine, started when something is to be said and stopped when quiet.",
    refresh: async () => {
      await ctx.speech.warm()
      if (ctx.speech.failed) throw new Error(ctx.speech.failed)
      sources.ok('speech', `${ctx.speech.voices.length} voices`)
    }
  })
  sources.add('updates', { label: 'Updates', kind: 'app', what: "This app's releases on GitHub, checked hourly.", refresh: () => ctx.updater.check() })
  sources.add('screen', {
    label: 'Screen reads',
    kind: 'screen',
    what: "The game's currency and stats windows, read off the screen with Windows OCR when you ask on the Motes and Stats pages."
  })
  sources.onChange((rows) => ctx.windows.toMain('state:sources', rows))
  jobs.onChange((list) => ctx.windows.toMain('state:jobs', list))
  // What can be known without asking anyone: the downloads kept, and whether this copy updates at all.
  void ctx.wikiCatalog.stored()
  void ctx.recipeBook.stored()
  if (ctx.updater.status.state === 'dev') sources.missing('updates', 'Running from source: only the installed app updates.')

  // The game's data files are read once; a game patch changes them while the app sits in the tray.
  // Looked at every minute: a change reads them again.
  let seen = 0
  setInterval(() => {
    void fs
      .stat(join(ctx.installDir(), 'spells_us.txt'))
      .then((st) => {
        if (seen && st.mtimeMs !== seen) void reloadGameData(ctx, 'The game updated its spell data')
        seen = st.mtimeMs
      })
      .catch(() => undefined)
  }, 60_000).unref()
}

/** Reads the spell data, game tables and icons again. */
async function reloadGameData(ctx: AppContext, why: string): Promise<void> {
  ctx.gameTables.clear()
  ctx.icons.clear()
  await ctx.engine.loadSpells()
  ctx.engine.pushFeed('info', `${why}: spell data, game tables and icons read again.`)
}

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
        log.warn("The update notification's action failed:", e)
      }
    })
    n.show()
  } catch (e) {
    log.warn('Could not show the update notification:', e)
  }
}
