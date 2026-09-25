import { createReadStream, existsSync, promises as fs, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { parseLogLine, type LogLine } from '../core/logLine'
import { LogTailer } from '../core/tailer'
import { SpellBook, summarize, type Spell } from '../core/spells'
import { casterLevel, computeDuration } from '../core/durations'
import { focusFor } from '../core/focus'
import { TimerBoard } from '../core/timers'
import { SpellTracker } from '../core/spellTracker'
import { TriggerEngine } from '../core/triggers'
import type { ArchiveOutcome } from '../core/archiver'
import { checkAgainstLog } from '../core/logCheck'
import { MoteTracker, moteName, parseMoteLoot, type MoteState } from '../core/motes'
import { CombatMeter, summarize as summarizeFight } from '../core/combatMeter'
import { LootLedger, type LootSnapshot } from '../core/loot'
import { RespawnLog, respawnView, type RespawnRecords, type RespawnView } from '../core/respawns'
import { PetGearReader, petSummonName, type PetGearReading } from '../core/pets'
import { askText, BuffWatch, buffNeeds, buffOffers, defaultWanted, type ActiveBuff, type BuffOffer, type BuffsFile, type BuffView, type Person } from '../core/buffs'
import { CATEGORY_COLORS } from '../core/spellTracker'
import { durationSec, fmtClock, fmtNum } from '../core/combatView'
import { characterKey, characterName } from './storeCore'
import { isGameFolder, lastZone, listLogs } from './game'
import { ArchiveManager } from './archiveManager'
import { MoteStockKeeper, type Cell } from './moteStock'
import { offsetBefore, readLines } from './logReading'
import type { MoteScanJob, MoteScanResult } from './moteHistory'
import { combineScans, mergeRebuilt, samePath } from './moteMerge'
import { log } from './log'
import type { SpeechWorker } from './speech'
import type {
  AppSettings, ArchiveStatus, CharacterSettings, CombatSnapshot, FeedItem, KnownSpell, LogCheckRow, MoteStock, Notification, Segment, SpellRule, TimerView, Trigger, WatchStatus
} from '../shared/types'

export interface EngineOutputs {
  timers: (views: TimerView[]) => void
  alert: (payload: { text: string; color: string; durationSec: number }) => void
  audio: (payload: AudioCommand) => void
  status: (status: WatchStatus) => void
  feed: (item: FeedItem) => void
  archive: (status: ArchiveStatus) => void
  motes: (state: MoteView) => void
  /** Progress of a mote history rebuild alone, without the history itself. */
  moteScan: (scan: { scanning: string; scanProgress: number }) => void
  stock: (stock: MoteStock) => void
  combat: (snapshot: CombatSnapshot) => void
  loot: (snapshot: LootView) => void
  respawns: (view: RespawnView) => void
  /** A `/pet inventory check` list, or a pet summoned, as the log reports it. */
  pet: (update: { gear?: PetGearReading; summon?: { spell: string; at: number } }) => void
  buffs: (view: BuffView) => void
}

/** The loot ledger with the meter's sessions, which its entries are filed under. */
export type LootView = LootSnapshot & { sessions: import('../shared/types').SegmentSummary[] }

export type MoteView = MoteState & { scanning: string; scanProgress: number }

export type AudioCommand =
  | { kind: 'speech'; wav: Uint8Array; interrupt: boolean }
  | { kind: 'speech-fallback'; text: string; interrupt: boolean }
  | { kind: 'sound'; data: Uint8Array; volume: number; name: string }

/** Reads mote history somewhere (a worker thread in the app); `stop` abandons it. */
export type MoteScanner = (
  job: MoteScanJob,
  progress: (message: string, fraction: number) => void
) => { done: Promise<MoteScanResult>; stop: () => void }

/** What the engine needs from the running app, passed in so the engine runs anywhere, tests included. */
export interface EngineEnv {
  /** The mote history worker's script (electron-vite's `./moteWorker?modulePath`). */
  moteWorkerPath: string
  isGameRunning: () => Promise<boolean>
  findInstall: () => Promise<string>
  soundDirs: () => string[]
  /** Where the engine keeps its own files: catchup.json. */
  dataDir: string
  /** Reads mote history in place of the worker thread; for tests. */
  scanMotes?: MoteScanner
}

/** The parts of the settings store the engine uses. */
export interface EngineStore {
  settings: Cell<AppSettings>
  triggers: { get(): Trigger[] }
  rules: { get(): Record<string, SpellRule> }
  casts: Cell<Record<string, { rankedName: string; lastCast: number; count: number }>>
  motes: Cell<MoteState>
  stock: Cell<MoteStock>
  respawns: Cell<RespawnRecords>
  buffs: Cell<BuffsFile>
  readonly motesFresh: boolean
  characterOf(logFile: string): CharacterSettings
}

export type Speaker = Pick<SpeechWorker, 'synthesize'>

/**
 * catchup.json: how far into which log mote tracking had read when the app last closed. Every line
 * before `offset` was handled. It holds only while motes.json says the same `seenUntil`; otherwise
 * catching up goes by the lines' times instead.
 */
interface CatchUpMark {
  logFile: string
  /** The file's identity (volume and file index), so an archived-and-replaced log is not mistaken for it. */
  id: string
  offset: number
  seenUntil: number
}

interface Tail {
  tailer: LogTailer
  logFile: string
  /** The size when the tailer attached: it reads on from there. -1 until its first look. */
  start: number
  /** Just past the last line it gave. -1 until it has given one. */
  end: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Warned this long before someone else's buff on you is due to fade: time to ask for it again. */
const BUFF_WARN_SEC = 60
/** An unchanged "ask for" is said again after this long, while it still holds. */
const BUFF_REMIND_MS = 10 * 60_000

export class Engine {
  book: SpellBook | null = null
  readonly board: TimerBoard
  private tracker: SpellTracker | null = null
  readonly triggers: TriggerEngine
  private tail: Tail | null = null
  /** Bumped by every start and stop, so a start overtaken while it waited gives up. */
  private watchGen = 0
  private starting = false
  /** The log last watched, to tell a switch of character from a restart of the same log. */
  private watchedLog = ''
  private missing = false
  private tickTimer: NodeJS.Timeout | null = null
  private archiveTimer: NodeJS.Timeout | null = null
  private timersDirty = false
  private statusDirty = false
  private statusSentAt = 0
  private readonly feedItems: FeedItem[] = []
  readonly status: WatchStatus = {
    watching: false, logFile: '', character: '', zone: '', spellsLoaded: 0, spellError: '', lastLineAt: 0, logSize: 0
  }
  readonly archives: ArchiveManager
  readonly stock: MoteStockKeeper
  readonly motes: MoteTracker
  private motesDirty = false
  private motesSentAt = 0
  /** While history is being read, live lines wait here so none are lost or counted twice. */
  private moteBacklog: LogLine[] | null = null
  /** Where in `backlogLog` the waiting lines begin: history reads up to there. -1 until known. */
  private backlogFrom = -1
  private backlogLog = ''
  /** Every line of `logFile` before `offset` has been through mote tracking. */
  private linePos: { logFile: string; offset: number } | null = null
  private scan: { stop: () => void } | null = null
  moteScan = ''
  moteScanProgress = 0
  /** Pasted test lines must not add to the real mote history or stock. */
  private simulating = false
  private speechFailed = false
  /** The damage meter. */
  readonly meter: CombatMeter
  private combatDirty = false
  private combatSentAt = 0
  /** While recent fights are being read from the log, live lines wait here so the meter sees them in order. */
  private combatBacklog: LogLine[] | null = null
  readonly loot: LootLedger
  private lootDirty = false
  private lootSentAt = 0
  /** How long mobs take to respawn, from kills and sightings. */
  readonly respawns: RespawnLog
  private respawnsDirty = false
  private respawnsSentAt = 0
  private readonly petReader: PetGearReader
  /** Buffs on the character from others, who is who, and what to ask the group for. */
  private readonly buffWatch: BuffWatch
  private buffOfferList: BuffOffer[] = []
  private buffsDirty = false
  private buffsSentAt = 0
  /** The last "ask for" told, and when, so it is not said again every few seconds. */
  private lastAsk = { text: '', at: 0 }
  /** Groupmates the player has been told to /who, once each. */
  private readonly whoHinted = new Set<string>()

  constructor(
    private readonly store: EngineStore,
    private readonly speech: Speaker,
    private readonly out: EngineOutputs,
    private readonly env: EngineEnv
  ) {
    this.board = new TimerBoard({
      onChange: () => (this.timersDirty = true),
      onNotify: (ns) => this.notify(ns)
    })
    this.triggers = new TriggerEngine(this.board, {
      notify: (ns) => this.notify(ns),
      feed: (kind, text) => this.pushFeed(kind, text)
    })
    this.archives = new ArchiveManager({
      settings: () => this.settings,
      isGameRunning: env.isGameRunning,
      onStatus: (a) => out.archive(a),
      feed: (kind, text) => this.pushFeed(kind, text)
    })
    this.stock = new MoteStockKeeper(store.stock, (s) => out.stock(s), (kind, text) => this.pushFeed(kind, text))
    this.loot = new LootLedger({
      onChange: () => (this.lootDirty = true),
      onLoot: (e) => {
        // What was kept or merged is news; what auto-loot sold or stored is not, and history is not.
        if (this.combatBacklog || (e.outcome !== 'kept' && e.outcome !== 'merged')) return
        const who = e.looter === 'You' ? 'Looted' : `${e.looter} looted`
        this.pushFeed('loot', `${who} ${e.count > 1 ? `${e.count} × ` : ''}${e.item} from ${e.source}${e.into ? ` → ${e.into}` : ''}`)
      }
    })
    this.meter = new CombatMeter(this.meterConfig(), {
      onChange: () => (this.combatDirty = true),
      onFightEnd: (f) => {
        // Fights read from history are not news.
        if (this.combatBacklog || !f.mine) return
        const sum = summarizeFight(f)
        this.pushFeed('fight', `${sum.name} · ${fmtClock(durationSec(f))} · ${fmtNum(sum.dps)} DPS (yours ${fmtNum(sum.yours / durationSec(f))})`)
      }
    })
    this.petReader = new PetGearReader((gear) => out.pet({ gear }))
    this.buffWatch = new BuffWatch([], {
      seconds: (spell, rank, caster) => this.buffSeconds(spell, rank, caster),
      onChange: () => this.buffsChanged(),
      onLand: (b) => this.buffLanded(b),
      onFade: (b) => this.board.end(`buff:${b.spell}`, 'faded'),
      onWho: (p) => this.learnPerson(p)
    })
    this.respawns = new RespawnLog(store.respawns.get(), {
      onChange: () => {
        this.store.respawns.set(this.respawns.records)
        this.respawnsDirty = true
      },
      kindOf: (name) => this.meter.kindOf(name).kind
    })
    this.motes = new MoteTracker(store.motes.get(), {
      onChange: () => {
        this.store.motes.set(this.motes.state)
        this.motesDirty = true
      },
      onLoot: (loot, session, time) => {
        if (!this.simulating) this.stock.add(loot, time)
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

  get archive(): ArchiveStatus {
    return this.archives.status
  }

  private get markFile(): string {
    return join(this.env.dataDir, 'catchup.json')
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
    this.archiveTimer = setInterval(() => void this.archiveCheck(), 30_000)
    this.archives.resumeStaging().catch((e: unknown) => log.error('Finishing interrupted archives failed:', e))
    // Reading history starts the backlog before the tailer can give a line, so nothing slips between.
    const history = this.store.motesFresh ? this.rebuildMoteHistory() : this.catchUpMotes()
    history.catch((e: unknown) => log.error('Reading mote history at startup failed:', e))
    if (this.settings.autoStart && this.settings.logFile) await this.startWatching()
    this.emitStatus()
  }

  async loadSpells(): Promise<void> {
    try {
      this.book = await SpellBook.load(this.settings.installDir)
      this.status.spellsLoaded = this.book.size
      this.buffOfferList = buffOffers(this.book, this.settings.tracking.tierDurationPct)
      this.buffWatch.setBook(this.book, this.buffOfferList)
      this.buffsDirty = true
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

  private meterConfig() {
    const c = this.settings.combat
    return { fightGapSec: c.fightGapSec, newSessionOnZone: c.newSessionOnZone }
  }

  reconfigure(): void {
    this.tracker?.configure(this.trackerConfig())
    this.meter.configure(this.meterConfig())
    this.triggers.load(this.store.triggers.get(), characterName(this.settings.logFile))
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
      this.board.clear()
      this.meter.reset()
      this.loot.reset()
      if (n) this.pushFeed('info', `Switched to ${basename(logFile)}; cleared ${n} timer${n === 1 ? '' : 's'}.`)
    }
    this.watchedLog = logFile
    // Each character's own buffs: the ones the last run saw on them, still running.
    this.buffWatch.active = this.store.buffs.get().active[characterKey(logFile)] ?? []
    this.buffWatch.prune(Date.now())
    this.buffsDirty = true
    this.status.logFile = logFile
    this.status.character = characterName(logFile)
    this.meter.setSelf(this.status.character)
    this.triggers.load(this.store.triggers.get(), this.status.character)
    this.status.zone = zone
    this.tracker?.setZone(zone)
    this.missing = false
    const tail: Tail = {
      logFile,
      start: -1,
      end: -1,
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

  /**
   * Recent fights: the live tailer starts at the end of the log, so the last `minutes` of it are
   * read here first, with live lines held back until the read is done, so the meter sees everything
   * in its order. The meter's clock is held too, or an old fight would be cut off mid-read.
   */
  async seedCombat(minutes = this.settings.combat.historyMinutes): Promise<void> {
    const t = this.tail
    if (!t || minutes <= 0 || this.combatBacklog) return
    const gen = this.watchGen
    const logFile = t.logFile
    this.combatBacklog = []
    this.meter.reading = `Reading the last ${minutes} minutes of the log…`
    this.loot.reading = this.meter.reading
    this.combatDirty = true
    this.lootDirty = true
    try {
      // The tailer reads on from where it attached; history is everything before that.
      for (let i = 0; i < 200 && t.start < 0 && gen === this.watchGen; i++) await sleep(25)
      const end = t.start
      if (end > 0 && gen === this.watchGen) {
        const from = await offsetBefore(logFile, Date.now() - minutes * 60_000)
        if (end > from && gen === this.watchGen) {
          await readLines(createReadStream(logFile, { start: from, end: end - 1 }), (line) => gen === this.watchGen && this.combatLine(line), { flushLast: false })
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Reading recent fights from ${logFile} failed:`, e)
    } finally {
      const waiting = this.combatBacklog
      this.combatBacklog = null
      for (const line of waiting ?? []) this.combatLine(line)
      this.meter.reading = ''
      this.loot.reading = ''
      this.combatDirty = true
      this.lootDirty = true
    }
  }

  /**
   * A line through the damage meter, then the loot ledger, which files loot under the meter's
   * session, and the respawn log, which goes by the meter's idea of who is a mob.
   */
  private combatLine(line: LogLine): void {
    const ev = this.meter.handle(line)
    this.buffWatch.handle(line.text, line.time, (name) => this.book?.resolve(name))
    this.respawns.handle(line, this.meter.currentZone || this.status.zone, ev)
    const c = line.text.charCodeAt(0)
    if (c === 89 || c === 45) this.loot.handle(line, this.meter.currentZone, this.meter.sessionAt(line.time).id)
  }

  // ---- buffs ----

  private get wantedBuffs(): string[] {
    return this.store.buffs.get().wanted[this.characterKey()] ?? defaultWanted(this.buffOfferList)
  }

  /** The group as /who last described each member. */
  private groupPeople(): { name: string; person: Person | null }[] {
    const people = this.store.buffs.get().people
    return this.meter.groupMembers.map((name) => ({ name, person: people[name.toLowerCase()] ?? null }))
  }

  buffView(): BuffView {
    const group = this.groupPeople()
    const active = this.buffWatch.active
    const wanted = this.wantedBuffs
    return {
      offers: this.buffOfferList,
      wanted,
      defaults: !this.store.buffs.get().wanted[this.characterKey()],
      group,
      active,
      needs: buffNeeds({ offers: this.buffOfferList, wanted, group: group.flatMap((g) => (g.person ? [g.person] : [])), active }),
      spellsLoaded: !!this.book
    }
  }

  /** The buffs the character wants; null goes back to the defaults. */
  setWantedBuffs(list: string[] | null): BuffView {
    const f = this.store.buffs.get()
    const key = this.characterKey()
    const wanted = { ...f.wanted }
    if (list) wanted[key] = [...new Set(list)].sort()
    else delete wanted[key]
    this.store.buffs.set({ ...f, wanted })
    this.lastAsk = { text: '', at: 0 }
    this.buffsDirty = true
    return this.buffView()
  }

  /** How long a buff lasts from this caster: yours with your focus, anyone else's at their /who level, unfocused. */
  private buffSeconds(spell: Spell, rank: number, caster: string): number | null {
    if (caster === 'You') {
      const d = this.durationFor(spell, rank)
      return d.permanent ? null : d.seconds
    }
    const level = this.store.buffs.get().people[caster.toLowerCase()]?.level ?? 50
    const d = computeDuration({ spell, rank, level, tierPct: this.settings.tracking.tierDurationPct, focusPct: 0 })
    return d.permanent ? null : d.seconds
  }

  private buffsChanged(): void {
    const f = this.store.buffs.get()
    const key = this.characterKey()
    if (key) this.store.buffs.set({ ...f, active: { ...f.active, [key]: this.buffWatch.active } })
    this.buffsDirty = true
  }

  private learnPerson(p: Person): void {
    const f = this.store.buffs.get()
    const k = p.name.toLowerCase()
    if (f.people[k] && f.people[k].at >= p.at) return
    this.store.buffs.set({ ...f, people: { ...f.people, [k]: p } })
    this.buffsDirty = true
  }

  /** Someone else's buff on you: a timer on the buffs overlay, with a word before it fades. */
  private buffLanded(b: ActiveBuff): void {
    if (b.caster === 'You' || b.endsAt === null) return
    const inGroup = this.meter.groupMembers.some((n) => n.toLowerCase() === b.caster.toLowerCase())
    this.board.upsert({
      key: `buff:${b.spell}`,
      id: this.board.get(`buff:${b.spell}`)?.id ?? this.board.nextId(),
      spell: b.spell,
      label: b.ranked,
      target: 'You',
      source: 'spell',
      category: 'buff',
      icon: this.book?.named(b.ranked)?.icon,
      color: CATEGORY_COLORS.buff,
      overlay: 'buffs',
      startedAt: b.landedAt,
      endsAt: b.endsAt,
      exact: false,
      warnSec: BUFF_WARN_SEC,
      onWarn: this.combatBacklog ? [] : [{ kind: 'speak', text: `${b.spell} is fading${inGroup ? `, ask ${b.caster}` : ''}`, interrupt: false }],
      onExpire: [],
      warned: false,
      graceMs: 12_000
    })
  }

  /** Says what to ask the group for, when it changes and again every so often, but never mid-fight. */
  private remindBuffs(now: number): void {
    if (this.combatBacklog || this.simulating || !this.status.watching) return
    const group = this.groupPeople()
    for (const g of group) {
      if (g.person || this.whoHinted.has(g.name.toLowerCase())) continue
      this.whoHinted.add(g.name.toLowerCase())
      this.pushFeed('info', `Type /who ${g.name} so the buff tracker knows the classes ${g.name} plays.`)
    }
    const needs = this.buffView().needs
    const text = needs.length ? askText(needs) : ''
    if (!text) {
      this.lastAsk = { text: '', at: 0 }
      return
    }
    if (this.meter.fighting) return
    if (text === this.lastAsk.text && now - this.lastAsk.at < BUFF_REMIND_MS) return
    this.lastAsk = { text, at: now }
    this.pushFeed('info', `Buffs: ${text}.`)
    this.notify([
      { kind: 'speak', text, interrupt: false },
      { kind: 'text', text, color: CATEGORY_COLORS.buff, durationSec: 6 }
    ])
  }

  respawnView(): RespawnView {
    return respawnView(this.respawns.records, this.store.triggers.get(), this.status.zone)
  }

  /** The page shows which mobs have timers, so it hears when the triggers change. */
  triggersChanged(): void {
    this.respawnsDirty = true
  }

  lootView(): LootView {
    return { ...this.loot.snapshot(), sessions: [...this.meter.sessions].reverse().map(summarizeFight) }
  }

  /** Forgets every fight and reads the last `minutes` of the log again. */
  async rebuildCombat(minutes: number): Promise<void> {
    if (this.combatBacklog) return
    this.meter.reset()
    this.loot.reset()
    await this.seedCombat(minutes)
  }

  combatSnapshot(): CombatSnapshot {
    return this.meter.snapshot()
  }

  combatSegment(id: string): Segment | null {
    return this.meter.segment(id)
  }

  newCombatSession(): CombatSnapshot {
    this.meter.newSession(Date.now())
    this.pushFeed('fight', 'New session started.')
    return this.meter.snapshot()
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
      if (this.moteBacklog && this.backlogFrom < 0) {
        this.backlogFrom = size
        this.backlogLog = t.logFile
      }
    }
    if (this.missing) {
      this.missing = false
      this.status.watching = true
      this.pushFeed('info', `${basename(t.logFile)} is back; watching it again.`)
      this.statusDirty = true
    }
    if (size !== this.status.logSize) this.statusDirty = true
    this.status.logSize = size
  }

  private onTailReset(t: Tail, reason: 'truncated' | 'replaced'): void {
    t.end = 0
    if (this.moteBacklog && samePath(this.backlogLog, t.logFile)) {
      // Where history reading was to stop is in the old file; the waiting lines are the new one's.
      log.warn(`The log was ${reason} while mote history was being read; lines around the switch may be counted twice.`)
      this.backlogFrom = -1
      this.backlogLog = ''
    }
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
    for (const raw of lines) {
      const line = parseLogLine(raw)
      if (!line) continue
      this.tracker?.handle(line)
      this.triggers.handle(line)
      this.petLine(line)
      if (this.moteBacklog) this.moteBacklog.push(line)
      else this.motes.handle(line)
      if (this.combatBacklog) this.combatBacklog.push(line)
      else this.combatLine(line)
      this.status.lastLineAt = line.time
      this.statusDirty = true
    }
    if (!this.moteBacklog) this.linePos = { logFile: t.logFile, offset: end }
  }

  /** What the pet wears and which pet it is, as the log tells it. */
  private petLine(line: LogLine): void {
    this.petReader.handle(line.text, line.time)
    if (this.book && line.text.startsWith('You begin casting ')) {
      const spell = petSummonName(this.book, line.text.slice(18, -1))
      if (spell) this.out.pet({ summon: { spell, at: line.time } })
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
      // Mote history is a record of real play: a pasted loot line must not count towards it.
    }
  }

  private tick(): void {
    const now = Date.now()
    this.board.tick(now)
    this.petReader.tick(now)
    this.motes.tick(now)
    if (!this.combatBacklog) this.meter.tick(now)
    if (this.combatDirty && now - this.combatSentAt > 500) {
      this.combatDirty = false
      this.combatSentAt = now
      this.out.combat(this.meter.snapshot())
    }
    if (this.lootDirty && now - this.lootSentAt > 500) {
      this.lootDirty = false
      this.lootSentAt = now
      this.out.loot(this.lootView())
    }
    if (now - this.buffsSentAt > 5000 || (this.buffsDirty && now - this.buffsSentAt > 1000)) {
      this.buffsSentAt = now
      this.buffWatch.prune(now)
      this.remindBuffs(now)
      if (this.buffsDirty) {
        this.buffsDirty = false
        this.out.buffs(this.buffView())
      }
    }
    if (this.respawnsDirty && now - this.respawnsSentAt > 1000) {
      this.respawnsDirty = false
      this.respawnsSentAt = now
      this.out.respawns(this.respawnView())
    }
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
    } catch (e) {
      // The audio window speaks it itself instead. Said once, not for every line spoken.
      if (!this.speechFailed) log.warn('Speech synthesis failed; falling back to the audio window’s own voice:', e)
      this.speechFailed = true
      this.out.audio({ kind: 'speech-fallback', text, interrupt })
    }
  }

  async playSound(file: string, volume: number): Promise<void> {
    const path = this.resolveSound(file)
    if (!path) {
      this.pushFeed('warn', `Sound not found: ${file}`)
      return
    }
    try {
      const data = await fs.readFile(path)
      this.out.audio({ kind: 'sound', data: new Uint8Array(data), volume, name: basename(path) })
    } catch (e) {
      this.pushFeed('warn', `Could not play ${basename(path)}: ${(e as Error).message}`)
    }
  }

  resolveSound(file: string): string | null {
    if (isAbsolute(file)) return existsSync(file) ? file : null
    for (const dir of this.env.soundDirs()) {
      const p = join(dir, file)
      if (existsSync(p)) return p
    }
    return null
  }

  async listSounds(): Promise<string[]> {
    const names = new Set<string>()
    for (const dir of this.env.soundDirs()) {
      try {
        for (const f of await fs.readdir(dir)) if (/\.(wav|mp3|ogg)$/i.test(f)) names.add(f)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Could not list sounds in ${dir}:`, e)
      }
    }
    return [...names].sort()
  }

  pushFeed(kind: FeedItem['kind'], text: string): void {
    if (kind === 'warn') log.warn(text)
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

  // ---- mote stock and the upgrade planner (MoteStockKeeper) ----

  stockView(): MoteStock {
    return this.stock.view()
  }

  setStockCounts(counts: MoteStock['counts']): MoteStock {
    return this.stock.setCounts(counts)
  }

  setStockItem(item: MoteStock['item']): MoteStock {
    return this.stock.setItem(item)
  }

  setStockAutoAdd(on: boolean): MoteStock {
    return this.stock.setAutoAdd(on)
  }

  applyPlan(): MoteStock {
    return this.stock.applyPlan()
  }

  // ---- mote history ----

  moteView(): MoteView {
    return { ...this.motes.state, scanning: this.moteScan, scanProgress: this.moteScanProgress }
  }

  private tailPos(): number {
    const t = this.tail
    return !t ? -1 : t.end >= 0 ? t.end : t.start
  }

  /** From here live lines wait, and the tailer's position says where reading history must stop. */
  private beginBacklog(): void {
    this.moteBacklog = []
    this.backlogFrom = this.tailPos()
    this.backlogLog = this.backlogFrom >= 0 ? this.tail!.logFile : ''
  }

  /** Where the waiting lines begin in `logFile`, waiting a moment for a tailer that is just starting; -1 if not known. */
  private async backlogMark(logFile: string): Promise<number> {
    for (let i = 0; i < 200 && this.backlogFrom < 0 && (this.starting || (this.tail && this.tail.start < 0)); i++) await sleep(25)
    return this.backlogFrom >= 0 && samePath(this.backlogLog, logFile) ? this.backlogFrom : -1
  }

  /** History is read: the lines that waited are handled now, in order. */
  private endBacklog(logFile: string, reached: number): void {
    const waiting = this.moteBacklog ?? []
    this.moteBacklog = null
    this.backlogFrom = -1
    this.backlogLog = ''
    for (const line of waiting) this.motes.handle(line)
    const pos = this.tailPos()
    if (this.tail && pos >= 0) this.linePos = { logFile: this.tail.logFile, offset: pos }
    else if (reached > 0) this.linePos = { logFile, offset: reached }
    this.store.motes.set(this.motes.state)
    this.motesDirty = true
  }

  private readMark(): CatchUpMark | null {
    try {
      const m = JSON.parse(readFileSync(this.markFile, 'utf8')) as CatchUpMark
      return typeof m.logFile === 'string' && typeof m.offset === 'number' && typeof m.seenUntil === 'number' && typeof m.id === 'string' ? m : null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`Ignoring ${this.markFile}:`, e)
      return null
    }
  }

  /** Written on the way out, alongside motes.json: how far mote tracking read. */
  private saveMark(): void {
    const p = this.linePos
    // Mid-read, what is on disk is not caught up; the next start goes by times instead.
    if (!p || this.moteBacklog) return
    try {
      const st = statSync(p.logFile, { bigint: true })
      const mark: CatchUpMark = { logFile: p.logFile, id: `${st.dev}:${st.ino}`, offset: p.offset, seenUntil: this.motes.state.seenUntil ?? 0 }
      writeFileSync(this.markFile + '.tmp', JSON.stringify(mark), 'utf8')
      renameSync(this.markFile + '.tmp', this.markFile)
    } catch (e) {
      log.warn('Could not save where mote tracking got to:', e)
    }
  }

  /**
   * The live tailer starts at the end of the log, so anything logged while the app was closed (a run
   * entered, motes looted) is read here first, from where mote tracking last left off: the offset in
   * catchup.json when it still matches, else the first line older than the last one tracked.
   */
  async catchUpMotes(): Promise<void> {
    const logFile = this.settings.logFile
    const motesSince = this.motes.state.seenUntil ?? 0
    const stockSince = this.stock.view().seenUntil ?? 0
    const since = motesSince || stockSince
    if (!logFile || this.moteBacklog || !since) return
    this.beginBacklog()
    let reached = 0
    try {
      const mark = this.readMark()
      // Used once: a crash before the next clean exit must not replay from it again.
      try {
        rmSync(this.markFile, { force: true })
      } catch (e) {
        log.warn(`Could not remove ${this.markFile}:`, e)
      }
      const st = await fs.stat(logFile, { bigint: true })
      const exact = !!mark && samePath(mark.logFile, logFile) && mark.id === `${st.dev}:${st.ino}` && mark.seenUntil === motesSince && mark.offset <= Number(st.size)
      const from = exact ? mark!.offset : await offsetBefore(logFile, since)
      if (exact) this.stock.resume()
      const onLine = (line: LogLine) => {
        if (exact || line.time > motesSince) this.motes.handle(line)
        else if (line.time >= stockSince) {
          // Already tracked, but newer than the stock: count its motes into the stock only.
          const loot = parseMoteLoot(line.text)
          if (loot) this.stock.add(loot, line.time)
        }
      }
      const until = await this.backlogMark(logFile)
      const end = until >= 0 ? until : Number(st.size)
      reached = from
      if (end > from) reached += await readLines(createReadStream(logFile, { start: from, end: end - 1 }), onLine, { flushLast: false })
      // The tailer attached while this read: read on to where it took over.
      const later = until < 0 && samePath(this.backlogLog, logFile) ? this.backlogFrom : -1
      if (later > reached) reached += await readLines(createReadStream(logFile, { start: reached, end: later - 1 }), onLine, { flushLast: false })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') log.info(`No log to catch up on at ${logFile}.`)
      else log.warn(`Catching up on motes from ${logFile} failed:`, e)
    } finally {
      this.endBacklog(logFile, reached)
    }
  }

  /**
   * Rebuilds mote history from every character's log in the Logs folder and their archives, merges
   * it into the history kept, then carries on live. Only progress goes out while it reads.
   */
  async rebuildMoteHistory(): Promise<void> {
    if (this.scan || this.moteBacklog) {
      this.pushFeed('info', 'Already reading your logs.')
      return
    }
    const watched = this.settings.logFile
    const installDir = this.settings.installDir
    this.beginBacklog()
    const setScan = (m: string, fraction = 0) => {
      this.moteScan = m
      this.moteScanProgress = fraction
      this.out.moteScan({ scanning: m, scanProgress: fraction })
    }
    let reached = 0
    try {
      setScan('Getting ready to read your logs…')
      const paths = installDir ? (await listLogs(installDir)).map((l) => l.path) : []
      if (watched && !paths.some((p) => samePath(p, watched)) && existsSync(watched)) paths.push(watched)
      if (!paths.length) {
        this.pushFeed('info', 'No character logs to read mote history from.')
        return
      }
      const until = watched ? await this.backlogMark(watched) : -1
      const job: MoteScanJob = {
        archiveDir: this.archiveDir(),
        logs: paths.map((p) => ({ logPath: p, stem: basename(p, '.txt'), ...(until >= 0 && samePath(p, watched) ? { end: until } : {}) }))
      }
      const run = (this.env.scanMotes ?? workerScanner(this.env.moteWorkerPath))(job, (m, f) => setScan(m, f))
      this.scan = run
      const scanned = await run.done
      const merged = mergeRebuilt(this.motes.state, combineScans(scanned, watched, this.archive.gameRunning))
      const w = scanned.characters.find((c) => samePath(c.logPath, watched))
      if (merged.seenUntil === undefined && w?.lastTime) merged.seenUntil = w.lastTime
      this.motes.state = merged
      reached = w?.end ?? 0
      // The tailer attached while the logs were read: read on to where it took over.
      const later = w && until < 0 && samePath(this.backlogLog, watched) ? this.backlogFrom : -1
      if (later > reached) reached += await readLines(createReadStream(watched, { start: reached, end: later - 1 }), (l) => this.motes.handle(l), { flushLast: false })
      const crawls = merged.sessions.filter((s) => s.kind === 'crawl').length
      const n = scanned.characters.length
      this.pushFeed('loot', `Mote history rebuilt from ${n} character log${n === 1 ? '' : 's'}: ${crawls} crawl${crawls === 1 ? '' : 's'}.`)
    } catch (e) {
      log.error('Rebuilding mote history failed:', e)
      this.pushFeed('warn', `Could not read mote history: ${(e as Error).message}`)
    } finally {
      this.scan = null
      this.endBacklog(watched, reached)
      setScan('')
      this.out.motes(this.moteView())
    }
  }

  shutdown(): void {
    this.archives.shutdown()
    this.scan?.stop()
    this.stopWatching()
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.archiveTimer) clearInterval(this.archiveTimer)
    this.saveMark()
  }

  characterKey(): string {
    return characterKey(this.settings.logFile)
  }
}

/** Reads mote history on a worker thread, so nothing it does can be felt in the app, the overlays or the live tailer. */
export function workerScanner(path: string): MoteScanner {
  return (job, progress) => {
    const worker = new Worker(path, { workerData: job })
    let stopped = false
    const done = new Promise<MoteScanResult>((resolve, reject) => {
      worker.on('message', (m: { kind: 'progress'; message: string; fraction: number } | { kind: 'done'; result: MoteScanResult } | { kind: 'error'; message: string }) => {
        if (m.kind === 'progress') progress(m.message, m.fraction)
        else if (m.kind === 'done') resolve(m.result)
        else reject(new Error(m.message))
      })
      worker.on('error', reject)
      worker.on('exit', (code) => code !== 0 && reject(new Error(stopped ? 'stopped' : `the reader stopped (${code})`)))
    })
    return {
      done,
      stop: () => {
        stopped = true
        worker.terminate().catch((e: unknown) => log.warn('Stopping the mote history reader failed:', e))
      }
    }
  }
}
