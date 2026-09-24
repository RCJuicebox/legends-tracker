import { describe, expect, it } from 'vitest'
import { compilePhrase, testTrigger, TriggerEngine } from '../src/core/triggers'
import { TimerBoard } from '../src/core/timers'
import { parseLogLine } from '../src/core/logLine'
import type { Notification, Trigger } from '../src/shared/types'

const trig = (over: Partial<Trigger>): Trigger => ({
  id: 'x', name: 'Test', folder: '', enabled: true, comment: '', phrases: [], cooldownSec: 0, actions: [], ...over
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
          actions: [{
            type: 'timer', name: 'Mez ${Target}', durationSec: 24, color: '#fff', overlay: 'targets', warnSec: 6,
            warnSpeech: 'mez ending', endSpeech: 'mez off', restart: 'restart',
            endEarly: [{ text: '${Target} has been awakened', regex: false }]
          }]
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
    expect(board.list().map((t) => t.label).sort()).toEqual(['Mez A gnoll pup', 'Mez A gnoll scout'])
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
