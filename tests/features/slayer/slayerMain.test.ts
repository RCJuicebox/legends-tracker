import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'

// The Slayer page's main side against a game folder on disk: the achievements export, the client's
// race table and two characters' logs, read as the app reads them. The live Slayer tracker (eqlwiki's
// races, what the exports settled) and the faction lines after kills are stood in for.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = mkdtempSync(join(tmpdir(), 'lt-slayer-main-'))
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { SlayerPlanner } = await import('../../../src/features/slayer/main')
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
  ['Slayer: Conquest', 'I\tOrc Stomp!', 'I\t\tOrcs and Wereorcs.\t4900/5000', 'I\tMight They Be Giants?', 'I\t\tGiants\t4990/5000'].join('\r\n')
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
  gameTables: new GameTables(() => game),
  achievementFiles: new AchievementFiles(
    h.dir,
    () => game,
    () => {}
  ),
  historyOf: (c: string) => ({ logPath: join(game, 'Logs', `eqlog_${c}.txt`), archiveDir: join(game, 'Logs', 'Archive'), stem: `eqlog_${c}` }),
  liveAchievements: {
    view: null as unknown,
    races: {
      ready: async () => undefined,
      race: (m: string) => (m.toLowerCase() in races ? races[m.toLowerCase()] : undefined),
      lookUp: async (mobs: string[]) => (asked.push(mobs), learned)
    },
    fact: () => undefined
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
})
