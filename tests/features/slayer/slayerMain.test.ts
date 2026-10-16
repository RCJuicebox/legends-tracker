import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { listLogs } from '../../../src/main/game'

// The Slayer page's main side against a game folder on disk: the achievements export, the client's
// race table and two characters' logs, read as the app reads them. The live Slayer tracker (eqlwiki's
// races, what the exports settled) and the faction lines after kills are stood in for.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = mkdtempSync(join(tmpdir(), 'lt-slayer-main-'))
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { SlayerPlanner, markMaps, usualPace } = await import('../../../src/features/slayer/main')
const { HunterPlanner } = await import('../../../src/features/hunter/main')
const { DEFAULT_CHOICES } = await import('../../../src/features/slayer/core')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { rendererUrl } = await import('../../../src/main/push')
const { GameTables } = await import('../../../src/main/stats')
const { AchievementFiles } = await import('../../../src/main/achievements')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }

const game = join(h.dir, 'game')
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const line = (stamp: string, text: string) => `[Mon Sep 28 ${stamp} 2026] ${text}\r\n`
// Rows from the client's string table: race names and plurals.
put(join(game, 'dbstr_us.txt'), ['54^11^Orc^0^', '54^12^Orcs^0^', '18^11^Giant^0^', '18^12^Giants^0^', '34^11^Bat^0^'].join('\r\n'))
mkdirSync(join(game, 'Resources'), { recursive: true })
put(
  join(game, 'Kelwyn_neriak-Achievements.txt'),
  [
    'Slayer: Conquest',
    'I\tOrc Stomp!',
    'I\t\tOrcs and Wereorcs.\t4900/5000',
    'I\tMight They Be Giants?',
    'I\t\tGiants\t4990/5000',
    'EverQuest: Hunter',
    'I\tHunter of Clan Crushbone',
    'I\t\tAmbassador DVinn',
    'C\t\tEmperor Crush'
  ].join('\r\n')
)
// Twenty minutes of orcs in Crushbone, one every minute; a bat between, which counts toward nothing; a mob no race is known for.
const crushbone = [line('10:00:00', 'You have entered Clan Crushbone.')]
for (let i = 1; i <= 20; i++) crushbone.push(line(`10:${String(i).padStart(2, '0')}:00`, 'You have slain an orc pawn!'))
crushbone.push(
  line('10:20:30', 'You have slain a bat!'),
  line('10:21:00', 'You have slain a mystery!'),
  line('10:21:30', 'You have slain a riddle!'),
  line('10:21:40', 'You have slain a riddle!')
)
put(join(game, 'Logs', 'eqlog_Kelwyn_neriak.txt'), crushbone.join(''))
// An alt's giants in the Permafrost: its log counts toward the pace too.
const permafrost = [line('12:00:00', 'You have entered The Permafrost Caverns.')]
for (let i = 1; i <= 12; i++)
  permafrost.push(
    line(`12:${String(i * 2).padStart(2, '0')}:00`, 'Aldric has been slain by a gnoll!'),
    line(`12:${String(i * 2).padStart(2, '0')}:30`, 'You have slain a hill giant!')
  )
put(join(game, 'Logs', 'eqlog_Aldric_neriak.txt'), permafrost.join(''))

const races: Record<string, string | null> = { 'an orc pawn': 'Orc', 'a hill giant': 'Giant', 'a bat': 'Bat', 'a mystery': null, 'a riddle': null }
const asked: string[][] = []
/** Whether eqlwiki's answer taught anything: the next plan is read afresh when it did. */
let learned = false
const ctx = {
  installDir: () => game,
  // The Respawns page's records: Khrix Fritchoff timed at 7:21 in Unrest, against classic's sixteen minutes.
  store: {
    respawns: {
      get: () => ({
        'the estate of unrest|khrix fritchoff': {
          zone: 'The Estate of Unrest',
          name: 'Khrix Fritchoff',
          kills: 20,
          lastDeath: 0,
          pendingSince: 0,
          gaps: [441, 460, 470],
          shared: false
        }
      })
    }
  },
  gameTables: new GameTables(() => game),
  achievementFiles: new AchievementFiles(
    h.dir,
    () => game,
    () => {}
  ),
  historyOf: (c: string) => ({ logPath: join(game, 'Logs', `eqlog_${c}.txt`), archiveDir: join(game, 'Logs', 'Archive'), stem: `eqlog_${c}` }),
  logCharacters: async () => (await listLogs(game)).map((l) => l.character),
  liveAchievements: {
    view: null as unknown,
    races: {
      ready: async () => undefined,
      race: (m: string) => (m.toLowerCase() in races ? races[m.toLowerCase()] : undefined),
      lookUp: async (mobs: string[]) => (asked.push(mobs), learned)
    },
    fact: () => undefined,
    changed: [] as string[],
    slayerChoicesChanged: (c: string) => ctx.liveAchievements.changed.push(c)
  },
  factions: {
    causes: {
      fail: false,
      view: async () =>
        ctx.factions.causes.fail
          ? Promise.reject(new Error('unreadable'))
          : {
              acts: { 'kill|clan crushbone|an orc pawn': { kind: 'kill', zone: 'Clan Crushbone', name: 'An orc pawn', n: 2, hits: { 'Kaladim Residents': { '-1': 2 } } } }
            }
    }
  }
}
const planner = new SlayerPlanner(new LogHistory(join(h.dir, 'log-history.json'), SlayerPlanner.consumers), h.dir)
planner.register(ctx as unknown as AppContext)
const hunter = new HunterPlanner(new LogHistory(join(h.dir, 'log-history-h.json'), SlayerPlanner.consumers), h.dir)
hunter.register(ctx as unknown as AppContext)
Object.assign(ctx, { hunter })
// The game's own map of Crushbone: a wall, and the way out.
put(join(game, 'maps', 'crushbone.txt'), 'L 0, 0, 0, 100, 100, 0, 0, 0, 0\r\n')
put(join(game, 'maps', 'crushbone_1.txt'), 'P 10, 10, 0, 0, 0, 0, 3, to_Greater_Faydark')
put(join(game, 'maps', 'unrest.txt'), 'L 0, 0, 0, 1, 1, 0, 0, 0, 0\r\n')
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>

describe('the Slayer page', () => {
  it('plans from the export, the race table and every character’s log', async () => {
    const { data, choices } = await call('slayer:plan', 'Kelwyn_neriak')
    expect(choices).toEqual(DEFAULT_CHOICES)
    expect(data.export.file).toBe('Kelwyn_neriak-Achievements.txt')
    expect(data.goals.map((g: { name: string; count: number }) => [g.name, g.count])).toEqual([
      ['Orc Stomp!', 4900],
      ['Might They Be Giants?', 4990]
    ])
    const crush = data.camps.find((c: { id: string }) => c.id === 'log:Clan Crushbone')
    // Twenty orcs in the twenty minutes and forty seconds spent killing there (the other kills count toward the time, not the achievements).
    expect(crush.kinds.map((k: { name: string }) => k.name)).toEqual(['an orc pawn'])
    expect(Math.round(crush.pace[0])).toBe(58)
    // Each kill there lowered Kaladim Residents by one.
    expect(crush.factions).toEqual([{ faction: 'Kaladim Residents', perHour: expect.closeTo(-58, 0) }])
    // The alt's giants, at its pace.
    expect(data.camps.find((c: { id: string }) => c.id === 'log:The Permafrost Caverns').pace).toEqual({ 1: expect.closeTo(32.7, 0) })
    // Most first.
    expect(data.unplaced).toEqual([
      { name: 'a riddle', n: 2 },
      { name: 'a mystery', n: 1 }
    ])
    expect(data.pending).toBe(0)
  })

  it('counts the kills since the export where the live counts are for the same export', async () => {
    const exp = await ctx.achievementFiles.exported('Kelwyn_neriak')
    ctx.liveAchievements.view = {
      character: 'Kelwyn_neriak',
      slayer: { exportAt: exp!.modified, rows: [{ name: 'Orc Stomp!', since: 60 }] }
    }
    const { data } = await call('slayer:plan', 'Kelwyn_neriak', true)
    expect(data.goals[0].count).toBe(4960)
    ctx.liveAchievements.view = null
  })

  it('asks eqlwiki for the mobs not looked up yet', async () => {
    races['an orc pawn'] = undefined as never
    delete races['an orc pawn']
    const { data } = await call('slayer:plan', 'Kelwyn_neriak', true)
    expect(data.pending).toBe(1)
    expect(asked.at(-1)).toEqual(['an orc pawn'])
    races['an orc pawn'] = 'Orc'
  })

  it('reads the plan afresh once eqlwiki taught a race, and plans without the faction costs when they cannot be read', async () => {
    delete races['an orc pawn']
    learned = true
    await call('slayer:plan', 'Kelwyn_neriak', true)
    await new Promise((r) => setTimeout(r, 0))
    races['an orc pawn'] = 'Orc'
    learned = false
    ctx.factions.causes.fail = true
    // Not the shared answer from before: eqlwiki's answer let it go.
    const { data } = await call('slayer:plan', 'Kelwyn_neriak')
    expect(data.pending).toBe(0)
    expect(data.camps.find((c: { id: string }) => c.id === 'log:Clan Crushbone').factions).toEqual([])
    ctx.factions.causes.fail = false
  })

  it('keeps the choices per character, as far as they are the right shape', async () => {
    await call('slayer:choices', 'Kelwyn_neriak', { ...DEFAULT_CHOICES, outCamps: ['log:Clan Crushbone'], travelMin: 999 })
    const { choices } = await call('slayer:plan', 'Kelwyn_neriak')
    expect(choices).toEqual({ ...DEFAULT_CHOICES, outCamps: ['log:Clan Crushbone'], travelMin: 120 })
    await planner.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'slayer-plan.json'), 'utf8')).Kelwyn_neriak.outCamps).toEqual(['log:Clan Crushbone'])
    await expect(call('slayer:choices', '../x', DEFAULT_CHOICES)).rejects.toThrow()
    await expect(call('slayer:plan', '../x')).rejects.toThrow()
  })

  it('hands the overlay the plan’s data only for a character that shows it there, and tells the overlay a choice changed', async () => {
    const exp = await ctx.achievementFiles.exported('Kelwyn_neriak')
    const c = ctx as unknown as AppContext
    expect(await planner.forOverlay(c, 'Kelwyn_neriak', exp!.modified)).toBeNull()
    await call('slayer:choices', 'Kelwyn_neriak', { ...DEFAULT_CHOICES, overlay: true })
    expect(ctx.liveAchievements.changed.at(-1)).toBe('Kelwyn_neriak')
    const got = await planner.forOverlay(c, 'Kelwyn_neriak', exp!.modified)
    expect(got?.choices.overlay).toBe(true)
    expect(got?.data.goals.map((g) => g.name)).toEqual(['Orc Stomp!', 'Might They Be Giants?'])
    // The same data again while it is fresh, for the same export.
    expect((await planner.forOverlay(c, 'Kelwyn_neriak', exp!.modified))?.data).toBe(got?.data)
    await call('slayer:choices', 'Kelwyn_neriak', { ...DEFAULT_CHOICES, outCamps: ['log:Clan Crushbone'] })
  })

  it('reads the choices kept at the next start', async () => {
    await planner.flush()
    const again = new SlayerPlanner(new LogHistory(join(h.dir, 'log-history-2.json'), SlayerPlanner.consumers), h.dir)
    again.register(ctx as unknown as AppContext)
    const { choices } = await call('slayer:plan', 'Kelwyn_neriak')
    expect(choices.outCamps).toEqual(['log:Clan Crushbone'])
    planner.register(ctx as unknown as AppContext)
  })

  it('has nothing to plan without an achievements export', async () => {
    const { data } = await call('slayer:plan', 'Aldric_neriak')
    expect(data).toMatchObject({ export: null, goals: [], camps: [] })
  })

  it('paces with the spawn tables, their timers scaled to the respawns timed', async () => {
    const { data } = await call('slayer:plan', 'Kelwyn_neriak')
    // Khrix Fritchoff timed at 7:21 in Unrest, against sixteen minutes classic.
    expect(data.timings).toEqual([{ zone: 'The Estate of Unrest', timer: 441, timed: [{ name: 'Khrix Fritchoff', legends: 441, classic: 960 }] }])
    // Under an hour hunted anywhere: no usual pace of the player's own.
    expect(data.killSpeed).toBeNull()
    expect(data.camps.some((c: { source: string }) => c.source === 'spawns')).toBe(true)
    // The log's orc pawns, and what their spawns allow.
    expect(data.camps.find((c: { id: string }) => c.id === 'log:Clan Crushbone').kinds[0].spawn).toMatchObject({ name: 'orc pawn', race: 'Orc' })
    // Twenty minutes of Crushbone, then out: no trip yet.
    expect(data.moves).toEqual([])
    expect(data.hunter.map((z: { achievement: string; left: { name: string; spawn?: unknown }[] }) => [z.achievement, z.left.map((n) => [n.name, !!n.spawn])])).toEqual([
      ['Hunter of Clan Crushbone', [['Ambassador DVinn', true]]]
    ])
  })

  it('takes the player’s usual pace from the zones hunted an hour or more', () => {
    const z = (sec: number, kills: number) => ({ sec, kills, last: 0, mobs: {} })
    expect(usualPace({ a: z(3600, 100), b: z(7200, 100), c: z(600, 999) })).toBe(75)
    expect(usualPace({ a: z(3600, 100), b: z(3600, 50), c: z(3600, 70) })).toBe(70)
    expect(usualPace({})).toBeNull()
  })

  it('lists the Hunter named left for Plan › Hunter', async () => {
    const data = await call('hunter:plan', 'Kelwyn_neriak')
    expect(data.zones.map((z: { zone: string; left: { name: string }[]; total: number }) => [z.zone, z.left.map((n) => n.name), z.total])).toEqual([
      ['Clan Crushbone', ['Ambassador DVinn'], 2]
    ])
    expect(await call('hunter:plan', 'Aldric_neriak')).toEqual({ character: 'Aldric_neriak', export: null, zones: [], broken: [] })
    await expect(call('hunter:plan', '../x')).rejects.toThrow()
    // Said not to work: out of Plan › Hunter and the Slayer plan's steps, for every character, until it works again.
    expect(await call('hunter:broken', 'Hunter of Clan Crushbone', true)).toEqual(['Hunter of Clan Crushbone'])
    expect(await call('hunter:broken', 'hunter of clan crushbone', true)).toEqual(['hunter of clan crushbone'])
    expect(await call('hunter:plan', 'Kelwyn_neriak')).toMatchObject({ zones: [], broken: ['hunter of clan crushbone'] })
    expect((await call('slayer:plan', 'Kelwyn_neriak', true)).data.hunter).toEqual([])
    await hunter.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'hunter-broken.json'), 'utf8'))).toEqual({ broken: ['hunter of clan crushbone'] })
    // Kept at the next start; one in a bad shape left out.
    writeFileSync(join(h.dir, 'hunter-broken.json'), JSON.stringify({ broken: ['Hunter of Clan Crushbone', 3] }))
    const again = new HunterPlanner(new LogHistory(join(h.dir, 'log-history-h2.json'), SlayerPlanner.consumers), h.dir)
    expect(again.isBroken('HUNTER OF CLAN CRUSHBONE')).toBe(true)
    writeFileSync(join(h.dir, 'hunter-broken.json'), 'not json')
    expect(new HunterPlanner(new LogHistory(join(h.dir, 'log-history-h3.json'), SlayerPlanner.consumers), h.dir).isBroken('x')).toBe(false)
    expect(await call('hunter:broken', 'Hunter of Clan Crushbone', false)).toEqual([])
    expect((await call('hunter:plan', 'Kelwyn_neriak')).zones).toHaveLength(1)
    await expect(call('hunter:broken', '', true)).rejects.toThrow()
  })

  it('draws a step’s zone from the game’s map files, with the spots its mobs pop at', async () => {
    const map = await call('slayer:map', 'Clan Crushbone 1 (Awakened)', ['An orc pawn'])
    expect(map).toMatchObject({ zone: 'Clan Crushbone', short: 'crushbone', lines: [0, 0, 100, 100], labels: [{ x: 10, y: 10, text: 'to Greater Faydark' }] })
    expect(map.spots.length).toBeGreaterThan(0)
    expect(map.spots[0].mobs[0].name).toBe('orc pawn')
    expect(await call('slayer:map', 'Lake Nerius', ['a fish'])).toEqual({ zone: 'Lake Nerius', short: '', lines: [], labels: [], spots: [] })
    await expect(call('slayer:map', 3, [])).rejects.toThrow()
  })

  it('marks the Hunter named in a copy of the game’s maps, never a Slayer camp’s mobs, and clears them', async () => {
    const set = join(game, 'maps', 'LegendsTracker')
    const r = await call(
      'slayer:mark',
      [
        // Mobs sent with them are left off: a Slayer camp's mobs are everywhere in its zone.
        { zone: 'Clan Crushbone', mobs: ['an orc pawn'], named: ['Ambassador DVinn'] },
        { zone: 'The Estate of Unrest', mobs: [], named: ['Khrix Fritchoff'] },
        { zone: 'Lake Nerius', mobs: [], named: ['a fish'] }
      ],
      'hunter'
    )
    expect(r.zones).toBe(2)
    // The game's maps copied; its own label layer as it was.
    expect(readFileSync(join(set, 'crushbone.txt'), 'latin1')).toContain('L 0, 0, 0')
    expect(readFileSync(join(game, 'maps', 'crushbone_1.txt'), 'latin1')).not.toContain('Hunter_')
    const marked = readFileSync(join(set, 'crushbone_1.txt'), 'latin1')
    expect(marked).toContain('to_Greater_Faydark\r\nP ')
    expect(marked).toContain('Hunter_Ambassador_DVinn')
    expect(marked).not.toContain('Slayer_')
    // Unrest has no label layer of the game's: the marks alone.
    expect(readFileSync(join(set, 'unrest_1.txt'), 'latin1')).toContain('Hunter_Khrix_Fritchoff')
    // Cleared: Unrest's layer gone, Crushbone's the game's own again.
    await call('slayer:mark', [], 'hunter')
    expect(existsSync(join(set, 'unrest_1.txt'))).toBe(false)
    expect(readFileSync(join(set, 'crushbone_1.txt'), 'latin1')).toBe(readFileSync(join(game, 'maps', 'crushbone_1.txt'), 'latin1'))
    await expect(call('slayer:mark', 'x', 'hunter')).rejects.toThrow()
    await expect(call('slayer:mark', [], 'slayer')).rejects.toThrow()
    await expect(markMaps('', [])).rejects.toThrow('game folder')
    await planner.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'map-marks.json'), 'utf8'))).toEqual({ hunter: [] })
  })

  it('takes the Slayer marks an older version put on the game’s maps off at start', async () => {
    const set = join(game, 'maps', 'LegendsTracker')
    const dir = join(h.dir, 'old-marks')
    put(
      join(dir, 'map-marks.json'),
      JSON.stringify({ slayer: [{ zone: 'Clan Crushbone', mobs: ['an orc pawn'] }], hunter: [{ zone: 'The Estate of Unrest', mobs: [], named: ['Khrix Fritchoff'] }] })
    )
    put(join(set, 'crushbone_1.txt'), 'P 10, 10, 0, 0, 0, 0, 3, to_Greater_Faydark\r\nP 1.0000, 2.0000, 0.0000, 240, 40, 40, 2, Slayer_orc_pawn\r\n')
    const old = new SlayerPlanner(new LogHistory(join(dir, 'log-history.json'), SlayerPlanner.consumers), dir)
    old.register(ctx as unknown as AppContext)
    for (let i = 0; i < 50 && readFileSync(join(set, 'crushbone_1.txt'), 'latin1').includes('Slayer_'); i++) await new Promise((r) => setTimeout(r, 20))
    expect(readFileSync(join(set, 'crushbone_1.txt'), 'latin1')).not.toContain('Slayer_')
    expect(readFileSync(join(set, 'unrest_1.txt'), 'latin1')).toContain('Hunter_Khrix_Fritchoff')
    // The marks kept say so once the maps are written: the Slayer set is gone.
    const kept = async () => (await old.flush(), JSON.parse(readFileSync(join(dir, 'map-marks.json'), 'utf8')))
    for (let i = 0; i < 50 && 'slayer' in (await kept()); i++) await new Promise((r) => setTimeout(r, 20))
    expect(await kept()).toEqual({ hunter: [{ zone: 'The Estate of Unrest', mobs: [], named: ['Khrix Fritchoff'] }] })
    planner.register(ctx as unknown as AppContext)
  })
})
