import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addFactionLine,
  FACTIONS_FILE,
  factionView,
  joinFactions,
  parseFactionAchievements,
  parseFactionLine,
  parseFactionPage,
  parseFactionsExport,
  progressionStatus,
  CLASS_KEYS,
  exportClass,
  modifierOf,
  parseFactionModifiers,
  RACE_KEYS,
  RECENT_KEPT,
  SinceExports,
  standingBand,
  type FactionTallies
} from '../src/features/factions/core'
import { parseAchievements } from '../src/core/achievements'
import { factionConsumer, FactionHistory } from '../src/features/factions/main'
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
    const b = tally(
      Array.from({ length: 15 }, () => adjusted('Gem Choppers', -1)),
      T0 + 60_000
    )
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
      ],
      standing: null,
      achievement: null
    })
  })

  it('is empty with nothing seen', () => {
    expect(factionView({})).toEqual({ factions: [], export: null, exportError: '' })
  })
})

const EXPORT = [
  'ID\tName\tStandingValue\tPointsToMax',
  '65\tBrownies of Faydwer\t-6\t2006',
  '234\tCrushbone Orcs\t-2000\t4000',
  '723\tFaction723\t0\t2000',
  '219\tAntonius Bayle\t2000\t0',
  ''
].join('\r\n')

describe('parseFactionsExport', () => {
  it('reads each faction line and passes over the header', () => {
    expect(parseFactionsExport('\uFEFF' + EXPORT)).toEqual([
      { id: 65, name: 'Brownies of Faydwer', value: -6, toMax: 2006 },
      { id: 234, name: 'Crushbone Orcs', value: -2000, toMax: 4000 },
      { id: 723, name: 'Faction723', value: 0, toMax: 2000 },
      { id: 219, name: 'Antonius Bayle', value: 2000, toMax: 0 }
    ])
  })

  it('works out the points to max when the column is missing', () => {
    expect(parseFactionsExport('65\tBrownies of Faydwer\t-6')).toEqual([{ id: 65, name: 'Brownies of Faydwer', value: -6, toMax: 2006 }])
  })

  it('says so when nothing in it is a faction line', () => {
    expect(() => parseFactionsExport('ID\tName\tStandingValue\tPointsToMax\r\n')).toThrow(/No factions found/)
  })
})

describe('FACTIONS_FILE', () => {
  it('takes the character key from the name, with or without the class', () => {
    expect(FACTIONS_FILE.exec('Kelwyn_neriak-MNK-Factions.txt')?.[1]).toBe('Kelwyn_neriak')
    expect(FACTIONS_FILE.exec('Kelwyn_neriak-Factions.txt')?.[1]).toBe('Kelwyn_neriak')
    expect(FACTIONS_FILE.exec('Kelwyn_neriak-Achievements.txt')).toBeNull()
  })
})

describe('what a faction cons at', () => {
  it("reads the client's modifiers and adds up a character's race and class", () => {
    const mods = parseFactionModifiers(['316^7^0^', '316^178^-750^', '316^54^100^', 'not a line', '220^178^-500^'].join(String.fromCharCode(13, 10)))
    expect(modifierOf(mods, 316, [RACE_KEYS.iksar, CLASS_KEYS.MNK])).toBe(-750)
    expect(modifierOf(mods, 316, [RACE_KEYS['wood elf']])).toBe(100)
    expect(modifierOf(mods, 999, [RACE_KEYS.iksar])).toBe(0)
    expect(exportClass('Kelwyn_neriak-MNK-Factions.txt')).toBe('MNK')
    expect(exportClass('Kelwyn_neriak-Factions.txt')).toBe('')
  })
})

describe('standingBand', () => {
  it('cons a standing and says what is left to the next band', () => {
    expect(standingBand(2000)).toEqual({ word: 'Ally', tone: 'ok', next: null })
    expect(standingBand(1100).word).toBe('Ally')
    expect(standingBand(1099)).toEqual({ word: 'Warmly', tone: 'ok', next: { word: 'Ally', points: 1 } })
    expect(standingBand(304)).toEqual({ word: 'Amiably', tone: 'plain', next: { word: 'Kindly', points: 196 } })
    expect(standingBand(0).word).toBe('Indifferent')
    expect(standingBand(-1).word).toBe('Apprehensive')
    expect(standingBand(-100).word).toBe('Apprehensive')
    expect(standingBand(-101).word).toBe('Dubious')
    expect(standingBand(-750).word).toBe('Threatening')
    expect(standingBand(-751)).toEqual({ word: 'Scowling', tone: 'bad', next: { word: 'Threatening', points: 1 } })
  })
})

describe('factionView with an export', () => {
  const at = T0 + 10_000
  const exported = { file: 'Tester_neriak-MNK-Factions.txt', modified: at, standings: parseFactionsExport(EXPORT) }

  it('adds the log changes written after the export to its standing, and lists what only the export has', () => {
    const v = factionView(tally([adjusted('Brownies of Faydwer', -5), ...Array(11).fill(''), adjusted('Brownies of Faydwer', 3), adjusted('Gem Choppers', 1)]), exported)
    expect(v.export).toEqual({ file: 'Tester_neriak-MNK-Factions.txt', modified: at })
    const brownies = v.factions.find((f) => f.name === 'Brownies of Faydwer')
    expect(brownies).toMatchObject({ net: -2, changes: 2, standing: { id: 65, value: -3, atExport: -6, since: 3, sinceAll: true } })
    expect(v.factions.find((f) => f.name === 'Gem Choppers')?.standing).toBeNull()
    expect(v.factions.find((f) => f.name === 'Faction723')).toMatchObject({ net: 0, changes: 0, last: 0, standing: { value: 0 } })
    // The log's first, then the export's own by name.
    expect(v.factions.map((f) => f.name)).toEqual(['Gem Choppers', 'Brownies of Faydwer', 'Antonius Bayle', 'Crushbone Orcs', 'Faction723'])
  })

  it('marks a standing at 2000 or -2000 maxed or bottomed, and holds it there', () => {
    const v = factionView(tally([...Array(11).fill(''), adjusted('Antonius Bayle', 5)]), exported)
    expect(v.factions.find((f) => f.name === 'Antonius Bayle')).toMatchObject({ cap: 'top', standing: { value: 2000, since: 5 } })
    expect(v.factions.find((f) => f.name === 'Crushbone Orcs')?.cap).toBe('bottom')
    expect(v.factions.find((f) => f.name === 'Brownies of Faydwer')?.cap).toBeNull()
  })

  it('says when the log saw more changes since the export than it keeps', () => {
    const lines = [...Array(11).fill(''), ...Array(RECENT_KEPT + 5).fill(adjusted('Brownies of Faydwer', 1))]
    const s = factionView(tally(lines), exported).factions.find((f) => f.name === 'Brownies of Faydwer')?.standing
    expect(s).toMatchObject({ since: RECENT_KEPT, sinceAll: false })
  })

  it('adds every change since the export when the log itself was read for them, however many', () => {
    const lines = [...Array(11).fill(''), ...Array(RECENT_KEPT + 5).fill(adjusted('Brownies of Faydwer', 1))]
    const since = { changes: new Map([['brownies of faydwer', RECENT_KEPT + 5]]), completed: new Set<string>() }
    const s = factionView(tally(lines), exported, null, since).factions.find((f) => f.name === 'Brownies of Faydwer')?.standing
    expect(s).toMatchObject({ value: -6 + RECENT_KEPT + 5, since: RECENT_KEPT + 5, sinceAll: true })
  })
})

describe('SinceExports', () => {
  // The game wrote both exports 0.4 s into the second of their "Outputfile Complete" lines.
  const factions = { file: 'Tester_neriak-MNK-Factions.txt', modified: T0 + 10_400 }
  const achievements = { file: 'Tester_neriak-Achievements.txt', modified: T0 + 10_400 }
  const at = (sec: number, text: string) => ({ time: T0 + sec * 1000, text })

  it("counts every change after the factions export's line, those in its second included, and none before it", () => {
    const s = new SinceExports(factions, null)
    const lines = [
      at(9, adjusted('Brownies of Faydwer', -5)),
      // In the export's second: before its line, in the export; after it, not.
      at(10, adjusted('Brownies of Faydwer', -1)),
      at(10, 'Outputfile Complete: Tester_neriak-MNK-Factions.txt'),
      at(10, adjusted('Brownies of Faydwer', 2)),
      ...Array.from({ length: RECENT_KEPT + 5 }, (_, i) => at(11 + i, adjusted('Brownies of Faydwer', 1)))
    ]
    for (const l of lines) s.add(l)
    expect(Object.fromEntries(s.factionChanges)).toEqual({ 'brownies of faydwer': 2 + RECENT_KEPT + 5 })
  })

  it('goes by the time the export was written in a log without its line', () => {
    const s = new SinceExports(factions, null)
    for (const l of [at(10, adjusted('Brownies of Faydwer', -1)), at(11, adjusted('Brownies of Faydwer', 3)), at(12, 'Outputfile Complete: Tester_neriak-Inventory.txt')]) s.add(l)
    expect(Object.fromEntries(s.factionChanges)).toEqual({ 'brownies of faydwer': 3 })
  })

  it('takes the achievements the game completed after the achievements export', () => {
    const s = new SinceExports(null, achievements)
    for (const l of [
      at(5, 'You have completed achievement: Antonius Bayle'),
      at(10, 'Outputfile Complete: Tester_neriak-Achievements.txt'),
      at(20, 'You have completed achievement: Crimson Hands'),
      at(21, adjusted('Crimson Hands', 5))
    ])
      s.add(l)
    expect([...s.completed]).toEqual(['crimson hands'])
    expect(s.factionChanges.size).toBe(0)
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

  it('counts every change the live log saw after the export, and what the game said was completed since', async () => {
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    const stamp = (sec: number) => `Sun Sep 27 12:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} 2026`
    // An evening's kills: more changes than a faction keeps, 1415 + 45 × 13 = 2000.
    await fs.writeFile(
      logPath,
      line(stamp(0), adjusted('Crimson Hands', 10)) +
        line(stamp(10), 'Outputfile Complete: Tester_neriak-Achievements.txt') +
        line(stamp(10), 'Outputfile Complete: Tester_neriak-MNK-Factions.txt') +
        Array.from({ length: 45 }, (_, i) => line(stamp(11 + i), adjusted('Crimson Hands', 13))).join('') +
        line(stamp(57), 'You have completed achievement: Crimson Hands')
    )
    const written = new Date(2026, 8, 27, 12, 0, 10).getTime() + 400
    const exported = { file: 'Tester_neriak-MNK-Factions.txt', modified: written, standings: parseFactionsExport('233\tCrimson Hands\t1415\t585') }
    const achievements = {
      list: parseFactionAchievements(CLIENT),
      status: progressionStatus(parseAchievements('EverQuest: Progression\nI\tCrimson Hands\nI\t\tCrimson Hands\n').sections),
      exported: { file: 'Tester_neriak-Achievements.txt', modified: written }
    }
    const fh = new FactionHistory(new LogHistory(join(dir, 'log-history.json'), { factions: factionConsumer }), 'factions')
    const where = { logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Tester_neriak' }
    const row = async () => (await fh.view(where, exported, achievements)).factions.find((f) => f.name === 'Crimson Hands')

    expect(await row()).toMatchObject({ standing: { value: 2000, atExport: 1415, since: 585, sinceAll: true }, achievement: { done: true, from: 'log' } })
    await fs.appendFile(logPath, line(stamp(58), adjusted('Crimson Hands', -20)))
    expect((await row())?.standing).toMatchObject({ value: 1980, since: 565, sinceAll: true })
  })

  it('is empty for a log with no faction lines', async () => {
    const logPath = join(dir, 'eqlog_Tester_neriak.txt')
    await fs.writeFile(logPath, line('Sun Sep 27 12:00:00 2026', 'You have entered Neriak Commons.'))
    const fh = new FactionHistory(new LogHistory(join(dir, 'log-history.json'), { factions: factionConsumer }), 'factions')
    expect(await fh.view({ logPath, archiveDir: join(dir, 'archive'), stem: 'eqlog_Tester_neriak' })).toEqual({ factions: [], export: null, exportError: '' })
  })
})

// The client's AchievementsClient.txt: id^name^description^icon^points^…
const CLIENT = [
  '5^Level 5^This achievement is completed by reaching level 5.^2272^10^0^0^',
  '80233^Crimson Hands^This achievement is completed by reaching maximum faction standing with Crimson Hands.^860^10^0^0^',
  '80219^Antonius Bayle^This achievement is completed by reaching maximum faction standing with Antonius Bayle.^860^10^0^0^',
  '80722^New Sebilis Expedition^This achievement is completed by reaching maximum faction standing with New Sebilis Expedition.^860^10^0^0^',
  '81720^Guktan Suppliers^This achievement is completed by reaching maximum faction standing with Guktan Suppliers.^860^10^0^0^'
].join('\r\n')

describe('parseFactionAchievements', () => {
  it('reads each faction achievement, its faction id being the achievement id less 80000', () => {
    expect(parseFactionAchievements(CLIENT)).toEqual([
      { id: 80233, name: 'Crimson Hands', factionId: 233, faction: 'Crimson Hands' },
      { id: 80219, name: 'Antonius Bayle', factionId: 219, faction: 'Antonius Bayle' },
      { id: 80722, name: 'New Sebilis Expedition', factionId: 722, faction: 'New Sebilis Expedition' },
      { id: 81720, name: 'Guktan Suppliers', factionId: 1720, faction: 'Guktan Suppliers' }
    ])
  })
})

describe('faction achievements on the Factions page', () => {
  const list = parseFactionAchievements(CLIENT)
  const standings = parseFactionsExport(
    ['ID\tName\tStandingValue\tPointsToMax', '233\tCrimson Hands\t1415\t585', '219\tAntonius Bayle\t2000\t0', '722\tNew Sebilisian Expedition\t100\t1900'].join('\n')
  )
  const exported = { file: 'Tester_neriak-MNK-Factions.txt', modified: T0, standings }
  // The export lists the open ones only.
  const achExport = 'EverQuest: Progression\nI\tCrimson Hands\nI\t\tCrimson Hands\nI\tNew Sebilis Expedition\nI\t\tNew Sebilis Expedition\n'

  it('joins by faction id, so a differently named achievement still finds its faction', () => {
    const v = factionView({}, exported, { list, status: progressionStatus(parseAchievements(achExport).sections) })
    const by = (n: string) => v.factions.find((f) => f.name === n)?.achievement
    expect(by('New Sebilisian Expedition')).toEqual({ id: 80722, name: 'New Sebilis Expedition', done: false, from: 'achievements' })
    expect(by('Crimson Hands')).toMatchObject({ done: false, from: 'achievements' })
    // Left out of the export's list: done.
    expect(by('Antonius Bayle')).toMatchObject({ done: true, from: 'achievements' })
    // Neither the log nor the factions export has it: a row of its own, so the filter still lists it.
    expect(v.factions.find((f) => f.name === 'Guktan Suppliers')).toMatchObject({ net: 0, standing: null, achievement: { done: true } })
  })

  it('goes by the standing without an achievements export', () => {
    const v = factionView({}, exported, { list, status: null })
    const by = (n: string) => v.factions.find((f) => f.name === n)?.achievement
    expect(by('Antonius Bayle')).toMatchObject({ done: true, from: 'standing' })
    expect(by('Crimson Hands')).toMatchObject({ done: false, from: 'standing' })
    expect(by('Guktan Suppliers')).toMatchObject({ done: null, from: null })
  })

  it('takes an achievement the game said was completed after the achievements export as done', () => {
    const since = { changes: null, completed: new Set(['crimson hands']) }
    const v = factionView({}, exported, { list, status: progressionStatus(parseAchievements(achExport).sections) }, since)
    const by = (n: string) => v.factions.find((f) => f.name === n)?.achievement
    expect(by('Crimson Hands')).toMatchObject({ done: true, from: 'log' })
    expect(by('New Sebilisian Expedition')).toMatchObject({ done: false, from: 'achievements' })
  })

  it('matches by name when there is no factions export', () => {
    const v = factionView(tally([adjusted('Crimson Hands', 5)]), null, { list, status: null })
    expect(v.factions.find((f) => f.name === 'Crimson Hands')).toMatchObject({ net: 5, achievement: { id: 80233, done: null } })
  })
})

describe('progressionStatus', () => {
  it('is null without an export, and empty for an export with nothing open in Progression', () => {
    expect(progressionStatus(null)).toBeNull()
    expect(progressionStatus(parseAchievements('EverQuest: Hunter\nI\tHunter of Befallen\nI\t\ta skeleton\n').sections)).toEqual(new Map())
  })
})

// Trimmed from eqlwiki's Crimson Hands page.
const PAGE = `{{Factionpage|

| description = The [[Wizard]] Guild in Erudin is called the Crimson Hands.

| zones_raise =

* [[Lavastorm Mountains]]
* [[The Hole|Ruins of Old Paineel]]

| zones_lower =

* [[Erudin|Erudin Palace]]

| quests_raise =

* [[Heretic Battle]]
* [[Ilanic's Scroll]]

| mobs_raise =

* [[Aglthin Dasmore]]  <span class='fmz'>(Toxxulia Forest)</span>
* [[Azzar Habbib]] <span class='fmz'>(Paineel - Quest NPC)</span>
* [[Keeper of the Tombs]] <span class='fmz'>(Ruins of Old Paineel (The Hole) - Undead)</span>
* [[A kerran \`amir]] <span class='fmz'>(Kerra Island)</span>

| mobs_lower =

* [[Ghanlin Skyphire]] <span class='fmz'>(Erudin Palace - Wizard Guildmaster)</span>
}}`

describe('parseFactionPage', () => {
  it('reads what raises the faction, and leaves what lowers it', () => {
    expect(parseFactionPage('Crimson Hands', PAGE)).toEqual({
      page: 'Crimson Hands',
      mobs: [
        { name: 'Aglthin Dasmore', zone: 'Toxxulia Forest', note: '' },
        { name: 'Azzar Habbib', zone: 'Paineel', note: 'Quest NPC' },
        { name: 'Keeper of the Tombs', zone: 'Ruins of Old Paineel (The Hole)', note: 'Undead' },
        { name: 'A kerran `amir', zone: 'Kerra Island', note: '' }
      ],
      quests: ['Heretic Battle', "Ilanic's Scroll"],
      zones: ['Lavastorm Mountains', 'Ruins of Old Paineel']
    })
  })

  it('is null for a page that is not a faction page, such as a zone of the same name', () => {
    expect(parseFactionPage('New Sebilis Expedition', '{{Classic Era}}\n\nNew Sebilis Expedition looks to be little more than a door.')).toBeNull()
  })

  it('has empty lists for a faction page that lists nothing yet', () => {
    expect(parseFactionPage('Clurg', '{{Factionpage|\n| description = Clurg.\n}}')).toEqual({ page: 'Clurg', mobs: [], quests: [], zones: [] })
  })
})
