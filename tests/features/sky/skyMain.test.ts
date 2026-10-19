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

const item = (location: string, name: string, count = 1) => ({ location, name, id: 1, count, augs: [] })
/** The exports, as the game wrote them: none until a test gives one. */
const exports: { inventory: unknown; achievements: unknown } = { inventory: null, achievements: null }
const ctx = {
  store: {
    dir: h.dir,
    settings: { get: () => ({ characters: { Kelwyn_neriak: { level: 50, classLevels: { Monk: 50 }, focusSources: [] } } }) },
    // One Sky named the Respawns records saw die and come back (LT-735).
    respawns: {
      get: () => ({
        'the plane of sky|noble dojorn': { zone: 'The Plane of Sky', name: 'Noble Dojorn', kills: 2, lastDeath: Date.now() - 40 * 60_000, pendingSince: 0, gaps: [], shared: false }
      })
    }
  },
  historyOf: (c: string) => ({ logPath: join(logs, `eqlog_${c}.txt`), archiveDir: join(logs, 'Archive'), stem: `eqlog_${c}` }),
  inventoryFiles: { exported: async () => exports.inventory },
  achievementFiles: { exported: async () => exports.achievements }
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
    expect(s.respawns).toEqual({ 'Noble Dojorn': 'died 40 min ago, seen since' })
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

  it('stars a Test, ignores one, and keeps the hand-ins the player adds', async () => {
    let s = await call('sky:mark', 'Kelwyn_neriak', FISTS, 'favorite', true)
    expect(s.favorites).toEqual([FISTS])
    s = await call('sky:mark', 'Kelwyn_neriak', 'Monk Test of Sight', 'ignored', true)
    expect(s.ignored).toEqual(['Monk Test of Sight'])
    s = await call('sky:mark', 'Kelwyn_neriak', FISTS, 'favorite', false)
    expect(s.favorites).toEqual([])
    s = await call('sky:turnIns', 'Kelwyn_neriak', FISTS, 2)
    expect(s.turnIns).toEqual({ [FISTS]: 2 })
    s = await call('sky:turnIns', 'Kelwyn_neriak', FISTS, 0)
    expect(s.turnIns).toEqual({})
  })

  it('counts the inventory export’s Sky items and reads the class unlocks from the achievements export', async () => {
    exports.inventory = {
      file: 'Kelwyn_neriak-Inventory.txt',
      modified: 5,
      inventory: {
        worn: [item('Primary', "Wu's Fist of Mastery +10")],
        bags: [item('General 1-Slot1', 'Nebulous Sapphire', 2), item('General 1-Slot2', 'Bone Chips', 9)],
        bank: [item('Bank1-Slot1', 'Nebulous Sapphire')],
        sharedBank: [],
        depot: [],
        keyRing: []
      }
    }
    exports.achievements = {
      file: 'Kelwyn_neriak-Achievements.txt',
      modified: 6,
      sections: [
        {
          cat: 'Untapped Potential',
          name: 'Classes',
          ach: [
            { n: 'Primary Class Unlock - Monk', c: [{ t: "Obtain Ton Po's Eye Patch.", d: true }, { t: 'Obtain Back Straps of Mastery.' }] },
            {
              n: 'Primary Class Unlock - Bard',
              d: true,
              c: [
                { t: 'Obtain Mask of Song.', d: true },
                { t: 'This achievement will autocomplete if you chose to confirm your Primary Class as a Bard.', d: true }
              ]
            }
          ]
        }
      ]
    }
    const s = await call('sky:state', 'Kelwyn_neriak')
    exports.inventory = exports.achievements = null
    expect(s.exported).toEqual({ file: 'Kelwyn_neriak-Inventory.txt', modified: 5, counts: { 'wus fist of mastery': 1, 'nebulous sapphire': 3 } })
    expect(s.achieved).toEqual({ modified: 6, obtained: ['Monk Test of Sight'], unlocked: expect.objectContaining({ Monk: false, Bard: true, Warrior: true }), granted: ['Bard'] })
  })

  it('refuses what a page should never send', async () => {
    await expect(call('sky:state', '../x')).rejects.toThrow('No such character.')
    await expect(call('sky:wish', 'Kelwyn_neriak', 'Monk Test of Nothing', 1)).rejects.toThrow('No such Test.')
    await expect(call('sky:wish', 'Kelwyn_neriak', FISTS, 1.5)).rejects.toThrow('Want it 0 to 99 times.')
    await expect(call('sky:wish', 'Kelwyn_neriak', FISTS, 1, -1)).rejects.toThrow('No more than 99 hand-ins.')
    await expect(call('sky:have', 'Kelwyn_neriak', 'Bone Chips', 1)).rejects.toThrow('Not an item a Test takes.')
    await expect(call('sky:have', 'Kelwyn_neriak', 'Brass Knuckles', -1)).rejects.toThrow('Hold 0 to 9999.')
    await expect(call('sky:mark', 'Kelwyn_neriak', FISTS, 'hidden', true)).rejects.toThrow('Star a Test or ignore it.')
    await expect(call('sky:turnIns', 'Kelwyn_neriak', FISTS, 100)).rejects.toThrow('Add or take away up to 99 hand-ins.')
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
