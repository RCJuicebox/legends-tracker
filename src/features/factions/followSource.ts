import { join } from 'node:path'
import type { FactionTrackView } from '../../shared/tracking'
import type { AppContext } from '../../main/context'
import { log } from '../../main/log'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { carryFollow, freshFollow, pickStep, readFollow, sanitizeFollows, sayStep, type FollowEvent, type FollowedPlan, type FollowState } from './tracker'
import { newerBuildWrote } from '../../main/schema'
import type { RoutePart } from '../../core/route'

// The faction plan the player follows, as the game is played: the Plan tab hands the plan over
// (factions:follow), the standings are read a moment after each faction line, and the step the plan is
// on, its progress and a step done are worked out (tracker.ts) and said. Kept per character in
// faction-follow.json. Owned by the Factions feature (LT-623); LiveAchievements says when to read, and
// publishes the view this holds.

interface Followed {
  plan: FollowedPlan
  state: FollowState
}

/** The faction achievements' section: tracking one of them reads the standings. */
export const FACTION_SECTION = 'EverQuest: Progression'

export class FactionFollow {
  private readonly follows: JsonFile<Record<string, Followed>>
  /** The step the followed plan is on, as last read; null with no plan followed, or before the first read. */
  view: FactionTrackView | null = null
  /** The character the view is for. */
  private viewFor = ''
  /** Faction achievements' factions and standings, by achievement name (lower-cased), for tracked ones. */
  byAchievement: Record<string, { faction: string; standing: number | null }> | null = null
  /** Told after a page changed what is followed (a plan followed, a step picked): the overlay reads it again and publishes. */
  onChange: (character: string) => Promise<void> = async () => undefined

  /** `standingsNow`: where the character stands with each faction now, and the faction achievements done (main.ts's). */
  constructor(
    private readonly ctx: AppContext,
    private readonly standingsNow: (
      character: string
    ) => Promise<{ standings: Record<string, number>; done: Set<string>; byAchievement: Record<string, { faction: string; standing: number | null }> }>
  ) {
    const path = join(ctx.store.dir, 'faction-follow.json')
    const read = readJsonFile(path)
    // Checked as it is read: a plan kept in an older shape would otherwise throw on every faction line.
    const value: Record<string, Followed> = read.state === 'ok' ? sanitizeFollows(read.value) : {}
    this.follows = new JsonFile(path, value, { delayMs: 3000, pretty: false, backup: true })
    if (read.state === 'unreadable') this.follows.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.follows.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.follows.flush()
  }

  /** Whether the character follows a plan. */
  has(character: string): boolean {
    return !!this.follows.get()[character]
  }

  /** Another character is being played: nothing read applies. */
  reset(): void {
    this.view = null
    this.viewFor = ''
    this.byAchievement = null
  }

  /** The view, when it is the character's. */
  viewFor_(character: string): FactionTrackView | null {
    return this.viewFor === character ? this.view : null
  }

  /**
   * The steps of the plan the character follows not done yet, as one zone view puts them (FEAT-031):
   * from the step being worked on, each with its zone and about how long it takes there.
   */
  stepsLeft(character: string): RoutePart[] {
    const f = this.follows.get()[character]
    if (!f) return []
    const from = this.viewFor === character ? (this.view?.current?.index ?? f.plan.steps.length) : 0
    return f.plan.steps.slice(from).map((s, i) => ({
      planner: 'faction' as const,
      zone: s.zone,
      title: `Faction step ${from + i + 1}: ${s.title}`,
      seconds: s.units * s.unitSec + (s.travelSec ?? 0)
    }))
  }

  /** The factions the plan the character follows is raising (its steps' hits), for Plan › Slayer's faction costs; none without a plan. */
  raisedByPlan(character: string): string[] {
    const f = this.follows.get()[character]
    if (!f) return []
    const out = new Set<string>()
    for (const s of f.plan.steps) for (const [faction, v] of Object.entries(s.per)) if (v > 0) out.add(faction)
    return [...out]
  }

  /**
   * Reads where the plan stands: the standings now, against the plan, with what the faction lines
   * since the last read did (`moved`) and the zone the player is in. `tracksFaction` reads the standings
   * for a tracked faction achievement though no plan is followed.
   */
  async read(character: string, o: { zone: string; moved: Record<string, number>; tracksFaction: boolean }): Promise<void> {
    const f = this.follows.get()[character]
    if (!f && !o.tracksFaction) {
      this.view = null
      this.viewFor = character
      this.byAchievement = null
      return
    }
    const { standings, done, byAchievement } = await this.standingsNow(character)
    this.byAchievement = byAchievement
    this.viewFor = character
    if (!f) {
      this.view = null
      return
    }
    const r = readFollow(f.plan, f.state, standings, done, { zone: o.zone, moved: o.moved })
    if (JSON.stringify(r.state) !== JSON.stringify(f.state)) this.follows.set({ ...this.follows.get(), [character]: { plan: f.plan, state: r.state } })
    this.view = r.view
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
    if (had) await this.onChange(character).catch(() => undefined)
    const next = { ...this.follows.get() }
    if (!plan) delete next[character]
    else {
      // The same steps keep their progress; another plan keeps the step worked on where it is still in it.
      const key = (p: FollowedPlan) => JSON.stringify(p.steps.map((s) => [s.id, s.finish, s.lift, s.reach ?? []]))
      const same = had && key(had.plan) === key(plan)
      next[character] = { plan, state: !had ? freshFollow() : same ? had.state : carryFollow(had.plan, had.state, plan) }
    }
    this.follows.set(next)
    await this.onChange(character).catch((e: unknown) => log.warn('Could not read the faction plan just followed:', e))
  }

  /**
   * The step to work on now, as the player picked it on the Plan tab: it is the one followed, its
   * progress counted from here, until kills or hand-ins go toward another step (or it is done).
   */
  async followStep(character: string, index: number): Promise<void> {
    const f = this.follows.get()[character]
    if (!f || index >= f.plan.steps.length) return
    this.follows.set({ ...this.follows.get(), [character]: { plan: f.plan, state: pickStep(f.state, index) } })
    await this.onChange(character).catch((e: unknown) => log.warn('Could not read the faction plan after a step was picked:', e))
  }
}
