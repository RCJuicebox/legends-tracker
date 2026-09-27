import { computeDuration } from '../../core/durations'
import { askText, BuffWatch, buffOffers, buffPlan, defaultWanted, LEVEL_CAP, YOU, type ActiveBuff, type BuffOffer, type BuffView, type Person } from '../../core/buffs'
import { CATEGORY_COLORS } from '../../core/spellTracker'
import { characterKey, characterName } from '../storeCore'
import { CLASS_NAMES, CLASS_NUMBER, type ClassId } from '../../shared/game/classes'
import type { Spell, SpellBook } from '../../core/spells'
import type { TimerBoard } from '../../core/timers'
import type { MyClass } from '../../core/spellMotes'
import type { EngineStore } from './contracts'
import type { Notifier } from './notifier'
import type { SpellQueries } from './spellQueries'

/** Warned this long before someone else's buff on you is due to fade: time to ask for it again. */
const BUFF_WARN_SEC = 60
/** An unchanged "ask for" is said again after this long, while it still holds. */
const BUFF_REMIND_MS = 10 * 60_000

export interface BuffHooks {
  book: () => SpellBook | null
  /** The group as the meter knows it, by name. */
  group: () => string[]
  fighting: () => boolean
  /** Fights are being read back from the log: what they show is history, so nothing is said. */
  readingHistory: () => boolean
  /** The log is being watched live (not pasted lines): reminders may be given. */
  live: () => boolean
  send: (view: BuffView) => void
}

/** Buffs on the character from others, who is who, and what to ask the group for. */
export class BuffCoordinator {
  readonly watch: BuffWatch
  private offers: BuffOffer[] = []
  private dirty = false
  private sentAt = 0
  /** The last "ask for" told, and when, so it is not said again every few seconds. */
  private lastAsk = { text: '', at: 0 }
  /** Groupmates the player has been told to /who, once each. */
  private readonly whoHinted = new Set<string>()
  /** Permanent self-only buffs already asked for this run. */
  private readonly selfSaid = new Set<string>()

  constructor(
    private readonly store: EngineStore,
    private readonly board: TimerBoard,
    private readonly queries: SpellQueries,
    private readonly notifier: Notifier,
    private readonly hooks: BuffHooks
  ) {
    this.watch = new BuffWatch([], {
      seconds: (spell, rank, caster) => this.buffSeconds(spell, rank, caster),
      onChange: () => this.changed(),
      onLand: (b) => this.landed(b),
      onFade: (b) => this.board.end(`buff:${b.spell}`, 'faded'),
      onWho: (p) => this.learnPerson(p)
    })
  }

  private get settings() {
    return this.store.settings.get()
  }

  private characterKey(): string {
    return characterKey(this.settings.logFile)
  }

  /** A new spell book: the buffs on offer are read from it. */
  setBook(book: SpellBook): void {
    this.offers = buffOffers(book, this.settings.tracking.tierDurationPct)
    this.watch.setBook(book, this.offers)
    this.dirty = true
  }

  /** Watching a character's log: their own buffs, the ones the last run saw on them, still running. */
  follow(key: string, now: number): void {
    this.watch.active = this.store.buffs.get().active[key] ?? []
    this.watch.prune(now)
    this.dirty = true
  }

  handle(text: string, time: number): void {
    const book = this.hooks.book()
    this.watch.handle(text, time, (name) => book?.resolve(name))
  }

  /** Settings changed: group buffs switched off take their timers off the overlay; switched on, the reminder shows again. */
  reconfigure(): void {
    if (!this.settings.tracking.groupBuffs) this.board.endWhere((t) => t.key.startsWith('buff:'), 'faded')
    else this.lastAsk = { text: '', at: 0 }
  }

  /** The group roster was changed by hand: the buff plan is built on it, so the page hears at once. */
  groupChanged(): void {
    this.dirty = true
    this.lastAsk = { text: '', at: 0 }
  }

  /** Prunes and reminds every five seconds; the page hears within a second of a change. */
  tick(now: number): void {
    if (now - this.sentAt <= 5000 && !(this.dirty && now - this.sentAt > 1000)) return
    this.sentAt = now
    this.watch.prune(now)
    this.remind(now)
    if (this.dirty) {
      this.dirty = false
      this.hooks.send(this.view())
    }
  }

  private get wanted(): string[] {
    return this.store.buffs.get().wanted[this.characterKey()] ?? defaultWanted(this.offers)
  }

  /** The group as /who last described each member. */
  private groupPeople(): { name: string; person: Person | null }[] {
    const people = this.store.buffs.get().people
    return this.hooks.group().map((name) => ({ name, person: people[name.toLowerCase()] ?? null }))
  }

  /** You: what /who last said, or failing that the classes and levels on the character sheet. */
  me(): Person | null {
    const name = characterName(this.settings.logFile)
    if (!name) return null
    const seen = this.store.buffs.get().people[name.toLowerCase()]
    if (seen) return seen
    const c = this.queries.character()
    // The sheet names classes the game's way (CLASS_NAMES, in class-number order); the tracker by id.
    const levels = (Object.entries(CLASS_NUMBER) as [ClassId, number][]).map(([id, n]) => [id, c.classLevels[CLASS_NAMES[n - 1]] ?? 0] as const).filter(([, l]) => l > 0)
    if (!levels.length) return null
    return { name, classes: levels.map(([id]) => id), level: Math.max(...levels.map(([, l]) => l)), race: '', at: 0 }
  }

  /**
   * The character's classes as the game names them, with the level each is at: the classes are what
   * /who last said (else the character sheet's), the level the sheet's for that class, else /who's,
   * never over the level cap.
   */
  myClasses(): MyClass[] {
    const me = this.me()
    if (!me) return []
    const sheet = this.queries.character().classLevels
    return me.classes.flatMap((id) => {
      const name = CLASS_NAMES[(CLASS_NUMBER[id as ClassId] ?? 0) - 1]
      return name ? [{ name, level: Math.min(LEVEL_CAP, sheet[name] || me.level || LEVEL_CAP) }] : []
    })
  }

  view(): BuffView {
    const group = this.groupPeople()
    const active = this.watch.active
    const wanted = this.wanted
    const me = this.me()
    const plan = buffPlan({ offers: this.offers, wanted, group: group.flatMap((g) => (g.person ? [g.person] : [])), active, me })
    return {
      offers: this.offers,
      wanted,
      defaults: !this.store.buffs.get().wanted[this.characterKey()],
      group,
      me,
      active,
      needs: plan.needs,
      plan,
      planAnyone: buffPlan({ offers: this.offers, wanted, group: 'anyone', active, me }),
      spellsLoaded: !!this.hooks.book()
    }
  }

  /** The buffs the character wants; null goes back to the defaults. */
  setWanted(list: string[] | null): BuffView {
    const f = this.store.buffs.get()
    const key = this.characterKey()
    const wanted = { ...f.wanted }
    // The order is the priority: kept as given.
    if (list) wanted[key] = [...new Set(list)]
    else delete wanted[key]
    this.store.buffs.set({ ...f, wanted })
    this.lastAsk = { text: '', at: 0 }
    this.dirty = true
    return this.view()
  }

  /** How long a buff lasts from this caster: yours with your focus, anyone else's at their /who level, unfocused. */
  private buffSeconds(spell: Spell, rank: number, caster: string): number | null {
    if (caster === 'You') {
      const d = this.queries.durationFor(spell, rank)
      return d.permanent ? null : d.seconds
    }
    const level = this.store.buffs.get().people[caster.toLowerCase()]?.level ?? 50
    const d = computeDuration({ spell, rank, level, tierPct: this.settings.tracking.tierDurationPct, focusPct: 0 })
    return d.permanent ? null : d.seconds
  }

  private changed(): void {
    const f = this.store.buffs.get()
    const key = this.characterKey()
    if (key) this.store.buffs.set({ ...f, active: { ...f.active, [key]: this.watch.active } })
    this.dirty = true
  }

  private learnPerson(p: Person): void {
    const f = this.store.buffs.get()
    const k = p.name.toLowerCase()
    if (f.people[k] && f.people[k].at >= p.at) return
    this.store.buffs.set({ ...f, people: { ...f.people, [k]: p } })
    this.dirty = true
  }

  /** Someone else's buff on you: a timer on the buffs overlay, with a word before it fades. Only when group buffs are turned on. */
  private landed(b: ActiveBuff): void {
    if (b.caster === 'You' || b.endsAt === null || !this.settings.tracking.groupBuffs) return
    const inGroup = this.hooks.group().some((n) => n.toLowerCase() === b.caster.toLowerCase())
    this.board.upsert({
      key: `buff:${b.spell}`,
      id: this.board.get(`buff:${b.spell}`)?.id ?? this.board.nextId(),
      spell: b.spell,
      label: b.ranked,
      target: 'You',
      source: 'spell',
      category: 'buff',
      icon: this.hooks.book()?.named(b.ranked)?.icon,
      color: CATEGORY_COLORS.buff,
      overlay: 'buffs',
      startedAt: b.landedAt,
      endsAt: b.endsAt,
      exact: false,
      warnSec: BUFF_WARN_SEC,
      onWarn: this.hooks.readingHistory() ? [] : [{ kind: 'speak', text: `${b.spell} is fading${inGroup ? `, ask ${b.caster}` : ''}`, interrupt: false }],
      onExpire: [],
      warned: false,
      graceMs: 12_000
    })
  }

  /**
   * Shows what to ask the group for, when it changes and again every so often, but never mid-fight.
   * On screen only, no speech, and only while group buffs are turned on; the Buffs page always lists it.
   */
  private remind(now: number): void {
    if (this.hooks.readingHistory() || !this.hooks.live() || !this.settings.tracking.groupBuffs) return
    const group = this.groupPeople()
    for (const g of group) {
      if (g.person || this.whoHinted.has(g.name.toLowerCase())) continue
      this.whoHinted.add(g.name.toLowerCase())
      this.notifier.pushFeed('info', `Type /who ${g.name} so the buff tracker knows the classes ${g.name} plays.`)
    }
    // A permanent self-only buff (Rage, Shielding) is said once a run: it may well be on from before the
    // tracker was watching, and then it never shows as on. The plan still lists it.
    const permanent = (spell: string) => this.offers.find((o) => o.spell === spell)?.seconds === Infinity
    const needs = this.view().needs.filter((n) => !(n.from === YOU && permanent(n.spell) && this.selfSaid.has(n.spell)))
    const text = needs.length ? askText(needs) : ''
    if (!text) {
      this.lastAsk = { text: '', at: 0 }
      return
    }
    if (this.hooks.fighting()) return
    if (text === this.lastAsk.text && now - this.lastAsk.at < BUFF_REMIND_MS) return
    this.lastAsk = { text, at: now }
    for (const n of needs) if (n.from === YOU && permanent(n.spell)) this.selfSaid.add(n.spell)
    this.notifier.pushFeed('info', `Buffs: ${text}.`)
    this.notifier.notify([{ kind: 'text', text, color: CATEGORY_COLORS.buff, durationSec: 6 }])
  }
}
