import { app, Notification } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
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
import { LogHistory } from './sources/logHistory'
import { TradeFavorites } from './tradeFavorites'
import { PetStore, PetWiki } from './pets'
import { listLogs, logIsIn } from './game'
import { Windows, loadPage } from './windows'
import { appIcon, preloadPath, resources } from './bootstrap'
import { log } from './log'
import type { AppSettings, Trigger } from '../shared/types'
import type { AudioDevice } from '../shared/ipc'
import { cacheDir } from './paths'

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
  /** Stores settings and makes everything follow them: overlays, audio, priority, the engine. */
  saveSettings(next: AppSettings): AppSettings
  /** Stores the trigger list and makes the engine use it. */
  saveTriggers(list: Trigger[]): void
  setArranging(on: boolean): void
  toggleMute(): void
  applyPriority(): void
  refreshOverlayVisibility(): void
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
  const windows = new Windows({ preload: preloadPath, icon: appIcon, audioSettings: () => store.settings.get().audio })
  const toMain = windows.toMain.bind(windows)
  // Item pages the Gear page looked up, kept a week; a catalog download refreshes them in passing.
  const itemCatalog = new ItemCatalog()
  // Casts, the melee tally and purchases over each character's log and archives, read in one pass.
  // Each had a cache file of its own before; log-history.json replaces them.
  for (const f of ['cast-history.json', 'melee-history.json', 'purchases.json']) rmSync(join(dataDir, f), { force: true })
  const logHistory = new LogHistory(join(cacheDir(), 'log-history.json'), {
    casts: dayConsumer(castCounter),
    melee: dayConsumer(meleeCounter),
    purchases: purchaseConsumer
  })

  const ctx = {
    store,
    windows,
    speech,
    azure,
    installDir,
    icons: new IconSource(installDir),
    achievementFiles: new AchievementFiles(installDir, (view) => toMain('state:achievements', view)),
    gameTables: new GameTables(installDir),
    wikiCatalog: new WikiCatalog(
      (p) => toMain('state:catalog', p),
      (pages) => void itemCatalog.refreshFrom(pages)
    ),
    castHistory: new CastHistory(logHistory, 'casts'),
    meleeHistory: new CastHistory(logHistory, 'melee'),
    recipeBook: new RecipeBook((p) => toMain('state:recipes', p)),
    purchases: new PurchaseHistory(logHistory, 'purchases'),
    tradeFavorites: new TradeFavorites(join(dataDir, 'tradeskills.json')),
    inventoryFiles: new InventoryFiles(installDir, itemCatalog, (view) => toMain('state:inventory', view)),
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

  ctx.updater = new Updater((s) => {
    toMain('state:update', s)
    if (s.state === 'downloading') {
      announceUpdate(`found:${s.version}`, `Legends Tracker ${s.version} is available`, 'Downloading it now. You can restart into it once it has arrived.', () =>
        windows.showMain()
      )
    } else if (s.state === 'ready') {
      ctx.engine.pushFeed('info', `Version ${s.version} is ready: restart to update.`)
      announceUpdate(`ready:${s.version}`, `Legends Tracker ${s.version} is ready`, 'Click to restart and update. Your settings and overlays stay as they are.', () =>
        void ctx.installUpdate()
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
      status: (s) => toMain('state:status', s),
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
      buffs: (view) => toMain('state:buffs', view)
    },
    appEngineEnv({
      dataDir,
      soundDirs: () => [join(dataDir, 'sounds'), join(installDir(), 'AudioTriggers', 'default'), join(installDir(), 'AudioTriggers', 'shared')]
    })
  )

  ctx.characterKey = () => ctx.engine.characterKey()

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
    return next
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
  }

  return ctx
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
