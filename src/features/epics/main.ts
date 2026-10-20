import { join } from 'node:path'
import { isCharacterKey } from '../../core/validate'
import { itemKey } from '../../core/inventory'
import { lastLooted, loggedCounts } from '../../core/itemTally'
import { parseLootLine } from '../../core/loot'
import { SELF } from '../../core/combatLines'
import { zoneEntered, type LogLine } from '../../core/logLine'
import { zoneKey } from '../../core/zones'
import type { AchievementTrack } from '../../shared/tracking'
import { handle } from '../../main/ipc/handle'
import { JsonFile, readJsonFile } from '../../main/storeCore'
import { everyStretch, type HistoryConsumer, type LogHistory } from '../../main/sources/logHistory'
import { newerBuildWrote } from '../../main/schema'
import { log } from '../../main/log'
import type { AppContext } from '../../main/context'
import type { AppFeature, FeatureDeps, TrackContext } from '../../main/appFeature'
import {
  emptyEpicCharacter,
  emptyEpicTally,
  exportCounts,
  isEpicItem,
  isTick,
  joinEpicTallies,
  readEpicLine,
  sanitizeEpicCharacter,
  type EpicCharacter,
  type EpicList,
  type EpicState,
  type EpicTally
} from './core'
import { beforeCopy, dropsOf, killCue, lootCue, slainMob, wantedBy } from './cue'
import { hereCue, wantedHere } from './here'

// Goals › Epics' side of the app (an optional module): the epic pieces counted over each character's
// logs (a LogHistory consumer), the inventory export as the game last wrote it, and what the player
// keeps per character in epics.json: the steps ticked off and their corrections to the counts. The
// consumer counts whether the module is on or not, so turning it on finds the counts ready. Goals ›
// Spell Quests, a module of its own, reads and ticks through the same channels. While a module is on,
// a piece the character loots, or a named that drops one dying, is said on the Live page's feed and the
// alert overlay when a list of its kind on the character's classes still wants it (cue.ts). The pieces
// still wanted from the zone the player is in are the achievements overlay's "Wanted here" section
// (its own switch, Settings › Overlays), and are said on zoning in unless the player turned that off
// (here.ts; kept in epics.json as zoneAlert: false).

/** Each stretch of log's epic and spell-quest pieces, as a LogHistory consumer (2: the spell quests' pieces counted too). */
const epicConsumer: HistoryConsumer<EpicTally> = {
  version: 2,
  empty: emptyEpicTally,
  reader: () => readEpicLine
}

const EPIC_KEY = 'epicItems'

/** The module each kind of list is, by its page id: Goals › Epics and Goals › Spell Quests. */
const MODULE_KINDS: readonly (readonly [string, EpicList['kind']])[] = [
  ['epics', 'epic'],
  ['spellquests', 'spell']
]

/** The cue's colour on the alert overlay, and how long it shows. */
const CUE_COLOR = '#f7c965'
const CUE_SEC = 8
/** Zoning back into a zone said lately says it again only after this long. */
const HERE_AGAIN_MS = 10 * 60_000
/** "Wanted here" is worked out again at least this often while shown: an inventory export the log did not see. */
const HERE_STALE_MS = 60_000

type EpicsFile = { characters: Record<string, EpicCharacter>; zoneAlert?: false }
type HereRows = NonNullable<AchievementTrack['epics']>['rows']

export class EpicTracker implements AppFeature {
  readonly id = 'epics'
  static readonly consumers: Readonly<Record<string, HistoryConsumer<unknown>>> = { [EPIC_KEY]: epicConsumer }
  /** By character key. */
  private readonly file: JsonFile<EpicsFile>
  /** The drop cues in hand, one after another as their lines came. */
  private cued: Promise<void> = Promise.resolve()
  private ctx: AppContext | null = null
  /** "Wanted here" as last worked out, by character, zone, kinds and counts; `asked` while one is being worked out. */
  private here: { key: string; at: number; view: AchievementTrack['epics'] } | null = null
  private asked = ''
  /** Bumped by what moves a count (a piece looted, a tick, a correction): "Wanted here" is worked out again. */
  private moved = 0
  /** The zone last said on zoning in, and when. */
  private said: { zone: string; at: number } | null = null
  /** Told when "Wanted here" has changed (LiveAchievements publishes the track again). */
  onChange: (() => void) | null = null

  /** Built as every feature module is (src/features/main.ts). */
  static create(d: FeatureDeps): EpicTracker {
    return new EpicTracker(d.logHistory, d.dir)
  }

  constructor(
    private readonly history: LogHistory,
    dir: string
  ) {
    const path = join(dir, 'epics.json')
    const read = readJsonFile(path)
    const v = (read.state === 'ok' && read.value && typeof read.value === 'object' ? read.value : {}) as { characters?: unknown; zoneAlert?: unknown }
    const characters: Record<string, EpicCharacter> = {}
    if (v.characters && typeof v.characters === 'object') for (const [k, c] of Object.entries(v.characters)) if (isCharacterKey(k)) characters[k] = sanitizeEpicCharacter(c)
    this.file = new JsonFile<EpicsFile>(path, { characters, ...(v.zoneAlert === false ? { zoneAlert: false as const } : {}) }, { delayMs: 1000, backup: true })
    if (read.state === 'unreadable') this.file.freeze('could not be read at start')
    if (newerBuildWrote(path)) this.file.freeze('written by a newer version')
  }

  flush(): Promise<void> {
    return this.file.flush()
  }

  private kept(character: string): EpicCharacter {
    return this.file.get().characters[character] ?? emptyEpicCharacter()
  }

  private keep(character: string, next: EpicCharacter): void {
    this.file.set({ ...this.file.get(), characters: { ...this.file.get().characters, [character]: next } })
    this.countsMoved()
  }

  /** Whether the pieces wanted in a zone are said on zoning in (on unless turned off). */
  get zoneAlert(): boolean {
    return this.file.get().zoneAlert !== false
  }

  register(ctx: AppContext): void {
    this.ctx = ctx
    const check = (character: unknown): string => {
      if (!isCharacterKey(character)) throw new Error('No such character.')
      return character
    }
    handle('epics:state', async (character) => this.state(ctx, check(character)))
    // A step ticked off by hand (handed in, made, or had before the log began), or not.
    handle('epics:tick', async (character, key, on) => {
      const c = check(character)
      if (!isTick(key)) throw new Error('No such step.')
      const kept = this.kept(c)
      this.keep(c, { ...kept, ticks: kept.ticks.filter((k) => k !== key).concat(on ? [key] : []) })
      return this.state(ctx, c)
    })
    // What the player says they hold of an item: kept as the difference from the log's count.
    handle('epics:have', async (character, item, have) => {
      const c = check(character)
      if (!isEpicItem(item)) throw new Error('Not an item an epic takes.')
      if (!Number.isInteger(have) || have < 0 || have > 9999) throw new Error('Hold 0 to 9999.')
      const k = itemKey(item)
      const logged = loggedCounts(await this.tally(ctx, c))[k] ?? 0
      const kept = this.kept(c)
      const { [k]: _, ...adjust } = kept.adjust
      this.keep(c, { ...kept, adjust: have === logged ? adjust : { ...adjust, [k]: have - logged } })
      return this.state(ctx, c)
    })
    // Whether the pieces wanted in a zone are said on zoning in; asked with nothing, it says.
    handle('epics:zoneAlert', async (on) => {
      if (on !== undefined) {
        const { zoneAlert: _was, ...rest } = this.file.get()
        this.file.set(on ? rest : { ...rest, zoneAlert: false })
      }
      return this.zoneAlert
    })
    ctx.engine.use({ id: 'epics', line: (line) => this.line(ctx, line) })
  }

  /** The kinds of list whose module is on: Epics and Spell Quests are a module each. */
  private kinds(ctx: AppContext): EpicList['kind'][] {
    const modules = ctx.store.settings.get().modules
    return MODULE_KINDS.filter(([id]) => modules[id] === true).map(([, kind]) => kind)
  }

  /** A count moved: "Wanted here" is worked out again, and the overlay told. */
  private countsMoved(): void {
    this.moved++
    this.onChange?.()
  }

  /** The achievements overlay's "Wanted here": as last worked out, worked out again when the zone, the counts or the modules moved. */
  track(at: TrackContext): Partial<Pick<AchievementTrack, 'epics'>> {
    const ctx = this.ctx
    const kinds = ctx ? this.kinds(ctx) : []
    if (!ctx || !kinds.length || !at.character || !at.zone) return { epics: null }
    const key = this.hereKey(at.character, at.zone, kinds)
    const here = this.here
    const fresh = here?.key === key && Date.now() - here.at < HERE_STALE_MS
    if (!fresh && this.asked !== key) {
      this.asked = key
      void this.wantedIn(ctx, at.character, at.zone, kinds)
        .then(() => this.onChange?.())
        .catch((e: unknown) => log.warn('Epics: what is wanted here could not be worked out:', e))
        .finally(() => {
          if (this.asked === key) this.asked = ''
        })
    }
    // A stale view of the same place shows until the new one is in.
    return { epics: here?.key.startsWith(`${at.character}|${zoneKey(at.zone)}|`) ? here.view : null }
  }

  private hereKey(character: string, zone: string, kinds: readonly EpicList['kind'][]): string {
    return `${character}|${zoneKey(zone)}|${kinds.join(',')}|${this.moved}`
  }

  /** Works out what the character's lists still want from a zone, and keeps it for the overlay. */
  private async wantedIn(ctx: AppContext, character: string, zone: string, kinds: readonly EpicList['kind'][]): Promise<HereRows> {
    const key = this.hereKey(character, zone, kinds)
    const rows = wantedHere(await this.state(ctx, character), zone, kinds)
    this.here = { key, at: Date.now(), view: rows.length ? { zone, rows } : null }
    return rows
  }

  /** A zone entered: what is wanted there is worked out at once, and said unless the player turned that off or it was said lately. */
  private entered(ctx: AppContext, zone: string, kinds: readonly EpicList['kind'][], time: number): void {
    this.cue(ctx, async (character) => {
      const rows = await this.wantedIn(ctx, character, zone, kinds)
      this.onChange?.()
      if (!this.zoneAlert) return null
      const said = this.said
      if (said && said.zone === zoneKey(zone) && time - said.at < HERE_AGAIN_MS) return null
      const text = hereCue(rows)
      if (text) this.said = { zone: zoneKey(zone), at: time }
      return text
    })
  }

  /** A line of the followed log: a piece looted, or a named that drops pieces slain, is looked into while the module is on. */
  private line(ctx: AppContext, line: LogLine): boolean {
    // Epics and Spell Quests are a module each: a kind cues while its own is on.
    const kinds = this.kinds(ctx)
    if (!kinds.length) return false
    const text = line.text
    const zone = zoneEntered(text)
    if (zone) {
      this.entered(ctx, zone, kinds, line.time)
      return true
    }
    if (text.startsWith('--You have looted ') || text.startsWith('You looted ')) {
      const e = parseLootLine(text)
      // Sold as it dropped, or looted into a merge: never held as itself.
      if (e?.kind !== 'loot' || e.looter !== SELF || e.outcome === 'sold' || e.outcome === 'merged' || !isEpicItem(e.item)) return false
      this.cue(ctx, async (character) => {
        const s = beforeCopy(await this.state(ctx, character), e.item, e.count, line.time)
        return lootCue(e.item, wantedBy(s, e.item, kinds))
      })
      // The piece in hand may be the last one the zone wanted.
      this.cued = this.cued.then(() => this.countsMoved())
      return true
    }
    const mob = slainMob(text)
    const items = mob ? dropsOf(mob) : []
    if (!mob || !items.length) return false
    this.cue(ctx, async (character) => {
      const s = await this.state(ctx, character)
      return killCue(
        mob,
        items.map((item) => ({ item, wanted: wantedBy(s, item, kinds) }))
      )
    })
    return true
  }

  /** Says a cue for the character being played, if there is one, on the Live page's feed and the alert overlay. */
  private cue(ctx: AppContext, make: (character: string) => Promise<string | null>): void {
    const character = ctx.characterKey()
    if (!isCharacterKey(character)) return
    this.cued = this.cued
      .then(() => make(character))
      .then((text) => {
        if (!text) return
        ctx.engine.pushFeed('loot', text)
        ctx.engine.notify([{ kind: 'text', text, color: CUE_COLOR, durationSec: CUE_SEC }])
      })
      .catch((e: unknown) => log.warn('Epics: the drop cue failed:', e))
  }

  /**
   * Waits for the drop cues in hand (the tests).
   * @public
   */
  cuesSaid(): Promise<void> {
    return this.cued
  }

  private async tally(ctx: AppContext, character: string): Promise<EpicTally> {
    return joinEpicTallies(everyStretch(await this.history.get<EpicTally>(EPIC_KEY, ctx.historyOf(character))))
  }

  private async state(ctx: AppContext, character: string): Promise<EpicState> {
    const [t, inv] = await Promise.all([this.tally(ctx, character), ctx.inventoryFiles.exported(character)])
    const record = ctx.store.settings.get().characters[character]
    return {
      character,
      ...this.kept(character),
      logged: loggedCounts(t),
      last: lastLooted(t),
      classes: Object.keys(record?.classLevels ?? {}),
      exported: inv ? { file: inv.file, modified: inv.modified, counts: exportCounts(inv.inventory) } : null
    }
  }
}
