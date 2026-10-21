import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { listLogs } from '../../../src/main/game'
import { tempDir } from '../../tempDir'

// The Hunter named on a Slayer step count for the character that killed them: every character's log
// feeds the pace and the travel, but a named an alt killed after this character's export is still
// this character's to kill (LT-715), as Plan › Hunter has it.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-slayer-own-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { SlayerPlanner } = await import('../../../src/features/slayer/main')
const { HunterPlanner } = await import('../../../src/features/hunter/main')
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
put(join(game, 'dbstr_us.txt'), ['54^11^Orc^0^', '54^12^Orcs^0^'].join('\r\n'))
mkdirSync(join(game, 'Resources'), { recursive: true })
const exportPath = join(game, 'Kelwyn_neriak-Achievements.txt')
put(
  exportPath,
  [
    'Slayer: Conquest',
    'I\tOrc Stomp!',
    'I\t\tOrcs and Wereorcs.\t4900/5000',
    'EverQuest: Hunter',
    'I\tHunter of Clan Crushbone',
    'I\t\tAmbassador DVinn',
    'I\t\tOrc Centurion'
  ].join('\r\n')
)
// Written at nine in the morning; every kill below came after it.
const exportAt = new Date(2026, 8, 28, 9, 0, 0)
utimesSync(exportPath, exportAt, exportAt)
// The character: orcs in Crushbone, and the centurion among them.
const kelwyn = [line('10:00:00', 'You have entered Clan Crushbone.')]
for (let i = 1; i <= 10; i++) kelwyn.push(line(`10:${String(i).padStart(2, '0')}:00`, 'You have slain an orc pawn!'))
kelwyn.push(line('10:11:00', 'You have slain Orc Centurion!'))
put(join(game, 'Logs', 'eqlog_Kelwyn_neriak.txt'), kelwyn.join(''))
// An alt in the same zone the same day: the ambassador is its kill, not the character's.
put(join(game, 'Logs', 'eqlog_Aldric_neriak.txt'), [line('12:00:00', 'You have entered Clan Crushbone.'), line('12:05:00', 'You have slain Ambassador DVinn!')].join(''))

const races: Record<string, string | null> = { 'an orc pawn': 'Orc', 'orc centurion': 'Orc', 'ambassador dvinn': 'Orc' }
const ctx = {
  installDir: () => game,
  store: {
    dir: h.dir,
    characterByKey: () => ({ level: 50, classLevels: {}, focusSources: [] }),
    settings: { get: () => ({ logFile: join(game, 'Logs', 'eqlog_Kelwyn_neriak.txt') }) },
    respawns: { get: () => ({}) }
  },
  gameTables: new GameTables(() => game),
  achievementFiles: new AchievementFiles(
    h.dir,
    () => game,
    () => {}
  ),
  historyOf: (c: string) => ({ logPath: join(game, 'Logs', `eqlog_${c}.txt`), archiveDir: join(game, 'Logs', 'Archive'), stem: `eqlog_${c}` }),
  logCharacters: async () => (await listLogs(game)).map((l) => l.character),
  npcPages: { ready: async () => undefined, race: (m: string) => (m.toLowerCase() in races ? races[m.toLowerCase()] : undefined), lookUp: async () => false },
  liveAchievements: { slayerChoicesChanged: () => {} },
  factions: { follow: { raisedByPlan: () => [] as string[] }, causes: { view: async () => ({ acts: {} }) } }
}
const planner = new SlayerPlanner(new LogHistory(join(h.dir, 'log-history.json'), SlayerPlanner.consumers), h.dir)
planner.register(ctx as unknown as AppContext)
const hunter = new HunterPlanner(new LogHistory(join(h.dir, 'log-history-h.json'), SlayerPlanner.consumers), h.dir)
hunter.register(ctx as unknown as AppContext)
Object.assign(ctx, { hunter })
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>

describe('the Hunter named on a Slayer step', () => {
  it('count for the character that killed them, not an alt (LT-715), while every log feeds the pace', async () => {
    const { data } = await call('slayer:plan', 'Kelwyn_neriak', true)
    expect(data.hunter.map((z: { zone: string; left: { name: string }[]; since: string[] }) => [z.zone, z.left.map((n) => n.name), z.since])).toEqual([
      ['Clan Crushbone', ['Ambassador DVinn'], ['Orc Centurion']]
    ])
    // Plan › Hunter says the same of it.
    const plan = await call('hunter:plan', 'Kelwyn_neriak')
    expect(plan.zones.map((z: { left: { name: string }[]; since: string[] }) => [z.left.map((n) => n.name), z.since])).toEqual([[['Ambassador DVinn'], ['Orc Centurion']]])
    // The alt's kill is in the zone's pace all the same: twelve kills over the two logs.
    expect(data.camps.some((c: { zone: string }) => c.zone === 'Clan Crushbone')).toBe(true)
  })
})
