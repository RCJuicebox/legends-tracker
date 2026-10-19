import { timeOfDay } from '../core/format'
import { app, globalShortcut, nativeTheme, Notification, session } from 'electron'
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
import { GameWatcher } from './gameWatcher'
import { overlaysVisible } from '../core/overlayVisibility'
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
import type { Factions } from '../features/factions/main'
import type { SlayerPlanner } from '../features/slayer/main'
import type { HunterPlanner } from '../features/hunter/main'
import type { SkyTracker } from '../features/sky/main'
import { createFeatures, FEATURE_CONSUMERS } from '../features/main'
import { LogHistory, type HistoryWhere } from './sources/logHistory'
import { TradeFavorites } from './tradeFavorites'
import { LiveAchievements } from './liveAchievements'
import { NpcPages } from './sources/npcPages'
import { GroupHealth } from './groupHealth'
import type { AppFeature } from './appFeature'
import { SkillHistory, skillConsumer } from './skillHistory'
import { AaHistory, aaConsumer } from './aaHistory'
import { PetStore, PetWiki } from './pets'
import { isGameRunning, listLogs, logIsIn } from './game'
import { LogFolders, otherArchiveDir } from './logFolders'
import { Windows, loadPage } from './windows'
import { appIcon, preloadPath, resources } from './bootstrap'
import { log } from './log'
import { sources } from './sources/registry'
import { jobs } from './sources/jobs'
import { settingsSummary } from '../core/diagnosticsText'
import { homedir } from 'node:os'
import type { AppSettings, Trigger, WatchStatus } from '../shared/types'
import type { AudioDevice } from '../shared/ipc'
import { cacheDir } from './paths'
import { perf } from './perf'
import { characterLogFile, logStem } from './storeCore'
import { sweepScreenCaptures } from './ocr'
import { engineOutputs, updateListener } from './contextParts'

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
  /** Every consumer's counts over each character's log history, in one cache file (log-history.json). */
  logHistory: LogHistory
  /** Other PCs' Logs folders (Settings › Game), and whether each answers. */
  logFolders: LogFolders
  castHistory: CastHistory
  /** The character's own melee day by day, read the way casts are: what worn effects and procs are weighed against. */
  meleeHistory: CastHistory
  recipeBook: RecipeBook
  purchases: PurchaseHistory
  /** The Factions page's side: faction changes and their causes over the logs, and the wiki pages behind the plan. */
  factions: Factions
  /** The faction plan followed and the Slayer counts, for the achievements overlay. */
  liveAchievements: LiveAchievements
  /** eqlwiki's pages for named mobs, for the Slayer counts and the faction plan (one cache for both). */
  npcPages: NpcPages
  /** Plan › Hunter's side: which Hunter achievements the player has said do not work. */
  hunter: HunterPlanner
  /** Plan › Plane of Sky's side (an optional module): the Sky's items counted over the logs, and each character's wish list. */
  sky: SkyTracker
  /** Plan › Slayer's side: the plan's data, and the player's choices (the overlay makes the plan from them). */
  slayer: SlayerPlanner
  /** The parts that register, and flush, themselves (AppFeature): the two above. */
  features: AppFeature[]
  /** Each skill's last value the log gave, for the skill achievements. */
  skills: SkillHistory
  /** The AAs bought and the ability points the log recorded, for Stats › AAs. */
  aaHistory: AaHistory
  tradeFavorites: TradeFavorites
  petStore: PetStore
  petWiki: PetWiki
  /** Characters whose log has been read back for the pet this session; after that the live log keeps it. */
  petScanned: Set<string>
  /** The audio window's output devices, as it last reported them. */
  audioDevices: AudioDevice[]
  /** What the audio window could not do, by kind and words, with how often (LT-618). */
  audioProblems: Map<string, number>

  installDir(): string
  /** The character being played: `Name_server`, or '' with no log chosen. */
  characterKey(): string
  /** A character's log, with its archives: where the log-history pages read from. */
  historyOf(character: string): HistoryWhere
  /** Every character with a log on this PC or in another PC's folder: this PC's first, each newest first. */
  logCharacters(): Promise<string[]>
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
  /** Restarts into a downloaded update; `unasked` when the player did not press for it. */
  installUpdate(unasked?: boolean): Promise<void>
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
  const windows = new Windows({
    preload: preloadPath,
    icon: appIcon,
    audioSettings: () => store.settings.get().audio,
    uiScale: () => store.settings.get().uiScale,
    setUiScale: (uiScale) => {
      ctx.saveSettings({ ...store.settings.get(), uiScale })
    }
  })
  const toMain = windows.toMain.bind(windows)
  // Item pages the Gear page looked up, kept a week; a catalog download refreshes them in passing.
  const itemCatalog = new ItemCatalog(cacheDir())
  // Casts, the melee tally, purchases and faction changes over each character's log and archives,
  // read in one pass.
  // Each had a cache file of its own before; log-history.json replaces them. faction-wiki.json has
  // not been written since the faction book took its place (LT-422). A file another program holds is
  // left for the next start, not a reason this one fails (LT-436).
  for (const f of [join(dataDir, 'cast-history.json'), join(dataDir, 'melee-history.json'), join(dataDir, 'purchases.json'), join(cacheDir(), 'faction-wiki.json')]) {
    try {
      rmSync(f, { force: true })
    } catch (e) {
      log.warn(`Could not remove the retired ${basename(f)}; trying again next start:`, e)
    }
  }
  // Other PCs' Logs folders: each looked at no more than one look at a time, so one whose PC is off never holds things up.
  const logFolders = new LogFolders(() => store.settings.get().logFolders)
  const logHistory = new LogHistory(
    join(cacheDir(), 'log-history.json'),
    {
      casts: dayConsumer(() => castCounter(() => ctx.engine.quickBuffLandings()), 2),
      melee: dayConsumer(meleeCounter),
      purchases: purchaseConsumer,
      skills: skillConsumer,
      aas: aaConsumer,
      ...FEATURE_CONSUMERS
    },
    (folder) => logFolders.reachable(folder)
  )

  const features = createFeatures({ logHistory, dir: store.dir })
  const ctx = {
    store,
    windows,
    speech,
    azure,
    installDir,
    icons: new IconSource(installDir),
    achievementFiles: new AchievementFiles(
      dataDir,
      installDir,
      (view) => toMain('state:achievements', view),
      () => windows.mainShown
    ),
    gameTables: new GameTables(installDir),
    wikiCatalog: new WikiCatalog(
      (p) => {
        toMain('state:catalog', p)
        // The download is over: what it brought the item cache is written now, once.
        if (!p.busy) void itemCatalog.flush()
      },
      (pages) => void itemCatalog.refreshFrom(pages)
    ),
    logHistory,
    logFolders,
    castHistory: new CastHistory(logHistory, 'casts'),
    meleeHistory: new CastHistory(logHistory, 'melee'),
    recipeBook: new RecipeBook((p) => toMain('state:recipes', p)),
    purchases: new PurchaseHistory(logHistory, 'purchases'),
    npcPages: new NpcPages(),
    factions: features.factions,
    skills: new SkillHistory(logHistory, 'skills'),
    aaHistory: new AaHistory(logHistory, 'aas'),
    tradeFavorites: new TradeFavorites(join(dataDir, 'tradeskills.json')),
    inventoryFiles: new InventoryFiles(
      dataDir,
      installDir,
      itemCatalog,
      (view) => toMain('state:inventory', view),
      () => windows.mainShown
    ),
    petStore: new PetStore(),
    petWiki: new PetWiki(),
    petScanned: new Set<string>(),
    audioDevices: [],
    audioProblems: new Map(),
    installUpdate: async () => undefined
  } as unknown as AppContext

  ctx.overlays = new OverlayManager({
    preload: preloadPath,
    load: loadPage,
    onBoundsChanged: (id, b) => {
      const s = store.settings.get()
      // Through the same floor the saved settings have (40 px), though the window will not go smaller anyway.
      const size = { width: Math.max(40, b.width), height: Math.max(40, b.height) }
      store.settings.set({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, x: b.x, y: b.y, ...size } : o)) })
      toMain('state:settings', store.settings.get())
    }
  })

  ctx.watcher = new GameWatcher((state, previous) => {
    if (previous.gameRunning && !state.gameRunning) ctx.engine.gameClosed()
    if (!previous.gameRunning && state.gameRunning) ctx.engine.gameStarted()
    ctx.refreshOverlayVisibility()
    ctx.overlays.setGameInFront(state.foregroundName === 'eqgame')
    // Another window to the front: the game may have put itself above the overlays as it came back.
    if (state.foregroundPid !== previous.foregroundPid) ctx.overlays.reassertTop()
  })

  ctx.updater = new Updater(
    updateListener({
      toMain,
      pushFeed: (kind, text) => ctx.engine.pushFeed(kind, text),
      announce: announceUpdate,
      showMain: () => windows.showMain(),
      install: (unasked) => void ctx.installUpdate(unasked),
      autoRestart: () => store.settings.get().autoRestartUpdates,
      heldBack: (v) => ctx.updater.heldBack(v),
      play: () => ({
        fighting: ctx.engine.meter.fighting,
        lastLineAt: ctx.engine.status.lastLineAt,
        watching: ctx.engine.status.watching,
        gameInFront: ctx.watcher.state.foregroundName === 'eqgame'
      })
    })
  )

  ctx.engine = new Engine(
    store,
    new VoiceRouter(speech, azure),
    engineOutputs({
      toMain,
      mainWatches: (c) => windows.mainWatches(c),
      overlays: () => ctx.overlays,
      toAudio: (cmd) => windows.toAudio(cmd),
      combatToMain: (snap) => windows.combatToMain(snap),
      reportStatus: (st) => reportStatus(st, store.settings.get().logFile),
      characterKey: () => ctx.characterKey(),
      pet: ctx.petStore,
      record: {
        get: (key) => store.characterByKey(key),
        set: (key, rec) => {
          const st = store.settings.get()
          store.settings.set({ ...st, characters: { ...st.characters, [key]: rec } })
        }
      },
      reconfigure: () => ctx.engine.reconfigure()
    }),
    appEngineEnv({
      dataDir,
      soundDirs: () => [join(dataDir, 'sounds'), join(installDir(), 'AudioTriggers', 'default'), join(installDir(), 'AudioTriggers', 'shared')],
      // The game watcher looks at the process list every three seconds anyway: its answer, rather than
      // another walk of it every half minute for the archiver (LT-377). Before its first look, a walk.
      isGameRunning: async () => ctx.watcher?.gameRunning ?? isGameRunning(),
      logFolders
    })
  )

  ctx.characterKey = () => ctx.engine.characterKey()
  // The character being played reads the log chosen in Settings, wherever it is; any other its own
  // file in the game's Logs folder. The same character played on another PC: its log there, and that
  // PC's archives if it keeps them.
  ctx.historyOf = (character) => ({
    logPath: characterLogFile(character, ctx.characterKey(), store.settings.get().logFile, installDir()),
    archiveDir: ctx.engine.archives.archiveDir(),
    stem: logStem(character),
    elsewhere: store.settings.get().logFolders.map((folder) => ({ folder, logPath: join(folder, `${logStem(character)}.txt`), archiveDir: otherArchiveDir(folder) }))
  })
  ctx.logCharacters = async () => {
    // A folder out of reach still names the characters it held when it last answered: their history is kept.
    const [here, looks] = await Promise.all([listLogs(installDir()), logFolders.lookAll()])
    const there = looks.flatMap((l) => l.logs).sort((a, b) => b.modified - a.modified)
    return [...new Set([...here, ...there].map((l) => l.character))]
  }
  // It reads the standings and the log as they settle, so its engine feature goes after everything the
  // engine has of its own (registered with the features, below), and after the features whose parts
  // of the track it reads and publishes (LT-623).
  ctx.liveAchievements = new LiveAchievements(ctx)
  ctx.hunter = features.hunter
  ctx.slayer = features.slayer
  ctx.sky = features.sky
  ctx.features = [ctx.factions, ctx.slayer, ctx.hunter, ctx.sky, ctx.liveAchievements, new GroupHealth()]

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
    // Arranging them at all, from the tray, a page or the hotkey, is placing them (Live's checklist).
    const s = store.settings.get()
    if (on && !s.setup.arranged) ctx.saveSettings({ ...s, setup: { ...s.setup, arranged: true } })
  }

  ctx.toggleMute = () => {
    const s = store.settings.get()
    ctx.saveSettings({ ...s, audio: { ...s.audio, muted: !s.audio.muted } })
  }

  // Every process of this app at below-normal priority while the setting is on, apart from audio:
  // the audio window and Chromium's audio service stay normal so alerts never stutter.
  ctx.applyPriority = () => {
    const on = store.settings.get().yieldToGame
    // The speech engine is no Electron process: told on its own (LT-614).
    speech.setYield(on)
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
    // A mute, a meter header click or a theme change leaves the overlays as they were: no regrouping.
    if (JSON.stringify(next.overlays) !== JSON.stringify(prev.overlays)) ctx.overlays.apply(next.overlays)
    ctx.refreshOverlayVisibility()
    windows.audioConfig()
    ctx.engine.reconfigure()
    if (next.installDir !== prev.installDir) {
      void ctx.engine.loadSpells()
      // A log from the old folder no longer fits; follow the newest character log in the new one.
      if (!logIsIn(next.logFile, next.installDir)) void followNewestLog(next.installDir)
    }
    if (next.logFile !== prev.logFile && (ctx.engine.status.watching || next.autoStart)) void ctx.engine.startWatching()
    // Another character's log: its record, for the pages that show the character being played.
    if (next.logFile !== prev.logFile) toMain('state:character', store.characterOf(next.logFile))
    toMain('state:settings', next)
    ctx.logSettings()
    return next
  }

  let loggedSummary = ''
  ctx.logSettings = () => {
    const summary = settingsSummary(store.settings.get(), store.triggers.get().length, homedir())
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
      [HOTKEYS.newSession, () => void ctx.engine.combat.newSession()],
      [HOTKEYS.arrange, () => ctx.setArranging(!ctx.overlays.isArranging)]
    ] as const) {
      if (!globalShortcut.register(accel, run)) ctx.hotkeysTaken.push(accel)
    }
    if (ctx.hotkeysTaken.length) log.warn(`Hotkeys another program holds: ${ctx.hotkeysTaken.join(', ')}`)
  }

  registerSources(ctx)
  // Their channels, rows and engine features; after the app's own rows, so theirs follow on Data Sources.
  for (const f of ctx.features) f.register(ctx)
  return ctx
}

/** The chat log's and the spell data's rows follow the engine's status. */
/** What the chat log's and spell data's rows last said, so a status push that changes neither sends no rows. */
let lastReported = ''

/**
 * The chat log's and spell data's rows on Data Sources, from the watch status. Status goes out every
 * half second while lines come in; the log's row names the last line's minute, so the rows change (and
 * go to the page) at most once a minute.
 */
function reportStatus(s: WatchStatus, chosenLog: string): void {
  const report = JSON.stringify([s.watching, s.logFile, chosenLog, s.lastLineAt ? timeOfDay(s.lastLineAt) : '', s.spellError, s.spellsLoaded, s.logError])
  if (report === lastReported) return
  lastReported = report
  const log = s.logFile || chosenLog
  if (s.watching && s.logError) sources.fail('log', new Error(s.logError), basename(s.logFile))
  else if (s.watching) sources.ok('log', `${basename(s.logFile)}${s.lastLineAt ? `, last line at ${timeOfDay(s.lastLineAt)}` : ''}`)
  else if (log) sources.idle('log', `${basename(log)} is not being watched.`)
  else sources.missing('log', 'No character log chosen (Settings › Log files).')
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
    what: "The Resources folder's skill caps, AC soft caps and stat values, for the Stats and Gear pages, and its faction modifiers and achievement lists, for the Factions page.",
    refresh: () => ctx.gameTables.refresh()
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
  sources.add('logFolders', {
    label: "Other PCs' logs",
    kind: 'log',
    what: "The Logs folders of other PCs you play on (Settings › Game), usually shared over your network. Their logs count toward each character's history; while one is off, what was read from it before still counts.",
    refresh: () => ctx.logFolders.lookAll(true)
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
    what: 'Every piece of equipment on eqlwiki, for the upgrade finder and optimizer. Due again weekly, and refreshed when you ask, reading only pages edited since.',
    refresh: () => ctx.wikiCatalog.refresh()
  })
  sources.add('recipes', {
    label: 'Recipes',
    kind: 'wiki',
    what: "Every player-crafted recipe on eqlwiki, for the Tradeskills page and crafted items' eras. Due again weekly, and refreshed when you ask.",
    refresh: () => ctx.recipeBook.refresh()
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
  void ctx.wikiCatalog.stamp()
  // Screen pictures a crash or a shutdown mid-read left behind.
  void sweepScreenCaptures()
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

  // How the app kept up over the last ten minutes, while a log is watched (FEAT-018).
  setInterval(() => {
    if (!ctx.engine.status.watching) return
    log.info(['Performance, the last ten minutes:', ...perf.report({ tailer: ctx.engine.tailerStats, lineFailures: ctx.engine.failures })].join('\n'))
    perf.restart({ tailer: ctx.engine.tailerStats, lineFailures: ctx.engine.failures })
  }, 10 * 60_000).unref()
}

/** Reads the spell data, game tables and icons again. */
async function reloadGameData(ctx: AppContext, why: string): Promise<void> {
  ctx.gameTables.clear()
  ctx.icons.clear()
  // Pages keep icons a day (eqicon:// answers max-age=86400): yesterday's would outlive the patch (LT-421).
  await session.defaultSession.clearCache().catch((e: unknown) => log.warn('Could not clear the icon cache:', e))
  await ctx.engine.loadSpells()
  ctx.engine.pushFeed('info', `${why}: spell data, game tables and icons read again.`)
}

/** Each step of one version is announced once: an hourly check must not nag. */
const announced = new Set<string>()
/**
 * Notifications shown and not yet clicked or closed: held, since one left to the garbage collector
 * loses its click handler, and a click from the Action Center later only starts a second copy (LT-616).
 */
const shownNotes = new Set<Notification>()

/** A Windows notification about an update, said once per key. Clicking it runs `onClick`. */
function announceUpdate(key: string, title: string, body: string, onClick: () => void): void {
  if (announced.has(key)) return
  announced.add(key)
  if (!Notification.isSupported()) return
  try {
    const n = new Notification({ title, body, icon: appIcon })
    shownNotes.add(n)
    const done = () => void shownNotes.delete(n)
    n.on('click', () => {
      done()
      try {
        onClick()
      } catch (e) {
        log.warn("The update notification's action failed:", e)
      }
    })
    n.on('close', done)
    n.on('failed', done)
    n.show()
  } catch (e) {
    log.warn('Could not show the update notification:', e)
  }
}
