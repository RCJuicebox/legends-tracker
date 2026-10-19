import { describe, expect, it } from 'vitest'
import { queueSpeech } from '../../src/core/speechQueue'

// The speech queue's order: urgent phrases first, and never the one dropped for room (LT-719).

describe('the speech queue', () => {
  const q = (...names: string[]): { n: string; urgent?: boolean }[] => names.map((n) => ({ n, urgent: n.startsWith('!') }))
  const names = (queue: { n: string }[]) => queue.map((x) => x.n)

  it('appends an ordinary phrase, and puts an urgent one at the front after any urgent one waiting', () => {
    const queue = q('a', 'b')
    queueSpeech(queue, { n: 'c' }, 6)
    expect(names(queue)).toEqual(['a', 'b', 'c'])
    queueSpeech(queue, { n: '!x', urgent: true }, 6)
    expect(names(queue)).toEqual(['!x', 'a', 'b', 'c'])
    queueSpeech(queue, { n: '!y', urgent: true }, 6)
    expect(names(queue)).toEqual(['!x', '!y', 'a', 'b', 'c'])
  })

  it('drops the oldest ordinary phrase when full, never an urgent one', () => {
    const queue = q('!x', 'a', 'b')
    queueSpeech(queue, { n: 'c' }, 3)
    expect(names(queue)).toEqual(['!x', 'b', 'c'])
    queueSpeech(queue, { n: '!y', urgent: true }, 3)
    expect(names(queue)).toEqual(['!x', '!y', 'c'])
    queueSpeech(queue, { n: 'd' }, 3)
    expect(names(queue)).toEqual(['!x', '!y', 'd'])
    // Only urgent ones waiting: the oldest of them goes.
    const all = q('!x', '!y')
    queueSpeech(all, { n: '!z', urgent: true }, 2)
    expect(names(all)).toEqual(['!y', '!z'])
  })
})
