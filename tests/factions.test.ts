import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addFactionLine, factionView, joinFactions, parseFactionLine, RECENT_KEPT, type FactionTallies } from '../src/core/factions'
import { factionConsumer, FactionHistory } from '../src/main/factions'
import { purchaseConsumer } from '../src/main/purchases'
import { LogHistory } from '../src/main/sources/logHistory'

const T0 = Date.UTC(2026, 8, 27, 12, 0, 0)

const adjusted = (faction: string, n: number) => `Your faction standing with ${faction} has been adjusted by ${n}.`
const better = (faction: string) => `Your faction standing with ${faction} could not possibly get any better.`
const worse = (faction: string) => `Your faction standing with ${faction} could not possibly get any worse.`

/** A stretch of log's tallies, one line a second from `start`. */
function tally(texts: string[], start = T0): FactionTallies {
  const into: FactionTallies = {}
  texts.forEach((text, i) => addFactionLine(into, { time: start + i * 1000, text }))
  return into
}

describe('parseFactionLine', () => {
  it('reads an adjustment up or down', () => {
    expect(parseFactionLine(adjusted('Clan Runnyeye', 2))).toEqual({ faction: 'Clan Runnyeye', amount: 2 })
    expect(parseFactionLine(adjusted('Clan Runnyeye', -1))).toEqual({ faction: 'Clan Runnyeye', amount: -1 })
  })

  it('reads the two cap lines', () => {
    expect(parseFactionLine(better('Guards of Qeynos'))).toEqual({ faction: 'Guards of Qeynos', cap: 'top' })
    expect(parseFactionLine(worse('Guards of Qeynos'))).toEqual({ faction: 'Guards of Qeynos', cap: 'bottom' })
  })

  it('keeps a name with a backtick, an apostrophe or a comma whole', () => {
    expect(parseFactionLine(adjusted('King Ak`Anon', -1))).toEqual({ faction: 'King Ak`Anon', amount: -1 })
    expect(parseFactionLine(better("Tunare's Scouts"))).toEqual({ faction: "Tunare's Scouts", cap: 'top' })
    expect(parseFactionLine(adjusted('Craftkeepers, Dwarven', 3))).toEqual({ faction: 'Craftkeepers, Dwarven', amount: 3 })
  })

  it('passes over everything else', () => {
    expect(parseFactionLine('You have entered Neriak Commons.')).toBeNull()
    expect(parseFactionLine('Your faction standing with nobody changed.')).toBeNull()
    expect(parseFactionLine('Tester tells you, "Your faction standing with King Ak`Anon has been adjusted by 5."')).toBeNull()
    expect(parseFactionLine('Your faction standing with King Ak`Anon has been adjusted by lots.')).toBeNull()
  })
})

describe('faction tallies', () => {
  it('adds up the changes and counts them, with the first and last time seen', () => {
    const t = tally([adjusted('Clan Runnyeye', 2), 'You have entered Neriak Commons.', adjusted('Clan Runnyeye', -1), adjusted('Clan Runnyeye', 3)])
    expect(t['clan runnyeye']).toMatchObject({ name: 'Clan Runnyeye', net: 4, changes: 3, first: T0, last: T0 + 3000, cap: null })
    expect(t['clan runnyeye'].recent).toEqual([
      { at: T0, amount: 2 },
      { at: T0 + 2000, amount: -1 },
      { at: T0 + 3000, amount: 3 }
    ])
  })

  it('keeps each faction apart, whatever the case the log wrote it in', () => {
    const t = tally([adjusted('King Ak`Anon', -1), adjusted('Gem Choppers', 1), adjusted('king ak`anon', -2)])
    expect(Object.keys(t).sort()).toEqual(['gem choppers', 'king ak`anon'])
    expect(t['king ak`anon']).toMatchObject({ net: -3, changes: 2 })
  })

  it('marks a faction maxed or bottomed from the cap lines, which are not changes', () => {
    const t = tally([adjusted('Guards of Qeynos', 1), better('Guards of Qeynos'), worse('Clan Runnyeye')])
    expect(t['guards of qeynos']).toMatchObject({ net: 1, changes: 1, cap: 'top', last: T0 + 1000 })
    expect(t['clan runnyeye']).toMatchObject({ net: 0, changes: 0, cap: 'bottom', recent: [] })
  })

  it('clears a cap on a change the other way, and not on one the same way', () => {
    const t = tally([better('Guards of Qeynos'), adjusted('Guards of Qeynos', 1), worse('Clan Runnyeye'), adjusted('Clan Runnyeye', -1)])
    expect(t['guards of qeynos'].cap).toBe('top')
    expect(t['clan runnyeye'].cap).toBe('bottom')
    const cleared = tally([better('Guards of Qeynos'), adjusted('Guards of Qeynos', -2), worse('Clan Runnyeye'), adjusted('Clan Runnyeye', 1)])
    expect(cleared['guards of qeynos']).toMatchObject({ cap: null, net: -2 })
    expect(cleared['clan runnyeye']).toMatchObject({ cap: null, net: 1 })
  })

  it('keeps only the last changes', () => {
    const t = tally(Array.from({ length: RECENT_KEPT + 5 }, (_, i) => adjusted('Gem Choppers', i + 1)))
    expect(t['gem choppers'].changes).toBe(RECENT_KEPT + 5)
    expect(t['gem choppers'].recent).toHaveLength(RECENT_KEPT)
    expect(t['gem choppers'].recent[0].amount).toBe(6)
  })
})

describe('joinFactions', () => {
  /** The same lines tallied whole, and split into stretches at each cut and joined. */
  function both(texts: string[], cuts: number[]) {
    const whole = tally(texts)
    const edges = [0, ...cuts, texts.length]
    const parts = edges.slice(1).map((end, i) => tally(texts.slice(edges[i], end), T0 + edges[i] * 1000))
    return { whole, joined: joinFactions(parts) }
  }

  it('gives what reading the stretches as one would', () => {
    const texts = [
      adjusted('Guards of Qeynos', 1),
      better('Guards of Qeynos'),
      worse('Clan Runnyeye'),
      adjusted('Guards of Qeynos', 1),
      adjusted('Clan Runnyeye', -1),
      adjusted('Guards of Qeynos', -1),
      adjusted('King Ak`Anon', -1),
      better('Guards of Qeynos'),
      adjusted('Clan Runnyeye', 2)
    ]
    for (const cuts of [[1], [2], [3], [5], [6], [8], [2, 5], [1, 3, 6, 8]]) {
      const { whole, joined } = both(texts, cuts)
      expect(factionView(joined), `cut at ${cuts.join(', ')}`).toEqual(factionView(whole))
    }
  })

  it("lets a later stretch's change the other way clear an earlier stretch's cap", () => {
    const joined = joinFactions([tally([better('Guards of Qeynos'), worse('Clan Runnyeye')]), tally([adjusted('Guards of Qeynos', -1)], T0 + 60_000)])
    expect(joined['guards of qeynos'].cap).toBeNull()
    expect(joined['clan runnyeye'].cap).toBe('bottom')
  })

  it("lets a later stretch's cap line win over an earlier one", () => {
    const joined = joinFactions([tally([better('Guards of Qeynos')]), tally([adjusted('Guards of Qeynos', -3), worse('Guards of Qeynos')], T0 + 60_000)])
    expect(joined['guards of qeynos']).toMatchObject({ cap: 'bottom', net: -3 })
  })

  it('keeps the last changes over the stretches', () => {
    const a = tally(Array.from({ length: 15 }, () => adjusted('Gem Choppers', 1)))
    const b = tally(Array.from({ length: 15 }, () => adjusted('Gem Choppers', -1)), T0 + 60_000)
    const g = joinFactions([a, b])['gem choppers']
    expect(g).toMatchObject({ net: 0, changes: 30, first: T0 })
    expect(g.recent).toHaveLength(RECENT_KEPT)
    expect(g.recent.filter((c) => c.amount === 1)).toHaveLength(5)
  })

  it('leaves the stretches it joins as they were', () => {
    const a = tally([adjusted('Gem Choppers', 1)])
    const before = structuredClone(a)
    joinFactions([a, tally([adjusted('Gem Choppers', 2)], T0 + 60_000)])
    expect(a).toEqual(before)
  })
})

describe('factionView', () => {
  it('lists the most recently seen first, with each history newest first', () => {
    const v = factionView(tally([adjusted('Gem Choppers', 1), adjusted('King Ak`Anon', -1), adjusted('Gem Choppers', 2)]))
    expect(v.factions.map((f) => f.name)).toEqual(['Gem Choppers', 'King Ak`Anon'])
    expect(v.factions[0]).toEqual({
      name: 'Gem Choppers',
      net: 3,
      changes: 2,
      first: T0,
      last: T0 + 2000,
      cap: null,
      recent: [
        { at: T0 + 2000, amount: 2 },
        { at: T0, amount: 1 }
      ]
    })
  })

  it('is empty with nothing seen', () => {
    expect(factionView({})).toEqual({ factions: [] })
  })
})

describe('FactionHistory over a real log', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'lt-factions-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const line = (stamp: string, text: string) => `[${stamp}] ${text}\r\n`

  it('joins the archives and the live log, and picks up new lines', async () => {
    const archiveDir = join(dir, 'archive')
    await fs.mkdir(archiveDir)
    await fs.writeFile(
      join(archiveDir, 'eqlog_Kelwyn_neriak_2026-09-01_to_2026-09-10.txt'),
      line('Tue Sep 01 20:00:00 2026', adjusted('King Ak`Anon', -1)) + line('Tue Sep 01 20:00:01 2026', better('Gem Choppers'))
    )
    const logPath = join(dir, 'eqlog_Kelwyn_neriak.txt')
    await fs.writeFile(
      logPath,
      line('Sun Sep 27 12:00:00 2026', adjusted('King Ak`Anon', -2)) +
        line('Sun Sep 27 12:00:05 2026', 'You have entered Neriak Commons.') +
        line('Sun Sep 27 12:00:10 2026', adjusted('Gem Choppers', 1))
    )
    const fh = new FactionHistory(new LogHistory(join(dir, 'log-history.json'), { factions: factionConsumer }), 'factions')
    const where = { logPath, archiveDir, stem: 'eqlog_Kelwyn_neriak' }

    const first = await fh.view(where)
    expect(first.factions.map((f) => [f.name, f.net, f.changes, f.cap])).toEqual([
      ['Gem Choppers', 1, 1, 'top'],
      ['King Ak`Anon', -3, 2, null]
    ])

    await fs.appendFile(logPath, line('Sun Sep 27 12:05:00 2026', adjusted('Gem Choppers', -1)))
    const second = await fh.view(where)
    expect(second.factions[0]).toMatchObject({ name: 'Gem Choppers', net: 0, changes: 2, cap: null })
  })

  it('reads the archives again for factions when the cache was written without them', async () => {
    const archiveDir = join(dir, 'archive')
    await fs.mkdir(archiveDir)
    await fs.writeFile(join(archiveDir, 'eqlog_Tester_neriak_2026-09-01_to_2026-09-10.txt'), line('Tue Sep 01 20:00:00 2026', adjusted('Gem Choppers', 4)))
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    await fs.writeFile(logPath, line('Sun Sep 27 12:00:00 2026', adjusted('Gem Choppers', 1)))
    const where = { logPath, archiveDir, stem: 'eqlog_Tester_neriak' }
    const cache = join(dir, 'log-history.json')

    // An older build: purchases only.
    await new LogHistory(cache, { purchases: purchaseConsumer }).get('purchases', where)
    const fh = new FactionHistory(new LogHistory(cache, { purchases: purchaseConsumer, factions: factionConsumer }), 'factions')
    expect((await fh.view(where)).factions).toMatchObject([{ name: 'Gem Choppers', net: 5, changes: 2 }])
  })

  it('is empty for a log with no faction lines', async () => {
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    await fs.writeFile(logPath, line('Sun Sep 27 12:00:00 2026', 'You have entered Neriak Commons.'))
    const fh = new FactionHistory(new LogHistory(join(dir, 'log-history.json'), { factions: factionConsumer }), 'factions')
    expect(await fh.view({ logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Tester_neriak' })).toEqual({ factions: [] })
  })
})
