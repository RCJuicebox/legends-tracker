import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseAchievements, type AchSection } from '../core/achievements'
import { trackedAchievements } from '../core/trackedAchievements'
import { SELF } from '../core/combatLines'
import { isFriend } from '../core/combatMeter'
import { RaceIndex, slayerCounters, slayerCounts, slayerLine, type SlayerCounter, type SlayerKills } from '../core/slayer'
import { isCharacterKey } from '../core/validate'
import { skillGoals, skillId, skillValue } from '../core/skillAchievements'
import { classIdOf, type ClassId } from '../shared/game/classes'
import { parseFactionLine } from '../features/factions/core'
import { standingsNow } from '../features/factions/main'
import {
  carryFollow,
  freshFollow,
  pickStep,
  readFollow,
  sanitizeFollowedPlan,
  sanitizeFollows,
  sayStep,
  type FollowEvent,
  type FollowedPlan,
  type FollowState
} from '../features/factions/tracker'
import type { AchievementTrack, FactionTrackView, SkillRow, SkillTrackView, SlayerTrackView, TrackedAchievement } from '../shared/tracking'
import type { AppContext } from './context'
import type { EngineFeature } from './engine'
import { handle } from './ipc/handle'
import { log } from './log'
import { NpcRaces } from './npcRaces'
import { offsetBefore, readForward } from './sources/logHistory'
import { JsonFile, readJsonFile } from './storeCore'

// What the achievements overlay follows as the game is played: the step of the faction plan the
// player follows (the Plan tab hands it over), the Slayer counts since the last achievements
// export, the skills the open skill achievements want, and the achievements the player tracks (the
// star on the Achievements page). The log is watched for the lines that move any of them (faction
// lines, kills, skill-ups, the game saying an achievement is done); a moment after a burst of them the
// standings, or the new stretch of log, are read and the overlay and the pages told. A step done is
// said aloud.

interface Followed {
  plan: FollowedPlan
  state: FollowState
}

/** Slayer counting for the character being played, since its achievements export. */
interface SlayerState {
  character: string
  exportFile: string
  exportAt: number
  counters: SlayerCounter[]
  index: RaceIndex
  logPath: string
  /** How far into the log the kills have been counted; -1 before the first read. */
  readTo: number
  kills: SlayerKills
  /** The player's pets, as they said so ("Attacking a gnoll, Master."). */
  pets: Set<string>
  /** Mobs the player or its pet went for lately (lower-cased), and when: one of those dying with no killer named is the player's kill. */
  engaged: Map<string, number>
  /** Achievements the game said were completed since the export (lower-cased). */
  completed: Set<string>
}

/** The faction achievements' section: tracking one of them reads the standings. */
const FACTION_SECTION = 'EverQuest: Progression'
/** A read waits this long after the last line that moves something: a stack hand-in or an area kill comes in a burst. */
const SETTLE_MS = 800
/** Everything is read again this often while watching: a new export, and anything the lines did not show. */
const SWEEP_MS = 30_000
/** A page that shows the track says so at least this often while it is open (useAchievementTrack). */
const PAGE_MS = 90_000
/** A mob the player went for this recently that dies with no killer named ("A bixie died.") died of the player's damage over time. */
const ENGAGED_MS = 60_000

export class LiveAchievements {
  private readonly follows: JsonFile<Record<string, Followed>>
  private readonly races = new NpcRaces()
  private character = ''
  private zone = ''
  /** When a line last moved each half, 0 when read since. */
  private factionAt = 0
  private slayerAt = 0
  private sweptAt = 0
  /** What the faction lines since the last read did. */
  private moved: Record<string, number> = {}
  private reading = false
  private faction: FactionTrackView | null = null
  private slayer: SlayerState | null = null
  private slayerView: SlayerTrackView | null = null
  private skillsAt = 0
  private skills: SkillTrackView | null = null
  /** The achievements export as last read, by character and when it was written. */
  private exported: { character: string; mtime: number; file: string; sections: AchSection[] } | null = null
  /** The player's marks on the Achievements page: hand ticks, and the achievements tracked. */
  private marks: { character: string; ticks: string[]; tracked: string[] } | null = null
  /** Faction achievements' factions and standings, by achievement name (lower-cased), for tracked ones. */
  private byAchievement: Record<string, { faction: string; standing: number | null }> | null = null
  private last: AchievementTrack | null = null
  private lastKey = ''
  /** When a page showing the track last said it was open; 0 once it closed. */
  private pageAt = 0

  constructor(private readonly ctx: AppContext) {
    const path = join(ctx.store.dir, 'faction-follow.json')
    const read = readJsonFile(path)
    // Checked as it is read: a plan kept in an older shape would otherwise throw on every faction line.
    const value: Record<string, Followed> = read.state === 'ok' ? sanitizeFollows(read.value) : {}
    this.follows = new JsonFile(path, value, { delayMs: 3000, pretty: false })
    if (read.state === 'unreadable') this.follows.freeze('could not be read at start')
    void this.races.ready()
  }

  /** Its part in following the log: it sees each line after everything else has. */
  readonly feature: EngineFeature = {
    id: 'achievements',
    line: (line) => this.line(line.text),
    tick: (now) => this.tick(now),
    reset: () => {
      this.character = ''
    }
  }

  /** Writes where the player is in each followed plan. */
  flush(): Promise<void> {
    return this.follows.flush()
  }

  /** What the overlay and the pages were last told. */
  get view(): AchievementTrack | null {
    return this.last
  }

  private line(text: string): void {
    const now = Date.now()
    if (text.startsWith('Your faction standing with ')) {
      const f = parseFactionLine(text)
      if (f && 'amount' in f) this.moved[f.faction] = (this.moved[f.faction] ?? 0) + f.amount
      this.factionAt = now
    } else if (text.startsWith('You have completed achievement')) {
      this.factionAt = now
      this.slayerAt = now
    } else if (text.startsWith('You have become better at ')) this.skillsAt = now
    else if (text.startsWith('You have slain ') || text.includes(' has been slain by ') || text.endsWith(' died.')) this.slayerAt = now
  }

  private tick(now: number): void {
    const character = this.ctx.characterKey()
    if (character !== this.character) {
      // Another character: read both halves for it at once.
      this.character = character
      this.slayer = null
      this.slayerView = null
      this.faction = null
      this.skills = null
      this.marks = null
      this.byAchievement = null
      this.moved = {}
      this.sweptAt = 0
    }
    const zone = this.ctx.engine.status.zone
    if (zone !== this.zone) {
      // The step worked on can be the one in the zone just entered.
      this.zone = zone
      this.factionAt ||= now - SETTLE_MS
    }
    if (this.reading || !character || !this.ctx.engine.status.watching) return
    const due = (at: number) => at > 0 && now - at >= SETTLE_MS
    // The sweep catches what no log line announces (a new export, a mark on the Achievements page):
    // only worth its reads while something shows the result. Lines that move a count are read anyway.
    const sweep = now - this.sweptAt >= SWEEP_MS && this.shown(character, now)
    if (!sweep && !due(this.factionAt) && !due(this.slayerAt) && !due(this.skillsAt)) return
    const faction = sweep || due(this.factionAt)
    const slayer = sweep || due(this.slayerAt)
    const skills = sweep || due(this.skillsAt)
    if (faction) this.factionAt = 0
    if (slayer) this.slayerAt = 0
    if (skills) this.skillsAt = 0
    if (sweep) this.sweptAt = now
    this.reading = true
    void (async () => {
      try {
        if (sweep || !this.marks) await this.readMarks(character)
        if (faction) await this.readFaction(character)
        if (slayer) await this.readSlayer(character)
        if (skills) await this.readSkills(character)
        if (character === this.character) this.publish()
      } catch (e) {
        log.warn('The achievements overlay could not read:', e)
      } finally {
        this.reading = false
      }
    })()
  }

  // ---- the faction plan ----

  private async readFaction(character: string): Promise<void> {
    const f = this.follows.get()[character]
    // A faction achievement tracked wants its standing, plan or no plan.
    const tracksFaction = (this.marks?.tracked ?? []).some((k) => k.startsWith(`${FACTION_SECTION} > `))
    if (!f && !tracksFaction) {
      this.faction = null
      this.byAchievement = null
      return
    }
    const { standings, done, byAchievement } = await standingsNow(this.ctx, character)
    this.byAchievement = byAchievement
    if (!f) {
      this.faction = null
      return
    }
    const moved = this.moved
    this.moved = {}
    const r = readFollow(f.plan, f.state, standings, done, { zone: this.zone, moved })
    if (JSON.stringify(r.state) !== JSON.stringify(f.state)) this.follows.set({ ...this.follows.get(), [character]: { plan: f.plan, state: r.state } })
    this.faction = r.view
    this.cue(r.events)
  }

  /** An achievement done flashes; a step done flashes and is said, with the step to go on to (once, for the last of several). */
  private cue(events: FollowEvent[]): void {
    if (!events.length || !this.ctx.store.settings.get().achievementCues) return
    for (const e of events) if (e.kind === 'achievement') this.ctx.engine.notify([{ kind: 'text', text: `✓ ${e.name}`, color: '#8fe0a6', durationSec: 6 }])
    const step = events.filter((e) => e.kind === 'step').pop()
    if (!step || step.kind !== 'step') return
    const next = step.next
    this.ctx.engine.notify([
      {
        kind: 'text',
        text: next ? `Faction step done · next: ${next.title}${next.zone ? ` (${next.zone})` : ''}` : 'Every faction step is done',
        color: '#f7c965',
        durationSec: 8
      },
      { kind: 'speak', text: next ? `Faction step done. Next, ${sayStep(next)}.` : 'Every step of the faction plan is done.', interrupt: false }
    ])
  }

  /** The Plan tab's plan for a character, to follow; null stops following. The old plan is read one last time first, so a step done is still said. */
  async follow(character: string, plan: FollowedPlan | null): Promise<void> {
    const had = this.follows.get()[character]
    if (had && character === this.character && this.ctx.engine.status.watching) await this.readFaction(character).catch(() => undefined)
    const next = { ...this.follows.get() }
    if (!plan) delete next[character]
    else {
      // The same steps keep their progress; another plan keeps the step worked on where it is still in it.
      const key = (p: FollowedPlan) => JSON.stringify(p.steps.map((s) => [s.id, s.finish, s.lift, s.reach ?? []]))
      const same = had && key(had.plan) === key(plan)
      next[character] = { plan, state: !had ? freshFollow() : same ? had.state : carryFollow(had.plan, had.state, plan) }
    }
    this.follows.set(next)
    if (character === this.character) {
      await this.readFaction(character).catch((e: unknown) => log.warn('Could not read the faction plan just followed:', e))
      this.publish()
    }
  }

  /**
   * The step to work on now, as the player picked it on the Plan tab: it is the one followed, its
   * progress counted from here, until kills or hand-ins go toward another step (or it is done).
   */
  async followStep(character: string, index: number): Promise<void> {
    const f = this.follows.get()[character]
    if (!f || index >= f.plan.steps.length) return
    this.follows.set({ ...this.follows.get(), [character]: { plan: f.plan, state: pickStep(f.state, index) } })
    if (character === this.character) {
      await this.readFaction(character).catch((e: unknown) => log.warn('Could not read the faction plan after a step was picked:', e))
      this.publish()
    }
  }

  // ---- Slayer ----

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

  /** The character's achievements export, read again only when the game has written it again; null without one. */
  private async achievementsExport(character: string): Promise<LiveAchievements['exported']> {
    const file = `${character}-Achievements.txt`
    const path = join(this.ctx.installDir(), file)
    const st = await fs.stat(path).catch(() => null)
    if (!st) return (this.exported = null)
    const had = this.exported
    if (had && had.character === character && had.mtime === st.mtimeMs) return had
    try {
      return (this.exported = { character, mtime: st.mtimeMs, file, sections: parseAchievements(await fs.readFile(path, 'utf8')).sections })
    } catch (e) {
      // Caught mid-write, or not an export: the next read tries again.
      log.warn(`Could not read ${file} for the achievements overlay:`, e)
      return null
    }
  }

  private async readSlayer(character: string): Promise<void> {
    const exp = await this.achievementsExport(character)
    if (!exp) {
      this.slayer = null
      this.slayerView = null
      return
    }
    const st = { mtimeMs: exp.mtime }
    const file = exp.file
    const logPath = this.ctx.historyOf(character).logPath
    let s = this.slayer
    if (!s || s.character !== character || s.exportAt !== st.mtimeMs || s.logPath !== logPath) {
      // A new export counts everything up to it: only the kills after it are kept.
      const counters = slayerCounters(exp.sections)
      const kept = s && s.character === character && s.logPath === logPath && s.exportAt <= st.mtimeMs ? s : null
      const kills: SlayerKills = new Map()
      for (const [k, v] of kept?.kills ?? []) {
        const times = v.times.filter((t) => t > st.mtimeMs)
        if (times.length) kills.set(k, { name: v.name, times })
      }
      s = this.slayer = {
        character,
        exportFile: file,
        exportAt: st.mtimeMs,
        counters,
        index: new RaceIndex(counters),
        logPath,
        readTo: kept ? kept.readTo : -1,
        kills,
        pets: kept?.pets ?? new Set(),
        engaged: new Map(),
        completed: new Set()
      }
    }
    const size = (await fs.stat(logPath).catch(() => null))?.size ?? 0
    // The first read starts at the line before the export was written; a log started afresh, at its top.
    if (s.readTo < 0) s.readTo = size ? await offsetBefore(logPath, s.exportAt, { slackMs: 2000 }) : 0
    else if (size < s.readTo) s.readTo = 0
    if (size > s.readTo) {
      const state = s
      const read = await readForward(
        logPath,
        s.readTo,
        size,
        (line) => {
          const x = slayerLine(line.text)
          if (!x) return
          if ('pet' in x) state.pets.add(x.pet)
          if ('engaged' in x) {
            state.engaged.set(x.engaged.toLowerCase(), line.time)
            return
          }
          if (line.time <= state.exportAt || 'pet' in x) return
          if ('completed' in x) state.completed.add(x.completed.toLowerCase())
          else {
            let mob: string | null = null
            // A player your side killed (a duel, a charmed pet turned) is nobody's Slayer kill.
            if ('kill' in x) mob = this.credited(x.kill.by, state.pets) && !this.friendly(x.kill.mob) ? x.kill.mob : null
            else if (line.time - (state.engaged.get(x.died.toLowerCase()) ?? -Infinity) <= ENGAGED_MS) mob = x.died
            if (!mob) return
            const k = mob.toLowerCase()
            const had = state.kills.get(k) ?? { name: mob, times: [] }
            had.times.push(line.time)
            state.kills.set(k, had)
          }
        },
        { flushLast: false }
      )
      s.readTo += read
    }
    this.countSlayer()
  }

  /** The counts from the kills so far; mobs whose names do not say what they are are asked of eqlwiki, and counted again when it answers. */
  private countSlayer(): void {
    const s = this.slayer
    if (!s) return
    const got = slayerCounts(s.counters, s.index, s.kills, (m) => this.races.race(m), s.completed)
    if (got.unknown.length)
      void this.races.lookUp(got.unknown).then((learned) => {
        if (!learned || this.slayer !== s) return
        this.countSlayer()
        this.publish()
      })
    this.slayerView = {
      exportFile: s.exportFile,
      exportAt: s.exportAt,
      rows: got.rows.map((r) => ({
        name: r.counter.name,
        section: r.counter.section,
        races: r.counter.races,
        count: r.counter.count,
        since: r.since,
        max: r.counter.max,
        last: r.last,
        done: r.done
      })),
      unplaced: got.unplaced.slice(0, 20),
      pending: got.unknown.length
    }
  }

  // ---- skills ----

  /**
   * The open skill objectives, each with the skill's value the log last gave and the cap to reach: the
   * best of the character's classes at that level (its own class's when its classes are not known).
   */
  private async readSkills(character: string): Promise<void> {
    const exp = await this.achievementsExport(character)
    const goals = exp ? skillGoals(exp.sections) : []
    if (!goals.length) {
      this.skills = null
      return
    }
    const values = await this.ctx.skills.view(this.ctx.historyOf(character))
    const classes = Object.keys(this.ctx.store.characterByKey(character).classLevels)
      .map(classIdOf)
      .filter((c): c is ClassId => !!c)
    const caps = new Map<string, Map<number, number>>()
    const capOf = async (ids: ClassId[], level: number, skill: number) => {
      const k = `${ids.join('+')}@${level}`
      let m = caps.get(k)
      if (!m) caps.set(k, (m = new Map((await this.ctx.gameTables.skillCaps(ids, level)).map((r) => [r.id, r.cap]))))
      return m.get(skill) ?? 0
    }
    const rows: SkillRow[] = []
    for (const g of goals) {
      const id = skillId(g.skill)
      const own = classIdOf(g.className)
      const target = id === null ? 0 : await capOf(classes.length ? classes : own ? [own] : [], g.level, id)
      const v = skillValue(values, g.skill)
      rows.push({ achievement: g.achievement, className: g.className, skill: g.skill, level: g.level, value: v?.value ?? null, target, last: v?.at ?? 0 })
    }
    this.skills = { rows, classes }
  }

  // ---- tracked ----

  private async readMarks(character: string): Promise<void> {
    const m = await this.ctx.achievementFiles.marks(character)
    this.marks = { character, ticks: m.ticks, tracked: m.tracked ?? [] }
  }

  /** The player tracked or untracked an achievement (or ticked one): read everything for it now. */
  marksChanged(character: string): void {
    if (character !== this.character) return
    this.marks = null
    this.sweptAt = 0
  }

  /** Whether anything shows the track now: the achievements overlay up, a plan followed (its cues are spoken), or a page open on it. */
  private shown(character: string, now: number): boolean {
    if (this.follows.get()[character]) return true
    if (this.ctx.overlays.isShown && this.ctx.store.settings.get().overlays.some((o) => o.kind === 'achievements' && o.visible)) return true
    return now - this.pageAt < PAGE_MS && this.ctx.windows.mainShown
  }

  /** A page showing the track opened (and says so again while open), or closed. Opening reads everything at once. */
  watch(open: boolean): void {
    if (open && !this.pageAt) this.sweptAt = 0
    this.pageAt = open ? Date.now() : 0
  }

  /** Each tracked achievement with its progress (trackedAchievements), from what the other parts read. */
  private trackedAchievements(): TrackedAchievement[] {
    const exp = this.exported
    const marks = this.marks
    if (!exp || !marks || exp.character !== marks.character) return []
    return trackedAchievements(exp.sections, marks, {
      slayer: this.slayerView?.rows,
      skills: this.skills?.rows,
      factions: this.byAchievement,
      kills: this.slayer?.kills,
      completed: this.slayer?.completed
    })
  }

  // ---- telling ----

  private publish(): void {
    const track: AchievementTrack = {
      character: this.character,
      at: Date.now(),
      faction: this.faction,
      slayer: this.slayerView,
      skills: this.skills,
      tracked: this.trackedAchievements()
    }
    const key = JSON.stringify([track.character, track.faction, track.slayer, track.skills, track.tracked])
    if (key === this.lastKey) return
    this.lastKey = key
    this.last = track
    this.ctx.overlays.achievements(track)
    this.ctx.windows.toMain('state:achievementTrack', track)
  }
}

export function registerLiveAchievementsIpc(ctx: AppContext): void {
  handle('factions:follow', async (character, plan) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    const clean = plan === null ? null : sanitizeFollowedPlan(plan)
    if (plan !== null && !clean) throw new Error('Not a plan.')
    await ctx.liveAchievements.follow(character, clean)
  })
  handle('factions:follow-step', async (character, index) => {
    if (!isCharacterKey(character)) throw new Error('Not a character.')
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new Error('Not a step.')
    await ctx.liveAchievements.followStep(character, index)
  })
  handle('achievements:track', (watching) => {
    if (typeof watching === 'boolean') ctx.liveAchievements.watch(watching)
    return ctx.liveAchievements.view
  })
}
