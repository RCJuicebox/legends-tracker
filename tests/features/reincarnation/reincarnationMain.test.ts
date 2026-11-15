import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { tempDir } from '../../tempDir'

// Goals › Reincarnation's main side against a log on disk, read as the app reads it: a reincarnation's
// four ranks from the AA lines, the priority list and class levels kept, ranks set by hand, a
// reincarnation said made, and the tokens in the inventory export.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-reinc-main-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { ReincarnationTracker } = await import('../../../src/features/reincarnation/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { AaHistory, aaConsumer } = await import('../../../src/main/aaHistory')
const { rendererUrl } = await import('../../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }

const logs = join(h.dir, 'game', 'Logs')
mkdirSync(logs, { recursive: true })
const line = (stamp: string, text: string) => `[Tue Nov 10 ${stamp} 2026] ${text}\r\n`
writeFileSync(
  join(logs, 'eqlog_Kelwyn_neriak.txt'),
  [
    line('01:00:00', 'You have gained the ability "Class Reincarnation: Rogue" at a cost of 0 ability points.'),
    line('01:00:00', 'You have gained the ability "Class Reincarnation: Shadow Knight" at a cost of 0 ability points.'),
    line('01:00:00', 'You have gained the ability "Class Reincarnation: Wizard" at a cost of 0 ability points.'),
    line('01:00:00', 'You have gained the ability "Race Reincarnation: Dark Elf" at a cost of 0 ability points.')
  ].join('')
)

const exports: { inventory: unknown } = { inventory: null }
const ctx = {
  store: {
    dir: h.dir,
    settings: { get: () => ({ characters: { Kelwyn_neriak: { level: 1, race: 'Dark Elf', classLevels: { Rogue: 1, 'Shadow Knight': 1, Wizard: 1 }, focusSources: [] } } }) }
  },
  installDir: () => join(h.dir, 'game'),
  historyOf: (c: string) => ({ logPath: join(logs, `eqlog_${c}.txt`), archiveDir: join(logs, 'Archive'), stem: `eqlog_${c}` }),
  aaHistory: new AaHistory(new LogHistory(join(h.dir, 'log-history.json'), { aas: aaConsumer }), 'aas'),
  inventoryFiles: { exported: async () => exports.inventory }
}
const reinc = ReincarnationTracker.create({ logHistory: null as never, dir: h.dir })
reinc.register(ctx as unknown as AppContext)
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>
const C = 'Kelwyn_neriak'

describe('the Reincarnation page', () => {
  it('reads the ranks a reincarnation gave from the log, with the loadout', async () => {
    const s = await call('reincarnation:state', C)
    expect(s.ranks['class:rog']).toEqual({ rank: 1, from: 'log', logged: 1 })
    expect(s.ranks['race:Dark Elf'].rank).toBe(1)
    expect(s.ranks['class:mnk']).toEqual({ rank: 0, from: 'none', logged: 0 })
    expect(s.completionist).toBe(0)
    expect(s.history).toEqual([{ at: expect.any(Number), classes: ['rog', 'shd', 'wiz'], race: 'Dark Elf', by: 'log' }])
    expect(s.loadout).toEqual({
      race: 'Dark Elf',
      classes: expect.arrayContaining([
        { id: 'rog', level: 1 },
        { id: 'wiz', level: 1 }
      ])
    })
    expect(s.tokens).toBeNull()
  })

  it('keeps the priority list, the anchor class and the classes said at the cap', async () => {
    let s = await call('reincarnation:priority', C, [
      { key: 'class:mnk', rank: 3 },
      { key: 'race:Dwarf', rank: 1 }
    ])
    expect(s.priority).toEqual([
      { key: 'class:mnk', rank: 3 },
      { key: 'race:Dwarf', rank: 1 }
    ])
    await expect(call('reincarnation:priority', C, [{ key: 'class:mnk', rank: 5 }])).rejects.toThrow('rank from 1 to 3')
    s = await call('reincarnation:anchor', C, 'wiz')
    expect(s.anchor).toBe('wiz')
    await expect(call('reincarnation:anchor', C, 'nope')).rejects.toThrow('No such class')
    s = await call('reincarnation:capped', C, 'mnk', true)
    expect(s.levels.mnk).toEqual({ capped: true, from: 'hand' })
    s = await call('reincarnation:capped', C, 'mnk', null)
    expect(s.levels.mnk).toEqual({ capped: null, from: 'none' })
    // The classes played now: the log's reincarnation already says they are below the cap, as the record does.
    expect(s.levels.rog).toEqual({ capped: false, from: 'reincarnated' })
  })

  it('sets a rank by hand, and goes back to the log’s', async () => {
    let s = await call('reincarnation:rank', C, 'class:war', 2)
    expect(s.ranks['class:war']).toEqual({ rank: 2, from: 'hand', logged: 0 })
    s = await call('reincarnation:rank', C, 'class:war', null)
    expect(s.ranks['class:war'].from).toBe('none')
    await expect(call('reincarnation:rank', C, 'class:nope', 1)).rejects.toThrow('No such')
    await expect(call('reincarnation:rank', C, 'class:war', 4)).rejects.toThrow('0 to 3')
  })

  it('raises each line of a reincarnation said made, and keeps it', async () => {
    const s = await call('reincarnation:done', C, ['mnk', 'shm', 'nec'], 'Dwarf')
    expect(['class:mnk', 'class:shm', 'class:nec', 'race:Dwarf'].map((k) => s.ranks[k])).toEqual(Array(4).fill({ rank: 1, from: 'hand', logged: 0 }))
    expect(s.history.map((x: { by: string }) => x.by)).toEqual(['hand', 'log'])
    await reinc.flush()
    const file = JSON.parse(readFileSync(join(h.dir, 'reincarnation.json'), 'utf8'))
    expect(file.characters[C].done).toHaveLength(1)
    expect(s.levels.mnk).toEqual({ capped: false, from: 'reincarnated' })
    await expect(call('reincarnation:done', C, ['mnk', 'mnk', 'nec'], '')).rejects.toThrow('three different classes')
    await expect(call('reincarnation:done', C, ['mnk', 'shm', 'nec'], 'Half Dark Elf')).rejects.toThrow('No such race')
  })

  it('counts the tokens in the inventory export', async () => {
    const item = (name: string, count = 1) => ({ location: 'General 4-Slot1', name, id: 181107, count, augs: [] })
    exports.inventory = {
      file: 'x',
      modified: 5,
      inventory: { worn: [], bags: [item('Token of Reincarnation'), item('Token of Reincarnation')], bank: [], sharedBank: [], depot: [], keyRing: [] }
    }
    expect((await call('reincarnation:state', C)).tokens).toEqual({ count: 2, modified: 5 })
  })
})
