import { afterEach, describe, expect, it, vi } from 'vitest'
import { WikiClient } from '../src/main/sources/wiki'
import { statsblockOf } from '../src/core/wikiItem'

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
    const titles = new WikiClient().search('odium')
    await vi.runAllTimersAsync()
    expect(await titles).toEqual(['Odium'])
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('maxlag=5')
    expect(calls[0]).toContain('format=json')
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
