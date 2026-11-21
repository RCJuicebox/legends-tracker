import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { newerBuildWrote } from '../../main/schema'
import type { ClassId } from '../../shared/game/classes'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps } from '../../main/appFeature'
import {
  REINC_CLASSES,
  REINC_KEYS,
  REINC_RACES,
  REINC_RANKS,
  classLevels,
  completionistRank,
  emptyReincCharacter,
  loggedRanks,
  loggedReincarnations,
  raceAtCap,
  rankOf,
  reincHistory,
  sanitizePriority,
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
// by hand, their priority list, which classes and races are at the level cap (a reincarnation sets
// them to level 1; the player says when a trio is levelled, with Levelled on the plan, or on Setup; /who
// is not read for it, 2026-11-21), and the Tokens of Reincarnation in the inventory export. What the player keeps is in
// reincarnation.json, by character; the page makes the plan from it.

/** A class id the page sent, or an error. */
function classOf(id: unknown): ClassId {
  const c = REINC_CLASSES.find((x) => x.id === id)
  if (!c) throw new Error('No such class.')
  return c.id
}

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
    // The priority list, in the player's order: the page sends the whole list each time.
    handle('reincarnation:priority', async (character, priority) => {
      const c = check(character)
      const ok = sanitizePriority(priority)
      if (!ok) throw new Error('Each line is a class or race and a rank from 1 to 3.')
      this.keep(c, { ...this.kept(c), priority: ok })
      return this.state(ctx, c)
    })
    // A class the player says is at the level cap (true) or below it (false), or null to forget what they said.
    handle('reincarnation:capped', async (character, id, capped) => {
      const c = check(character)
      const cls = classOf(id)
      const kept = this.kept(c)
      const { [cls]: _, ...levels } = kept.levels
      this.keep(c, { ...kept, levels: capped === null ? levels : { ...levels, [cls]: { capped, at: Date.now(), by: 'hand' } } })
      return this.state(ctx, c)
    })
    // The class every levelling trio keeps, or '' for none.
    handle('reincarnation:anchor', async (character, id) => {
      const c = check(character)
      this.keep(c, { ...this.kept(c), anchor: id === '' ? '' : classOf(id) })
      return this.state(ctx, c)
    })
    // A levelling trio the player says is done: its classes, and its race when it levelled too, are at the cap.
    handle('reincarnation:levelled', async (character, classes, race) => {
      const c = check(character)
      if (!Array.isArray(classes) || classes.length < 1 || classes.length > 3 || new Set(classes).size !== classes.length)
        throw new Error('A levelling trio is one to three different classes.')
      const trio = classes.map(classOf)
      if (race !== '' && !REINC_RACES.some((r) => r.race === race)) throw new Error('No such race.')
      const kept = this.kept(c)
      const at = Date.now()
      const levels = { ...kept.levels }
      for (const cls of trio) levels[cls] = { capped: true, at, by: 'hand' }
      this.keep(c, { ...kept, levels, races: race ? { ...kept.races, [race]: { capped: true, at } } : kept.races })
      return this.state(ctx, c)
    })
    // A reincarnation the player says they made, as this trio and race: a rank in each of its lines.
    handle('reincarnation:done', async (character, classes, race) => {
      const c = check(character)
      if (!Array.isArray(classes) || classes.length !== 3 || new Set(classes).size !== 3) throw new Error('A reincarnation is three different classes.')
      const trio = classes.map(classOf)
      if (race !== '' && !REINC_RACES.some((r) => r.race === race)) throw new Error('No such race.')
      const kept = this.kept(c)
      const { ranks } = await this.ranks(ctx, c, kept)
      const at = Date.now()
      const hand = { ...kept.hand }
      const keys: ReincKey[] = [...trio.map((x): ReincKey => `class:${x}`), ...(race ? [`race:${race}` as ReincKey] : [])]
      for (const k of keys) hand[k] = { rank: Math.min(REINC_RANKS, (ranks[k]?.rank ?? 0) + 1), at }
      this.keep(c, { ...kept, hand, done: [...kept.done, { at, classes: trio, race, by: 'hand' }] })
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
    const kept = this.kept(character)
    const [{ events, ranks, from }, inv] = await Promise.all([this.ranks(ctx, character, kept), ctx.inventoryFiles.exported(character)])
    const seen = loggedReincarnations(events)
    const record = ctx.store.settings.get().characters[character]
    const reincs = [...seen, ...kept.done]
    const history = reincHistory(seen, kept.done)
    const race = history[0]?.race || record?.race || ''
    return {
      character,
      ranks,
      completionist: completionistRank(ranks),
      priority: kept.priority,
      levels: classLevels(kept.levels, reincs),
      race: { name: race, capped: raceAtCap(race, kept.races, reincs) },
      anchor: kept.anchor,
      history,
      tokens: inv ? { count: tokenCount(inv.inventory), modified: inv.modified } : null,
      logFrom: from
    }
  }
}
