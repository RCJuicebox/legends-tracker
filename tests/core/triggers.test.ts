import { describe, expect, it } from 'vitest'
import { compilePhrase, conditionsHold, phraseGuard, testTrigger, TriggerEngine } from '../../src/core/triggers'
import { TimerBoard } from '../../src/core/timers'
import { parseLogLine } from '../../src/core/logLine'
import type { Notification, Trigger } from '../../src/shared/types'

const trig = (over: Partial<Trigger>): Trigger => ({
  id: 'x',
  name: 'Test',
  folder: '',
  enabled: true,
  comment: '',
  phrases: [],
  cooldownSec: 0,
  actions: [],
  ...over
})

describe('compilePhrase', () => {
  it('matches plain text anywhere, case-insensitively, escaping regex characters', () => {
    const re = compilePhrase({ text: 'You feel yourself starting to appear.', regex: false }, 'Kelwyn')
    expect(re.test('You feel yourself starting to appear.')).toBe(true)
    expect(re.test('You feel yourself starting to appearX')).toBe(false)
  })

  it('expands {C}, {S1} and {N1}', () => {
    const re = compilePhrase({ text: '{C} hits {S1} for {N1} points', regex: false }, 'Kelwyn')
    const m = re.exec('Kelwyn hits a ratman warrior for 200 points of damage.')!
    expect(m.groups).toEqual({ S1: 'a ratman warrior', N1: '200' })
  })

  it('keeps named groups in regex phrases', () => {
    const re = compilePhrase({ text: "^(?<S1>\\w+) tells you, '(?<S2>.+)'$", regex: true }, 'Kelwyn')
    expect(re.exec("Aldric tells you, 'inc'")!.groups).toEqual({ S1: 'Aldric', S2: 'inc' })
  })
})

describe('TriggerEngine', () => {
  it('speaks with captures, honours cooldowns, and runs trigger timers with end-early phrases', () => {
    const notes: Notification[] = []
    const board = new TimerBoard({ onChange: () => {}, onNotify: (n) => notes.push(...n) })
    const engine = new TriggerEngine(board, { notify: (n) => notes.push(...n), feed: () => {} })
    engine.load(
      [
        trig({
          id: 'tell',
          phrases: [{ text: "^(?<S1>\\w+) tells you, '(?<S2>.+)'$", regex: true }],
          cooldownSec: 5,
          actions: [{ type: 'speak', text: 'Tell from {S1}: {S2}', interrupt: false }]
        }),
        trig({
          id: 'mez',
          phrases: [{ text: '${Target} has been mesmerized.', regex: false }],
          actions: [
            {
              type: 'timer',
              name: 'Mez ${Target}',
              durationSec: 24,
              color: '#fff',
              overlay: 'targets',
              warnSec: 6,
              warnSpeech: 'mez ending',
              endSpeech: 'mez off',
              restart: 'restart',
              endEarly: [{ text: '${Target} has been awakened', regex: false }]
            }
          ]
        })
      ],
      'Kelwyn'
    )
    const feed = (raw: string) => engine.handle(parseLogLine(raw)!)
    feed("[Wed Sep 23 13:00:00 2026] Aldric tells you, 'inc'")
    feed("[Wed Sep 23 13:00:02 2026] Aldric tells you, 'again'")
    expect(notes.map((n) => n.kind === 'speak' && n.text)).toEqual(['Tell from Aldric: inc'])

    feed('[Wed Sep 23 13:00:10 2026] A gnoll pup has been mesmerized.')
    feed('[Wed Sep 23 13:00:11 2026] A gnoll scout has been mesmerized.')
    expect(
      board
        .list()
        .map((t) => t.label)
        .sort()
    ).toEqual(['Mez A gnoll pup', 'Mez A gnoll scout'])
    feed('[Wed Sep 23 13:00:12 2026] A gnoll pup has been awakened by Aldric.')
    expect(board.list().map((t) => t.label)).toEqual(['Mez A gnoll scout'])
  })
})

describe('testTrigger', () => {
  it('reports the match, captures and rendered outputs for a pasted log line', () => {
    const r = testTrigger(
      trig({ phrases: [{ text: 'Your {S1} spell is interrupted.', regex: false }], actions: [{ type: 'speak', text: '{S1} interrupted', interrupt: true }] }),
      '[Wed Sep 23 13:00:00 2026] Your Envenomed Bolt spell is interrupted.',
      'Kelwyn'
    )
    expect(r.matched).toBe(true)
    expect(r.outputs).toEqual(['Speak: "Envenomed Bolt interrupted"'])
  })
})

describe('TriggerEngine end-early with snippets', () => {
  it('fixes {S1} in an end-early phrase to what the start captured, so one awakening ends one timer', () => {
    const board = new TimerBoard({ onChange: () => {}, onNotify: () => {} })
    const engine = new TriggerEngine(board, { notify: () => {}, feed: () => {} })
    engine.load(
      [
        trig({
          id: 'mez',
          phrases: [{ text: '{S1} has been mesmerized.', regex: false }],
          actions: [
            {
              type: 'timer',
              name: 'Mez {S1}',
              durationSec: 24,
              color: '#fff',
              overlay: 'targets',
              warnSec: 0,
              warnSpeech: '',
              endSpeech: '',
              restart: 'restart',
              endEarly: [{ text: '{S1} has been awakened', regex: false }]
            }
          ]
        })
      ],
      'Kelwyn'
    )
    const feed = (raw: string) => engine.handle(parseLogLine(raw)!)
    feed('[Wed Sep 23 13:00:10 2026] A gnoll pup has been mesmerized.')
    feed('[Wed Sep 23 13:00:11 2026] A gnoll scout has been mesmerized.')
    feed('[Wed Sep 23 13:00:12 2026] A gnoll pup has been awakened by Aldric.')
    expect(board.list().map((t) => t.label)).toEqual(['Mez A gnoll scout'])
  })

  it('fixes {N1} too, and escapes the bound text in regex end-early phrases', () => {
    const board = new TimerBoard({ onChange: () => {}, onNotify: () => {} })
    const engine = new TriggerEngine(board, { notify: () => {}, feed: () => {} })
    engine.load(
      [
        trig({
          id: 'n',
          phrases: [{ text: 'Countdown {N1} for {S1}', regex: false }],
          actions: [
            {
              type: 'timer',
              name: '{S1} {N1}',
              durationSec: 60,
              color: '#fff',
              overlay: 'targets',
              warnSec: 0,
              warnSpeech: '',
              endSpeech: '',
              restart: 'restart',
              endEarly: [{ text: '^Stop {N1} for {S1}$', regex: true }]
            }
          ]
        })
      ],
      'Kelwyn'
    )
    const feed = (raw: string) => engine.handle(parseLogLine(raw)!)
    feed('[Wed Sep 23 13:00:10 2026] Countdown 1 for a.b')
    feed('[Wed Sep 23 13:00:11 2026] Countdown 2 for a.b')
    feed('[Wed Sep 23 13:00:12 2026] Stop 1 for axb')
    expect(board.list().length).toBe(2)
    feed('[Wed Sep 23 13:00:13 2026] Stop 1 for a.b')
    expect(board.list().map((t) => t.label)).toEqual(['a.b 2'])
  })
})

describe('compilePhrase edge cases', () => {
  it('makes a repeated snippet a backreference', () => {
    const re = compilePhrase({ text: '{S1} hits {S1}', regex: false }, 'Kelwyn')
    expect(re.test('a rat hits a rat')).toBe(true)
    expect(re.test('a rat hits a bat')).toBe(false)
  })

  it('lets {N1} match negative numbers', () => {
    const re = compilePhrase({ text: 'Your faction standing changed by {N1}.', regex: false }, 'Kelwyn')
    expect(re.exec('Your faction standing changed by -5.')!.groups).toEqual({ N1: '-5' })
  })

  it('reports a bad regex in errors instead of throwing', () => {
    const board = new TimerBoard({ onChange: () => {}, onNotify: () => {} })
    const engine = new TriggerEngine(board, { notify: () => {}, feed: () => {} })
    engine.load([trig({ name: 'Broken', phrases: [{ text: '(unclosed', regex: true }] }), trig({ id: 'ok', phrases: [{ text: 'fine', regex: false }] })], 'Kelwyn')
    expect(engine.errors.map((e) => e.trigger)).toEqual(['Broken'])
    expect(testTrigger(trig({ phrases: [{ text: '(unclosed', regex: true }] }), 'x', 'Kelwyn').error).not.toBe('')
  })
})

describe('the cheap look before a phrase runs (LT-746)', () => {
  it("takes a phrase's leading literal text, stopping at a snippet or a regex's special character", () => {
    expect(phraseGuard({ text: 'You feel yourself starting to appear.', regex: false })).toBe('you feel yourself starting to appear.')
    expect(phraseGuard({ text: '{S1} tells you, {S2}', regex: false })).toBe('')
    expect(phraseGuard({ text: 'Your target resisted the {S1} spell', regex: false })).toBe('your target resisted the ')
    expect(phraseGuard({ text: '^(?<S1>\\w+) tells you', regex: true })).toBe('')
    expect(phraseGuard({ text: 'You have slain (.+)!', regex: true })).toBe('you have slain ')
    // "s?" makes the s optional: the guard stops before it.
    expect(phraseGuard({ text: 'Bones? crack', regex: true })).toBe('bone')
    expect(phraseGuard({ text: 'ab', regex: false })).toBe('')
  })
})

describe('trigger conditions and counters (FEAT-030)', () => {
  const state = { zone: 'The Plane of Fear 4 (Refined)', fighting: true }

  it('holds a zone, a fight, a character and a number compare', () => {
    expect(conditionsHold(undefined, {}, 'Kelwyn', null)).toBe(true)
    expect(conditionsHold({ zone: 'plane of fear' }, {}, 'Kelwyn', state)).toBe(true)
    expect(conditionsHold({ zone: 'befallen' }, {}, 'Kelwyn', state)).toBe(false)
    expect(conditionsHold({ fighting: false }, {}, 'Kelwyn', state)).toBe(false)
    expect(conditionsHold({ characters: ['Aldric'] }, {}, 'Kelwyn', state)).toBe(false)
    expect(conditionsHold({ characters: ['kelwyn'] }, {}, 'Kelwyn', state)).toBe(true)
    expect(conditionsHold({ compare: { snippet: 'N1', op: '>', value: 300 } }, { N1: '1,200' }, 'Kelwyn', state)).toBe(true)
    expect(conditionsHold({ compare: { snippet: 'N1', op: '>', value: 300 } }, { N1: '120' }, 'Kelwyn', state)).toBe(false)
    expect(conditionsHold({ compare: { snippet: 'N1', op: '>', value: 300 } }, {}, 'Kelwyn', state)).toBe(false)
  })

  it('fires on the third match within the window, then counts again, and puts the capture on its timer (LT-745)', () => {
    const notes: Notification[] = []
    const board = new TimerBoard({ onChange: () => {}, onNotify: () => {} })
    const engine = new TriggerEngine(board, { notify: (n) => notes.push(...n), feed: () => {}, state: () => state })
    engine.load(
      [
        trig({
          id: 'resists',
          phrases: [{ text: '{S1} resisted your {S2}!', regex: false }],
          when: { count: { n: 3, withinSec: 20 } },
          actions: [
            { type: 'speak', text: 'Resists on {S1}', interrupt: false },
            { type: 'timer', name: 'Watch {S1}', durationSec: 30, color: '#fff', overlay: 'targets', warnSec: 0, warnSpeech: '', endSpeech: '', restart: 'restart', endEarly: [] }
          ]
        })
      ],
      'Kelwyn'
    )
    const line = (t: string) => engine.handle(parseLogLine(`[Sat Sep 12 23:11:${t} 2026] A ratman warrior resisted your Envenomed Bolt X!`)!)
    line('00')
    line('05')
    expect(notes).toEqual([])
    line('10')
    expect(notes.map((n) => (n.kind === 'speak' ? n.text : ''))).toEqual(['Resists on A ratman warrior'])
    expect(board.list()[0].target).toBe('A ratman warrior')
    line('11')
    line('12')
    expect(notes).toHaveLength(1)
  })
})
