// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { ranLines } from '../../src/renderer/src/pages/Dashboard'

// What the corner says after Run lines (LT-679): a line that matched nothing is told from a run that did not happen.

it('says the lines read and what started, or that nothing matched', () => {
  expect(ranLines({ lines: 0, timers: 0, triggers: 0 })).toBe('No log lines in the text: each needs its [time] in front')
  expect(ranLines({ lines: 1, timers: 0, triggers: 0 })).toBe('Ran 1 line: no timer or trigger matched')
  expect(ranLines({ lines: 4, timers: 2, triggers: 1 })).toBe('Ran 4 lines: 2 timers, 1 trigger')
})
