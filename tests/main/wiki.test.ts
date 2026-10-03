import { afterEach, describe, expect, it, vi } from 'vitest'
import { WikiClient } from '../../src/main/sources/wiki'
import { statsblockOf } from '../../src/core/wikiItem'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

describe('statsblockOf', () => {
  it('keeps a piped link and a template inside the value, and stops at the next parameter', () => {
    const page = [
      '{{Itempage',
      '|itemname = Clawed Knuckle-Ring',
      '|statsblock = MAGIC ITEM<br>',
      'Slot: FINGERS<br>',
      'Focus Effect: [[Extended Enhancement II|Extended Enhancement]] {{Note|see focus}}<br>',
      '|dropsfrom = [[Chardok]]',
      '}}'
    ].join('\n')
    expect(statsblockOf(page)).toBe('MAGIC ITEM<br>\nSlot: FINGERS<br>\nFocus Effect: [[Extended Enhancement II|Extended Enhancement]] {{Note|see focus}}<br>')
  })

  it('runs to the end of the template when it is the last parameter, and is empty when missing', () => {
    expect(statsblockOf('{{Itempage\n|statsblock = Slot: EAR<br>\n}}</onlyinclude>')).toBe('Slot: EAR<br>')
    expect(statsblockOf('{{Itempage\n|itemname = X\n}}')).toBe('')
  })
})

describe('the wiki client', () => {
  it('asks politely and waits out a busy wiki before trying again', async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const answers = [json({ error: { code: 'maxlag', info: 'lagged' } }), json({}, 429, { 'retry-after': '3' }), json({ query: { search: [{ title: 'Odium' }] } })]
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      return answers.shift()!
    })
    const titles = new WikiClient().search('odium', 10, 'background')
    await vi.runAllTimersAsync()
    expect(await titles).toEqual(['Odium'])
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('maxlag=5')
    expect(calls[0]).toContain('format=json')
  })

  it('tries a page twice, lets others through while it waits, and fails fast for a minute once offline (LT-410)', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      const q = new URL(url).searchParams.get('srsearch') ?? ''
      asked.push(q)
      if (q === 'down') throw new TypeError('fetch failed')
      return json({ query: { search: [{ title: q }] } })
    })
    const c = new WikiClient()
    const down = c.search('down').catch((e: Error) => e.message)
    // While the failed try waits, another request gets its turn.
    const other = c.search('other')
    await vi.runAllTimersAsync()
    expect(await other).toEqual(['other'])
    expect(await down).toMatch(/fetch failed/)
    expect(asked.filter((q) => q === 'down')).toHaveLength(2)
    expect(asked.indexOf('other')).toBeLessThan(asked.lastIndexOf('down'))
    // Offline: the next request fails at once, without asking.
    const before = asked.length
    await expect(c.search('again')).rejects.toThrow(/could not be reached a moment ago/)
    expect(asked.length).toBe(before)
    vi.advanceTimersByTime(61_000)
    const later = c.search('later')
    await vi.runAllTimersAsync()
    expect(await later).toEqual(['later'])
  })

  it('fails at once on a mistake in the request', async () => {
    vi.stubGlobal('fetch', async () => json({ error: { code: 'badvalue', info: 'no such thing' } }))
    await expect(new WikiClient().search('x')).rejects.toThrow('badvalue')
  })

  it('answers a page waiting on it before a background download', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      order.push(new URL(url).searchParams.get('srsearch') ?? '')
      return json({ query: { search: [] } })
    })
    const c = new WikiClient()
    const all = [c.search('first', 10, 'background'), c.search('second', 10, 'background'), c.search('page', 10, 'now')]
    await vi.runAllTimersAsync()
    await Promise.all(all)
    expect(order).toEqual(['first', 'page', 'second'])
  })
})
