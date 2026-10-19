import type { SimulateResult } from '../../shared/ipc'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { parseLogLine, type LogLine } from '../../core/logLine'
import { SpellBook, type RankedSpell, type Spell } from '../../core/spells'
import { TimerBoard } from '../../core/timers'
import { SpellTracker } from '../../core/spellTracker'
import type { QuickBuffLanding } from '../castHistory'
import { TriggerEngine } from '../../core/triggers'
import { MoteTracker, moteName } from '../../core/motes'
import { PetGearReader, petSummonName } from '../../core/pets'
import type { BuffView } from '../../core/buffs'
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
import { readSpellBook } from './spellBookLoad'
import { IDLE_POLL_MS, LIVE_POLL_MS, LogFollower } from './logFollower'
import { Throttled } from '../../core/throttle'
import { UnreadLines } from '../../core/unreadLines'
import type { EngineFeature } from './feature'
import type { AppSettings, ArchiveStatus, CharacterSettings, FeedItem, Notification, SpellRule, WatchStatus } from '../../shared/types'
import type { EngineEnv, EngineOutputs, EngineStore, MoteView, Speaker } from './contracts'
import { jobs } from '../sources/jobs'
import { perf } from '../perf'
import type { TailerStats } from '../../core/tailer'

export type { EngineEnv, EngineOutputs, EngineStore, MoteView, Speaker } from './contracts'

/** This PC's log quiet this long, its game closed, before another PC's is followed. */
const MAIN_QUIET_MS = 60_000
/** Another PC's log written this recently is being played. */
const REMOTE_FRESH_MS = 60_000
/** Another PC's log followed and quiet this long: back to this PC's. */
const REMOTE_IDLE_MS = 15 * 60_000

/** Another PC's log being followed, and since when. */
interface RemoteFollow {
  path: string
  character: string
  folder: string
  since: number
}

/** The engine's clock: timers, cues and pushes go on its laps. */
const TICK_MS = 200
export type { EngineFeature } from './feature'

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
  readonly queries: SpellQueries
  private readonly buffs: BuffCoordinator
  readonly combat: CombatFeed
  private readonly moteHistory: MoteCatchUp
  private readonly petReader: PetGearReader
  private readonly timersOut: Throttled
  private readonly motesOut: Throttled
  /** Size and last-line time change with every write; they go out at most once a second. */
  private readonly statusOut: Throttled
  /** The lines no part took, by shape, since the app started or the character changed (FEAT-025). */
  readonly unread = new UnreadLines()
  /** What follows the log, in the order each line, tick and change of character reaches it (see buildFeatures). */
  private readonly features: EngineFeature[]

  /** The watched log, followed (logFollower.ts). */
  private readonly follower: LogFollower
  /** Bumped by every start and stop, so a start overtaken while it waited gives up. */
  private watchGen = 0
  private starting = false
  /** Another PC's log being followed while this PC's game is closed; null while this PC's is. */
  private remote: RemoteFollow | null = null
  /** The log last watched, to tell a switch of character from a restart of the same log. */
  private watchedLog = ''
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
    this.queries = new SpellQueries(
      store,
      () => this.book,
      () => this.playedLog
    )
    this.timersOut = new Throttled(0, () => this.out.timers(this.board.views()))
    this.motesOut = new Throttled(1000, () => this.out.motes(this.moteView()))
    this.statusOut = new Throttled(1000, () => this.out.status({ ...this.status }))
    this.board = new TimerBoard({
      onChange: () => this.timersOut.mark(),
      onNotify: (ns, t) => this.notifier.notify(ns, t),
      onAdd: (t) => this.notifier.prepare(t.onWarn)
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
    this.buffs = new BuffCoordinator(store, out, this.board, this.queries, this.notifier, {
      book: () => this.book,
      group: () => this.combat.meter.groupMembers,
      fighting: () => this.combat.meter.fighting,
      readingHistory: () => this.combat.backlog.active,
      live: () => !this.simulating && this.status.watching,
      self: () => this.status.character,
      logFile: () => this.playedLog,
      // Your own /who: the zone when the watch does not know it yet, and your race and classes for the
      // record. Those only from a /who typed now: one read back from the log may be from before a change.
      onSelf: (p) => {
        if (p.zone && !this.status.zone) {
          this.status.zone = p.zone
          this.tracker?.setZone(p.zone)
          this.emitStatus()
        }
        if (!this.combat.backlog.active) out.selfSeen?.({ race: p.race, classes: p.classes, level: p.level })
      }
    })
    this.combat = new CombatFeed(store, out, this.notifier, this.buffs, {
      book: () => this.book,
      zone: () => this.status.zone,
      // The merge planner follows what the log says was merged, not only its own Done (LT-740).
      merged: (name, at) => {
        if (!this.simulating) this.stock.observed([name], at, 'merge')
      }
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
        logFile: () => this.follower.tail?.logFile ?? '',
        position: () => {
          const t = this.follower.tail
          return !t ? -1 : t.end >= 0 ? t.end : t.start
        },
        settling: () => this.starting || (!!this.follower.tail && this.follower.tail.start < 0)
      },
      archiveDir: () => this.archives.archiveDir(),
      gameRunning: () => this.archive.gameRunning,
      changed: () => this.motesOut.mark()
    })
    this.features = this.buildFeatures()
    this.follower = new LogFollower({
      status: this.status,
      features: this.features,
      pushFeed: (kind, text) => this.pushFeed(kind, text),
      emitStatus: () => this.emitStatus(),
      statusChanged: () => this.statusOut.mark(),
      lines: () => this.notifier.playing(Date.now()),
      // A new timer's bar goes out with its line, not at the next lap of the clock (LT-353).
      linesDone: () => this.timersOut.tick(Date.now()),
      unread: (line) => this.unread.add(line.text),
      attached: (logFile, size) => this.moteHistory.attached(logFile, size),
      reset: (logFile, reason) => this.moteHistory.tailReset(logFile, reason),
      archiving: () => this.archive.busy
    })
  }

  /**
   * The parts that follow the log, in order. A line goes to the spell tracker, the triggers, the pet
   * reader, mote history, the combat feed (and through it buffs) and then the status line; a tick to
   * the timer board, the pet reader, motes, the combat feed and buffs, and then the views that go out;
   * a change of character clears the timers and then the fights. The order matters, so it is kept as
   * it was written by hand. A part of the engine's own (mote history, the combat feed, buffs) is listed
   * as itself; one from core, which cannot know the contract, or the engine's own state, through an
   * entry here.
   */
  private buildFeatures(): EngineFeature[] {
    const output = (id: string, out: Throttled): EngineFeature => ({ id, tick: (now) => out.tick(now) })
    return [
      {
        id: 'timers',
        tick: (now) => this.board.tick(now),
        reset: () => {
          this.board.clear()
          this.unread.clear()
        }
      },
      // The tracker is made when spell data loads, and made again when it reloads: this entry follows the current one.
      { id: 'spells', line: (line) => this.tracker?.handle(line) },
      { id: 'triggers', line: (line) => this.triggers.handle(line) },
      { id: 'pet', line: (line) => this.petLine(line), tick: (now) => this.petReader.tick(now) },
      { id: 'motes', tick: (now) => this.motes.tick(now) },
      this.moteHistory,
      this.combat,
      this.buffs,
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
    this.tickTimer = setInterval(() => this.tick(), TICK_MS)
    this.archiveTimer = setInterval(() => {
      void this.archiveCheck()
      void this.lookElsewhere()
      // Another PC's log, while this PC's game is closed (Settings › Log files).
      void this.followOtherPc()
      // Motes looted on other PCs since the last look.
      void this.moteHistory.others.check()
    }, 30_000)
    this.archives.resumeStaging().catch((e: unknown) => log.error('Finishing interrupted archives failed:', e))
    // Reading history starts the backlog before the tailer can give a line, so nothing slips between.
    const history = this.store.motesFresh ? this.rebuildMoteHistory() : this.catchUpMotes()
    history.catch((e: unknown) => log.error('Reading mote history at startup failed:', e))
    // Then what other PCs' logs gained while this app was closed.
    void history.then(
      () => this.moteHistory.others.check(),
      () => undefined
    )
    // Catching up reads the log's end on this thread; the meter's own read of it waits its turn. A
    // rebuild runs in a worker and is not waited for.
    if (!this.store.motesFresh) this.startupRead = history.catch(() => undefined)
    if (this.settings.autoStart && this.settings.logFile) await this.startWatching()
    this.emitStatus()
  }

  /**
   * The buffs the character casts, the newest rank of each (the casts kept in casts.json): what a Quick
   * Buff activation can land, since Legends prints no cast line for it (LT-503).
   */
  private quickBuffs(): RankedSpell[] {
    if (!this.book) return []
    const newest = new Map<string, { r: RankedSpell; at: number }>()
    for (const c of Object.values(this.store.casts.get()[characterKey(this.playedLog)] ?? {})) {
      const r = this.book.resolve(c.rankedName)
      if (!r || !r.spell.beneficial || (!r.spell.landSelf && !r.spell.landOther)) continue
      const had = newest.get(r.spell.name)
      if (!had || c.lastCast > had.at) newest.set(r.spell.name, { r, at: c.lastCast })
    }
    return [...newest.values()].map((x) => x.r)
  }

  /** For the cast counts: each buff Quick Buff can land, by its landing texts and the ranked name it counts as. */
  quickBuffLandings(): QuickBuffLanding[] {
    return this.quickBuffs().map((r) => ({ self: r.spell.landSelf, other: r.spell.landOther, rankedName: r.rankedName }))
  }

  async loadSpells(): Promise<void> {
    const read = await readSpellBook(this.settings.installDir)
    if ('error' in read) {
      this.book = null
      this.tracker = null
      this.status.spellsLoaded = 0
      this.status.spellError = read.error
    } else
      try {
        this.book = read.book
        this.status.spellsLoaded = this.book.size
        for (const f of this.features) f.spellsLoaded?.(this.book)
        this.status.spellError = ''
        this.tracker = new SpellTracker(this.book, this.board, this.trackerConfig(), {
          notify: (ns) => this.notifier.notify(ns),
          feed: (kind, text) => this.pushFeed(kind, text),
          onZone: (zone) => {
            this.status.zone = zone
            this.emitStatus()
          },
          onCast: (r, at) => {
            // Changed in place: the file needs only a mark, not a copy of every known cast per cast (LT-384).
            const all = this.store.casts.get()
            const casts = (all[characterKey(this.playedLog)] ??= {})
            const prev = casts[r.rankedName]
            casts[r.rankedName] = { rankedName: r.rankedName, lastCast: at, count: (prev?.count ?? 0) + 1 }
            this.store.casts.set(all)
          },
          isPet: (name) => this.combat.meter.kindOf(name).kind === 'pet',
          isYourPet: (name) => this.combat.meter.isYourPet(name),
          quickBuffs: () => this.quickBuffs()
        })
      } catch (e) {
        // A part that cannot take the spells leaves them unloaded, as a file that would not read does.
        log.error('Could not set up the spells:', e)
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
    this.notifier.reconfigure()
    this.tracker?.configure(this.trackerConfig())
    // Charm pets on or off changes whose every past blow was: the fights on record are read again.
    if (this.combat.applySettings() && this.status.watching) void this.rebuildCombat(this.settings.combat.historyMinutes)
    this.triggers.load(this.store.triggers.get(), characterName(this.playedLog))
    for (const f of this.features) f.reconfigure?.()
    this.emitStatus()
  }

  // ---- watching ----

  /** Follows the settings' log, or with `remote` another PC's while this one's game is closed (followOtherPc). */
  async startWatching(remote: RemoteFollow | null = null): Promise<void> {
    const gen = ++this.watchGen
    this.stopTail()
    this.remote = remote
    this.moteHistory.remote = !!remote
    this.status.remote = remote ? { path: remote.path, character: remote.character, folder: remote.folder } : null
    const logFile = remote?.path ?? this.settings.logFile
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
      this.pushFeed('info', `Now watching ${basename(logFile)}${n ? `; cleared ${n} timer${n === 1 ? '' : 's'}` : ''}.`)
    }
    this.watchedLog = logFile
    for (const f of this.features) f.watching?.(logFile, Date.now())
    this.status.logFile = logFile
    this.status.character = characterName(logFile)
    this.combat.meter.setSelf(this.status.character)
    this.triggers.load(this.store.triggers.get(), this.status.character)
    this.status.zone = zone
    this.tracker?.setZone(zone)
    this.follower.follow(logFile, this.env.pollMs ?? (this.archive.gameRunning ? LIVE_POLL_MS : IDLE_POLL_MS))
    this.status.watching = true
    // Until a line comes, the last one is the file's last write: "Last line 5m ago", not "never".
    this.status.lastLineAt = (await fs.stat(logFile).catch(() => null))?.mtimeMs ?? 0
    this.pushFeed(
      'info',
      remote
        ? `Following ${remote.character}'s log on ${remote.folder}${zone ? ` in ${zone}` : ''}: this PC's game is closed.`
        : `Watching ${basename(logFile)}${zone ? ` in ${zone}` : ''}`
    )
    this.emitStatus()
    void this.seedCombat()
  }

  /** Recent fights from the log (see CombatFeed.seed). */
  async seedCombat(minutes = this.settings.combat.historyMinutes): Promise<void> {
    const t = this.follower.tail
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
      const t = this.follower.tail
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
    this.follower.stop()
    if (this.status.watching) this.pushFeed('info', 'Stopped watching')
    this.status.watching = false
    this.emitStatus()
  }

  /** What the pet wears and which pet it is, as the log tells it. Whether the line was the pet's gear. */
  private petLine(line: LogLine): boolean {
    const took = this.petReader.handle(line.text, line.time)
    const cast = this.book && line.text.startsWith('You begin ') ? CAST_BY_YOU.exec(line.text) : null
    if (cast) {
      const spell = petSummonName(this.book!, cast[1])
      if (spell) this.out.pet({ summon: { spell, at: line.time } })
    }
    return took
  }

  /** Feeds pasted log lines through the live pipeline, with their times shifted to now. */
  /**
   * Runs pasted log lines through the spell timers and the triggers as if just logged, and says what
   * came of it: the lines read, and the timers and triggers the feed saw start (LT-679).
   */
  simulate(text: string): SimulateResult {
    this.simulating = true
    const before = this.feed.length
    let lines = 0
    try {
      const parsed = text
        .split(/\r?\n/)
        .map((l) => parseLogLine(l.trim()))
        .filter((l) => l !== null)
      lines = parsed.length
      if (!parsed.length) return { lines, timers: 0, triggers: 0 }
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
    const added = this.feed.slice(before)
    return { lines, timers: added.filter((f) => f.kind === 'timer').length, triggers: added.filter((f) => f.kind === 'trigger').length }
  }

  private lastTickAt = 0
  /** When a lap last came so late it was logged: at most one line a minute. */
  private lateLoggedAt = 0

  private tick(): void {
    const now = Date.now()
    if (this.lastTickAt) {
      const late = Math.max(0, now - this.lastTickAt - TICK_MS)
      perf.tickLate.add(late)
      // A lap a quarter of a second late, with when and whether the game ran: what LT-350's long laps need (LT-607).
      if (late > 250 && now - this.lateLoggedAt > 60_000) {
        this.lateLoggedAt = now
        log.info(`Engine clock: a lap came ${late} ms late (the game ${this.archive.gameRunning ? 'running' : 'closed'})`)
      }
    }
    this.lastTickAt = now
    for (const f of this.features) {
      try {
        f.tick?.(now)
      } catch (e) {
        this.follower.failed(f, 'a lap of the clock', e)
      }
    }
    this.follower.tick(now)
  }

  /** Lines or laps a part threw on this run (diagnostics). */
  get failures(): number {
    return this.follower.failures
  }

  /** The watched log's tailer's counts, or null when none is watched. */
  get tailerStats(): TailerStats | null {
    return this.follower.tail?.tailer.stats ?? null
  }

  /**
   * A feature module's own part in following the log (the achievements overlay's tracking), after
   * every built-in one: it sees each line once they all have.
   */
  use(feature: EngineFeature): void {
    this.features.push(feature)
  }

  // ---- output ----

  /**
   * A countdown a feature starts, as a trigger's timer would run (FEAT-038: a wanted Hunter named's
   * respawn). Started again from now if one of `key` runs; `endSpeech` said when it ends.
   */
  startTimer(t: { key: string; label: string; seconds: number; overlay: string; color: string; warnSec: number; warnSpeech: string; endSpeech: string; at: number }): void {
    this.board.upsert({
      key: t.key,
      id: this.board.get(t.key)?.id ?? this.board.nextId(),
      label: t.label,
      target: '',
      source: 'trigger',
      color: t.color,
      overlay: t.overlay,
      startedAt: t.at,
      endsAt: t.at + t.seconds * 1000,
      exact: true,
      warnSec: t.warnSec,
      onWarn: t.warnSpeech ? [{ kind: 'speak', text: t.warnSpeech, interrupt: false }] : [],
      onExpire: t.endSpeech ? [{ kind: 'speak', text: t.endSpeech, interrupt: false }] : [],
      warned: false,
      graceMs: 0
    })
  }

  /** Alerts, speech and sounds, as a trigger's would go: muting and the settings apply. */
  notify(ns: Notification[]): void {
    this.notifier.notify(ns)
  }

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

  /** The Respawns page shows which mobs have timers, so it hears when the triggers change. */
  triggersChanged(): void {
    this.combat.triggersChanged()
  }

  // ---- spells ----

  // ---- log management (ArchiveManager) ----

  /** Auto-archives any character log over the size threshold; never rejects. */
  async archiveCheck(): Promise<void> {
    try {
      await this.archives.check()
    } catch (e) {
      log.error('The automatic archive check failed:', e)
    }
  }

  /**
   * Another character: the watched log has been quiet for a while and another log in the game folder
   * was written in the last minute. The Live page offers to switch; the feed says so once per log.
   */
  private async lookElsewhere(now = Date.now()): Promise<void> {
    const quiet = !this.remote && this.status.watching && now - this.status.lastLineAt > 120_000
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
    this.follower.setPollMs(this.env.pollMs ?? IDLE_POLL_MS)
    this.pushFeed('info', n ? `The game closed; cleared ${n} timer${n === 1 ? '' : 's'}.` : 'The game closed.')
  }

  gameStarted(): void {
    this.archives.set({ gameRunning: true })
    // This PC's game is played again: its own log, not another PC's.
    if (this.remote) void this.startWatching()
    this.follower.setPollMs(this.env.pollMs ?? LIVE_POLL_MS)
    this.pushFeed('info', 'The game is running.')
  }

  // ---- mote history (MoteCatchUp) ----

  moteView(): MoteView {
    return { ...this.motes.state, scanning: this.moteHistory.scanning, scanProgress: this.moteHistory.scanProgress }
  }

  /** Reads what was logged while the app was closed (see MoteCatchUp.catchUp). */
  /** Motes looted on other PCs since the last look at their logs (Settings › Log files). */
  checkOtherLogs(): Promise<void> {
    return this.moteHistory.others.check()
  }

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

  /** The character being played: another PC's while its log is followed, else the settings' log's. */
  characterKey(): string {
    return characterKey(this.playedLog)
  }

  /** The log being followed: another PC's while this PC's game is closed, else the one the settings name. */
  get playedLog(): string {
    return this.remote?.path ?? this.settings.logFile
  }

  /**
   * Another PC's log, followed live while this PC's game is closed and its log quiet (the second PC a
   * player leaves killing): the newest log in the other PCs' folders written in the last minute, the
   * same character's first. Back to this PC's log as soon as its game starts or its log is written, or
   * once the other one has been quiet a quarter hour.
   */
  private async followOtherPc(now = Date.now()): Promise<void> {
    if (this.starting) return
    const s = this.settings
    if (this.remote) {
      const main = s.logFile ? await fs.stat(s.logFile).catch(() => null) : null
      const mainWritten = !!main && main.mtimeMs > this.remote.since
      const gone = now - this.status.lastLineAt > REMOTE_IDLE_MS
      if (!s.followOtherPcs || this.archive.gameRunning || mainWritten || gone) {
        this.pushFeed(
          'info',
          mainWritten || this.archive.gameRunning
            ? "Back to this PC's log: its game is being played."
            : `${this.remote.character}'s log on the other PC has gone quiet; back to this PC's log.`
        )
        await this.startWatching()
      }
      return
    }
    if (!s.followOtherPcs || !s.logFolders.length || !this.status.watching || this.archive.gameRunning) return
    if (now - this.status.lastLineAt < MAIN_QUIET_MS) return
    const looks = (await this.env.logFolders?.lookAll().catch(() => [])) ?? []
    const fresh = looks
      .filter((l) => l.reachable)
      .flatMap((l) => l.logs.map((x) => ({ ...x, folder: l.dir })))
      .filter((x) => now - x.modified < REMOTE_FRESH_MS)
      .sort((a, b) => b.modified - a.modified)
    const mine = characterKey(s.logFile).toLowerCase()
    const pick = fresh.find((x) => characterKey(x.path).toLowerCase() === mine) ?? fresh[0]
    // A start or a stop may have come while the folders were looked at.
    if (!pick || this.remote || !this.status.watching || this.archive.gameRunning) return
    await this.startWatching({ path: pick.path, character: characterName(pick.path), folder: pick.folder, since: now })
  }
}
