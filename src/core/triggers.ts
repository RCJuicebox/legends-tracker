import type { LogLine } from './logLine'
import type { BoardTimer, TimerBoard } from './timers'
import type { FeedItem, Notification, Phrase, Trigger, TriggerTestResult } from '../shared/types'

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

export function renderTemplate(template: string, captures: Record<string, string>, character: string, line: string): string {
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
  lastFired: number
}

export interface TriggerHooks {
  notify: (n: Notification[], trigger: Trigger) => void
  feed: (kind: FeedItem['kind'], text: string) => void
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
        const patterns = trigger.phrases.filter((p) => p.text.trim()).map((p) => compilePhrase(p, character))
        if (patterns.length) this.compiled.push({ trigger, patterns, lastFired: previous.get(trigger.id) ?? 0 })
      } catch (e) {
        this.errors.push({ trigger: trigger.name, error: (e as Error).message })
      }
    }
  }

  handle(line: LogLine): void {
    this.checkEndEarly(line.text)
    for (const c of this.compiled) {
      for (const re of c.patterns) {
        const m = re.exec(line.text)
        if (!m) continue
        if (c.trigger.cooldownSec > 0 && line.time - c.lastFired < c.trigger.cooldownSec * 1000) break
        c.lastFired = line.time
        this.fire(c.trigger, { ...(m.groups ?? {}) }, line)
        break
      }
    }
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
            target: '',
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

  private checkEndEarly(text: string): void {
    for (const t of this.board.values()) {
      const phrases = t.meta?.endEarly as RegExp[] | undefined
      if (phrases?.some((re) => re.test(text))) this.board.end(t.key, 'cleared')
    }
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
          case 'speak': return `Speak: "${r(a.text)}"`
          case 'sound': return `Play: ${a.file}`
          case 'text': return `Show: "${r(a.text)}"`
          case 'timer': return `Timer: "${r(a.name) || trigger.name}" for ${a.durationSec}s`
        }
      })
      return { matched: true, phraseIndex: i, captures, outputs, error: '' }
    }
    return { matched: false, phraseIndex: -1, captures: {}, outputs: [], error: '' }
  } catch (e) {
    return { matched: false, phraseIndex: -1, captures: {}, outputs: [], error: (e as Error).message }
  }
}
