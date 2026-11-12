import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { newerBuildWrote } from '../../main/schema'
import { classIdOf, type ClassId } from '../../shared/game/classes'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps } from '../../main/appFeature'
import {
  REINC_KEYS,
  REINC_RANKS,
  completionistRank,
  emptyReincCharacter,
  loggedRanks,
  loggedReincarnations,
  openPlans,
  rankOf,
  reincHistory,
  sanitizePlans,
  sanitizeReincCharacter,
  tokenCount,
  type LineRank,
  type RankEvent,
  type ReincCharacter,
  type ReincKey,
  type ReincState
} from './core'

// Goals › Reincarnation's side of the app (an optional module): each line's rank from the AA lines the
// game writes when a reincarnation gives one (Stats › AAs reads the same lines), the player's ranks set
// by hand, their plan of trios, and the Tokens of Reincarnation in the inventory export. What the
// player keeps is in reincarnation.json, by character.

export class ReincarnationTracker implements AppFeature {
  readonly id = 'reincarnation'
  private readonly file: JsonFile<{ characters: Record<string, ReincCharacter> }>

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): ReincarnationTracker {
    return new ReincarnationTracker(d.dir)
  }

  constructor(dir: string) {
    const path = join(dir, 'reincarnation.json')
    const read = readJsonFile(path)
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { characters?: unknown }
    const characters: Record<string, ReincCharacter> = {}
    if (v.characters && typeof v.characters === 'object') for (const [k, c] of Object.entries(v.characters)) if (isCharacterKey(k)) characters[k] = sanitizeReincCharacter(c)
    this.file = new JsonFile(path, { characters }, { delayMs: 1000, backup: true })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  private kept(character: string): ReincCharacter {
    return this.file.get().characters[character] ?? emptyReincCharacter()
  }

  private keep(character: string, next: ReincCharacter): void {
    this.file.set({ characters: { ...this.file.get().characters, [character]: next } })
  }

  register(ctx: AppContext): void {
    const check = (character: unknown): string => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return character
    }
    handle('reincarnation:state', async (character) => this.state(ctx, check(character)))
    // A line's rank set by hand (0 to 3), or null to go back to what the log says.
    handle('reincarnation:rank', async (character, key, rank) => {
      const c = check(character)
      if (typeof key !== 'string' || !(REINC_KEYS as readonly string[]).includes(key)) throw new Error('No such Reincarnation AA.')
      if (rank !== null && (!Number.isInteger(rank) || rank < 0 || rank > REINC_RANKS)) throw new Error('A rank is 0 to 3.')
      const kept = this.kept(c)
      const { [key as ReincKey]: _, ...hand } = kept.hand
      this.keep(c, { ...kept, hand: rank === null ? hand : { ...hand, [key]: { rank, at: Date.now() } } })
      return this.state(ctx, c)
    })
    // The plans, in the player's order: the page sends the whole list each time.
    handle('reincarnation:plans', async (character, plans) => {
      const c = check(character)
      const ok = sanitizePlans(plans)
      if (!ok) throw new Error('Each plan is three different classes and a race, or none.')
      this.keep(c, { ...this.kept(c), plans: ok })
      return this.state(ctx, c)
    })
    // A plan the player says they reincarnated as: a rank in each of its lines, and off the plan.
    handle('reincarnation:done', async (character, id) => {
      const c = check(character)
      const kept = this.kept(c)
      const plan = kept.plans.find((p) => p.id === id)
      if (!plan) throw new Error('No such plan.')
      const { ranks } = await this.ranks(ctx, c, kept)
      const at = Date.now()
      const hand = { ...kept.hand }
      const keys: ReincKey[] = [...plan.classes.map((x): ReincKey => `class:${x}`), ...(plan.race ? [`race:${plan.race}` as ReincKey] : [])]
      for (const k of keys) hand[k] = { rank: Math.min(REINC_RANKS, (ranks[k]?.rank ?? 0) + 1), at }
      this.keep(c, {
        hand,
        plans: kept.plans.filter((p) => p !== plan),
        done: [...kept.done, { at, classes: plan.classes, race: plan.race, by: 'hand' }]
      })
      return this.state(ctx, c)
    })
  }

  /** Every Reincarnation rank the log saw given, and each line's rank with the player's own. */
  private async ranks(ctx: AppContext, character: string, kept: ReincCharacter): Promise<{ events: RankEvent[]; ranks: Partial<Record<ReincKey, LineRank>>; from: number }> {
    const view = ctx.installDir() ? await ctx.aaHistory.view(ctx.historyOf(character)) : null
    const events: RankEvent[] = view ? [...view.granted, ...view.bought].flatMap((a) => a.ranks.map((r) => ({ name: a.name, rank: r.rank, at: r.at }))) : []
    const logged = loggedRanks(events)
    const ranks: Partial<Record<ReincKey, LineRank>> = {}
    for (const k of REINC_KEYS) ranks[k] = rankOf(logged[k], kept.hand[k])
    return { events, ranks, from: view?.from ?? 0 }
  }

  private async state(ctx: AppContext, character: string): Promise<ReincState> {
    let kept = this.kept(character)
    const [{ events, ranks, from }, inv] = await Promise.all([this.ranks(ctx, character, kept), ctx.inventoryFiles.exported(character)])
    const seen = loggedReincarnations(events)
    // A plan the log has seen made is done: off the list.
    const { open, done } = openPlans(kept.plans, seen)
    if (done.length) this.keep(character, (kept = { ...kept, plans: open }))
    const record = ctx.store.settings.get().characters[character]
    const classes = Object.entries(record?.classLevels ?? {}).flatMap(([name, level]): { id: ClassId; level: number }[] => {
      const id = classIdOf(name)
      return id ? [{ id, level: level ?? 0 }] : []
    })
    return {
      character,
      ranks,
      completionist: completionistRank(ranks),
      plans: kept.plans,
      history: reincHistory(seen, kept.done),
      loadout: { race: record?.race ?? '', classes },
      tokens: inv ? { count: tokenCount(inv.inventory), modified: inv.modified } : null,
      logFrom: from
    }
  }
}
