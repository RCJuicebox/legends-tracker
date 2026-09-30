import { describe, expect, it } from 'vitest'
import { downloadStale, expired, reportDownload, WIKI_FRESH_MS } from '../src/main/sources/freshness'
import type { Job } from '../src/main/sources/jobs'
import { sources } from '../src/main/sources/registry'

// When what is kept from the wiki is due again, and what a download says while it runs.

const DAY = 24 * 3600_000

describe('what is kept from the wiki, and when it is due again', () => {
  it('serves a week, or as long as asked', () => {
    const now = Date.now()
    expect(WIKI_FRESH_MS).toBe(7 * DAY)
    expect(expired(undefined)).toBe(true)
    expect(expired(now - DAY)).toBe(false)
    expect(expired(now - 8 * DAY)).toBe(true)
    expect(expired(now - 8 * DAY, 30 * DAY)).toBe(false)
    expect(expired(1000, WIKI_FRESH_MS, 1000 + WIKI_FRESH_MS)).toBe(false)
    expect(expired(1000, WIKI_FRESH_MS, 1001 + WIKI_FRESH_MS)).toBe(true)
  })

  it('downloads again when there is none, it is kept in an older form, or a week old', () => {
    const now = Date.now()
    expect(downloadStale(null, 2)).toBe(true)
    expect(downloadStale({ fetchedAt: now, format: 1 }, 2)).toBe(true)
    // Kept before the form was numbered: the first form.
    expect(downloadStale({ fetchedAt: now }, 1)).toBe(false)
    expect(downloadStale({ fetchedAt: now }, 2)).toBe(true)
    expect(downloadStale({ fetchedAt: now, format: 2 }, 2)).toBe(false)
    expect(downloadStale({ fetchedAt: now - 8 * DAY, format: 2 }, 2)).toBe(true)
  })
})

describe('a download, on the Data Sources page and in the jobs strip', () => {
  const row = () => sources.list().find((r) => r.id === 'fresh-test')
  const steps: [number | null, string | undefined][] = []
  const job: Job = { signal: new AbortController().signal, progress: (fraction, detail) => void steps.push([fraction, detail]) }

  it('says the pages read while it runs, then its error or what it keeps', () => {
    reportDownload('fresh-test', { busy: true, pages: 3, total: 10, error: '' }, job, null)
    expect(row()).toMatchObject({ status: 'reading', detail: '3 of 10 pages' })
    // Before the page count is known.
    reportDownload('fresh-test', { busy: true, pages: 3, total: 0, error: '' }, job, null)
    expect(steps).toEqual([
      [0.3, '3 of 10 pages'],
      [null, '3 of ? pages']
    ])

    reportDownload('fresh-test', { busy: false, pages: 10, total: 10, error: 'The wiki did not answer.' }, job, { what: '12 items', stale: false })
    expect(row()).toMatchObject({ status: 'error', error: 'The wiki did not answer.' })
    reportDownload('fresh-test', { busy: false, pages: 10, total: 10, error: '' }, null, { what: '12 items, from 9/1/2026', stale: true })
    expect(row()).toMatchObject({ status: 'stale', detail: '12 items, from 9/1/2026' })
    reportDownload('fresh-test', { busy: false, pages: 10, total: 10, error: '' }, null, { what: '12 items, from 9/30/2026', stale: false })
    expect(row()).toMatchObject({ status: 'ok', detail: '12 items, from 9/30/2026' })
    // Nothing kept and nothing running: the row is left as it was.
    reportDownload('fresh-test', { busy: false, pages: 0, total: 0, error: '' }, null, null)
    expect(row()?.status).toBe('ok')
    expect(steps).toHaveLength(2)
  })
})
