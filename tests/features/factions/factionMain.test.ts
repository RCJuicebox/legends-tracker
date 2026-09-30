import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'

// The factions feature's main side against a game folder on disk: the book of eqlwiki's faction pages
// (kept a week, served old while the wiki cannot be reached, read once however many ask), and each
// handler the Factions page calls, from the export, the client's files, the achievements export and the
// logs of two characters. Only the wiki is stood in for; everything else is read as the app reads it.

type Handler = (e: unknown, ...args: unknown[]) => unknown
interface Page {
  title: string
  content: string
}
const h = vi.hoisted(() => ({
  dir: '',
  handlers: new Map<string, Handler>(),
  wiki: { factionPages: [] as Page[], quests: {} as Record<string, string>, fail: null as Error | null, reads: 0, gate: Promise.resolve() as Promise<void> }
}))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))
vi.mock('../../../src/main/sources/wiki', () => ({
  wiki: {
    embeddedIn: async (_template: string, onBatch: (pages: Page[]) => void) => {
      h.wiki.reads++
      await h.wiki.gate
      if (h.wiki.fail) throw h.wiki.fail
      onBatch(h.wiki.factionPages)
    },
    pages: async (titles: string[]) => new Map(titles.filter((t) => t in h.wiki.quests).map((t) => [t, { title: t, content: h.wiki.quests[t] }]))
  }
}))

h.dir = mkdtempSync(join(tmpdir(), 'lt-faction-main-'))
process.env['EQL_USER_DATA'] = h.dir
// The app makes its cache folder at start; the book is written into it.
mkdirSync(join(h.dir, 'local'), { recursive: true })
const m = await import('../../../src/features/factions/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { rendererUrl } = await import('../../../src/main/push')
const { GameTables } = await import('../../../src/main/stats')
const { AchievementFiles } = await import('../../../src/main/achievements')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
const BOOK = join(h.dir, 'local', 'faction-book.json')
const DAY = 24 * 3600_000

// Trimmed from eqlwiki's Crimson Hands page.
const CRIMSON_HANDS = `{{Factionpage|
| description = The [[Wizard]] Guild in Erudin is called the Crimson Hands.
| zones_raise =
* [[Lavastorm Mountains]]
| quests_raise =
* [[Heretic Battle]]
* [[Ilanic's Scroll]]
| mobs_raise =
* [[Azzar Habbib]] <span class='fmz'>(Paineel - Quest NPC)</span>
| mobs_lower =
* [[Ghanlin Skyphire]] <span class='fmz'>(Erudin Palace - Wizard Guildmaster)</span>
}}`
const HERETIC_BATTLE = `{| class="questTopTable"
! ''' Start Zone: '''
| [[Paineel]]
|-
! ''' Quest Giver: '''
| [[Azzar Habbib]]
|}
'''Give [[Heretic Head]] to [[Azzar Habbib]].'''
<div class="facblock">
* Your faction standing with [[Crimson Hands]] has been adjusted by 10.
</div>`

beforeEach(async () => {
  Object.assign(h.wiki, {
    factionPages: [{ title: 'Crimson Hands', content: CRIMSON_HANDS }],
    quests: { 'Heretic Battle': HERETIC_BATTLE },
    fail: null,
    reads: 0,
    gate: Promise.resolve()
  })
  await fs.rm(BOOK, { force: true })
})

describe('the book of eqlwiki faction pages', () => {
  it('reads the wiki once, keeps what it read on disk, and serves that for a week without asking again', async () => {
    const book = new m.FactionBook()
    const first = await book.get()
    expect(h.wiki.reads).toBe(1)
    expect(first.error).toBe('')
    expect(first.book.pages.map((p) => p.page)).toEqual(['Crimson Hands'])
    // A quest the page names with no page of its own is kept as none, so it is not asked for again.
    expect(Object.keys(first.book.quests)).toEqual(['Heretic Battle', "Ilanic's Scroll"])
    expect(first.book.quests["Ilanic's Scroll"]).toBeNull()
    expect(first.book.quests['Heretic Battle']).toMatchObject({ page: 'Heretic Battle', givers: ['Azzar Habbib'], zones: ['Paineel'] })
    await book.get()
    expect(h.wiki.reads).toBe(1)
    // The app started again: the book from the file.
    const again = await new m.FactionBook().get()
    expect(h.wiki.reads).toBe(1)
    expect(again.book).toEqual(first.book)
  })

  it('reads the wiki again once the book is a week old, or when asked to', async () => {
    await new m.FactionBook().get()
    const kept = JSON.parse(await fs.readFile(BOOK, 'utf8'))
    await fs.writeFile(BOOK, JSON.stringify({ ...kept, fetchedAt: Date.now() - 8 * DAY }))
    const book = new m.FactionBook()
    await book.get()
    expect(h.wiki.reads).toBe(2)
    await book.get()
    expect(h.wiki.reads).toBe(2)
    await book.get(true)
    expect(h.wiki.reads).toBe(3)
  })

  it('serves the book it has, with why, while the wiki cannot be reached; without one it fails', async () => {
    const had = (await new m.FactionBook().get()).book
    h.wiki.fail = new Error('eqlwiki answered 503')
    expect(await new m.FactionBook().get(true)).toEqual({ book: had, error: 'eqlwiki answered 503' })
    await fs.rm(BOOK)
    await expect(new m.FactionBook().get()).rejects.toThrow('eqlwiki answered 503')
  })

  it('reads a book of an older shape again, and serves it while the wiki cannot be reached', async () => {
    await new m.FactionBook().get()
    const kept = JSON.parse(await fs.readFile(BOOK, 'utf8'))
    await fs.writeFile(BOOK, JSON.stringify({ ...kept, version: kept.version - 1 }))
    h.wiki.fail = new Error('offline')
    const book = new m.FactionBook()
    // However new it is: what it kept of a page may be short of what is read today.
    const served = await book.get()
    expect(h.wiki.reads).toBe(2)
    expect(served).toMatchObject({ error: 'offline', book: { version: kept.version - 1, fetchedAt: 0 } })
    h.wiki.fail = null
    expect((await book.get()).book.version).toBe(kept.version)
    expect(h.wiki.reads).toBe(3)
  })

  it('does not serve a book too old to read, one from a later version, or a broken file', async () => {
    await new m.FactionBook().get()
    const kept = JSON.parse(await fs.readFile(BOOK, 'utf8'))
    h.wiki.fail = new Error('offline')
    for (const text of [JSON.stringify({ ...kept, version: 1 }), JSON.stringify({ ...kept, version: kept.version + 1 }), JSON.stringify({ ...kept, pages: null }), '{ not json']) {
      await fs.writeFile(BOOK, text)
      await expect(new m.FactionBook().get()).rejects.toThrow('offline')
    }
  })

  it('reads the wiki once for everything that asks while it is being read', async () => {
    let open = () => {}
    h.wiki.gate = new Promise<void>((r) => (open = r))
    const book = new m.FactionBook()
    const both = Promise.all([book.get(), book.get(true)])
    await new Promise((r) => setTimeout(r, 50))
    open()
    const [a, b] = await both
    expect(h.wiki.reads).toBe(1)
    expect(a.book).toBe(b.book)
  })
})

// A game folder: Tester_neriak's exports and log, and Tester_qeynos's log.
const game = join(h.dir, 'game')
/** When the factions export was written: before everything in the logs. */
const EXPORTED = new Date(2026, 8, 28, 9, 0, 0).getTime()
const line = (stamp: string, text: string) => `[Mon Sep 28 ${stamp} 2026] ${text}\r\n`
const adjusted = (faction: string, n: number) => `Your faction standing with ${faction} has been adjusted by ${n}.`
const put = (path: string, text: string, modified?: number) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
  if (modified) utimesSync(path, modified / 1000, modified / 1000)
}
const faction = (id: number, name: string) => `${80000 + id}^${name}^This achievement is completed by reaching maximum faction standing with ${name}.^860^10^0^0^`
const race = (id: number, name: string, race: string) => `${id}^${name}^Completing this achievement will allow you to select ${race} as a Race in Loadouts.^4479^5^1^0^`

/** The Wood Elf Monk of Tunare whose factions are planned. */
const record = { race: 'Wood Elf', classLevels: { Monk: 50 }, deity: 'Tunare' }
const setting = { installDir: game }

beforeAll(() => {
  put(
    join(game, 'Tester_neriak-MNK-Factions.txt'),
    [
      'ID\tName\tStandingValue\tPointsToMax',
      '233\tCrimson Hands\t1415\t585',
      '326\tEmerald Warriors\t100\t1900',
      '310\tSoldiers of Tunare\t2000\t0',
      '276\tKelethin Merchants\t500\t1500'
    ].join('\r\n'),
    EXPORTED
  )
  put(join(game, 'Tester_bad-WAR-Factions.txt'), 'Not a factions export', EXPORTED)
  put(join(game, 'Tester_neriak-Inventory.txt'), ['Location\tName\tID\tCount\tSlots', 'General 1\tHeretic Head\t12345\t2\t0'].join('\r\n'))
  // Faction id ^ race, class or deity key ^ what it adds: Wood Elf 54, Half Elf 57, Monk 7, Wizard 12, Tunare 215.
  put(join(game, 'Resources', 'Faction', 'FactionAssociations.txt'), ['326^54^100^', '326^57^200^', '326^7^-50^', '326^215^200^', '233^54^-500^', '233^12^100^'].join('\r\n'))
  put(
    join(game, 'Resources', 'Achievements', 'AchievementsClient.txt'),
    [
      faction(233, 'Crimson Hands'),
      faction(326, 'Emerald Warriors'),
      faction(310, 'Soldiers of Tunare'),
      faction(276, 'Kelethin Merchants'),
      race(20000101, 'Race Unlock - Human (Freeport)', 'Human'),
      race(20000104, 'Race Unlock - Wood Elf', 'Wood Elf'),
      race(20000107, 'Race Unlock - Half Elf', 'Half Elf')
    ].join('\r\n')
  )
  put(
    join(game, 'Resources', 'Achievements', 'AchievementComponentsClient.txt'),
    [
      '20000101^4^1^60229^Get maximum faction with Coalition of Tradesfolk.^',
      '20000101^5^1^60330^Get maximum faction with Freeport Militia.^',
      '20000101^6^1^60281^Get maximum faction with Knights of Truth.^',
      '20000104^0^1^60326^Get maximum faction with Emerald Warriors.^',
      '20000104^1^1^60310^Get maximum faction with Soldiers of Tunare.^',
      '20000104^2^1^60276^Get maximum faction with Kelethin Merchants.^',
      '20000107^0^1^20000107^This achievement will autocomplete when you unlock Human or Wood Elf as a race.^'
    ].join('\r\n')
  )
  // Only what is still open: Soldiers of Tunare and the Human unlock are done.
  put(
    join(game, 'Tester_neriak-Achievements.txt'),
    [
      'EverQuest: Progression',
      'I\tCrimson Hands',
      'I\t\tCrimson Hands',
      'I\tEmerald Warriors',
      'I\t\tEmerald Warriors',
      'I\tKelethin Merchants',
      'I\t\tKelethin Merchants',
      'Untapped Potential: Races',
      'I\tRace Unlock - Wood Elf',
      'I\t\tGet maximum faction with Emerald Warriors.',
      'I\t\tGet maximum faction with Kelethin Merchants.',
      'I\tRace Unlock - Half Elf',
      'I\t\tThis achievement will autocomplete when you unlock Human or Wood Elf as a race.',
      'Untapped Potential: Deities',
      'I\tDeity Unlock - Agnostic'
    ].join('\r\n')
  )
  put(
    join(game, 'Logs', 'eqlog_Tester_neriak.txt'),
    [
      line('10:00:00', 'You have entered The Greater Faydark.'),
      line('10:00:05', adjusted('Emerald Warriors', 5)),
      line('10:00:05', 'You have slain an orc pawn!'),
      line('10:01:05', adjusted('Emerald Warriors', 5)),
      line('10:01:05', 'You have slain an orc pawn!')
    ].join('')
  )
  put(
    join(game, 'Logs', 'eqlog_Tester_qeynos.txt'),
    [
      line('11:00:00', 'You have entered The Greater Faydark.'),
      line('11:00:05', adjusted('Emerald Warriors', 5)),
      line('11:00:05', 'You have slain an orc pawn!'),
      line('11:05:00', 'You have entered Paineel.'),
      line('11:06:00', 'You offered 1 Heretic Head to Azzar Habbib.'),
      line('11:06:00', "Azzar Habbib says, 'The heretics will fall.'"),
      line('11:06:00', adjusted('Crimson Hands', 10)),
      line('11:10:00', 'You have entered Erudin.')
    ].join('')
  )

  const history = new LogHistory(join(h.dir, 'log-history.json'), m.Factions.consumers)
  const ctx = {
    installDir: () => setting.installDir,
    gameTables: new GameTables(() => setting.installDir),
    achievementFiles: new AchievementFiles(
      h.dir,
      () => setting.installDir,
      () => {}
    ),
    historyOf: (c: string) => ({ logPath: join(game, 'Logs', `eqlog_${c}.txt`), archiveDir: join(game, 'Logs', 'Archive'), stem: `eqlog_${c}` }),
    // Allakhazam is not read here: it has its own tests.
    factions: Object.assign(new m.Factions(history), { alla: { factions: async () => [], status: () => ({ read: 0, wanted: 0, error: '' }) } }),
    purchases: { latest: async () => ({}) },
    inventoryFiles: { lookup: async () => ({}) },
    store: { characterByKey: () => record }
  }
  ctx.factions.register(ctx as unknown as AppContext)
  context = ctx as unknown as AppContext
})
let context: AppContext

const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>

describe('the Factions page', () => {
  beforeEach(() => {
    setting.installDir = game
  })

  it("the standings: the export's with the log's changes since, each with what it cons at for the character", async () => {
    const got = await call('factions:get', 'Tester_neriak')
    const by = (n: string) => got.factions.find((f: { name: string }) => f.name === n)
    expect(got.exportError).toBe('')
    expect(got.conBasis).toEqual({ race: 'Wood Elf', classes: ['Monk'], deity: 'Tunare' })
    expect(by('Emerald Warriors').standing).toMatchObject({ value: 110, atExport: 100, since: 10, con: { value: 360, race: 100, cls: -50, deity: 200 } })
    expect(by('Crimson Hands').standing).toMatchObject({ value: 1415, con: { value: 915 } })
    expect(by('Soldiers of Tunare').achievement).toMatchObject({ done: true })
    expect(by('Crimson Hands').achievement).toMatchObject({ done: false, from: 'achievements' })
  })

  it("the log's changes and why, when the export cannot be read; nothing before the game folder is chosen", async () => {
    const bad = await call('factions:get', 'Tester_bad')
    expect(bad.exportError).toMatch(/No factions found/)
    expect(bad.export).toBeNull()
    setting.installDir = ''
    expect(await call('factions:get', 'Tester_neriak')).toEqual({ factions: [], export: null, exportError: '' })
    await expect(call('factions:plan', 'Tester_neriak')).rejects.toThrow('Choose the game folder on the Settings page first.')
  })

  it('refuses what is not a character, a faction or a name to look up', async () => {
    for (const channel of ['factions:get', 'factions:plan', 'factions:moved', 'factions:lookup'])
      await expect(call(channel, '..\\x', 'Crimson Hands')).rejects.toThrow('Not a character.')
    for (const f of ['', '  ', 'x'.repeat(101), 5]) {
      await expect(call('factions:sources', f)).rejects.toThrow('Not a faction.')
      await expect(call('factions:moved', 'Tester_neriak', f)).rejects.toThrow('Not a faction.')
    }
    await expect(call('factions:lookup', 'Tester_neriak', 'x'.repeat(81))).rejects.toThrow('Not a name to look up.')
    expect(await call('factions:lookup', 'Tester_neriak', ' or ')).toEqual({ results: [] })
  })

  it('what raises a faction, from its wiki page', async () => {
    expect(await call('factions:sources', ' Crimson Hands ')).toEqual({
      sources: {
        page: 'Crimson Hands',
        zones: ['Lavastorm Mountains'],
        quests: ['Heretic Battle', "Ilanic's Scroll"],
        mobs: [{ name: 'Azzar Habbib', zone: 'Paineel', note: 'Quest NPC' }]
      }
    })
  })

  it("the plan's data: targets, what the logs of both characters saw, the wiki, the races and what each adds", async () => {
    const plan = await call('factions:plan', 'Tester_neriak', false, false)
    expect(plan.targets.map((t: { faction: string }) => t.faction).sort()).toEqual(['Crimson Hands', 'Emerald Warriors', 'Kelethin Merchants'])
    expect(plan.maxed).toEqual(['Soldiers of Tunare'])
    expect(plan.achievementsExport).toBe(true)
    expect(plan.standings).toEqual({ 'Crimson Hands': 1415, 'Emerald Warriors': 110, 'Soldiers of Tunare': 2000, 'Kelethin Merchants': 500 })
    expect(plan.export).toEqual({ file: 'Tester_neriak-MNK-Factions.txt', modified: EXPORTED })
    expect(plan.inventory).toMatchObject({ file: 'Tester_neriak-Inventory.txt' })
    expect(plan.wiki).toMatchObject({ pages: 1, quests: 1, error: '' })
    expect(plan.log).toEqual({ kills: 2, handIns: 0, unexplained: 0 })
    expect(plan.shared).toEqual({ characters: ['Tester_qeynos'], kills: 1, handIns: 1 })
    expect(plan.alla).toEqual({ read: 0, wanted: 0, error: '' })
    expect(plan.agnostic).toBe(false)
    expect(plan.races).toEqual(['Human'])
    expect(plan.raceMods).toEqual({
      own: 'Wood Elf',
      mods: { 'Wood Elf': { 'Emerald Warriors': 50, 'Crimson Hands': -500 }, Human: { 'Emerald Warriors': -50 }, 'Half Elf': { 'Emerald Warriors': 150 } }
    })
    expect(plan.noAchievementList).toBeUndefined()
  })

  it("what moved a faction, in both characters' logs", async () => {
    const { movers } = await call('factions:moved', 'Tester_neriak', 'Emerald Warriors')
    expect(movers).toEqual([expect.objectContaining({ kind: 'kill', zone: 'The Greater Faydark', name: 'An orc pawn', others: ['Tester_qeynos'], own: true })])
  })

  it('what a mob or an NPC does, from the logs and the wiki', async () => {
    const pawn = await call('factions:lookup', 'Tester_neriak', 'orc pawn')
    expect(pawn.results).toEqual([expect.objectContaining({ kind: 'kill', name: 'An orc pawn', from: 'log' })])
    const azzar = await call('factions:lookup', 'Tester_neriak', 'azzar')
    expect(azzar.results.map((r: { from: string }) => r.from)).toContain('log')
  })

  it('the standings now, for the achievements overlay', async () => {
    const now = await m.standingsNow(context, 'Tester_neriak')
    expect(now.standings['Emerald Warriors']).toBe(110)
    expect([...now.done]).toEqual(['Soldiers of Tunare'])
    expect(now.byAchievement['crimson hands']).toEqual({ faction: 'Crimson Hands', standing: 1415 })
  })
})
