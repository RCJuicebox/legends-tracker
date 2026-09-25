import { existsSync, promises as fs } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { parseLogLine } from '../core/logLine'
import { LogTailer } from '../core/tailer'
import { SpellBook, summarize, type Spell } from '../core/spells'
import { casterLevel, computeDuration } from '../core/durations'
import { focusFor } from '../core/focus'
import { TimerBoard } from '../core/timers'
import { SpellTracker } from '../core/spellTracker'
import { TriggerEngine } from '../core/triggers'
import { archiveLog, compressLoose, findStaging, finishStaged, stagingOriginalName, type ArchiveOutcome } from '../core/archiver'
import { checkAgainstLog } from '../core/logCheck'
import { MoteTracker, moteName, parseMoteLoot, type MoteLoot, type MoteState } from '../core/motes'
import { StockCursor, fixItem, levelFromName, plan } from '../core/moteCalc'
import { Worker } from 'node:worker_threads'
import { readLines } from './moteHistory'
import moteWorkerPath from './moteWorker?modulePath'
import type { MoteState as ScannedMotes } from '../core/motes'
import { createReadStream } from 'node:fs'
import type { LogLine } from '../core/logLine'
import { characterKey, characterName, type Store } from './store'
import { findInstall, isGameFolder, isGameRunning, lastZone, listArchives, listLogs } from './game'
import type { SpeechWorker } from './speech'
import type {
  AppSettings, ArchiveStatus, CharacterSettings, FeedItem, KnownSpell, LogCheckRow, MoteStock, Notification, SpellRule, TimerView, WatchStatus
} from '../shared/types'

export interface EngineOutputs {
  timers: (views: TimerView[]) => void
  alert: (payload: { text: string; color: string; durationSec: number }) => void
  audio: (payload: AudioCommand) => void
  status: (status: WatchStatus) => void
  feed: (item: FeedItem) => void
  archive: (status: ArchiveStatus) => void
  motes: (state: MoteState & { scanning: string; scanProgress: number }) => void
  stock: (stock: MoteStock) => void
}

export type AudioCommand =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean }
  | { kind: 'sound'; data: Uint8Array; volume: number; name: string }

export class Engine {
  book: SpellBook | null = null
  readonly board: TimerBoard
  private tracker: SpellTracker | null = null
  readonly triggers: TriggerEngine
  private tailer: LogTailer | null = null
  private tickTimer: NodeJS.Timeout | null = null
  private archiveTimer: NodeJS.Timeout | null = null
  private timersDirty = false
  private statusDirty = false
  private statusSentAt = 0
  private readonly feedItems: FeedItem[] = []
  readonly status: WatchStatus = {
    watching: false, logFile: '', character: '', zone: '', spellsLoaded: 0, spellError: '', lastLineAt: 0, logSize: 0
  }
  readonly archive: ArchiveStatus = { busy: false, message: '', pendingUntilGameExits: [], gameRunning: false, liveRotation: 'unknown' }
  private archiveAbort = new AbortController()
  readonly motes: MoteTracker
  private motesDirty = false
  private motesSentAt = 0
  /** While history is being rebuilt, live lines wait here so none are lost or counted twice. */
  private moteBacklog: LogLine[] | null = null
  moteScan = ''
  moteScanProgress = 0
  /** Pasted test lines must not add to the real mote stock. */
  private simulating = false
  private stockCursor: StockCursor | null = null

  constructor(
    private readonly store: Store,
    private readonly speech: SpeechWorker,
    private readonly out: EngineOutputs,
    private readonly soundDirs: () => string[]
  ) {
    this.board = new TimerBoard({
      onChange: () => (this.timersDirty = true),
      onNotify: (ns) => this.notify(ns)
    })
    this.triggers = new TriggerEngine(this.board, {
      notify: (ns) => this.notify(ns),
      feed: (kind, text) => this.pushFeed(kind, text)
    })
    this.motes = new MoteTracker(store.motes.get(), {
      onChange: () => {
        this.store.motes.set(this.motes.state)
        this.motesDirty = true
      },
      onLoot: (loot, session, time) => {
        this.addToStock(loot, time)
        this.pushFeed('loot', `${loot.count > 1 ? `${loot.count} × ` : ''}${moteName(loot.rank)} from ${loot.source}${session ? '' : ' (no session running)'}`)
      },
      onSession: (s) =>
        this.pushFeed('loot', s.kind === 'crawl' ? `Dungeon crawl completed: ${s.name}` : `${s.kind === 'manual' ? 'Session' : 'Normal instance'} ended: ${s.name}`)
    })
  }

  get settings(): AppSettings {
    return this.store.settings.get()
  }

  get feed(): FeedItem[] {
    return this.feedItems
  }

  async init(): Promise<void> {
    const s = this.settings
    if (!isGameFolder(s.installDir)) {
      const found = await findInstall()
      if (found) this.store.settings.set({ ...s, installDir: found })
    }
    if (!this.settings.logFile && this.settings.installDir) {
      const logs = await listLogs(this.settings.installDir)
      if (logs[0]) this.store.settings.set({ ...this.settings, logFile: logs[0].path })
    }
    await this.loadSpells()
    this.tickTimer = setInterval(() => this.tick(), 200)
    this.archiveTimer = setInterval(() => void this.archiveCheck(), 30_000)
    void this.resumeStaging()
    if (this.store.motesFresh) void this.rebuildMoteHistory()
    else void this.catchUpMotes()
    if (this.settings.autoStart && this.settings.logFile) await this.startWatching()
    this.emitStatus()
  }

  async loadSpells(): Promise<void> {
    try {
      this.book = await SpellBook.load(this.settings.installDir)
      this.status.spellsLoaded = this.book.size
      this.status.spellError = ''
      this.tracker = new SpellTracker(this.book, this.board, this.trackerConfig(), {
        notify: (ns) => this.notify(ns),
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
      this.book = null
      this.tracker = null
      this.status.spellsLoaded = 0
      this.status.spellError = `Could not read the spell files: ${(e as Error).message}`
    }
    this.emitStatus()
  }

  // ---- configuration ----

  character(): CharacterSettings {
    return this.store.characterOf(this.settings.logFile)
  }

  ruleFor(name: string): SpellRule {
    return this.store.rules.get()[name] ?? {}
  }

  durationFor(spell: Spell, rank: number) {
    const c = this.character()
    const rule = this.ruleFor(spell.name)
    const level = casterLevel(spell, c)
    const focus = focusFor(spell, c, level)
    const extra = rule.extraFocusPct ?? 0
    return computeDuration({
      spell,
      rank,
      level,
      tierPct: this.settings.tracking.tierDurationPct,
      focusPct: focus.pct + extra,
      focusSteps: extra ? [...focus.steps, `Extra focus set on this spell: +${extra}%`] : focus.steps,
      overrideSec: rule.durationOverrideSec
    })
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
    this.triggers.load(this.store.triggers.get(), characterName(this.settings.logFile))
    this.emitStatus()
  }

  // ---- watching ----

  async startWatching(): Promise<void> {
    this.stopWatching()
    const logFile = this.settings.logFile
    if (!logFile) return
    this.status.logFile = logFile
    this.status.character = characterName(logFile)
    this.triggers.load(this.store.triggers.get(), this.status.character)
    const zone = await lastZone(logFile)
    this.status.zone = zone
    this.tracker?.setZone(zone)
    this.tailer = new LogTailer(logFile, {
      startAtEnd: true,
      onLines: (lines) => this.onLines(lines),
      onReset: (reason) => this.pushFeed('info', reason === 'replaced' ? 'A new log file was started.' : 'The log was truncated; reading from the top.'),
      onSize: (size) => {
        if (size !== this.status.logSize) this.statusDirty = true
        this.status.logSize = size
      }
    })
    this.tailer.start()
    this.status.watching = true
    this.pushFeed('info', `Watching ${basename(logFile)}${zone ? ` in ${zone}` : ''}`)
    this.emitStatus()
  }

  stopWatching(): void {
    this.tailer?.stop()
    this.tailer = null
    if (this.status.watching) this.pushFeed('info', 'Stopped watching')
    this.status.watching = false
    this.emitStatus()
  }

  private onLines(lines: string[]): void {
    for (const raw of lines) {
      const line = parseLogLine(raw)
      if (!line) continue
      this.tracker?.handle(line)
      this.triggers.handle(line)
      if (this.moteBacklog) this.moteBacklog.push(line)
      else this.motes.handle(line)
      this.status.lastLineAt = line.time
      this.statusDirty = true
    }
  }

  /** Feeds pasted log lines through the live pipeline, with their times shifted to now. */
  simulate(text: string): void {
    this.simulating = true
    try {
      this.simulateLines(text)
    } finally {
      this.simulating = false
    }
  }

  private simulateLines(text: string): void {
    const parsed = text.split(/\r?\n/).map((l) => parseLogLine(l.trim())).filter((l) => l !== null)
    if (!parsed.length) return
    const shift = Date.now() - parsed[parsed.length - 1].time
    for (const line of parsed) {
      const shifted = { ...line, time: line.time + shift }
      this.tracker?.handle(shifted)
      this.triggers.handle(shifted)
      this.motes.handle(shifted)
    }
  }

  private tick(): void {
    const now = Date.now()
    this.board.tick(now)
    this.motes.tick(now)
    if (this.motesDirty && now - this.motesSentAt > 1000) {
      this.motesDirty = false
      this.motesSentAt = now
      this.out.motes(this.moteView())
    }
    // Size and last-line time change with every write; send them at most once a second.
    if (this.statusDirty && now - this.statusSentAt > 1000) {
      this.statusDirty = false
      this.emitStatus()
    }
    if (this.timersDirty) {
      this.timersDirty = false
      this.out.timers(this.board.views())
    }
  }

  // ---- output ----

  private notify(ns: Notification[]): void {
    const audio = this.settings.audio
    for (const n of ns) {
      if (n.kind === 'text') this.out.alert({ text: n.text, color: n.color, durationSec: n.durationSec })
      else if (audio.muted) continue
      else if (n.kind === 'speak') void this.speak(n.text, n.interrupt)
      else if (n.kind === 'sound') void this.playSound(n.file, n.volume)
    }
  }

  async speak(text: string, interrupt = false): Promise<void> {
    if (!text.trim()) return
    const a = this.settings.audio
    try {
      const wav = await this.speech.synthesize(text, a.voice, a.rate)
      this.out.audio({ kind: 'speech', wav: new Uint8Array(wav), interrupt })
    } catch {
      this.out.audio({ kind: 'speech-fallback', text, interrupt })
    }
  }

  async playSound(file: string, volume: number): Promise<void> {
    const path = this.resolveSound(file)
    if (!path) {
      this.pushFeed('warn', `Sound not found: ${file}`)
      return
    }
    const data = await fs.readFile(path)
    this.out.audio({ kind: 'sound', data: new Uint8Array(data), volume, name: basename(path) })
  }

  resolveSound(file: string): string | null {
    if (isAbsolute(file)) return existsSync(file) ? file : null
    for (const dir of this.soundDirs()) {
      const p = join(dir, file)
      if (existsSync(p)) return p
    }
    return null
  }

  async listSounds(): Promise<string[]> {
    const names = new Set<string>()
    for (const dir of this.soundDirs()) {
      try {
        for (const f of await fs.readdir(dir)) if (/\.(wav|mp3|ogg)$/i.test(f)) names.add(f)
      } catch {
        // folder absent
      }
    }
    return [...names].sort()
  }

  pushFeed(kind: FeedItem['kind'], text: string): void {
    const item = { at: Date.now(), kind, text }
    this.feedItems.push(item)
    if (this.feedItems.length > 300) this.feedItems.shift()
    this.out.feed(item)
  }

  emitStatus(): void {
    this.statusSentAt = Date.now()
    this.out.status({ ...this.status })
  }

  // ---- spells ----

  knownSpells(): KnownSpell[] {
    if (!this.book) return []
    const casts = this.store.casts.get()
    const rules = this.store.rules.get()
    const byBase = new Map<string, { rankedName: string; lastCast: number }>()
    for (const c of Object.values(casts)) {
      const r = this.book.resolve(c.rankedName)
      if (!r) continue
      const prev = byBase.get(r.spell.name)
      if (!prev || c.lastCast > prev.lastCast) byBase.set(r.spell.name, c)
    }
    for (const name of Object.keys(rules)) if (!byBase.has(name)) byBase.set(name, { rankedName: name, lastCast: 0 })
    const out: KnownSpell[] = []
    for (const { rankedName, lastCast } of byBase.values()) {
      const r = this.book.resolve(rankedName)
      if (!r) continue
      const d = this.durationFor(r.spell, r.rank)
      if (d.ticks === 0) continue
      out.push({ ...summarize(r.spell), rank: r.rank, rankedName, lastCast, duration: d, rule: rules[r.spell.name] ?? {} })
    }
    return out.sort((a, b) => b.lastCast - a.lastCast)
  }

  explain(rankedName: string): KnownSpell | null {
    const r = this.book?.resolve(rankedName)
    if (!r) return null
    return {
      ...summarize(r.spell), rank: r.rank, rankedName, lastCast: 0, duration: this.durationFor(r.spell, r.rank), rule: this.ruleFor(r.spell.name)
    }
  }

  async checkLog(megabytes: number): Promise<LogCheckRow[]> {
    if (!this.book || !this.settings.logFile) return []
    const c = this.character()
    const book = this.book
    return checkAgainstLog({
      logPath: this.settings.logFile,
      book,
      megabytes,
      level: (name) => casterLevel(book.named(name)!, c),
      focusPct: (spell) => focusFor(spell, c, casterLevel(spell, c)).pct + (this.ruleFor(spell.name).extraFocusPct ?? 0),
      tierPct: this.settings.tracking.tierDurationPct
    })
  }

  // ---- log management ----

  archiveDir(): string {
    const s = this.settings
    return s.archive.archiveDir || join(s.installDir, 'Logs', 'archive')
  }

  private deps(progress = true) {
    return {
      isGameRunning,
      signal: this.archiveAbort.signal,
      progress: progress ? (m: string) => this.setArchive({ message: m }) : undefined
    }
  }

  private setArchive(patch: Partial<ArchiveStatus>): void {
    Object.assign(this.archive, patch)
    this.out.archive({ ...this.archive })
  }

  async archiveNow(logPath: string): Promise<ArchiveOutcome> {
    if (this.archive.busy) return { status: 'failed', message: 'An archive is already in progress.' }
    this.setArchive({ busy: true, message: `Archiving ${basename(logPath)}…` })
    try {
      const outcome = await archiveLog(logPath, this.archiveDir(), this.deps())
      this.report(logPath, outcome)
      return outcome
    } finally {
      this.setArchive({ busy: false })
    }
  }

  async compressLoose(path: string): Promise<ArchiveOutcome> {
    if (this.archive.busy) return { status: 'failed', message: 'An archive is already in progress.' }
    this.setArchive({ busy: true, message: `Compressing ${basename(path)}…` })
    try {
      const outcome = await compressLoose(path, this.deps())
      this.report(path, outcome)
      return outcome
    } finally {
      this.setArchive({ busy: false })
    }
  }

  private report(logPath: string, o: ArchiveOutcome): void {
    const name = basename(logPath)
    const pending = this.archive.pendingUntilGameExits.filter((p) => p !== logPath)
    if (o.status === 'archived') {
      const ratio = o.originalBytes ? Math.round((1 - o.zipBytes / o.originalBytes) * 100) : 0
      const msg = `Archived ${name}: ${mb(o.originalBytes)} → ${mb(o.zipBytes)} (${ratio}% smaller) as ${basename(o.zipPath)}`
      this.setArchive({ message: msg, pendingUntilGameExits: pending, ...(o.liveHandoff ? { liveRotation: 'supported' as const } : {}) })
      this.pushFeed('archive', msg)
    } else if (o.status === 'deferred') {
      this.setArchive({
        message: o.message,
        pendingUntilGameExits: [...pending, logPath],
        ...(o.reason === 'held-open' ? { liveRotation: 'unsupported' as const } : {})
      })
      this.pushFeed('archive', o.message)
    } else {
      this.setArchive({ message: o.message, pendingUntilGameExits: pending })
      this.pushFeed('warn', o.message)
    }
  }

  /** Auto-archives any character log over the size threshold; retries deferred logs once the game has exited. */
  async archiveCheck(): Promise<void> {
    const s = this.settings
    if (this.archive.busy || !s.installDir) return
    const running = await isGameRunning()
    if (running !== this.archive.gameRunning) this.setArchive({ gameRunning: running })
    const waitForExit = running && this.archive.liveRotation === 'unsupported'
    for (const path of this.archive.pendingUntilGameExits) {
      if (!running && existsSync(path)) return void (await this.archiveNow(path))
    }
    if (!s.archive.autoEnabled) return
    for (const log of await listLogs(s.installDir)) {
      if (log.size < s.archive.thresholdMB * 1048576) continue
      if (waitForExit || this.archive.pendingUntilGameExits.includes(log.path)) continue
      this.pushFeed('archive', `${log.name} is ${mb(log.size)}, over the ${s.archive.thresholdMB} MB limit.`)
      await this.archiveNow(log.path)
      return
    }
  }

  /** An archive interrupted by the app closing leaves its moved log behind; finish it. */
  private async resumeStaging(): Promise<void> {
    const dir = this.archiveDir()
    for (const staging of await findStaging(dir)) {
      const logPath = join(this.settings.installDir, 'Logs', stagingOriginalName(staging))
      this.setArchive({ busy: true, message: `Finishing an interrupted archive of ${basename(logPath)}…` })
      try {
        this.report(logPath, await finishStaged(staging, logPath, dir, this.deps()))
      } finally {
        this.setArchive({ busy: false })
      }
    }
  }

  async logsOverview() {
    const s = this.settings
    const running = await isGameRunning()
    if (running !== this.archive.gameRunning) this.setArchive({ gameRunning: running })
    return {
      logs: s.installDir ? await listLogs(s.installDir) : [],
      archives: await listArchives(this.archiveDir()),
      archiveDir: this.archiveDir(),
      status: { ...this.archive }
    }
  }

  /** The game has closed: nothing it was timing is still running. */
  gameClosed(): void {
    const n = this.board.list().length
    this.board.clear()
    this.motes.gameClosed(Date.now())
    this.setArchive({ gameRunning: false })
    this.pushFeed('info', n ? `The game closed; cleared ${n} timer${n === 1 ? '' : 's'}.` : 'The game closed.')
  }

  gameStarted(): void {
    this.setArchive({ gameRunning: true })
    this.pushFeed('info', 'The game is running.')
  }

  // ---- mote stock and the upgrade planner ----

  stockView(): MoteStock {
    return this.store.stock.get()
  }

  private saveStock(next: MoteStock): MoteStock {
    this.store.stock.set(next)
    this.out.stock(next)
    return next
  }

  private addToStock(loot: MoteLoot, time: number): void {
    const s = this.store.stock.get()
    if (this.simulating || !s.autoAdd) return
    this.stockCursor ??= new StockCursor(s.seenUntil ?? 0, s.seenAtSecond ?? 0)
    if (!this.stockCursor.accept(time)) return
    this.saveStock({
      ...s,
      counts: { ...s.counts, [loot.rank]: (s.counts[loot.rank] ?? 0) + loot.count },
      seenUntil: this.stockCursor.seenUntil,
      seenAtSecond: this.stockCursor.seenAtSecond
    })
  }

  setStockCounts(counts: MoteStock['counts']): MoteStock {
    return this.saveStock({ ...this.store.stock.get(), counts })
  }

  setStockItem(item: MoteStock['item']): MoteStock {
    return this.saveStock({ ...this.store.stock.get(), item: fixItem(item) })
  }

  setStockAutoAdd(on: boolean): MoteStock {
    // Switching it back on counts from now, not from whenever it was switched off.
    const s = this.store.stock.get()
    if (on) this.stockCursor = new StockCursor(Date.now(), 0)
    return this.saveStock({ ...s, autoAdd: on, ...(on ? { seenUntil: Date.now(), seenAtSecond: 0 } : {}) })
  }

  /** "Done": takes the planned motes off the stock and moves the item up to the level reached. */
  applyPlan(): MoteStock {
    const s = this.store.stock.get()
    const p = plan(fixItem(s.item), s.counts)
    if (!p.covered || !p.after) return s
    const counts = { ...s.counts }
    const keys = ['infinitesimal', 'minor', 'lesser', 'potential', 'major', 'greater', 'superior', 'grand', 'ascendant', 'infinite']
    keys.forEach((k, i) => (counts[k] = p.after![i]))
    const name = levelFromName(s.item.name) !== null ? s.item.name.replace(/\+\d+\s*$/, `+${p.reached}`) : s.item.name
    this.pushFeed('loot', `Upgraded ${name || 'the item'} to +${p.reached}.`)
    return this.saveStock({ ...s, counts, item: fixItem({ name, lvl: p.reached, xp: 0, to: Math.max(s.item.to, p.reached + 1) }) })
  }

  moteView(): MoteState & { scanning: string; scanProgress: number } {
    return { ...this.motes.state, scanning: this.moteScan, scanProgress: this.moteScanProgress }
  }

  /**
   * The live tailer starts at the end of the log, so anything logged while the app was closed (a run
   * entered, motes looted) is read here first, from where mote tracking last left off.
   */
  async catchUpMotes(): Promise<void> {
    const logFile = this.settings.logFile
    const motesSince = this.motes.state.seenUntil ?? 0
    const stockSince = this.store.stock.get().seenUntil ?? 0
    const since = Math.min(motesSince || Infinity, stockSince || Infinity)
    if (!logFile || this.moteBacklog || !Number.isFinite(since)) return
    this.moteBacklog = []
    let last = since
    try {
      await readLines(createReadStream(logFile), (line) => {
        if (line.time < since) return
        last = line.time
        if (line.time > motesSince) this.motes.handle(line)
        else {
          // Already tracked, but newer than the stock: count its motes into the stock only.
          const loot = parseMoteLoot(line.text)
          if (loot) this.addToStock(loot, line.time)
        }
      })
      for (const line of this.moteBacklog) if (line.time > last) this.motes.handle(line)
    } catch {
      // A missing or rotated log: nothing to catch up on.
    } finally {
      this.moteBacklog = null
      this.store.motes.set(this.motes.state)
      this.motesDirty = true
    }
  }

  /** Rebuilds mote history from this character's logs and archives, then carries on live. */
  async rebuildMoteHistory(): Promise<void> {
    const logFile = this.settings.logFile
    if (!logFile || this.moteBacklog) return
    this.moteBacklog = []
    const setScan = (m: string, fraction = 0) => {
      this.moteScan = m
      this.moteScanProgress = fraction
      this.out.motes(this.moteView())
    }
    try {
      setScan('Getting ready to read your logs…')
      // Read in a worker thread at full speed, so nothing the rebuild does can be felt in the app,
      // the overlays or the live tailer. Only progress and the finished history come back.
      const { state, lastTime } = await new Promise<{ state: ScannedMotes; lastTime: number }>((resolve, reject) => {
        const worker = new Worker(moteWorkerPath, {
          workerData: { logPath: logFile, archiveDir: this.archiveDir(), stem: basename(logFile, '.txt') }
        })
        worker.on('message', (m: { kind: 'progress'; message: string; fraction: number } | { kind: 'done'; state: ScannedMotes; lastTime: number } | { kind: 'error'; message: string }) => {
          if (m.kind === 'progress') setScan(m.message, m.fraction)
          else if (m.kind === 'done') resolve(m)
          else reject(new Error(m.message))
        })
        worker.on('error', reject)
        worker.on('exit', (code) => code !== 0 && reject(new Error(`the reader stopped (${code})`)))
      })
      const live = this.motes.state
      // A manual session is the player's own doing; keep it running over the rebuilt history.
      if (live.active?.kind === 'manual') state.active = live.active
      else if (!this.archive.gameRunning && state.active && state.active.kind !== 'manual') {
        this.motes.state = state
        this.motes.gameClosed(lastTime)
      }
      this.motes.state = state
      for (const line of this.moteBacklog) if (line.time > lastTime) this.motes.handle(line)
      const crawls = state.sessions.filter((s) => s.kind === 'crawl').length
      this.pushFeed('loot', `Mote history rebuilt from your logs: ${crawls} crawl${crawls === 1 ? '' : 's'}.`)
    } catch (e) {
      this.pushFeed('warn', `Could not read mote history: ${(e as Error).message}`)
    } finally {
      this.moteBacklog = null
      this.store.motes.set(this.motes.state)
      setScan('')
    }
  }

  shutdown(): void {
    this.archiveAbort.abort()
    this.stopWatching()
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.archiveTimer) clearInterval(this.archiveTimer)
  }

  characterKey(): string {
    return characterKey(this.settings.logFile)
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`
}
