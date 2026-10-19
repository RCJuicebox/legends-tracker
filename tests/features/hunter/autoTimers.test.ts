import { describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseAchievements } from '../../../src/core/achievements'
import { wantedTimers } from '../../../src/features/hunter/core'
import type { AppContext } from '../../../src/main/context'
import type { EngineFeature } from '../../../src/main/engine'
import { tempDir } from '../../tempDir'

// FEAT-038: a named still wanted by an open Hunter achievement that dies in the zone you are in starts
// its respawn timer by itself, when Plan › Hunter's switch is on.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-hunter-auto-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { HunterPlanner } = await import('../../../src/features/hunter/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')
const { rendererUrl } = await import('../../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }

describe('a wanted Hunter named that dies starts its timer (FEAT-038)', () => {
  it('knows each named left with a length, and leaves out one nothing times', () => {
    const m = wantedTimers([{ left: ['Gynok Moltor', 'a nobody'] }], (n) => (n === 'Gynok Moltor' ? 1200 : null))
    expect([...m]).toEqual([['gynok moltor', { name: 'Gynok Moltor', seconds: 1200 }]])
  })

  it('starts a timer on a kill of one in your zone with the switch on, and not without it', async () => {
    const features: EngineFeature[] = []
    const started: { key: string; seconds: number; overlay: string }[] = []
    const ctx = {
      engine: {
        use: (f: EngineFeature) => features.push(f),
        status: { zone: 'Befallen' },
        startTimer: (t: { key: string; seconds: number; overlay: string }) => started.push(t),
        pushFeed: () => {}
      },
      store: {
        triggers: { get: () => [] },
        settings: { get: () => ({ overlays: [{ id: 'respawns' }] }) },
        respawns: { get: () => ({}) }
      }
    } as unknown as AppContext
    const hunter = new HunterPlanner(new LogHistory(join(h.dir, 'log-history.json'), {}), h.dir)
    hunter.register(ctx)
    const exported = { file: 'x', modified: 0, sections: parseAchievements(['EverQuest: Hunter', 'I\tHunter of Befallen', 'I\t\tGynok Moltor'].join('\n')).sections }
    hunter.track({ character: 'Kelwyn_neriak', zone: 'Befallen', exported } as never)
    const line = (text: string) => features.find((f) => f.id === 'hunter')!.line!({ time: 1000, text } as never)
    expect(line('You have slain Gynok Moltor!')).toBe(false)
    expect(await h.handlers.get('hunter:autoTimers')!(OWN, true)).toBe(true)
    expect(line('You have slain Gynok Moltor!')).toBe(true)
    expect(started).toEqual([expect.objectContaining({ key: 'hunter:gynok moltor', overlay: 'respawns' })])
    expect(started[0].seconds).toBeGreaterThan(0)
    expect(line('You have slain a giant rat!')).toBe(false)
  })
})
