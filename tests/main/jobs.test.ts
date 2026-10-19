import { describe, expect, it } from 'vitest'
import { jobs } from '../../src/main/sources/jobs'

// The job strip's registry: a second start of a job still running waits for it, so the running one
// stays on the strip and can be cancelled (LT-609).

describe('jobs.run', () => {
  it('hands a second start of a running job the first one, and runs it again once done', async () => {
    let starts = 0
    let finish = () => {}
    const work = () => {
      starts++
      return new Promise<number>((r) => (finish = () => r(starts)))
    }
    const first = jobs.run('test-job', 'Testing', work)
    const second = jobs.run('test-job', 'Testing', work)
    expect(starts).toBe(1)
    expect(jobs.list().map((j) => j.id)).toContain('test-job')
    finish()
    expect([await first, await second]).toEqual([1, 1])
    expect(jobs.list().map((j) => j.id)).not.toContain('test-job')
    const third = jobs.run('test-job', 'Testing', work)
    finish()
    expect(await third).toBe(2)
  })
})
