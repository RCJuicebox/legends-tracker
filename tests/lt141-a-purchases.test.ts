import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { purchaseConsumer, PurchaseHistory, type Purchases } from '../src/main/purchases'
import { LogHistory, type HistorySlice } from '../src/main/sources/logHistory'
import type { Purchase } from '../src/core/tradeskills'

const T0 = Date.UTC(2026, 8, 24, 16, 0, 0)

/** Runs the consumer's reader over lines, as LogHistory would over one stretch of log. */
function read(lines: { time: number; text: string }[]): Purchases {
  const into = purchaseConsumer.empty()
  const reader = purchaseConsumer.reader()
  for (const l of lines) reader(l, into)
  return into
}

const bought = (item: string, at: number, copper = 10, count = 1): Purchase => ({ item, count, merchant: 'Merchant Tester', copper, at })

describe('purchaseConsumer', () => {
  it('starts empty', () => {
    expect(purchaseConsumer.empty()).toEqual({})
  })

  it('reads the item, count, merchant and price of a purchase line', () => {
    const p = read([{ time: T0, text: 'You purchased 100 Small Vial from Kizzie Tester for  1 platinum, 2 gold, 3 silver and 4 copper.' }])
    expect(p).toEqual({ 'small vial': { item: 'Small Vial', count: 100, merchant: 'Kizzie Tester', copper: 1234, at: T0 } })
  })

  it('counts a purchase with no number as one, without its "a" or "an"', () => {
    const p = read([
      { time: T0, text: 'You purchased a Fishing Pole from Merchant Tester for 5 silver.' },
      { time: T0, text: 'You purchased an Iron Ration from Merchant Tester for 3 copper.' }
    ])
    expect(p['fishing pole']).toMatchObject({ item: 'Fishing Pole', count: 1, copper: 50 })
    expect(p['iron ration']).toMatchObject({ item: 'Iron Ration', count: 1, copper: 3 })
  })

  it('ignores lines that are not the player buying something', () => {
    const p = read([
      { time: T0, text: 'Tester purchased 5 Small Vial from Kizzie Tester for 5 copper.' },
      { time: T0, text: 'You sold 5 Small Vial to Kizzie Tester for 5 copper.' },
      { time: T0, text: 'You purchased nothing worth mentioning' },
      { time: T0, text: 'Merchant Tester tells you, "You purchased 5 Small Vial from me for 5 copper."' }
    ])
    expect(p).toEqual({})
  })

  it('keeps the newest purchase of an item, whatever the case of its name', () => {
    const p = read([
      { time: T0 + 2000, text: 'You purchased 2 Small Vial from Kizzie Tester for 2 copper.' },
      { time: T0, text: 'You purchased 9 small vial from Kizzie Tester for 9 copper.' },
      { time: T0 + 1000, text: 'You purchased 5 Bottle from Kizzie Tester for 5 copper.' }
    ])
    expect(Object.keys(p).sort()).toEqual(['bottle', 'small vial'])
    expect(p['small vial']).toMatchObject({ item: 'Small Vial', count: 2, copper: 2 })
  })

  it('lets a later line in the same second replace an earlier one', () => {
    const p = read([
      { time: T0, text: 'You purchased 1 Small Vial from Kizzie Tester for 1 copper.' },
      { time: T0, text: 'You purchased 3 Small Vial from Kizzie Tester for 3 copper.' }
    ])
    expect(p['small vial'].count).toBe(3)
  })
})

describe('PurchaseHistory', () => {
  const where = { logPath: 'eqlog_Tester_neriak.txt', archiveDir: 'archive', stem: 'eqlog_Tester_neriak' }

  /** A LogHistory stand-in that hands back one slice. */
  function historyOf(slice: HistorySlice<Purchases>, asked: string[] = []): LogHistory {
    return {
      get: async (key: string) => {
        asked.push(key)
        return slice
      }
    } as unknown as LogHistory
  }

  it('asks the history for its own key', async () => {
    const asked: string[] = []
    await new PurchaseHistory(historyOf({ archives: [], live: {} }, asked), 'purchases').latest(where)
    expect(asked).toEqual(['purchases'])
  })

  it('gives the last price paid for each item over the archives and the live log', async () => {
    const slice: HistorySlice<Purchases> = {
      archives: [
        { name: 'a1.zip', end: '2026-09-01', value: { 'small vial': bought('Small Vial', T0 - 3000, 5), bottle: bought('Bottle', T0 - 3000, 7) } },
        { name: 'a2.zip', end: '2026-09-10', value: { 'small vial': bought('Small Vial', T0 - 2000, 6) } }
      ],
      live: { 'small vial': bought('Small Vial', T0, 8), 'fishing pole': bought('Fishing Pole', T0, 50) }
    }
    const all = await new PurchaseHistory(historyOf(slice), 'purchases').latest(where)
    expect(Object.keys(all).sort()).toEqual(['bottle', 'fishing pole', 'small vial'])
    expect(all['small vial'].copper).toBe(8)
    expect(all['bottle'].copper).toBe(7)
  })

  it('keeps an archive purchase that is newer than the live one', async () => {
    const slice: HistorySlice<Purchases> = {
      archives: [{ name: 'a1.zip', end: '2026-09-30', value: { bottle: bought('Bottle', T0 + 5000, 9) } }],
      live: { bottle: bought('Bottle', T0, 4) }
    }
    const all = await new PurchaseHistory(historyOf(slice), 'purchases').latest(where)
    expect(all['bottle'].copper).toBe(9)
  })

  it('prefers the live log on a tie, and a later archive over an earlier one', async () => {
    const slice: HistorySlice<Purchases> = {
      archives: [
        { name: 'a1.zip', end: '2026-09-01', value: { bottle: bought('Bottle', T0, 1) } },
        { name: 'a2.zip', end: '2026-09-02', value: { bottle: bought('Bottle', T0, 2), vial: bought('Vial', T0, 2) } }
      ],
      live: { vial: bought('Vial', T0, 3) }
    }
    const all = await new PurchaseHistory(historyOf(slice), 'purchases').latest(where)
    expect(all['bottle'].copper).toBe(2)
    expect(all['vial'].copper).toBe(3)
  })

  it('is empty for a character who never bought anything', async () => {
    expect(await new PurchaseHistory(historyOf({ archives: [], live: {} }), 'purchases').latest(where)).toEqual({})
  })

  describe('over a real log', () => {
    let dir: string
    beforeEach(async () => {
      dir = await fs.mkdtemp(join(tmpdir(), 'lt-purchases-'))
    })
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('reads purchases from the live log and picks up new ones', async () => {
      const logPath = join(dir, 'eqlog_Tester_neriak.txt')
      const line = (stamp: string, text: string) => `[${stamp}] ${text}\r\n`
      await fs.writeFile(
        logPath,
        line('Thu Sep 24 16:00:00 2026', 'You purchased 5 Small Vial from Kizzie Tester for 5 copper.') +
          line('Thu Sep 24 16:00:05 2026', 'You have entered Neriak Commons.') +
          line('Thu Sep 24 16:00:10 2026', 'You purchased a Bottle from Kizzie Tester for 1 gold.')
      )
      const history = new LogHistory(join(dir, 'log-history.json'), { purchases: purchaseConsumer })
      const ph = new PurchaseHistory(history, 'purchases')
      const o = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Tester_neriak' }

      const first = await ph.latest(o)
      expect(Object.keys(first).sort()).toEqual(['bottle', 'small vial'])
      expect(first['bottle']).toMatchObject({ count: 1, copper: 100, merchant: 'Kizzie Tester' })

      await fs.appendFile(logPath, line('Thu Sep 24 16:05:00 2026', 'You purchased 10 Small Vial from Kizzie Tester for 1 silver.'))
      const second = await ph.latest(o)
      expect(second['small vial']).toMatchObject({ count: 10, copper: 10 })
    })
  })
})
