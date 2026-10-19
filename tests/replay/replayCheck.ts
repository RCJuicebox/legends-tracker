import { CombatMeter } from '../../src/core/combatMeter'
import { looksLikeCombat, parseCombatLine } from '../../src/core/combatLines'
import { computeDuration, casterLevel } from '../../src/core/durations'
import { focusFor } from '../../src/core/focus'
import { parseLootLine } from '../../src/core/loot'
import { zoneEntered, type LogLine } from '../../src/core/logLine'
import { CAST_BY_OTHER, CAST_BY_YOU, COMPLETED_ACHIEVEMENT } from '../../src/core/phrases'
import { RespawnLog } from '../../src/core/respawns'
import { BuffWatch, buffOffers } from '../../src/core/buffs'
import { SpellTracker, timerKey } from '../../src/core/spellTracker'
import { TimerBoard, type BoardTimer } from '../../src/core/timers'
import type { RankedSpell, SpellBook } from '../../src/core/spells'
import type { CharacterSettings, SpellRule, TrackingSettings } from '../../src/shared/types'
import { CHAT, shapeOf, type Shape } from '../../src/core/unreadLines'
import { skillUp } from '../../src/core/skillAchievements'

// The replay check (FEAT-019): the player's own log through the parts the app runs live, the
// SpellTracker, BuffWatch, the damage meter and the respawn log, reporting where they and the game
// disagree: a spell's fades against its estimate, timers that ran out with no fade line, fade lines
// with no timer, combat lines nothing parsed, and the shapes of the lines no part takes, names and
// numbers stripped. Every accuracy row of the 10-12 review came out of such a replay done by hand.

export interface ReplayReport {
  lines: number
  from: number
  to: number
  /** Each spell faded at least twice: the median seconds from landing to fade, and the estimate. */
  fades: { spell: string; n: number; median: number; estimate: number; off: number }[]
  /** Timers that ran out with no fade line in the log: an estimate too short, or a fade the log never printed. */
  expired: { spell: string; n: number }[]
  /** Fade lines of yours with no timer on: a landing the tracker missed. */
  fadesNoTimer: { spell: string; n: number }[]
  /** Lines that look like combat that the combat parser did not take. */
  combatUnparsed: Shape[]
  /** Lines no part takes, by shape: what the app does not read yet. */
  unread: Shape[]
  chat: number
  meter: { fights: number; mostEntities: number }
  respawns: { mobs: number; timed: number }
  buffs: { landed: number }
}

const FADE = /^Your (.+?) spell has worn off of (.+)\.$/
const SHAPES_KEPT = 60

class Shapes {
  private readonly by = new Map<string, Shape>()
  add(text: string): void {
    const shape = shapeOf(text)
    const had = this.by.get(shape)
    if (had) had.n++
    else this.by.set(shape, { shape, n: 1, example: text.slice(0, 160) })
  }
  top(): Shape[] {
    return [...this.by.values()].sort((a, b) => b.n - a.n).slice(0, SHAPES_KEPT)
  }
}

export class ReplayCheck {
  private readonly board: TimerBoard
  private readonly tracker: SpellTracker
  private readonly meter = new CombatMeter({ fightGapSec: 30, newSessionOnZone: false, charmPets: true })
  private readonly respawns = new RespawnLog({}, { onChange: () => {}, kindOf: (n) => this.meter.kindOf(n).kind })
  private readonly buffs: BuffWatch
  private readonly observed = new Map<string, number[]>()
  /** The newest rank of each buff cast so far: what Quick Buff can land, as casts.json gives the engine. */
  private readonly casted = new Map<string, RankedSpell>()
  private readonly expiredBy = new Map<string, number>()
  private readonly fadeNoTimer = new Map<string, number>()
  private readonly combat = new Shapes()
  private readonly unread = new Shapes()
  private landed = 0
  private now = 0
  private ticked = -1
  private zone = ''
  private lines = 0
  private chat = 0
  private from = 0
  private fights = 0
  private mostEntities = 0

  constructor(
    private readonly book: SpellBook,
    private readonly o: { character: CharacterSettings; self: string; rules: Record<string, SpellRule>; tracking: TrackingSettings }
  ) {
    this.board = new TimerBoard({
      onChange: () => {},
      onNotify: () => {},
      onEnd: (t: BoardTimer, reason) => {
        const name = String(t.meta?.rankedName ?? t.label)
        if (reason === 'faded' && !t.meta?.joined) this.observed.set(name, [...(this.observed.get(name) ?? []), (this.now - t.startedAt) / 1000])
        if (reason === 'expired') this.expiredBy.set(name, (this.expiredBy.get(name) ?? 0) + 1)
        if (process.env['LT_TRACE'] && name.includes(process.env['LT_TRACE']))
          process.stdout.write(
            `${reason} ${t.target} ${new Date(t.startedAt).toTimeString().slice(0, 8)}→${new Date(this.now).toTimeString().slice(0, 8)} ${new Date(t.startedAt).toDateString()}\n`
          )
      }
    })
    const tracking = { ...o.tracking, enabled: true, selfBuffs: true, otherBuffs: true, groupBuffs: true, dots: true, debuffs: true }
    this.tracker = new SpellTracker(
      book,
      this.board,
      { tracking, ruleFor: (n) => o.rules[n] ?? {}, durationFor: (spell, rank) => this.duration(spell, rank) },
      {
        notify: () => {},
        feed: () => {},
        // As the engine wires it: the meter says who is a pet, and Quick Buff lands the buffs cast so far.
        onCast: (r) => {
          if (r.spell.beneficial && (r.spell.landSelf || r.spell.landOther)) this.casted.set(r.spell.name, r)
        },
        isPet: (name) => this.meter.kindOf(name).kind === 'pet',
        isYourPet: (name) => this.meter.isYourPet(name),
        quickBuffs: () => [...this.casted.values()]
      }
    )
    this.meter.setSelf(o.self)
    this.buffs = new BuffWatch([], { seconds: (spell, rank) => this.duration(spell, rank).seconds, onChange: () => {}, onLand: () => void this.landed++ })
    this.buffs.setBook(book, buffOffers(book, o.tracking.tierDurationPct))
  }

  private duration(spell: Parameters<typeof computeDuration>[0]['spell'], rank: number) {
    const level = casterLevel(spell, this.o.character)
    const focus = focusFor(spell, this.o.character, level)
    return computeDuration({ spell, rank, level, tierPct: this.o.tracking.tierDurationPct, focusPct: focus.pct + (this.o.rules[spell.name]?.extraFocusPct ?? 0) })
  }

  line(line: LogLine): void {
    const { text, time } = line
    this.lines++
    this.from ||= time
    this.now = time
    const zone = zoneEntered(text)
    if (zone) this.zone = zone
    const fade = text.startsWith('Your ') ? FADE.exec(text) : null
    if (fade) {
      const r = this.book.resolve(fade[1])
      if (r && !this.board.get(timerKey(r.spell.name, fade[2])) && !this.board.get(timerKey(r.spell.name, 'You')))
        this.fadeNoTimer.set(r.spell.name, (this.fadeNoTimer.get(r.spell.name) ?? 0) + 1)
    }
    const timersBefore = this.board.list().length
    const tracked = this.tracker.handle(line)
    const wasFighting = this.meter.fighting
    // Experience and ability points, as the live combat feed reads them before the meter (LT-720).
    const progress = this.meter.progress(line)
    const ev = progress ? null : this.meter.handle(line)
    if (this.meter.fighting && !wasFighting) this.fights++
    const live = this.meter.liveFight
    if (live) this.mostEntities = Math.max(this.mostEntities, Object.keys(live.entities).length)
    this.respawns.handle(line, this.zone, ev)
    this.buffs.handle(text, time, (n) => this.book.resolve(n))
    if (time !== this.ticked) {
      this.board.tick((this.ticked = time))
      this.meter.tick(time)
    }
    // What took the line: the tracker (a timer started, moved or ended), the meter, the loot, a cast or a zone.
    const took =
      tracked ||
      progress ||
      skillUp(text) ||
      ev ||
      zone ||
      this.board.list().length !== timersBefore ||
      fade ||
      parseLootLine(text) ||
      CAST_BY_YOU.test(text) ||
      CAST_BY_OTHER.test(text) ||
      COMPLETED_ACHIEVEMENT.test(text)
    if (took) return
    if (CHAT.test(text)) {
      this.chat++
      return
    }
    if (looksLikeCombat(text) && !parseCombatLine(text)) this.combat.add(text)
    else this.unread.add(text)
  }

  report(): ReplayReport {
    const fades = [...this.observed].flatMap(([name, samples]) => {
      const r = this.book.resolve(name)
      if (!r || samples.length < 2) return []
      const sorted = [...samples].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const d = this.duration(r.spell, r.rank)
      return [{ spell: name, n: samples.length, median, estimate: d.seconds, off: Math.round(median - d.seconds) }]
    })
    const counts = (m: Map<string, number>) => [...m].map(([spell, n]) => ({ spell, n })).sort((a, b) => b.n - a.n)
    return {
      lines: this.lines,
      from: this.from,
      to: this.now,
      fades: fades.sort((a, b) => Math.abs(b.off) - Math.abs(a.off)),
      expired: counts(this.expiredBy),
      fadesNoTimer: counts(this.fadeNoTimer),
      combatUnparsed: this.combat.top(),
      unread: this.unread.top(),
      chat: this.chat,
      meter: { fights: this.fights, mostEntities: this.mostEntities },
      respawns: { mobs: Object.keys(this.respawns.records).length, timed: Object.values(this.respawns.records).filter((r) => r.gaps.length > 0).length },
      buffs: { landed: this.landed }
    }
  }
}

/** The report as a person reads it. */
export function reportText(r: ReplayReport, logName: string): string {
  const when = (t: number) => new Date(t).toLocaleString()
  const table = (rows: string[][]) => rows.map((x) => `| ${x.join(' | ')} |`).join('\n')
  const shapes = (list: Shape[]) =>
    list.length ? table([['Lines', 'Shape', 'Example'], ['---', '---', '---'], ...list.map((s) => [String(s.n), `\`${s.shape}\``, s.example.replace(/\|/g, '/')])]) : 'None.'
  return [
    `# Replay check: ${logName}`,
    '',
    `${r.lines.toLocaleString()} lines, ${when(r.from)} to ${when(r.to)}; ${r.chat.toLocaleString()} of them chat. ${r.meter.fights} fights, at most ${r.meter.mostEntities} in one; ${r.respawns.mobs} mobs seen, ${r.respawns.timed} with a respawn timed; ${r.buffs.landed} buff landings.`,
    '',
    '## Fades against the estimate (seconds, most off first)',
    '',
    r.fades.length
      ? table([
          ['Spell', 'Fades', 'Median', 'Estimate', 'Off'],
          ['---', '---', '---', '---', '---'],
          ...r.fades.map((f) => [f.spell, String(f.n), f.median.toFixed(0), f.estimate.toFixed(0), String(f.off)])
        ])
      : 'None.',
    '',
    '## Timers that ran out with no fade line',
    '',
    r.expired.length ? table([['Spell', 'Times'], ['---', '---'], ...r.expired.map((x) => [x.spell, String(x.n)])]) : 'None.',
    '',
    '## Fade lines with no timer on (a landing missed)',
    '',
    r.fadesNoTimer.length ? table([['Spell', 'Times'], ['---', '---'], ...r.fadesNoTimer.map((x) => [x.spell, String(x.n)])]) : 'None.',
    '',
    '## Combat lines the parser did not take',
    '',
    shapes(r.combatUnparsed),
    '',
    '## Lines no part takes',
    '',
    shapes(r.unread),
    ''
  ].join('\n')
}
