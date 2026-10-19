import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { tempDir } from '../../tempDir'

// How the Slayer feature's live counts read the log (liveSource.ts), apart from when the overlay asks
// (main/liveAchievements.test.ts) and the counts end to end (main/liveSlayer.test.ts): a log replaced
// at its path, and the character's log on another PC.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('../../../src/main/paths', () => ({ cacheDir: () => h.dir }))

h.dir = tempDir('eql-slayer-live-')
const { SlayerLive } = await import('../../../src/features/slayer/liveSource')

const T0 = new Date(2026, 8, 30, 12, 0, 0).getTime()

/** The counts on a context with the character's logs and what tells a mob from a player. */
function live(ctx: object) {
  return new SlayerLive({ store: { dir: h.dir }, engine: { meter: { kindOf: () => ({ kind: 'mob' }) } }, ...ctx } as unknown as AppContext, () => null)
}

describe('SlayerLive counts the kills since the export', () => {
  it('reads a log replaced at its path from the export again, not from the old offset into the new file (LT-625)', async () => {
    const root = tempDir('eql-slayer-')
    const here = join(root, 'eqlog_Tester_neriak.txt')
    const kill = (stamp: string, mob = 'a gnoll') => `[${stamp}] You have slain ${mob}!\r\n`
    await fs.writeFile(here, kill('Wed Sep 30 11:59:00 2026') + kill('Wed Sep 30 12:00:10 2026'))
    const l = live({
      historyOf: () => ({ logPath: here, archiveDir: join(root, 'archive'), stem: 'eqlog_Tester_neriak', elsewhere: [] }),
      logHistory: { reachable: async () => true },
      slayer: { namedKilled: () => undefined }
    })
    const s = {
      character: 'Tester_neriak',
      exportAt: T0,
      logPath: here,
      readTo: -1,
      logId: '',
      others: new Map<string, number>(),
      zoneIn: new Map<string, string>(),
      kills: new Map<string, { name: string; times: number[]; zones?: string[] }>(),
      pets: new Set<string>(),
      engaged: new Map<string, number>(),
      completed: new Map<string, number>(),
      counts: new Map<string, number>()
    }
    const readLog = (l as unknown as { readLog: (state: typeof s) => Promise<void> }).readLog.bind(l)
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(1)
    expect(s.logId).not.toBe('')
    const readTo = s.readTo
    // Another log at the same path, longer than the old read: its kills after the export count, from the export on.
    await fs.rm(here)
    await fs.writeFile(
      here,
      kill('Wed Sep 30 11:58:00 2026', 'a bat') + kill('Wed Sep 30 12:00:30 2026', 'a bat') + kill('Wed Sep 30 12:01:00 2026', 'a bat') + kill('Wed Sep 30 12:02:00 2026', 'a bat')
    )
    expect((await fs.stat(here)).size).toBeGreaterThan(readTo)
    await readLog(s)
    expect(s.kills.get('a bat')?.times).toHaveLength(3)
  })

  it("in the character's log on another PC too: in time order, each log read on from where it got to, one out of reach left alone", async () => {
    const root = tempDir('eql-slayer-')
    const here = join(root, 'eqlog_Tester_neriak.txt')
    const there = join(root, 'there', 'Logs')
    const otherLog = join(there, 'eqlog_Tester_neriak.txt')
    await fs.mkdir(there, { recursive: true })
    const kill = (stamp: string) => `[${stamp}] You have slain a gnoll!\r\n`
    const entered = (stamp: string, zone: string) => `[${stamp}] You have entered ${zone}.\r\n`
    // Before the export, then after it on this PC and on the other in turn.
    await fs.writeFile(
      here,
      entered('Wed Sep 30 11:50:00 2026', 'The Western Plains of Karana') + kill('Wed Sep 30 11:59:00 2026') + kill('Wed Sep 30 12:00:10 2026') + kill('Wed Sep 30 12:05:00 2026')
    )
    await fs.writeFile(otherLog, entered('Wed Sep 30 11:57:00 2026', 'Lake Rathetear') + kill('Wed Sep 30 11:58:00 2026') + kill('Wed Sep 30 12:01:40 2026'))
    let answers = true
    const killedNamed: string[] = []
    const l = live({
      historyOf: () => ({
        logPath: here,
        archiveDir: join(root, 'archive'),
        stem: 'eqlog_Tester_neriak',
        elsewhere: [{ folder: there, logPath: otherLog, archiveDir: join(there, 'archive') }]
      }),
      logHistory: { reachable: async () => answers },
      slayer: { namedKilled: (mobs: string[]) => killedNamed.push(...mobs) }
    })
    const s = {
      character: 'Tester_neriak',
      exportAt: T0,
      logPath: here,
      readTo: -1,
      others: new Map<string, number>(),
      zoneIn: new Map<string, string>(),
      kills: new Map<string, { name: string; times: number[]; zones?: string[] }>(),
      pets: new Set<string>(),
      engaged: new Map<string, number>(),
      completed: new Map<string, number>(),
      counts: new Map<string, number>()
    }
    const readLog = (l as unknown as { readLog: (state: typeof s) => Promise<void> }).readLog.bind(l)
    const at = (hms: string) => new Date(`2026-09-30T${hms}`).getTime()
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toEqual([at('12:00:10'), at('12:01:40'), at('12:05:00')])
    // Each kill is handed on, so a Hunter named killed comes off the game's map.
    expect(killedNamed).toContain('a gnoll')
    // Each kill in the zone its log was in, found back before the export where the read began, and kept beside its time.
    expect(s.kills.get('a gnoll')?.zones).toEqual(['The Western Plains of Karana', 'Lake Rathetear', 'The Western Plains of Karana'])
    expect(s.zoneIn.get(here.toLowerCase())).toBe('The Western Plains of Karana')
    expect(s.readTo).toBe((await fs.stat(here)).size)
    expect(s.others.get(otherLog.toLowerCase())).toBe((await fs.stat(otherLog)).size)

    await fs.appendFile(otherLog, entered('Wed Sep 30 12:06:00 2026', 'The Rathe Mountains') + kill('Wed Sep 30 12:06:40 2026'))
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(4)
    expect(s.kills.get('a gnoll')?.zones?.at(-1)).toBe('The Rathe Mountains')

    // That PC off: its log is not touched, and what it counted stands.
    answers = false
    await fs.appendFile(otherLog, kill('Wed Sep 30 12:08:00 2026'))
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(4)
    answers = true
    await readLog(s)
    expect(s.kills.get('a gnoll')?.times).toHaveLength(5)
    await fs.rm(root, { recursive: true, force: true })
  })

  it('credits the player’s, its pet’s and its group’s kills, a mob it was hurting that died, never a player; and keeps the achievements the game said were done', async () => {
    const root = tempDir('eql-slayer-')
    const here = join(root, 'eqlog_Tester_neriak.txt')
    const line = (stamp: string, text: string) => `[Wed Sep 30 ${stamp} 2026] ${text}
`
    await fs.writeFile(
      here,
      [
        line('12:00:20', "Grunt told you, 'Attacking a hill giant Master.'"),
        line('12:00:30', 'a hill giant has been slain by Grunt!'),
        // A mob killed one of the player's side, and the player killed a player: neither is a Slayer kill.
        line('12:00:40', 'Kelwyn has been slain by a gnoll!'),
        line('12:00:50', 'You have slain Fenwick!'),
        // Hurt by the player, then died with no killer named (a damage-over-time kill); a rat the player never touched did too.
        line('12:01:00', 'You pierce a bat for 12 points of damage.'),
        line('12:01:05', 'a bat died.'),
        line('12:01:10', 'a rat died.'),
        line('12:01:20', 'You have completed achievement: Orc Stomp!'),
        line('12:01:30', 'a hill giant has been slain by Vonartik!'),
        line('12:01:40', 'a hill giant has been slain by Stranger!')
      ].join('')
    )
    const kinds: Record<string, { kind: string; owner?: string }> = { Fenwick: { kind: 'player' }, Vonartik: { kind: 'group' }, Stranger: { kind: 'player' } }
    const killedNamed: string[] = []
    const l = live({
      historyOf: () => ({ logPath: here, archiveDir: join(root, 'archive'), stem: 'eqlog_Tester_neriak', elsewhere: [] }),
      logHistory: { reachable: async () => true },
      slayer: { namedKilled: (mobs: string[]) => killedNamed.push(...mobs) },
      engine: { meter: { kindOf: (name: string) => kinds[name] ?? { kind: 'mob' } } }
    })
    const s = {
      character: 'Tester_neriak',
      exportAt: T0,
      logPath: here,
      readTo: -1,
      others: new Map<string, number>(),
      zoneIn: new Map<string, string>(),
      kills: new Map<string, { name: string; times: number[]; zones?: string[] }>(),
      pets: new Set<string>(),
      engaged: new Map<string, number>(),
      completed: new Map<string, number>(),
      counts: new Map<string, number>()
    }
    await (l as unknown as { readLog: (state: typeof s) => Promise<void> }).readLog(s)
    const at = (hms: string) => new Date(`2026-09-30T${hms}`).getTime()
    expect(s.pets).toEqual(new Set(['Grunt']))
    expect([...s.kills.keys()]).toEqual(['a hill giant', 'a bat'])
    expect(s.kills.get('a hill giant')?.times).toEqual([at('12:00:30'), at('12:01:30')])
    expect(s.completed).toEqual(new Map([['orc stomp!', at('12:01:20')]]))
    expect(killedNamed).toEqual(['a hill giant', 'a bat', 'a hill giant'])
    // What the counts answer for the character they are for, and nothing for another.
    Object.assign(l, { state: s })
    expect(l.character).toBe('Tester_neriak')
    expect(l.kills('Tester_neriak')).toBe(s.kills)
    expect(l.completed('Tester_neriak')).toEqual(new Set(['orc stomp!']))
    expect(l.killsSince('Tester_neriak', ['A Hill Giant', 'a bat'], at('12:01:00'))).toBe(2)
    expect([l.kills('Someone_else'), l.completed('Someone_else'), l.killsSince('Someone_else', ['a bat'], 0)]).toEqual([undefined, undefined, 0])
    l.reset()
    expect([l.character, l.view]).toEqual([null, null])
    await fs.rm(root, { recursive: true, force: true })
  })
})
