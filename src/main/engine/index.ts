import { basename } from 'node:path'
import { LogClock, parseLogLine, type LogLine } from '../../core/logLine'
import { LogTailer } from '../../core/tailer'
import { SpellBook, type Spell } from '../../core/spells'
import { TimerBoard } from '../../core/timers'
import { SpellTracker } from '../../core/spellTracker'
import { TriggerEngine } from '../../core/triggers'
import type { ArchiveOutcome } from '../../core/archiver'
import { MoteTracker, moteName } from '../../core/motes'
import { PetGearReader, petSummonName } from '../../core/pets'
import type { BuffView } from '../../core/buffs'
import type { RespawnView } from '../../core/respawns'
import type { MyClass } from '../../core/spellMotes'
import { CAST_BY_YOU } from '../../core/phrases'
import { characterKey, characterName } from '../storeCore'
import { isGameFolder, lastZone, listLogs } from '../game'
import { ArchiveManager } from '../archiveManager'
import { MoteStockKeeper } from '../../core/moteStock'
import { samePath } from '../../core/moteMerge'
import { log } from '../log'
import { Notifier } from './notifier'
import { SpellQueries } from './spellQueries'
import { BuffCoordinator } from './buffs'
import { CombatFeed } from './combat'
import { MoteCatchUp } from './moteCatchUp'
import { Throttled } from './throttle'
import type { EngineFeature } from './feature'
import type {
  AppSettings,
  ArchiveStatus,
  CharacterSettings,
  CombatSnapshot,
  FeedItem,
  KnownSpell,
  LogCheckRow,
  Segment,
  SpellRule,
  WatchStatus,
  StitchedTimeline
} from '../../shared/types'
import type { EngineEnv, EngineOutputs, EngineStore, LootView, MoteView, Speaker } from './contracts'
import { jobs } from '../sources/jobs'

export type { AudioCommand, EngineEnv, EngineOutputs, EngineStore, LootView, MoteScanner, MoteView, Speaker } from './contracts'
export type { EngineFeature } from './feature'
export { workerScanner } from './moteCatchUp'

interface Tail {
  tailer: LogTailer
  logFile: string
  /** The size when the tailer attached: it reads on from there. -1 until its first look. */
  start: number
  /** Just past the last line it gave. -1 until it has given one. */
  end: number
  /** Keeps the lines' times in order across the hour the clocks go back. */
  clock: LogClock
}

/**
 * Everything that follows the log: it watches the character's log and hands each line to the spell
 * tracker, the triggers, the pet reader, mote tracking and the combat feed, and pushes what they make
 * of it to the windows at a steady pace. The parts live beside this file; this is the wiring.
 */
export class Engine {
  book: SpellBook | null = null
  readonly board: TimerBoard
  private tracker: SpellTracker | null = null
  readonly triggers: TriggerEngine
  readonly archives: ArchiveManager
  readonly stock: MoteStockKeeper
  readonly motes: MoteTracker
  readonly status: WatchStatus = {
    watching: false,
    logFile: '',
    character: '',
    zone: '',
    spellsLoaded: 0,
    spellError: '',
    lastLineAt: 0,
    logSize: 0
  }
  private readonly notifier: Notifier
  private readonly queries: SpellQueries
  private readonly buffs: BuffCoordinator
  private readonly combat: CombatFeed
  private readonly moteHistory: MoteCatchUp
  private readonly petReader: PetGearReader
  private readonly timersOut: Throttled
  private readonly motesOut: Throttled
  /** Size and last-line time change with every write; they go out at most once a second. */
  private readonly statusOut: Throttled
  /** What follows the log, in the order each line, tick and change of character reaches it (see buildFeatures). */
  private readonly features: readonly EngineFeature[]

  private tail: Tail | null = null
  /** Bumped by every start and stop, so a start overtaken while it waited gives up. */
  private watchGen = 0
  private starting = false
  /** The log last watched, to tell a switch of character from a restart of the same log. */
  private watchedLog = ''
  private missing = false
  private tickTimer: NodeJS.Timeout | null = null
  private archiveTimer: NodeJS.Timeout | null = null
  /** Pasted test lines must not add to the real mote history or stock. */
  private simulating = false
  /** Other characters' logs the feed has mentioned. */
  private readonly saidElsewhere = new Set<string>()
  /** The start-up mote catch-up, which the first combat read waits for. */
  private startupRead: Promise<unknown> | undefined

  constructor(
    private readonly store: EngineStore,
    speech: Speaker,
    private readonly out: EngineOutputs,
    private readonly env: EngineEnv
  ) {
    this.notifier = new Notifier(speech, out, () => this.settings, env.soundDirs)
    this.queries = new SpellQueries(store, () => this.book)
    this.timersOut = new Throttled(0, () => this.out.timers(this.board.views()))
    this.motesOut = new Throttled(1000, () => this.out.motes(this.moteView()))
    this.statusOut = new Throttled(1000, () => this.out.status({ ...this.status }))
    this.board = new TimerBoard({
      onChange: () => this.timersOut.mark(),
      onNotify: (ns) => this.notifier.notify(ns)
    })
    this.triggers = new TriggerEngine(this.board, {
      notify: (ns) => this.notifier.notify(ns),
      feed: (kind, text) => this.pushFeed(kind, text)
    })
    this.archives = new ArchiveManager({
      settings: () => this.settings,
      isGameRunning: env.isGameRunning,
      onStatus: (a) => out.archive(a),
      feed: (kind, text) => this.pushFeed(kind, text)
    })
    this.stock = new MoteStockKeeper(
      store.stock,
      (s) => out.stock(s),
      (kind, text) => this.pushFeed(kind, text)
    )
    this.buffs = new BuffCoordinator(store, this.board, this.queries, this.notifier, {
      book: () => this.book,
      group: () => this.combat.meter.groupMembers,
      fighting: () => this.combat.meter.fighting,
      readingHistory: () => this.combat.backlog.active,
      live: () => !this.simulating && this.status.watching,
      send: (view) => out.buffs(view),
      self: () => this.status.character,
      // Your own /who: the zone when the watch does not know it yet, and your race for the record.
      onSelf: (p) => {
        if (p.zone && !this.status.zone) {
          this.status.zone = p.zone
          this.tracker?.setZone(p.zone)
          this.emitStatus()
        }
        out.selfSeen?.({ race: p.race })
      }
    })
    this.combat = new CombatFeed(store, out, this.notifier, this.buffs, {
      book: () => this.book,
      zone: () => this.status.zone
    })
    this.petReader = new PetGearReader((gear) => out.pet({ gear }))
    this.motes = new MoteTracker(store.motes.get(), {
      onChange: () => {
        this.store.motes.set(this.motes.state)
        this.motesOut.mark()
      },
      onLoot: (loot, session, time) => {
        if (!this.simulating) this.stock.add(loot, time)
        this.pushFeed('loot', `${loot.count > 1 ? `${loot.count} × ` : ''}${moteName(loot.rank)} from ${loot.source}${session ? '' : ' (no session running)'}`)
      },
      onSession: (s) => this.pushFeed('loot', s.kind === 'crawl' ? `Dungeon crawl completed: ${s.name}` : `${s.kind === 'manual' ? 'Session' : 'Normal instance'} ended: ${s.name}`)
    })
    this.moteHistory = new MoteCatchUp(store, env, out, this.notifier, {
      motes: () => this.motes,
      stock: this.stock,
      tail: {
        logFile: () => this.tail?.logFile ?? '',
        position: () => {
          const t = this.tail
          return !t ? -1 : t.end >= 0 ? t.end : t.start
        },
        settling: () => this.starting || (!!this.tail && this.tail.start < 0)
      },
      archiveDir: () => this.archiveDir(),
      gameRunning: () => this.archive.gameRunning,
      changed: () => this.motesOut.mark()
    })
    this.features = this.buildFeatures()
  }

  /**
   * The parts that follow the log, in order. A line goes to the spell tracker, the triggers, the pet
   * reader, mote history, the combat feed and then the status line; a tick to the timer board, the pet
   * reader, motes, the combat feed and buffs, and then the views that go out; a change of character
   * clears the timers and then the fights. The order matters, so it is kept as it was written by hand.
   */
  private buildFeatures(): EngineFeature[] {
    const output = (id: string, out: Throttled): EngineFeature => ({ id, tick: (now) => out.tick(now) })
    return [
      { id: 'timers', tick: (now) => this.board.tick(now), reset: () => this.board.clear() },
      // The tracker is made when spell data loads, and made again when it reloads: this entry follows the current one.
      { id: 'spells', line: (line) => this.tracker?.handle(line) },
      { id: 'triggers', line: (line) => this.triggers.handle(line) },
      { id: 'pet', line: (line) => this.petLine(line), tick: (now) => this.petReader.tick(now) },
      { id: 'motes', tick: (now) => this.motes.tick(now) },
      { id: 'moteHistory', line: (line) => this.moteHistory.live(line), linesRead: (logFile, end) => this.moteHistory.linesRead(logFile, end) },
      { id: 'combat', line: (line) => this.combat.live(line), tick: (now) => this.combat.tick(now), reset: () => this.combat.reset() },
      { id: 'buffs', tick: (now) => this.buffs.tick(now) },
      output('motes:out', this.motesOut),
      {
        id: 'status',
        line: (line) => {
          this.status.lastLineAt = line.time
          this.statusOut.mark()
          if (this.status.elsewhere) this.status.elsewhere = null
        },
        tick: (now) => this.statusOut.tick(now)
      },
      output('timers:out', this.timersOut)
    ]
  }

  get settings(): AppSettings {
    return this.store.settings.get()
  }

  get feed(): FeedItem[] {
    return this.notifier.feed
  }

  get archive(): ArchiveStatus {
    return this.archives.status
  }

  /** The damage meter. */
  get meter() {
    return this.combat.meter
  }

  get loot() {
    return this.combat.loot
  }

  /** How long mobs take to respawn, from kills and sightings. */
  get respawns() {
    return this.combat.respawns
  }

  get moteScan(): string {
    return this.moteHistory.scanning
  }

  async init(): Promise<void> {
    const s = this.settings
    if (!isGameFolder(s.installDir)) {
      const found = await this.env.findInstall().catch((e: unknown) => {
        log.warn('Looking for the game folder failed:', e)
        return ''
      })
      if (found) this.store.settings.set({ ...s, installDir: found })
    }
    if (!this.settings.logFile && this.settings.installDir) {
      const logs = await listLogs(this.settings.installDir)
      if (logs[0]) this.store.settings.set({ ...this.settings, logFile: logs[0].path })
    }
    await this.loadSpells()
    this.tickTimer = setInterval(() => this.tick(), 200)
    this.archiveTimer = setInterval(() => {
      void this.archiveCheck()
      void this.lookElsewhere()
    }, 30_000)
    this.archives.resumeStaging().catch((e: unknown) => log.error('Finishing interrupted archives failed:', e))
    // Reading history starts the backlog before the tailer can give a line, so nothing slips between.
    const history = this.store.motesFresh ? this.rebuildMoteHistory() : this.catchUpMotes()
    history.catch((e: unknown) => log.error('Reading mote history at startup failed:', e))
    // Catching up reads the log's end on this thread; the meter's own read of it waits its turn. A
    // rebuild runs in a worker and is not waited for.
    if (!this.store.motesFresh) this.startupRead = history.catch(() => undefined)
    if (this.settings.autoStart && this.settings.logFile) await this.startWatching()
    this.emitStatus()
  }

  async loadSpells(): Promise<void> {
    try {
      const heapBefore = process.memoryUsage().heapUsed
      const started = performance.now()
      this.book = await SpellBook.load(this.settings.installDir)
      // The largest thing the app reads; its cost is logged so a change to it shows (see README, Measuring).
      log.info(
        `Spell data: ${this.book.size} spells in ${Math.round(performance.now() - started)} ms; the heap grew ${Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576)} MB reading it`
      )
      this.status.spellsLoaded = this.book.size
      this.buffs.setBook(this.book)
      this.status.spellError = ''
      this.tracker = new SpellTracker(this.book, this.board, this.trackerConfig(), {
        notify: (ns) => this.notifier.notify(ns),
        feed: (kind, text) => this.pushFeed(kind, text),
        onZone: (zone) => {
          this.status.zone = zone
          this.emitStatus()
        },
        onCast: (r, at) => {
          const casts = { ...this.store.casts.get() }
          const prev = casts[r.rankedName]
          casts[r.rankedName] = { rankedName: r.rankedName, lastCast: at, count: (prev?.count ?? 0) + 1 }
          this.store.casts.set(casts)
        }
      })
    } catch (e) {
      log.error(`Could not load spells from ${this.settings.installDir}:`, e)
      this.book = null
      this.tracker = null
      this.status.spellsLoaded = 0
      this.status.spellError = `Could not read the spell files: ${(e as Error).message}`
    }
    this.emitStatus()
  }

  // ---- configuration ----

  character(): CharacterSettings {
    return this.queries.character()
  }

  ruleFor(name: string): SpellRule {
    return this.queries.ruleFor(name)
  }

  durationFor(spell: Spell, rank: number) {
    return this.queries.durationFor(spell, rank)
  }

  private trackerConfig() {
    return {
      tracking: this.settings.tracking,
      durationFor: (spell: Spell, rank: number) => this.durationFor(spell, rank),
      ruleFor: (name: string) => this.ruleFor(name)
    }
  }

  reconfigure(): void {
    this.tracker?.configure(this.trackerConfig())
    // Charm pets on or off changes whose every past blow was: the fights on record are read again.
    if (this.combat.reconfigure() && this.status.watching) void this.rebuildCombat(this.settings.combat.historyMinutes)
    this.triggers.load(this.store.triggers.get(), characterName(this.settings.logFile))
    this.buffs.reconfigure()
    this.emitStatus()
  }

  // ---- watching ----

  async startWatching(): Promise<void> {
    const gen = ++this.watchGen
    this.stopTail()
    const logFile = this.settings.logFile
    if (!logFile) return
    this.starting = true
    const zone = await lastZone(logFile)
    // A later start or a stop came while the zone was being read; that one wins.
    if (gen !== this.watchGen) return
    this.starting = false
    if (this.watchedLog && !samePath(this.watchedLog, logFile)) {
      // Another character: nothing the last one had running applies any more.
      const n = this.board.list().length
      for (const f of this.features) f.reset?.()
      if (n) this.pushFeed('info', `Switched to ${basename(logFile)}; cleared ${n} timer${n === 1 ? '' : 's'}.`)
    }
    this.watchedLog = logFile
    this.buffs.follow(characterKey(logFile), Date.now())
    this.status.logFile = logFile
    this.status.character = characterName(logFile)
    this.combat.meter.setSelf(this.status.character)
    this.triggers.load(this.store.triggers.get(), this.status.character)
    this.status.zone = zone
    this.tracker?.setZone(zone)
    this.missing = false
    const tail: Tail = {
      logFile,
      start: -1,
      end: -1,
      clock: new LogClock(),
      tailer: new LogTailer(logFile, {
        startAtEnd: true,
        onLines: (lines, end) => this.tail === tail && this.onLines(tail, lines, end),
        onReset: (reason) => this.tail === tail && this.onTailReset(tail, reason),
        onMissing: () => this.tail === tail && this.onTailMissing(tail),
        onSize: (size) => this.tail === tail && this.onTailSize(tail, size)
      })
    }
    this.tail = tail
    tail.tailer.start()
    this.status.watching = true
    this.pushFeed('info', `Watching ${basename(logFile)}${zone ? ` in ${zone}` : ''}`)
    this.emitStatus()
    void this.seedCombat()
  }

  /** Recent fights from the log (see CombatFeed.seed). */
  async seedCombat(minutes = this.settings.combat.historyMinutes): Promise<void> {
    const t = this.tail
    if (!t) return
    const gen = this.watchGen
    const after = this.startupRead
    this.startupRead = undefined
    await this.combat.seed(
      t.logFile,
      () => t.start,
      () => gen === this.watchGen,
      minutes,
      after
    )
  }

  /** Forgets every fight and reads the last `minutes` of the log again. */
  rebuildCombat(minutes: number): Promise<void> {
    if (this.combat.backlog.active) return Promise.resolve()
    return jobs.run('combat', `Reading the last ${minutes} minutes of the log into the meter`, async (job) => {
      this.combat.reset()
      const t = this.tail
      if (!t) return
      const gen = this.watchGen
      await this.combat.seed(
        t.logFile,
        () => t.start,
        () => gen === this.watchGen && !job.signal.aborted,
        minutes
      )
    })
  }

  stopWatching(): void {
    this.watchGen++
    this.stopTail()
  }

  private stopTail(): void {
    this.starting = false
    this.tail?.tailer.stop()
    this.tail = null
    if (this.status.watching) this.pushFeed('info', 'Stopped watching')
    this.status.watching = false
    this.emitStatus()
  }

  private onTailSize(t: Tail, size: number): void {
    if (t.start < 0) {
      t.start = size
      this.moteHistory.attached(t.logFile, size)
    }
    if (this.missing) {
      this.missing = false
      this.status.watching = true
      this.pushFeed('info', `${basename(t.logFile)} is back; watching it again.`)
      this.statusOut.mark()
    }
    if (size !== this.status.logSize) this.statusOut.mark()
    this.status.logSize = size
  }

  private onTailReset(t: Tail, reason: 'truncated' | 'replaced'): void {
    t.end = 0
    this.moteHistory.tailReset(t.logFile, reason)
    this.pushFeed('info', reason === 'replaced' ? 'A new log file was started.' : 'The log was truncated; reading from the top.')
  }

  private onTailMissing(t: Tail): void {
    this.missing = true
    this.status.watching = false
    const text = `${basename(t.logFile)} is gone (moved or deleted). Waiting for the game to write it again.`
    // Archiving moves the log away on purpose; the game starts a new one at its next line.
    this.pushFeed(this.archive.busy ? 'info' : 'warn', text)
    this.emitStatus()
  }

  private onLines(t: Tail, lines: string[], end: number): void {
    t.end = end
    this.notifier.playing(Date.now())
    for (const raw of lines) {
      const line = t.clock.parse(raw)
      if (!line) continue
      for (const f of this.features) f.line?.(line)
    }
    for (const f of this.features) f.linesRead?.(t.logFile, end)
  }

  /** What the pet wears and which pet it is, as the log tells it. */
  private petLine(line: LogLine): void {
    this.petReader.handle(line.text, line.time)
    const cast = this.book && line.text.startsWith('You begin ') ? CAST_BY_YOU.exec(line.text) : null
    if (cast) {
      const spell = petSummonName(this.book!, cast[1])
      if (spell) this.out.pet({ summon: { spell, at: line.time } })
    }
  }

  /** Feeds pasted log lines through the live pipeline, with their times shifted to now. */
  simulate(text: string): void {
    this.simulating = true
    try {
      const parsed = text
        .split(/\r?\n/)
        .map((l) => parseLogLine(l.trim()))
        .filter((l) => l !== null)
      if (!parsed.length) return
      const shift = Date.now() - parsed[parsed.length - 1].time
      for (const line of parsed) {
        const shifted = { ...line, time: line.time + shift }
        this.tracker?.handle(shifted)
        this.triggers.handle(shifted)
        // Mote history is a record of real play: a pasted loot line must not count towards it.
      }
    } finally {
      this.simulating = false
    }
  }

  private tick(): void {
    const now = Date.now()
    for (const f of this.features) f.tick?.(now)
  }

  // ---- output ----

  speak(text: string, interrupt = false): Promise<void> {
    return this.notifier.speak(text, interrupt)
  }

  playSound(file: string, volume: number): Promise<void> {
    return this.notifier.playSound(file, volume)
  }

  resolveSound(file: string): string | null {
    return this.notifier.resolveSound(file)
  }

  listSounds(): Promise<string[]> {
    return this.notifier.listSounds()
  }

  pushFeed(kind: FeedItem['kind'], text: string): void {
    this.notifier.pushFeed(kind, text)
  }

  emitStatus(): void {
    this.statusOut.sent(Date.now())
    this.out.status({ ...this.status })
  }

  // ---- buffs, group, respawns, loot, fights ----

  buffView(): BuffView {
    return this.buffs.view()
  }

  /** The buffs the character wants; null goes back to the defaults. */
  setWantedBuffs(list: string[] | null): BuffView {
    return this.buffs.setWanted(list)
  }

  myClasses(): MyClass[] {
    return this.buffs.myClasses()
  }

  /** The group roster was changed by hand: the buff plan is built on it, so the page hears at once. */
  groupChanged(): void {
    this.buffs.groupChanged()
  }

  respawnView(): RespawnView {
    return this.combat.respawnView()
  }

  /** The Respawns page shows which mobs have timers, so it hears when the triggers change. */
  triggersChanged(): void {
    this.combat.triggersChanged()
  }

  lootView(): LootView {
    return this.combat.lootView()
  }

  combatSnapshot(): CombatSnapshot {
    return this.combat.snapshot()
  }

  combatSegment(id: string): Segment | null {
    return this.combat.segment(id)
  }

  sessionTimeline(id: string): StitchedTimeline | null {
    return this.combat.meter.sessionTimeline(id)
  }

  newCombatSession(): CombatSnapshot {
    return this.combat.newSession()
  }

  // ---- spells ----

  knownSpells(): KnownSpell[] {
    return this.queries.knownSpells()
  }

  checkLog(megabytes: number): Promise<LogCheckRow[]> {
    return this.queries.checkLog(megabytes)
  }

  // ---- log management (ArchiveManager) ----

  archiveDir(): string {
    return this.archives.archiveDir()
  }

  archiveNow(logPath: string): Promise<ArchiveOutcome> {
    return this.archives.archiveNow(logPath)
  }

  compressLoose(path: string): Promise<ArchiveOutcome> {
    return this.archives.compressLoose(path)
  }

  /** Auto-archives any character log over the size threshold; never rejects. */
  async archiveCheck(): Promise<void> {
    try {
      await this.archives.check()
    } catch (e) {
      log.error('The automatic archive check failed:', e)
    }
  }

  logsOverview() {
    return this.archives.overview()
  }

  /**
   * Another character: the watched log has been quiet for a while and another log in the game folder
   * was written in the last minute. The Live page offers to switch; the feed says so once per log.
   */
  private async lookElsewhere(now = Date.now()): Promise<void> {
    const quiet = this.status.watching && now - this.status.lastLineAt > 120_000
    let found: WatchStatus['elsewhere'] = null
    if (quiet && this.settings.installDir) {
      const other = (await listLogs(this.settings.installDir)).find((l) => !samePath(l.path, this.settings.logFile) && now - l.modified < 60_000)
      if (other) found = { path: other.path, character: other.character.split('_')[0] }
    }
    if ((found?.path ?? '') === (this.status.elsewhere?.path ?? '')) return
    this.status.elsewhere = found
    if (found && !this.saidElsewhere.has(found.path)) {
      this.saidElsewhere.add(found.path)
      this.pushFeed('info', `${found.character}'s log is being written while ${this.status.character}'s is quiet. Switch on the Live page to follow ${found.character}.`)
    }
    this.emitStatus()
  }

  /** The game has closed: nothing it was timing is still running. */
  gameClosed(): void {
    const n = this.board.list().length
    this.board.clear()
    this.motes.gameClosed(Date.now())
    this.archives.set({ gameRunning: false })
    this.pushFeed('info', n ? `The game closed; cleared ${n} timer${n === 1 ? '' : 's'}.` : 'The game closed.')
  }

  gameStarted(): void {
    this.archives.set({ gameRunning: true })
    this.pushFeed('info', 'The game is running.')
  }

  // ---- mote history (MoteCatchUp) ----

  moteView(): MoteView {
    return { ...this.motes.state, scanning: this.moteHistory.scanning, scanProgress: this.moteHistory.scanProgress }
  }

  /** Reads what was logged while the app was closed (see MoteCatchUp.catchUp). */
  catchUpMotes(): Promise<void> {
    return this.moteHistory.catchUp(this.settings.logFile)
  }

  /** Rebuilds mote history from every log and archive (see MoteCatchUp.rebuild). */
  rebuildMoteHistory(): Promise<void> {
    return this.moteHistory.rebuild(this.settings.installDir, this.settings.logFile, () => this.moteView())
  }

  shutdown(): void {
    this.archives.shutdown()
    this.stopWatching()
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.archiveTimer) clearInterval(this.archiveTimer)
    this.moteHistory.shutdown()
  }

  characterKey(): string {
    return characterKey(this.settings.logFile)
  }
}
