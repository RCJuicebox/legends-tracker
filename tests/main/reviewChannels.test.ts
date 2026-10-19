import { describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../src/main/context'
import { tempDir } from '../tempDir'
import { fixtureBook } from '../helpers'
import { recipeKey } from '../../src/core/tradeskills'

const BRACER = { product: 'Bone Bracer', skill: 'Smithing', trivial: 10, yields: 1, from: 'page' as const, ingredients: [{ name: 'Bone Chips', count: 3 }] }

// The channels the 10-19 review added, against a context of real-shaped parts: what each answers with
// a good argument (the IPC handler test calls them with bad ones).

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-review-channels-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { registerCharacterIpc } = await import('../../src/main/ipc/character')
const { registerPlayIpc } = await import('../../src/main/ipc/play')
const { registerSpellIpc } = await import('../../src/main/ipc/spells')
const { rendererUrl } = await import('../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
const call = (channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<any>

const KEY = 'Kelwyn_neriak'
const window = (counts: Record<string, number>) => ({ recent: async () => ({ counts, total: 0, from: '2026-10-06', to: '2026-10-19' }) })
const book = fixtureBook()
const ctx = {
  store: { dir: h.dir },
  engine: {
    book,
    character: () => ({ level: 50, classLevels: { Shaman: 50 }, focusSources: [] }),
    myClasses: () => [],
    combat: {
      loot: {
        snapshot: () => ({
          entries: [
            {
              id: 1,
              at: 150,
              zone: 'Befallen',
              sessionId: 's',
              looter: 'You',
              item: 'Bone Chips',
              base: 'Bone Chips',
              plus: 0,
              count: 2,
              source: 'a skeleton',
              outcome: 'kept',
              copper: 0
            }
          ],
          coin: {},
          reading: ''
        })
      },
      meter: { fights: [{ startedAt: 100, enemies: { 'a skeleton': false }, entities: { 'a skeleton': { name: 'a skeleton' } } }] }
    }
  },
  characterKey: () => KEY,
  historyOf: () => ({ logPath: join(h.dir, 'eqlog.txt'), archiveDir: h.dir, stem: 'eqlog' }),
  castHistory: window({ 'Envenomed Bolt X': 10 }),
  resistHistory: window({ 'Envenomed Bolt X': 3 }),
  spellMergeHistory: window({}),
  meleeHistory: window({ 'm|punch|h': 90, 'm|punch|x': 10, 'm|punch|c': 9, active: 600_000 }),
  skills: { view: async () => ({ Kick: { value: 180, at: 1 } }) },
  inventoryFiles: { exported: async () => null, lookup: async () => ({}) },
  offers: { latest: async () => ({ 'bone chips': { item: 'Bone Chips', merchant: 'Tenra', copper: 3, at: 1 } }) },
  recipeBook: {
    stored: async () => ({ recipes: [BRACER] })
  },
  tradeFavorites: { get: async () => ({ favorites: [{ key: recipeKey(BRACER), product: 'Bone Bracer', combines: 2 }], prices: {} }) },
  achievementHistory: { progress: async (_c: string, _w: unknown, days: Promise<unknown>) => ({ completions: [], snapshots: [], factionDays: await days, today: '2026-10-19' }) },
  factions: { daysMoved: async () => ({ '2026-10-19': { 'Guards of Qeynos': 5 } }) }
} as unknown as AppContext
registerCharacterIpc(ctx)
registerPlayIpc(ctx)
registerSpellIpc(ctx)

describe('the 10-19 review’s channels', () => {
  it('spells:resists gives each spell its casts and resists (LT-722)', async () => {
    expect(await call('spells:resists')).toEqual({ 'Envenomed Bolt': { casts: 10, resisted: 3 } })
  })

  it('stats:fromLog gives the melee rates and the skills (LT-739)', async () => {
    const r = await call('stats:fromLog', KEY, 14)
    expect(r.melee).toMatchObject({ hits: 90, crits: 9, misses: 10 })
    expect(r.skills[30]).toBe(180)
  })

  it('loot:offers, loot:byMob and trade:wanted (LT-725, FEAT-037, FEAT-036)', async () => {
    expect((await call('loot:offers'))['bone chips'].copper).toBe(3)
    expect(await call('loot:byMob')).toEqual([{ mob: 'a skeleton', kills: 1, items: [{ item: 'Bone Chips', n: 2, perKill: 2 }] }])
    expect(await call('trade:wanted')).toEqual({ 'bone chips': [{ product: 'Bone Bracer', count: 6 }] })
  })

  it('achievements:progress hands over the factions moved a day (FEAT-032)', async () => {
    expect((await call('achievements:progress', KEY)).factionDays).toEqual({ '2026-10-19': { 'Guards of Qeynos': 5 } })
  })
})
