import { describe, expect, it } from 'vitest'
import { perf, Samples } from '../../src/main/perf'

describe('performance counts (FEAT-018)', () => {
  it('keeps the last samples, and gives their 99th percentile and worst', () => {
    const s = new Samples(100)
    expect(s.summary()).toBeNull()
    for (let i = 1; i <= 150; i++) s.add(i)
    // The first 50 have gone: 51…150 are kept.
    expect(s.count).toBe(100)
    expect(s.summary()).toEqual({ p99: 150, max: 150 })
    s.add(0)
    expect(s.summary()?.max).toBe(150)
  })

  it('reports what it has: the clock, the tailer, failures, pushes and the heap', () => {
    perf.restart()
    perf.tickLate.add(3)
    for (let i = 0; i < 20; i++) perf.push('timers', [{ id: 't1' }])
    const text = perf.report({ tailer: { polls: 10, slices: 2, bytes: 2_097_152, lines: 300, maxSliceMs: 4.4, failures: 1 }, lineFailures: 2 }).join('\n')
    expect(text).toMatch(/Engine clock late: p99 \d+ ms, worst \d+ ms/)
    expect(text).toMatch(/10 polls, 2 slices, 2\.0 MB, 300 lines; longest slice 4 ms; 1 failed reads/)
    expect(text).toMatch(/Lines a part failed on: 2/)
    expect(text).toMatch(/timers \d+ KB\/min/)
    expect(text).toMatch(/Main heap: \d+ of \d+ MB/)
    expect(perf.report({ tailer: null, lineFailures: 0 }).join('\n')).toMatch(/Log reading: not watching/)
  })
})
