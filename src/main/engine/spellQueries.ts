import { summarize, type Spell, type SpellBook } from '../../core/spells'
import { casterLevel, computeDuration } from '../../core/durations'
import { focusFor } from '../../core/focus'
import { checkAgainstLog } from '../../core/logCheck'
import type { CharacterSettings, KnownSpell, LogCheckRow, SpellRule } from '../../shared/types'
import type { EngineStore } from './contracts'
import { jobs, type Job } from '../sources/jobs'

/** Spell durations for the character being played, and the Spell Timers page's questions. */
export class SpellQueries {
  constructor(
    private readonly store: EngineStore,
    private readonly book: () => SpellBook | null
  ) {}

  character(): CharacterSettings {
    return this.store.characterOf(this.store.settings.get().logFile)
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
      tierPct: this.store.settings.get().tracking.tierDurationPct,
      focusPct: focus.pct + extra,
      focusSteps: extra ? [...focus.steps, `Extra focus set on this spell: +${extra}%`] : focus.steps,
      overrideSec: rule.durationOverrideSec
    })
  }

  /** Spells the character has cast, or has settings for, newest first, each with its duration worked out. */
  knownSpells(): KnownSpell[] {
    const book = this.book()
    if (!book) return []
    const casts = this.store.casts.get()
    const rules = this.store.rules.get()
    const byBase = new Map<string, { rankedName: string; lastCast: number }>()
    for (const c of Object.values(casts)) {
      const r = book.resolve(c.rankedName)
      if (!r) continue
      const prev = byBase.get(r.spell.name)
      if (!prev || c.lastCast > prev.lastCast) byBase.set(r.spell.name, c)
    }
    for (const name of Object.keys(rules)) if (!byBase.has(name)) byBase.set(name, { rankedName: name, lastCast: 0 })
    const out: KnownSpell[] = []
    for (const { rankedName, lastCast } of byBase.values()) {
      const r = book.resolve(rankedName)
      if (!r) continue
      const d = this.durationFor(r.spell, r.rank)
      if (d.ticks === 0) continue
      out.push({ ...summarize(r.spell), rank: r.rank, rankedName, lastCast, duration: d, rule: rules[r.spell.name] ?? {} })
    }
    return out.sort((a, b) => b.lastCast - a.lastCast)
  }

  /** The calculated durations against what the log saw, over its last `megabytes`. */
  checkLog(megabytes: number): Promise<LogCheckRow[]> {
    return jobs.run('checkLog', `Checking durations against the last ${megabytes} MB of the log`, (job) => this.check(megabytes, job))
  }

  private async check(megabytes: number, job: Job): Promise<LogCheckRow[]> {
    const book = this.book()
    const settings = this.store.settings.get()
    if (!book || !settings.logFile) return []
    const c = this.character()
    return checkAgainstLog({
      logPath: settings.logFile,
      book,
      megabytes,
      signal: job.signal,
      onProgress: (f) => job.progress(f),
      level: (name) => casterLevel(book.named(name)!, c),
      focusPct: (spell) => focusFor(spell, c, casterLevel(spell, c)).pct + (this.ruleFor(spell.name).extraFocusPct ?? 0),
      tierPct: settings.tracking.tierDurationPct
    })
  }
}
