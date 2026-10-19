import { COMPLETED_ACHIEVEMENT } from '../core/phrases'
import type { Notification } from '../shared/runtime'
import { trackedAchievements } from '../core/trackedAchievements'
import { skillGoals, skillId, skillValue } from '../core/skillAchievements'
import { classIdOf, type ClassId } from '../shared/game/classes'
import { parseFactionLine } from '../features/factions/core'
import { FACTION_SECTION } from '../features/factions/followSource'
import type { AchievementTrack, SkillRow, SkillTrackView, SlayerPlanTrackView, TrackedAchievement, PlayerLocation } from '../shared/tracking'
import { planSlayer, slayerPlanView } from '../features/slayer/core'
import type { AchievementsExport } from './achievements'
import type { AppContext } from './context'
import type { AppFeature, TrackContext } from './appFeature'
import type { EngineFeature } from './engine'
import { handle } from './ipc/handle'
import { log } from './log'
import { parseLoc } from '../core/where'

// What the achievements overlay follows as the game is played: the step of the faction plan the
// player follows (the Factions feature holds it, followSource.ts), the Slayer counts since the last
// achievements export (the Slayer feature's, liveSource.ts), the skills the open skill achievements
// want, and the achievements the player tracks (the star on the Achievements page). This class says
// when to read: the log is watched for the lines that move any of them (faction lines, kills,
// skill-ups, the game saying an achievement is done); a moment after a burst of them the standings, or
// the new stretch of log, are read, and the track is put together from what each feature holds
// (AppFeature.track) and the overlay and the pages told.

/** A read waits this long after the last line that moves something: a stack hand-in or an area kill comes in a burst. */
const SETTLE_MS = 800
/**
 * Kills settle longer: in an AoE grind they come a second or two apart, and each read opens the
 * export and counts every Slayer achievement (LT-383). Still read at least this often while they
 * keep coming.
 */
const KILLS_SETTLE_MS = 5000
const KILLS_AT_MOST_MS = 15_000
/** Everything is read again this often while watching: a new export, and anything the lines did not show. */
const SWEEP_MS = 30_000
/** A page that shows the track says so at least this often while it is open (useAchievementTrack). */
const PAGE_MS = 90_000

export class LiveAchievements implements AppFeature {
  readonly id = 'achievements'
  private character = ''
  private zone = ''
  /** When a line last moved each half, 0 when read since. */
  private factionAt = 0
  private slayerAt = 0
  /** The first kill not read yet: kills that keep coming are still read every KILLS_AT_MOST_MS. */
  private slayerSince = 0
  private sweptAt = 0
  /** What the faction lines since the last read did. */
  private moved: Record<string, number> = {}
  private reading = false
  private skillsAt = 0
  private skills: SkillTrackView | null = null
  /** When the Slayer plan was last asked to be made again (a zone entered, the choices changed), 0 when made since. */
  private planAt = 0
  private slayerPlan: SlayerPlanTrackView | null = null
  /** The achievements export as last read, by character and when it was written. */
  private exported: (AchievementsExport & { character: string }) | null = null
  /** The player's marks on the Achievements page: hand ticks, and the achievements tracked. */
  private marks: { character: string; ticks: string[]; tracked: string[] } | null = null
  private last: AchievementTrack | null = null
  private lastKey = ''
  /** When a page showing the track last said it was open; 0 once it closed. */
  private pageAt = 0

  constructor(private readonly ctx: AppContext) {}

  /** Its part in following the log: it sees each line after everything else has. */
  readonly feature: EngineFeature = {
    id: 'achievements',
    line: (line) => this.line(line.text),
    tick: (now) => this.tick(now),
    reset: () => {
      this.character = ''
    }
  }

  /** Its channel, and its part in following the log: registered after the engine's own, it sees each line last. */
  register(ctx: AppContext): void {
    // Where the player last typed /loc, for the "you" on the Slayer and Hunter maps (FEAT-023).
    handle('game:location', () => this.location)
    handle('achievements:track', (watching) => {
      if (typeof watching === 'boolean') ctx.liveAchievements.watch(watching)
      return ctx.liveAchievements.view
    })
    ctx.engine.use(this.feature)
    // What the features hold changes on its own too: eqlwiki answers a mob's race, a page follows a plan.
    const live = ctx.slayer?.live
    if (live) live.onChange = () => this.publish()
    const follow = ctx.factions?.follow
    if (follow) follow.onChange = (character) => this.refreshFaction(character)
  }

  /** What the overlay and the pages were last told. */
  get view(): AchievementTrack | null {
    return this.last
  }

  /** The player's last /loc, and the zone it was typed in (FEAT-023). */
  private loc: PlayerLocation | null = null

  /** The player's last /loc, while they are still in its zone. */
  get location(): PlayerLocation | null {
    return this.loc && this.loc.zone === this.ctx.engine.status.zone ? this.loc : null
  }

  private line(text: string): void {
    const now = Date.now()
    const loc = parseLoc(text)
    if (loc) {
      this.loc = { ...loc, zone: this.ctx.engine.status.zone, at: now }
      // The overlay's Hunter rows say how far each named's nearest spot is: told at once.
      if (this.character) this.publish()
      return
    }
    if (text.startsWith('Your faction standing with ')) {
      const f = parseFactionLine(text)
      if (f && 'amount' in f) this.moved[f.faction] = (this.moved[f.faction] ?? 0) + f.amount
      this.factionAt = now
    } else if (COMPLETED_ACHIEVEMENT.test(text)) {
      this.factionAt = now
      this.slayerAt = now
      this.slayerSince = 0
    } else if (text.startsWith('You have become better at ')) this.skillsAt = now
    else if (text.startsWith('You have slain ') || text.includes(' has been slain by ') || text.endsWith(' died.')) {
      this.slayerAt = now
      this.slayerSince ||= now
    }
  }

  private tick(now: number): void {
    const character = this.ctx.characterKey()
    if (character !== this.character) {
      // Another character: read both halves for it at once.
      this.character = character
      this.ctx.slayer?.live?.reset()
      this.ctx.factions?.follow?.reset()
      this.skills = null
      this.slayerPlan = null
      this.marks = null
      this.moved = {}
      this.sweptAt = 0
    }
    const zone = this.ctx.engine.status.zone
    if (zone !== this.zone) {
      // The step worked on can be the one in the zone just entered, the faction plan's or the Slayer plan's.
      this.zone = zone
      this.factionAt ||= now - SETTLE_MS
      this.planAt ||= now - SETTLE_MS
    }
    if (this.reading || !character || !this.ctx.engine.status.watching) return
    const due = (at: number) => at > 0 && now - at >= SETTLE_MS
    // The sweep catches what no log line announces (a new export, a mark on the Achievements page):
    // only worth its reads while something shows the result. Lines that move a count are read anyway.
    const sweep = now - this.sweptAt >= SWEEP_MS && this.shown(character, now)
    // A completion line clears slayerSince's wait: it is read on the short settle.
    const killsDue = this.slayerAt > 0 && (this.slayerSince ? now - this.slayerAt >= KILLS_SETTLE_MS || now - this.slayerSince >= KILLS_AT_MOST_MS : due(this.slayerAt))
    if (!sweep && !due(this.factionAt) && !killsDue && !due(this.skillsAt) && !due(this.planAt)) return
    const faction = sweep || due(this.factionAt)
    const slayer = sweep || killsDue
    const skills = sweep || due(this.skillsAt)
    // The Slayer plan is made again from the counts each time they are read.
    const plan = slayer || due(this.planAt)
    if (plan) this.planAt = 0
    if (faction) this.factionAt = 0
    if (slayer) {
      this.slayerAt = 0
      this.slayerSince = 0
    }
    if (skills) this.skillsAt = 0
    if (sweep) this.sweptAt = now
    this.reading = true
    void (async () => {
      try {
        if (sweep || !this.marks) await this.readMarks(character)
        if (faction) await this.readFaction(character)
        if (slayer) await this.readSlayer(character)
        if (plan) await this.readSlayerPlan(character)
        if (skills) await this.readSkills(character)
        if (character === this.character) this.publish()
      } catch (e) {
        log.warn('The achievements overlay could not read:', e)
      } finally {
        this.reading = false
      }
    })()
  }

  // ---- the faction plan (the Factions feature's, followSource.ts) ----

  private async readFaction(character: string): Promise<void> {
    const follow = this.ctx.factions?.follow
    if (!follow) return
    // A faction achievement tracked wants its standing, plan or no plan.
    const tracksFaction = (this.marks?.tracked ?? []).some((k) => k.startsWith(`${FACTION_SECTION} > `))
    const moved = this.moved
    this.moved = {}
    await follow.read(character, { zone: this.zone, moved, tracksFaction })
  }

  /** A page followed a plan or picked a step: read where it stands now, and tell the overlay. */
  async refreshFaction(character: string): Promise<void> {
    if (character !== this.character || !this.ctx.engine.status.watching) return
    await this.readFaction(character)
    this.publish()
  }

  // ---- Slayer (the Slayer feature's, liveSource.ts) ----

  /** The character's achievements export, read again only when the game has written it again; null without one. */
  private async achievementsExport(character: string): Promise<LiveAchievements['exported']> {
    const exp = await this.ctx.achievementFiles.exported(character)
    return (this.exported = exp && { character, ...exp })
  }

  private async readSlayer(character: string): Promise<void> {
    await this.achievementsExport(character)
    await this.ctx.slayer?.live?.read(character)
  }

  /**
   * Plan › Slayer's step, for a character that shows it on the overlay: the plan made again with the
   * counts as they are now (the export's and the kills since), the camps as the page reads them.
   */
  private async readSlayerPlan(character: string): Promise<void> {
    const live = this.ctx.slayer?.live
    const view = live?.character === character ? live.view : null
    const got = view ? await this.ctx.slayer?.forOverlay(this.ctx, character, view.exportAt) : null
    if (!view || !got || got.data.export?.modified !== view.exportAt) {
      this.slayerPlan = null
      return
    }
    const rows = new Map(view.rows.map((r) => [r.name.toLowerCase(), r]))
    const goals = got.data.goals.map((g) => {
      const r = rows.get(g.name.toLowerCase())
      return r ? { ...g, count: r.done ? g.max : Math.min(g.max, r.count + r.since) } : g
    })
    const before = this.slayerPlan
    this.slayerPlan = slayerPlanView(planSlayer({ ...got.data, goals }, got.choices), goals, got.choices, this.zone)
    this.cueSlayer(before, this.slayerPlan, goals)
  }

  /**
   * A Slayer achievement of the step being worked on finished: it flashes, and when the plan has moved
   * on, the step now is said with where and what to kill, as the faction plan's steps are (LT-655).
   */
  private cueSlayer(before: SlayerPlanTrackView | null, now: SlayerPlanTrackView, goals: { name: string; count: number; max: number }[]): void {
    const was = before?.current
    if (!was || !this.ctx.store.settings.get().achievementCues) return
    const done = was.goals.filter((g) => g.count < g.max && (goals.find((x) => x.name === g.name)?.count ?? 0) >= g.max)
    if (!done.length) return
    const ns: Notification[] = done.map((g) => ({ kind: 'text', text: `✓ ${g.name}`, color: '#8fe0a6', durationSec: 6 }))
    const next = now.current
    const moved = !next || next.zone !== was.zone || next.goals.some((g) => !was.goals.some((w) => w.name === g.name))
    if (moved) {
      const what =
        next?.mobs
          .slice(0, 2)
          .map((m) => m.name)
          .join(', ') ?? ''
      ns.push(
        {
          kind: 'text',
          text: next ? `Slayer step done · next: ${next.zone}${what ? `, ${what}` : ''}` : 'Every Slayer step is done',
          color: '#f7c965',
          durationSec: 8
        },
        {
          kind: 'speak',
          text: next ? `${done.map((g) => g.name).join(' and ')} done. Next, ${next.zone}${what ? `: ${what}` : ''}.` : 'Every step of the Slayer plan is done.',
          interrupt: false
        }
      )
    }
    this.ctx.engine.notify(ns)
  }

  /** The player changed Plan › Slayer's choices (or showed it here): the plan is made again at once. */
  slayerChoicesChanged(character: string): void {
    if (character === this.character) this.planAt = Date.now() - SETTLE_MS
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
    if (this.ctx.factions?.follow?.has(character)) return true
    if (this.ctx.overlays.isShown && this.ctx.store.settings.get().overlays.some((o) => o.kind === 'achievements' && o.visible)) return true
    return now - this.pageAt < PAGE_MS && this.ctx.windows.mainShown
  }

  /** A page showing the track opened (and says so again while open), or closed. Opening reads everything at once. */
  watch(open: boolean): void {
    if (open && !this.pageAt) this.sweptAt = 0
    this.pageAt = open ? Date.now() : 0
  }

  /** Each tracked achievement with its progress (trackedAchievements), from what the features hold. */
  private trackedAchievements(): TrackedAchievement[] {
    const exp = this.exported
    const marks = this.marks
    if (!exp || !marks || exp.character !== marks.character) return []
    const live = this.ctx.slayer?.live
    const mine = live?.character === exp.character
    return trackedAchievements(exp.sections, marks, {
      slayer: mine ? live.view?.rows : undefined,
      skills: this.skills?.rows,
      factions: this.ctx.factions?.follow?.byAchievement ?? null,
      kills: mine ? live.kills(exp.character) : undefined,
      completed: mine ? live.completed(exp.character) : undefined
    })
  }

  // ---- telling ----

  /** The track as it stands: what this class read, and each feature's part (AppFeature.track). */
  private publish(): void {
    const exported = this.exported?.character === this.character ? this.exported : null
    const at: TrackContext = { character: this.character, zone: this.zone, exported, loc: this.location }
    const track: AchievementTrack = {
      character: this.character,
      at: Date.now(),
      faction: null,
      slayer: null,
      skills: this.skills,
      hunter: null,
      slayerPlan: this.slayerPlan,
      tracked: this.trackedAchievements()
    }
    for (const f of this.ctx.features ?? []) if (f !== this && f.track) Object.assign(track, f.track(at))
    const key = JSON.stringify([track.character, track.faction, track.slayer, track.skills, track.hunter, track.slayerPlan, track.tracked])
    if (key === this.lastKey) return
    this.lastKey = key
    this.last = track
    this.ctx.overlays.achievements(track)
    this.ctx.windows.toMain('state:achievementTrack', track)
  }
}
