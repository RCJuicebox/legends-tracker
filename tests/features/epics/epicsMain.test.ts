import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import { tempDir } from '../../tempDir'

// Goals › Epics' main side against a log on disk, read as the app reads it: the pieces counted, a
// hand-in, and the ticks and corrections kept in epics.json.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-epics-main-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { EpicTracker } = await import('../../../src/features/epics/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { rendererUrl } = await import('../../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }

const logs = join(h.dir, 'game', 'Logs')
mkdirSync(logs, { recursive: true })
const line = (stamp: string, text: string) => `[Tue Sep 29 ${stamp} 2026] ${text}\r\n`
writeFileSync(
  join(logs, 'eqlog_Kelwyn_neriak.txt'),
  [
    line('21:00:00', "--You have looted a Decayed Chainmail from a lizard crusader's corpse.--"),
    line('21:00:01', "--You have looted a Decayed Breastplate from a lizard crusader's corpse.--"),
    line('21:00:02', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--"),
    line('21:11:00', 'You offered 1 Decayed Chainmail to Mordin Frostcleaver.'),
    line('21:11:01', 'You offered 1 Decayed Breastplate to Mordin Frostcleaver.'),
    line('21:11:03', 'You complete the trade with Mordin Frostcleaver.')
  ].join('')
)

const item = (location: string, name: string, count = 1) => ({ location, name, id: 1, count, augs: [] })
/** The inventory export, as the game wrote it: none until a test gives one. */
const exports: { inventory: unknown } = { inventory: null }
const ctx = {
  store: { dir: h.dir, settings: { get: () => ({ characters: { Kelwyn_neriak: { level: 50, classLevels: { 'Shadow Knight': 50 }, focusSources: [] } } }) } },
  send: vi.fn(),
  on: vi.fn(() => () => {}),
  engine: { use: vi.fn() },
  historyOf: (c: string) => ({ logPath: join(logs, `eqlog_${c}.txt`), archiveDir: join(logs, 'Archive'), stem: `eqlog_${c}` }),
  inventoryFiles: { exported: async () => exports.inventory }
} as unknown as AppContext

const epics = EpicTracker.create({ logHistory: new LogHistory(join(h.dir, 'log-history.json'), EpicTracker.consumers), dir: h.dir })
epics.register(ctx)
type State = { logged: Record<string, number>; classes: string[]; ticks: string[]; adjust: Record<string, number>; exported: { counts: Record<string, number> } | null }
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<State>
const epicState = () => call('epics:state', 'Kelwyn_neriak')

describe('the Epics page', () => {
  it('counts the pieces from the log, less what a trade took, with the character’s classes', async () => {
    const s = await epicState()
    expect(s.logged).toEqual({ 'decayed chainmail': 0, 'decayed breastplate': 0, ghoulbane: 1 })
    expect(s.classes).toEqual(['Shadow Knight'])
    expect(s.ticks).toEqual([])
    expect(s.exported).toBeNull()
  })

  it('keeps a step ticked off, and unticks it', async () => {
    let s = await call('epics:tick', 'Kelwyn_neriak', 'Shadow Knight|Darkforge Breastplate', true)
    expect(s.ticks).toEqual(['Shadow Knight|Darkforge Breastplate'])
    s = await call('epics:tick', 'Kelwyn_neriak', 'Shadow Knight|Darkforge Breastplate', true)
    expect(s.ticks).toEqual(['Shadow Knight|Darkforge Breastplate'])
    await epics.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'epics.json'), 'utf8')).characters.Kelwyn_neriak.ticks).toEqual(['Shadow Knight|Darkforge Breastplate'])
    s = await call('epics:tick', 'Kelwyn_neriak', 'Shadow Knight|Darkforge Breastplate', false)
    expect(s.ticks).toEqual([])
    await expect(call('epics:tick', 'Kelwyn_neriak', 'Bard|Darkforge Breastplate', true)).rejects.toThrow('No such step')
    await expect(call('epics:tick', '..\\Kelwyn', 'Shadow Knight|Darkforge Breastplate', true)).rejects.toThrow('No such character')
  })

  it('keeps what the player says they hold as a difference from the log’s count', async () => {
    let s = await call('epics:have', 'Kelwyn_neriak', 'Drake Spine', 2)
    expect(s.adjust).toEqual({ 'drake spine': 2 })
    s = await call('epics:have', 'Kelwyn_neriak', 'Ghoulbane', 3)
    expect(s.adjust.ghoulbane).toBe(2)
    // The log's own count again: no correction kept.
    s = await call('epics:have', 'Kelwyn_neriak', 'Ghoulbane', 1)
    expect(s.adjust).toEqual({ 'drake spine': 2 })
    await expect(call('epics:have', 'Kelwyn_neriak', 'Rusty Dagger', 1)).rejects.toThrow('Not an item')
    await expect(call('epics:have', 'Kelwyn_neriak', 'Ghoulbane', 10_000)).rejects.toThrow('0 to 9999')
  })

  it('counts the inventory export’s pieces', async () => {
    exports.inventory = {
      file: 'Kelwyn_neriak-Inventory.txt',
      modified: 5,
      inventory: {
        worn: [item('Chest', 'Darkforge Breastplate')],
        bags: [item('General 1-Slot1', 'Enchanted Platinum Bar', 2), item('General 1-Slot2', 'Bone Chips', 9)],
        bank: [item('Bank1-Slot1', 'Ghoulbane')],
        sharedBank: [],
        depot: [],
        keyRing: []
      }
    }
    const s = await epicState()
    expect(s.exported?.counts).toEqual({ 'darkforge breastplate': 1, 'enchanted platinum bar': 2, 'bone chips': 9, ghoulbane: 1 })
  })
})
