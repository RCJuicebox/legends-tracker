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
import { Factions } from '../features/factions/main'
import { LogHistory, type HistoryWhere } from './sources/logHistory'
import { TradeFavorites } from './tradeFavorites'
import { LiveAchievements } from './liveAchievements'
import { GroupHealth } from './groupHealth'
import type { AppFeature } from './appFeature'
import { SkillHistory, skillConsumer } from './skillHistory'
import { AaHistory, aaConsumer } from './aaHistory'
import { PetStore, PetWiki } from './pets'
import { isGameRunning, listLogs, logIsIn } from './game'
import { Windows, loadPage } from './windows'
import { appIcon, preloadPath, resources } from './bootstrap'
import { log } from './log'
import { describeClasses, recordFromWho } from '../core/selfWho'
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
  castHistory: CastHistory
  /** The character's own melee day by day, read the way casts are: what worn effects and procs are weighed against. */
  meleeHistory: CastHistory
  recipeBook: RecipeBook
  purchases: PurchaseHistory
  /** The Factions page's side: faction changes and their causes over the logs, and the wiki pages behind the plan. */
  factions: Factions
  /** The faction plan followed and the Slayer counts, for the achievements overlay. */
  liveAchievements: LiveAchievements
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
  /** Restarts into a downloaded update; `unasked` when the player did not press for it. */
  installUpdate(unasked?: boolean): Promise<void>
}

/** The newest loot entry the main window was sent whole or added to; 0 when it should get the whole list. */
let lootSent = 0

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
  const logHistory = new LogHistory(join(cacheDir(), 'log-history.json'), {
    casts: dayConsumer(castCounter),
    melee: dayConsumer(meleeCounter),
    purchases: purchaseConsumer,
    skills: skillConsumer,
    aas: aaConsumer,
    ...Factions.consumers
  })

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
    castHistory: new CastHistory(logHistory, 'casts'),
    meleeHistory: new CastHistory(logHistory, 'melee'),
    recipeBook: new RecipeBook((p) => toMain('state:recipes', p)),
    purchases: new PurchaseHistory(logHistory, 'purchases'),
    factions: new Factions(logHistory),
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

  let lastUpdate = 'idle'
  let lastUpdateCheck = 0
  ctx.updater = new Updater((s) => {
    toMain('state:update', s)
    const was = lastUpdate
    lastUpdate = s.state
    if (s.state === 'idle' && s.checkedAt) lastUpdateCheck = s.checkedAt
    // Offline is not a fault of the updater: said plainly, with when it last got through, rather than
    // a red error first in every diagnostics paste all evening (LT-444).
    if (s.state === 'error' && /could not reach GitHub/.test(s.message))
      sources.missing(
        'updates',
        `Offline: GitHub could not be reached; ${lastUpdateCheck ? `last checked ${new Date(lastUpdateCheck).toLocaleString()}` : 'not checked yet this run'}. Tried again within the hour.`
      )
    else if (s.state === 'error') sources.fail('updates', new Error(s.message))
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
    } else if (s.state === 'ready' && store.settings.get().autoRestartUpdates) {
      // The player chose not to be asked: restart into it at the first lull in play, so no fight's
      // timers are lost to it (LT-430): out of combat with the log quiet a minute, or the game not in
      // front, looked at every half minute, and at most two hours on.
      ctx.engine.pushFeed('info', `Version ${s.version} has downloaded: restarting into it at the next lull in play.`)
      log.info(`Restarting into ${s.version} by itself at the next lull (Restart into updates by itself is on)`)
      const readyAt = Date.now()
      const atLull = () => {
        const quiet = !ctx.engine.meter.fighting && Date.now() - ctx.engine.status.lastLineAt > 60_000
        const away = ctx.watcher.state.foregroundName !== 'eqgame'
        if (quiet || away || !ctx.engine.status.watching || Date.now() - readyAt > 2 * 3600_000) void ctx.installUpdate(true)
        else setTimeout(atLull, 30_000).unref()
      }
      setTimeout(atLull, 2000).unref()
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
        perf.push('timers', views)
        ctx.overlays.timers(views)
        toMain('state:timers', views)
      },
      alert: (p) => ctx.overlays.alert(p),
      audio: (cmd) => windows.toAudio(cmd),
      status: (s) => {
        toMain('state:status', s)
        reportStatus(s, store.settings.get().logFile)
      },
      feed: (item) => toMain('state:feed', item),
      archive: (a) => toMain('state:archive', a),
      motes: (m) => toMain('state:motes', m),
      moteScan: (s) => toMain('state:moteScan', s),
      stock: (s) => toMain('state:stock', s),
      combat: (snap) => {
        perf.push('combat', snap)
        ctx.overlays.combat(snap)
        toMain('state:combat', snap)
      },
      loot: (view) => {
        // The main window has the entries up to the newest it was sent: only those after go (LT-369).
        // Hidden, it is sent the whole list, as only the last push is kept for it.
        const newest = view.entries[0]?.id ?? 0
        const oldest = view.entries.at(-1)?.id ?? 0
        const push = windows.mainShown && lootSent > 0 && newest >= lootSent ? { ...view, entries: view.entries.filter((e) => e.id > lootSent), addedOnly: { oldest } } : view
        lootSent = windows.mainShown ? newest : 0
        perf.push('loot', push)
        toMain('state:loot', push)
      },
      respawns: (view) => toMain('state:respawns', view),
      pet: (update) => {
        const character = ctx.characterKey()
        if (!character) return
        void ctx.petStore.merge(character, update).then(async (changed) => changed && toMain('state:pet', { character, ...(await ctx.petStore.get(character)) }))
      },
      push: toMain,
      // A /who of yourself names your race and classes: the character record follows them, so a change
      // of either reaches the faction cons, the AC sums, spell durations and the gear you can wear.
      selfSeen: (who) => {
        const key = ctx.characterKey()
        const rec = key ? store.characterByKey(key) : null
        const next = rec ? recordFromWho(rec, who) : null
        if (!key || !rec || !next) return
        if (next.race !== rec.race) log.info(`Race for ${key}: ${rec.race || 'none'} → ${next.race} (from /who).`)
        const [was, now] = [describeClasses(rec.classLevels), describeClasses(next.classLevels)]
        if (was !== now) log.info(`Classes for ${key}: ${was} → ${now} (from /who).`)
        const s = store.settings.get()
        store.settings.set({ ...s, characters: { ...s.characters, [key]: next } })
        ctx.engine.reconfigure()
        toMain('state:character', next)
      }
    },
    appEngineEnv({
      dataDir,
      soundDirs: () => [join(dataDir, 'sounds'), join(installDir(), 'AudioTriggers', 'default'), join(installDir(), 'AudioTriggers', 'shared')],
      // The game watcher looks at the process list every three seconds anyway: its answer, rather than
      // another walk of it every half minute for the archiver (LT-377). Before its first look, a walk.
      isGameRunning: async () => ctx.watcher?.gameRunning ?? isGameRunning()
    })
  )

  ctx.characterKey = () => ctx.engine.characterKey()
  // The character being played reads the log chosen in Settings, wherever it is; any other its own
  // file in the game's Logs folder.
  ctx.historyOf = (character) => ({
    logPath: characterLogFile(character, ctx.characterKey(), store.settings.get().logFile, installDir()),
    archiveDir: ctx.engine.archives.archiveDir(),
    stem: logStem(character)
  })
  // It reads the standings and the log as they settle, so its engine feature goes after everything the
  // engine has of its own (registered with the features, below).
  ctx.liveAchievements = new LiveAchievements(ctx)
  ctx.features = [ctx.factions, ctx.liveAchievements, new GroupHealth()]

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
  else if (log) sources.missing('log', `${basename(log)} is not being watched. Start watching on the Live page.`)
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
    perf.restart()
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
