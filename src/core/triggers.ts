import type { LogLine } from './logLine'
import type { BoardTimer, TimerBoard } from './timers'
import type { FeedItem, Notification, Phrase, Trigger, TriggerTestResult, TriggerWhen } from '../shared/types'

// Snippets, GINA/Nag style: {C} your character, {S}/{S1}–{S9} any text, {N}/{N1}–{N9} a number,
// {L} the whole line, ${Name} a named capture.
const SNIPPET = /\{(C|L|S\d?|N\d?)\}|\$\{(\w+)\}/gi

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Plain phrases match anywhere in the line, case-insensitively. Regex phrases are JavaScript
 * regular expressions, also case-insensitive; snippets expand inside both. A snippet used twice
 * must capture the same text both times.
 */
export function compilePhrase(p: Phrase, character: string): RegExp {
  return compileWith(p, character, {})
}

/** As compilePhrase, but snippets named in `bound` match only that exact text instead of capturing. */
function compileWith(p: Phrase, character: string, bound: Record<string, string>): RegExp {
  const used = new Set<string>()
  let out = ''
  let last = 0
  const lit = (s: string) => (p.regex ? s : escapeRegex(s))
  for (const m of p.text.matchAll(SNIPPET)) {
    out += lit(p.text.slice(last, m.index))
    last = (m.index ?? 0) + m[0].length
    const token = (m[1] ?? '').toUpperCase()
    if (m[2]) out += group(m[2], '.+')
    else if (token === 'C') out += escapeRegex(character)
    else if (token === 'L') out += '.*'
    else if (token[0] === 'S') out += group(token, '.+')
    else if (token[0] === 'N') out += group(token, '-?\\d+')
  }
  out += lit(p.text.slice(last))
  return new RegExp(out, 'i')

  function group(name: string, body: string): string {
    if (bound[name] !== undefined) return escapeRegex(bound[name])
    if (used.has(name)) return `\\k<${name}>`
    used.add(name)
    return `(?<${name}>${body})`
  }
}

function renderTemplate(template: string, captures: Record<string, string>, character: string, line: string): string {
  return template.replace(SNIPPET, (_, token: string | undefined, named: string | undefined) => {
    if (named) return captures[named] ?? ''
    const t = (token ?? '').toUpperCase()
    if (t === 'C') return character
    if (t === 'L') return line
    return captures[t] ?? ''
  })
}

interface Compiled {
  trigger: Trigger
  patterns: RegExp[]
  /** Each pattern's leading literal text, lower-cased: a line without it cannot match (LT-746). '' for none. */
  guards: string[]
  lastFired: number
  /** The matches counted toward `when.count`, oldest first. */
  hits: number[]
}

/** A guard shorter than this would let nearly every line through: not worth the look. */
const GUARD_MIN = 3

/**
 * The literal text a phrase starts with, lower-cased (LT-746): every line it matches holds it, so a
 * cheap `includes` turns most lines away before the regular expression runs. A regex phrase's literal
 * start stops at its first special character; one that starts with a pattern has none.
 */
export function phraseGuard(p: Phrase): string {
  let text = p.text
  const snippet = text.search(SNIPPET_START)
  if (snippet >= 0) text = text.slice(0, snippet)
  if (p.regex) {
    const special = text.search(/[\\^$.*+?()[\]{}|]/)
    if (special >= 0) text = text.slice(0, special)
    // A quantifier binds to the character before it: that one is not certain to be there.
    if (special >= 0 && /[*?{]/.test(p.text[special])) text = text.slice(0, -1)
  }
  const g = text.toLowerCase()
  return g.trim().length >= GUARD_MIN ? g : ''
}

/** Where a snippet starts in a phrase's text. */
const SNIPPET_START = /\{(?:C|L|S\d?|N\d?)\}|\$\{\w+\}/i

/** What the conditions are read against: the zone the player is in and whether a fight is on (FEAT-030). */
export interface TriggerState {
  zone: string
  fighting: boolean
}

export interface TriggerHooks {
  notify: (n: Notification[], trigger: Trigger) => void
  feed: (kind: FeedItem['kind'], text: string) => void
  /** The zone and whether fighting, for a trigger's conditions; without it, conditions on them never hold. */
  state?: () => TriggerState
}

/** Whether a trigger's conditions hold for a match, before its count (FEAT-030). */
export function conditionsHold(when: TriggerWhen | undefined, captures: Record<string, string>, character: string, state: TriggerState | null): boolean {
  if (!when) return true
  if (when.zone !== undefined && !(state && state.zone.toLowerCase().includes(when.zone.toLowerCase()))) return false
  if (when.fighting !== undefined && (!state || state.fighting !== when.fighting)) return false
  if (when.characters?.length && !when.characters.some((c) => c.toLowerCase() === character.toLowerCase())) return false
  if (when.compare) {
    const raw = captures[when.compare.snippet]
    const n = raw === undefined ? NaN : Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(n)) return false
    const v = when.compare.value
    const ok = { '>': n > v, '>=': n >= v, '<': n < v, '<=': n <= v, '=': n === v }[when.compare.op]
    if (!ok) return false
  }
  return true
}

export class TriggerEngine {
  private compiled: Compiled[] = []
  private character = ''
  errors: { trigger: string; error: string }[] = []

  constructor(
    private readonly board: TimerBoard,
    private readonly hooks: TriggerHooks
  ) {}

  load(triggers: Trigger[], character: string): void {
    this.character = character
    this.errors = []
    const previous = new Map(this.compiled.map((c) => [c.trigger.id, c.lastFired]))
    this.compiled = []
    for (const trigger of triggers) {
      if (!trigger.enabled) continue
      try {
        const kept = trigger.phrases.filter((p) => p.text.trim())
        const patterns = kept.map((p) => compilePhrase(p, character))
        if (patterns.length) this.compiled.push({ trigger, patterns, guards: kept.map(phraseGuard), lastFired: previous.get(trigger.id) ?? 0, hits: [] })
      } catch (e) {
        this.errors.push({ trigger: trigger.name, error: (e as Error).message })
      }
    }
  }

  /** Whether a trigger's phrase matched the line (FEAT-025): the player's own triggers read it. */
  handle(line: LogLine): boolean {
    let matched = this.checkEndEarly(line.text)
    // Lower-cased once a line, and only when a guard wants it.
    let lower: string | null = null
    for (const c of this.compiled) {
      for (let i = 0; i < c.patterns.length; i++) {
        const guard = c.guards[i]
        if (guard && !(lower ??= line.text.toLowerCase()).includes(guard)) continue
        const m = c.patterns[i].exec(line.text)
        if (!m) continue
        matched = true
        const captures = { ...(m.groups ?? {}) }
        if (!conditionsHold(c.trigger.when, captures, this.character, this.hooks.state?.() ?? null)) break
        if (!this.counted(c, line.time)) break
        if (c.trigger.cooldownSec > 0 && line.time - c.lastFired < c.trigger.cooldownSec * 1000) break
        c.lastFired = line.time
        this.fire(c.trigger, captures, line)
        break
      }
    }
    return matched
  }

  /** A trigger with `when.count` fires on its n-th match within the window, then counts again from none (FEAT-030). */
  private counted(c: Compiled, at: number): boolean {
    const count = c.trigger.when?.count
    if (!count) return true
    c.hits = [...c.hits.filter((t) => at - t <= count.withinSec * 1000), at]
    if (c.hits.length < count.n) return false
    c.hits = []
    return true
  }

  private fire(trigger: Trigger, captures: Record<string, string>, line: LogLine): void {
    const r = (s: string) => renderTemplate(s, captures, this.character, line.text)
    const out: Notification[] = []
    for (const a of trigger.actions) {
      switch (a.type) {
        case 'speak':
          out.push({ kind: 'speak', text: r(a.text), interrupt: a.interrupt })
          break
        case 'sound':
          out.push({ kind: 'sound', file: a.file, volume: a.volume })
          break
        case 'text':
          out.push({ kind: 'text', text: r(a.text), color: a.color, durationSec: a.durationSec })
          break
        case 'timer': {
          const name = r(a.name) || trigger.name
          const key = `trigger:${trigger.id}|${name.toLowerCase()}`
          if (a.restart === 'ignore' && this.board.get(key)) break
          const timer: BoardTimer = {
            key,
            id: this.board.get(key)?.id ?? this.board.nextId(),
            label: name,
            // What the phrase caught, so a grouped overlay puts the bar under its mob (LT-745).
            target: (a.target !== undefined ? r(a.target) : (captures.Target ?? captures.S1 ?? captures.S ?? '')).trim(),
            source: 'trigger',
            color: a.color,
            overlay: a.overlay || 'targets',
            startedAt: line.time,
            endsAt: line.time + a.durationSec * 1000,
            exact: true,
            warnSec: a.warnSec,
            onWarn: a.warnSpeech ? [{ kind: 'speak', text: r(a.warnSpeech), interrupt: false }] : [],
            onExpire: a.endSpeech ? [{ kind: 'speak', text: r(a.endSpeech), interrupt: false }] : [],
            warned: false,
            graceMs: 0,
            meta: { endEarly: a.endEarly.filter((p) => p.text.trim()).map((p) => compileEndEarly(p, captures, this.character)) }
          }
          this.board.upsert(timer)
          break
        }
      }
    }
    this.hooks.feed('trigger', `${trigger.name}: ${line.text}`)
    if (out.length) this.hooks.notify(out, trigger)
  }

  private checkEndEarly(text: string): boolean {
    let ended = false
    for (const t of this.board.values()) {
      const phrases = t.meta?.endEarly as RegExp[] | undefined
      if (!phrases?.some((re) => re.test(text))) continue
      this.board.end(t.key, 'cleared')
      ended = true
    }
    return ended
  }
}

/**
 * End-early phrases are fixed to the values the starting line captured ({S1}, {N1} and ${Name}
 * alike), so they only end their own timer. A snippet the start did not capture still matches anything.
 */
function compileEndEarly(p: Phrase, captures: Record<string, string>, character: string): RegExp {
  return compileWith(p, character, captures)
}

export function testTrigger(trigger: Trigger, line: string, character: string): TriggerTestResult {
  const text = line.replace(/^\[[^\]]*\]\s*/, '')
  try {
    for (let i = 0; i < trigger.phrases.length; i++) {
      if (!trigger.phrases[i].text.trim()) continue
      const m = compilePhrase(trigger.phrases[i], character).exec(text)
      if (!m) continue
      const captures = { ...(m.groups ?? {}) }
      const outputs = trigger.actions.map((a) => {
        const r = (s: string) => renderTemplate(s, captures, character, text)
        switch (a.type) {
          case 'speak':
            return `Speak: "${r(a.text)}"`
          case 'sound':
            return `Play: ${a.file}`
          case 'text':
            return `Show: "${r(a.text)}"`
          case 'timer':
            return `Timer: "${r(a.name) || trigger.name}" for ${a.durationSec}s`
        }
      })
      return { matched: true, phraseIndex: i, captures, outputs, error: '' }
    }
    return { matched: false, phraseIndex: -1, captures: {}, outputs: [], error: '' }
  } catch (e) {
    return { matched: false, phraseIndex: -1, captures: {}, outputs: [], error: (e as Error).message }
  }
}
