import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { tempDir } from '../../tempDir'

// Plan › Plane of Sky's main side against a log on disk, read as the app reads it: the Sky's items
// counted, a hand-in to the Monk giver, and the wish list and corrections kept in sky.json.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-sky-main-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { SkyTracker } = await import('../../../src/features/sky/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { rendererUrl } = await import('../../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }

const logs = join(h.dir, 'game', 'Logs')
mkdirSync(logs, { recursive: true })
const line = (stamp: string, text: string) => `[Tue Sep 29 ${stamp} 2026] ${text}\r\n`
writeFileSync(
  join(logs, 'eqlog_Kelwyn_neriak.txt'),
  [
    line('21:00:00', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
    line('21:00:01', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
    line('21:00:02', "You looted a Wind Rune Neza from a blade storm's corpse and stored it in your currency"),
    line('21:11:00', 'You offered 1 Nebulous Sapphire to Holwin.'),
    line('21:11:01', 'You offered 1 Wind Rune Neza to Holwin.'),
    line('21:11:03', 'You complete the trade with Holwin.')
  ].join('')
)

const ctx = {
  store: { dir: h.dir, settings: { get: () => ({ characters: { Kelwyn_neriak: { level: 50, classLevels: { Monk: 50 }, focusSources: [] } } }) } },
  historyOf: (c: string) => ({ logPath: join(logs, `eqlog_${c}.txt`), archiveDir: join(logs, 'Archive'), stem: `eqlog_${c}` })
}
const sky = SkyTracker.create({ logHistory: new LogHistory(join(h.dir, 'log-history.json'), SkyTracker.consumers), dir: h.dir })
sky.register(ctx as unknown as AppContext)
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>

const FISTS = 'Monk Test of Fists'

describe('the Plane of Sky page', () => {
  it('counts the Sky’s items and hand-ins from the log, with the character’s classes', async () => {
    const s = await call('sky:state', 'Kelwyn_neriak')
    expect(s.logged).toEqual({ 'nebulous sapphire': 1, 'wind rune neza': 0 })
    expect(s.runs[FISTS]).toHaveLength(1)
    expect(s.classes).toEqual(['Monk'])
    expect(s.wishes).toEqual([])
  })

  it('keeps a wish, changes how many times it is wanted, and drops it at none', async () => {
    let s = await call('sky:wish', 'Kelwyn_neriak', FISTS, 2)
    expect(s.wishes).toEqual([{ quest: FISTS, want: 2, since: expect.any(Number) }])
    const since = s.wishes[0].since
    s = await call('sky:wish', 'Kelwyn_neriak', FISTS, 3, 1)
    expect(s.wishes).toEqual([{ quest: FISTS, want: 3, since, extra: 1 }])
    s = await call('sky:wish', 'Kelwyn_neriak', FISTS, 4)
    expect(s.wishes[0].extra).toBe(1)
    await sky.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'sky.json'), 'utf8')).characters.Kelwyn_neriak.wishes[0].want).toBe(4)
    s = await call('sky:wish', 'Kelwyn_neriak', FISTS, 0)
    expect(s.wishes).toEqual([])
  })

  it('keeps what the player says they hold as a difference from the log’s count', async () => {
    let s = await call('sky:have', 'Kelwyn_neriak', 'Brass Knuckles', 2)
    expect(s.adjust).toEqual({ 'brass knuckles': 2 })
    s = await call('sky:have', 'Kelwyn_neriak', 'Nebulous Sapphire', 3)
    expect(s.adjust['nebulous sapphire']).toBe(2)
    // The log's own count again: no correction kept.
    s = await call('sky:have', 'Kelwyn_neriak', 'Nebulous Sapphire', 1)
    expect(s.adjust).toEqual({ 'brass knuckles': 2 })
  })

  it('refuses what a page should never send', async () => {
    await expect(call('sky:state', '../x')).rejects.toThrow('No such character.')
    await expect(call('sky:wish', 'Kelwyn_neriak', 'Monk Test of Nothing', 1)).rejects.toThrow('No such Test.')
    await expect(call('sky:wish', 'Kelwyn_neriak', FISTS, 1.5)).rejects.toThrow('Want it 0 to 99 times.')
    await expect(call('sky:wish', 'Kelwyn_neriak', FISTS, 1, -1)).rejects.toThrow('No more than 99 hand-ins.')
    await expect(call('sky:have', 'Kelwyn_neriak', 'Bone Chips', 1)).rejects.toThrow('Not an item a Test takes.')
    await expect(call('sky:have', 'Kelwyn_neriak', 'Brass Knuckles', -1)).rejects.toThrow('Hold 0 to 9999.')
  })

  it('reads sky.json back as it was kept', async () => {
    await call('sky:wish', 'Kelwyn_neriak', FISTS, 2)
    await sky.flush()
    const again = SkyTracker.create({ logHistory: new LogHistory(join(h.dir, 'log-history-2.json'), SkyTracker.consumers), dir: h.dir })
    h.handlers.clear()
    again.register(ctx as unknown as AppContext)
    const s = await call('sky:state', 'Kelwyn_neriak')
    expect(s.wishes.map((w: { quest: string; want: number }) => [w.quest, w.want])).toEqual([[FISTS, 2]])
    expect(s.adjust).toEqual({ 'brass knuckles': 2 })
  })
})
