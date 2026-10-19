import { join } from 'node:path'
import { SELF } from '../../core/combatLines'
import { isFriend } from '../../core/combatMeter'
import { zoneEntered } from '../../core/logLine'
import { NO_RACE_TABLE, RACE_TABLE, type RaceTable } from '../../core/raceNames'
import { learnFromExport, SlayerRaces, slayerCounters, slayerCounts, slayerLine, type RaceMix, type SlayerCounter, type SlayerKills } from '../../core/slayer'
import type { SlayerTrackView } from '../../shared/tracking'
import type { AppContext } from '../../main/context'
import { lastZoneLine } from '../../main/game'
import { log } from '../../main/log'
import { cacheDir } from '../../main/paths'
import { readForward } from '../../main/sources/logHistory'
import { sinceStart, type SincePosition } from '../../main/sources/sinceExport'
import { JsonFile, readJsonFile } from '../../main/storeCore'

// The Slayer counts since the character's achievements export, as the game is played: the kills the
// log shows after the export (this PC's log and the character's log on other PCs), each placed by its
// race, counted toward the achievements that list it; kept across a start (slayer-since.json, so the
// log is read on from where it got to, LT-371) and taught by each new export (slayer-facts.json: what
// the numbers forced about which mobs count). Owned by the Slayer feature (LT-623); LiveAchievements
// says when to read, and publishes what this holds.

/** Slayer counting for the character being played, since its achievements export. */
interface SlayerState {
  character: string
  exportFile: string
  exportAt: number
  counters: SlayerCounter[]
  /** Each open achievement's count at the export, by lower-cased name: what the next export's are set against. */
  counts: Map<string, number>
  /** The client's race table the races were built with: a new one (a patch) builds them again. */
  game: RaceTable
  races: SlayerRaces
  logPath: string
  /** How far into the log the kills have been counted; -1 before the first read. */
  readTo: number
  /** The log file's identity where the counts got to, so a log replaced at the path is read afresh (LT-625); '' while unknown. */
  logId?: string
  /** The same for the character's log on each other PC, by lower-cased path. */
  others: Map<string, number>
  otherIds?: Map<string, string>
  /** The zone each log was in where its counts got to, by lower-cased path: each kill is put to its zone. */
  zoneIn: Map<string, string>
  kills: SlayerKills
  /** The player's pets, as they said so ("Attacking a gnoll, Master."). */
  pets: Set<string>
  /** Mobs the player or its pet went for lately (lower-cased), and when: one of those dying with no killer named is the player's kill. */
  engaged: Map<string, number>
  /** Achievements the game said were completed since the export (lower-cased), and when. */
  completed: Map<string, number>
}

/** A SlayerState's counts as kept on disk, so a start reads on from where the last run got to (LT-371). */
interface KeptSlayer {
  character: string
  logPath: string
  exportAt: number
  readTo: number
  /** Each kill's zone beside its time; an older file kept the times alone. */
  kills: [string, { name: string; times: number[]; zones?: string[] }][]
  pets: string[]
  /** With when each was; an older file kept the names alone. */
  completed: ([string, number] | string)[]
  /** The export's counts, by lower-cased name; missing from an older file. */
  counts?: [string, number][]
  /** How far into the character's log on each other PC, by lower-cased path; missing from an older file. */
  others?: [string, number][]
  /** The identity of the log at each path where the counts got to (this PC's under its own path); missing from an older file. */
  logIds?: [string, string][]
  /** The zone each log was in where the counts got to, by lower-cased path; missing from an older file. */
  zoneIn?: [string, string][]
}

function keptSlayer(v: unknown): KeptSlayer | null {
  const k = v as Partial<KeptSlayer> | null
  if (!k || typeof k.character !== 'string' || typeof k.logPath !== 'string' || typeof k.exportAt !== 'number' || typeof k.readTo !== 'number') return null
  if (!Array.isArray(k.kills) || !Array.isArray(k.pets) || !Array.isArray(k.completed)) return null
  const kills = k.kills
    .filter(
      (e): e is KeptSlayer['kills'][number] =>
        Array.isArray(e) && typeof e[0] === 'string' && typeof e[1]?.name === 'string' && Array.isArray(e[1].times) && e[1].times.every((t) => typeof t === 'number')
    )
    .map(([key, v]): KeptSlayer['kills'][number] => {
      // Zones that do not line up with the times are not known.
      const zones = Array.isArray(v.zones) && v.zones.length === v.times.length && v.zones.every((z) => typeof z === 'string') ? v.zones : v.times.map(() => '')
      return [key, { name: v.name, times: v.times, zones }]
    })
  const completed = k.completed.filter((c) => typeof c === 'string' || (Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'number'))
  const pairs = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is [string, number] => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'number') : undefined)
  const strPairs = (v: unknown) => (Array.isArray(v) ? v.filter((c): c is [string, string] => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'string') : undefined)
  return {
    ...(k as KeptSlayer),
    kills,
    pets: k.pets.filter((p) => typeof p === 'string'),
    completed,
    counts: pairs(k.counts),
    others: pairs(k.others),
    zoneIn: strPairs(k.zoneIn),
    logIds: strPairs(k.logIds)
  }
}

/** What the exports settled about which mobs count toward which Slayer achievements, for every character: a race is the game's, not the player's. */
interface FactsFile {
  version: 1
  /** By lower-cased mob, then lower-cased achievement: whether its kills count, when that was settled, and on what. */
  mobs: Record<string, Record<string, { counts: boolean; at: number; kills: number; rise: number }>>
}

function factsFile(v: unknown): FactsFile {
  const f = v as Partial<FactsFile> | null
  if (!f || f.version !== 1 || !f.mobs || typeof f.mobs !== 'object') return { version: 1, mobs: {} }
  const mobs: FactsFile['mobs'] = {}
  for (const [mob, by] of Object.entries(f.mobs)) {
    if (!by || typeof by !== 'object') continue
    for (const [ach, x] of Object.entries(by)) if (x && typeof x.counts === 'boolean') (mobs[mob] ??= {})[ach] = x
  }
  return { version: 1, mobs }
}

/** A mob the player went for this recently that dies with no killer named ("A bixie died.") died of the player's damage over time. */
const ENGAGED_MS = 60_000

export class SlayerLive {
  private state: SlayerState | null = null
  /** The counts as last made: the export's and the kills since; null without an export, or before the first read. */
  view: SlayerTrackView | null = null
  /** The counts since the export, kept so the next start need not read the log from the export again. */
  private readonly kept: JsonFile<KeptSlayer | null>
  /** What the exports settled (slayer.ts, learnFromExport). */
  private readonly facts: JsonFile<FactsFile>
  /** Told when the counts changed on their own (eqlwiki answered a mob's race): the overlay publishes. */
  onChange: () => void = () => undefined

  /** `raceMix`: the share of each race in a mob of mixed race, by zone (the spawn tables'), for the counts and what an export teaches. */
  constructor(
    private readonly ctx: AppContext,
    private readonly raceMix: RaceMix
  ) {
    const keptPath = join(cacheDir(), 'slayer-since.json')
    const kept = readJsonFile(keptPath)
    this.kept = new JsonFile<KeptSlayer | null>(keptPath, kept.state === 'ok' ? keptSlayer(kept.value) : null, { delayMs: 10_000, pretty: false })
    const factsPath = join(ctx.store.dir, 'slayer-facts.json')
    const facts = readJsonFile(factsPath)
    this.facts = new JsonFile(factsPath, factsFile(facts.state === 'ok' ? facts.value : null), { delayMs: 3000, pretty: false, backup: true })
    if (facts.state === 'unreadable') this.facts.freeze('could not be read at start')
  }

  flush(): Promise<void> {
    return Promise.all([this.kept.flush(), this.facts.flush()]).then(() => undefined)
  }

  /** The character the counts are for; null for none. */
  get character(): string | null {
    return this.state?.character ?? null
  }

  /** Another character is being played: nothing held applies. */
  reset(): void {
    this.state = null
    this.view = null
  }

  /** The kills since the export (lower-cased mob → times and zones), for the character; undefined for another. */
  kills(character: string): SlayerKills | undefined {
    return this.state?.character === character ? this.state.kills : undefined
  }

  /** The achievements the game said were completed since the export (lower-cased), for the character. */
  completed(character: string): Set<string> | undefined {
    return this.state?.character === character ? new Set(this.state.completed.keys()) : undefined
  }

  /** How many of these mobs the character's live counts have seen die since a time (a raid lockout's kills today). */
  killsSince(character: string, mobs: readonly string[], since: number): number {
    const s = this.state
    if (!s || s.character !== character) return 0
    let n = 0
    for (const m of mobs) n += s.kills.get(m.toLowerCase())?.times.filter((t) => t >= since).length ?? 0
    return n
  }

  /** Whether the exports settled that a mob's kills count toward an achievement (both lower-cased): the Slayer plan asks it too. */
  readonly fact = (mob: string, achievement: string): boolean | undefined => this.facts.get().mobs[mob]?.[achievement]?.counts

  /** Whether a kill counts for the character: its own, its pet's, or its group's. */
  private credited(by: string, pets: Set<string>): boolean {
    if (by === 'You' || pets.has(by)) return true
    const meter = this.ctx.engine.meter
    const k = meter.kindOf(by)
    if (k.kind === 'group') return true
    return k.kind === 'pet' && !!k.owner && k.owner.split(' or ').some((o) => o === SELF || meter.kindOf(o).kind === 'group')
  }

  /** A name the damage meter knows for a player, or a player's pet: never a Slayer kill. */
  private friendly(name: string): boolean {
    return isFriend(this.ctx.engine.meter.kindOf(name).kind)
  }

  /**
   * Reads the counts for the character: the export as it is now, the kills since it (the log read on
   * from where it got to), and a new export set against the kills before it.
   */
  async read(character: string): Promise<void> {
    const exp = await this.ctx.achievementFiles.exported(character)
    if (!exp) {
      this.state = null
      this.view = null
      return
    }
    const logPath = this.ctx.historyOf(character).logPath
    const game = await this.ctx.gameTables.get(RACE_TABLE)
    const mem = this.state
    // Nothing in memory for this character and log yet (a start): what the last run counted.
    let s = mem && mem.character === character && mem.logPath === logPath ? mem : this.fromDisk(character, logPath, game)
    if (!s || s.exportAt !== exp.modified || s.game !== game) {
      const counters = slayerCounters(exp.sections)
      const races = new SlayerRaces(counters, game)
      if (s && s.exportAt < exp.modified) {
        // A new export: the kills up to it, read to the end first, are set against how far its counts rose.
        await this.readLog(s)
        this.learn(s, exp.modified, counters, races)
      }
      // The new export counts everything up to it: only what came after it is kept.
      const kept = s && s.exportAt <= exp.modified ? s : null
      const kills: SlayerKills = new Map()
      for (const [k, v] of kept?.kills ?? []) {
        const after = v.times.flatMap((t, i) => (t > exp.modified ? [i] : []))
        if (after.length) kills.set(k, { name: v.name, times: after.map((i) => v.times[i]), zones: after.map((i) => v.zones?.[i] ?? '') })
      }
      s = {
        character,
        exportFile: exp.file,
        exportAt: exp.modified,
        counters,
        counts: new Map(counters.map((c) => [c.name.toLowerCase(), c.count])),
        game,
        races,
        logPath,
        readTo: kept ? kept.readTo : -1,
        logId: kept?.logId ?? '',
        others: new Map(kept?.others ?? []),
        otherIds: new Map(kept?.otherIds ?? []),
        zoneIn: new Map(kept?.zoneIn ?? []),
        kills,
        pets: kept?.pets ?? new Set(),
        engaged: kept?.engaged ?? new Map(),
        completed: new Map([...(kept?.completed ?? [])].filter(([, t]) => t > exp.modified))
      }
      this.state = s
    }
    await this.readLog(s)
    this.count()
  }

  /** What the last run kept for this character and log, at whichever export it was counting from; null for none. */
  private fromDisk(character: string, logPath: string, game: RaceTable): SlayerState | null {
    const d = this.kept.get()
    if (!d || d.character !== character || d.logPath !== logPath) return null
    return {
      character,
      exportFile: '',
      exportAt: d.exportAt,
      // Only its counts are wanted from an export since written over; the same export is read again.
      counters: [],
      counts: new Map(d.counts ?? []),
      // Not the table read now: the state is built again from the export either way.
      game: NO_RACE_TABLE,
      races: new SlayerRaces([], game),
      logPath,
      readTo: d.readTo,
      others: new Map(d.others ?? []),
      logId: new Map(d.logIds ?? []).get(logPath.toLowerCase()) ?? '',
      otherIds: new Map((d.logIds ?? []).filter(([p]) => p !== logPath.toLowerCase())),
      zoneIn: new Map(d.zoneIn ?? []),
      kills: new Map(d.kills),
      pets: new Set(d.pets),
      engaged: new Map(),
      completed: new Map(d.completed.map((c): [string, number] => (typeof c === 'string' ? [c, Infinity] : c)))
    }
  }

  /**
   * Reads the character's logs on from where the counts got to, and keeps how far: this PC's, then
   * its log on each other PC that answers (a kill there counts the same).
   */
  private async readLog(s: SlayerState): Promise<void> {
    const own = await this.readOne(s, s.logPath, { id: s.logId ?? '', readTo: s.readTo })
    s.readTo = own.readTo
    s.logId = own.id
    let read = own.read
    s.otherIds ??= new Map()
    for (const o of this.ctx.historyOf(s.character).elsewhere ?? []) {
      if (!(await this.ctx.logHistory.reachable(o.folder))) continue
      const k = o.logPath.toLowerCase()
      try {
        const there = await this.readOne(s, o.logPath, { id: s.otherIds.get(k) ?? '', readTo: s.others.get(k) ?? -1 })
        s.others.set(k, there.readTo)
        s.otherIds.set(k, there.id)
        read += there.read
      } catch (e) {
        // Its PC went away part way: nothing from this read was counted, and the next one starts where this did.
        log.warn(`Slayer: could not read ${o.logPath}:`, e)
      }
    }
    if (read > 0)
      this.kept.set({
        character: s.character,
        logPath: s.logPath,
        exportAt: s.exportAt,
        readTo: s.readTo,
        kills: [...s.kills],
        pets: [...s.pets],
        completed: [...s.completed],
        counts: [...s.counts],
        others: [...s.others],
        zoneIn: [...s.zoneIn],
        logIds: [[s.logPath.toLowerCase(), s.logId ?? ''], ...(s.otherIds ?? new Map())]
      })
  }

  /**
   * Reads one log on from where the kept read got to (readTo -1 before its first read), counting what it
   * finds only once the read is done: how much was read, how far into the log the counts now go, and
   * which file that is. A log replaced at the path, or cut short, starts again from the line before the
   * export (sinceStart, as the factions' reader does: LT-625).
   */
  private async readOne(s: SlayerState, logPath: string, kept: SincePosition): Promise<{ read: number; readTo: number; id: string }> {
    const path = logPath.toLowerCase()
    const start = await sinceStart(logPath, kept, s.exportAt)
    if (!start) return { read: 0, readTo: Math.max(0, kept.readTo), id: kept.id }
    let readTo = start.from
    const { size, id } = start
    // The zone the read is in where it left off; a read started afresh works it out again.
    let zone = start.fresh ? undefined : s.zoneIn.get(path)
    if (size <= readTo) return { read: 0, readTo, id }
    // The zone the read starts in, the first time: the last one entered before it.
    if (zone === undefined) zone = readTo > 0 ? ((await lastZoneLine(logPath, { end: readTo }).then((l) => l && zoneEntered(l.text))) ?? '') : ''
    const kills: { mob: string; at: number; zone: string }[] = []
    const completed: [string, number][] = []
    const read = await readForward(
      logPath,
      readTo,
      size,
      (line) => {
        const entered = zoneEntered(line.text)
        if (entered) {
          zone = entered
          return
        }
        const x = slayerLine(line.text)
        if (!x) return
        if ('pet' in x) s.pets.add(x.pet)
        if ('engaged' in x) {
          s.engaged.set(x.engaged.toLowerCase(), line.time)
          // Only the last few minutes' are asked about: the rest go, a few hundred at a time (LT-380).
          if (s.engaged.size > 500) for (const [k, t] of s.engaged) if (line.time - t > ENGAGED_MS) s.engaged.delete(k)
          return
        }
        if (line.time <= s.exportAt || 'pet' in x) return
        if ('completed' in x) completed.push([x.completed.toLowerCase(), line.time])
        else {
          let mob: string | null = null
          // A player your side killed (a duel, a charmed pet turned) is nobody's Slayer kill.
          if ('kill' in x) mob = this.credited(x.kill.by, s.pets) && !this.friendly(x.kill.mob) ? x.kill.mob : null
          else if (line.time - (s.engaged.get(x.died.toLowerCase()) ?? -Infinity) <= ENGAGED_MS) mob = x.died
          if (mob) kills.push({ mob, at: line.time, zone: zone ?? '' })
        }
      },
      { flushLast: false }
    )
    for (const [k, t] of completed) s.completed.set(k, t)
    // A Hunter named killed comes off the game's map (Plan › Hunter's marks).
    if (kills.length) this.ctx.slayer?.namedKilled(kills.map((k) => k.mob))
    for (const { mob, at, zone: where } of kills) {
      const k = mob.toLowerCase()
      const had = s.kills.get(k) ?? { name: mob, times: [], zones: [] }
      const zones = (had.zones ??= had.times.map(() => ''))
      had.times.push(at)
      zones.push(where)
      // Another PC's kills can come before this PC's: times stay in order, the newest last, each zone with its time.
      if (had.times.length > 1 && had.times[had.times.length - 2] > at) {
        const order = had.times.map((t, i) => [t, zones[i]] as const).sort((a, b) => a[0] - b[0])
        had.times = order.map((o) => o[0])
        had.zones = order.map((o) => o[1])
      }
      s.kills.set(k, had)
    }
    s.zoneIn.set(path, zone ?? '')
    return { read, readTo: readTo + read, id }
  }

  /**
   * Sets the kills between the export counted from and a new one against how far the new one's
   * counts rose, and keeps what that settles.
   */
  private learn(s: SlayerState, at: number, counters: SlayerCounter[], races: SlayerRaces): void {
    const kills = [...s.kills.values()].map((k) => ({ name: k.name, n: k.times.filter((t) => t <= at).length }))
    const got = learnFromExport(s.counts, counters, races, kills, (m) => this.ctx.npcPages.race(m), this.fact, this.raceMix)
    if (!got.length) return
    const mobs = { ...this.facts.get().mobs }
    for (const f of got) {
      mobs[f.mob] = { ...mobs[f.mob], [f.achievement]: { counts: f.counts, at, kills: f.kills, rise: f.rise } }
      log.info(`Slayer: the export says ${f.mob} ${f.counts ? 'counts' : 'does not count'} toward ${f.achievement} (${f.kills} killed, the count rose ${f.rise})`)
    }
    this.facts.set({ version: 1, mobs })
  }

  /** The counts from the kills so far; mobs not looked up on eqlwiki yet are asked about, and counted again when it answers. */
  private count(): void {
    const s = this.state
    if (!s) return
    const got = slayerCounts(s.counters, s.races, s.kills, (m) => this.ctx.npcPages.race(m), this.fact, new Set(s.completed.keys()), this.raceMix)
    if (got.unknown.length)
      void this.ctx.npcPages.lookUp(got.unknown).then((learned) => {
        if (!learned || this.state !== s) return
        this.count()
        this.onChange()
      })
    this.view = {
      exportFile: s.exportFile,
      exportAt: s.exportAt,
      rows: got.rows.map((r) => ({
        name: r.counter.name,
        section: r.counter.section,
        races: r.counter.races,
        count: r.counter.count,
        since: r.since,
        guessed: r.guessed,
        max: r.counter.max,
        last: r.last,
        done: r.done
      })),
      unplaced: got.unplaced.slice(0, 20),
      pending: got.unknown.length
    }
  }
}
