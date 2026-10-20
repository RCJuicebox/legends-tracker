import { describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseAchievements } from '../../../src/core/achievements'
import type { SlayerKills } from '../../../src/core/slayer'
import type { AppContext } from '../../../src/main/context'
import type { Notification } from '../../../src/shared/runtime'
import { tempDir } from '../../tempDir'

// A named a Hunter achievement still wants, killed on any of the character's logs (a hunt left running
// on another PC), is said at once: in the activity feed and a Windows notification, and on the overlay
// and aloud as the achievement cues are. Said once, and only while fresh.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))

h.dir = tempDir('lt-hunter-down-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { HunterPlanner } = await import('../../../src/features/hunter/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')

const EXPORT_AT = Date.now() - 3_600_000
const sections = parseAchievements(
  ['EverQuest: Hunter', 'I\tHunter of The Permafrost Caverns', 'C\t\tan injured polar bear', 'I\t\ta goblin alchemist', 'I\t\ta goblin archaeologist'].join('\n')
).sections

function setUp(cues = true, hunterToasts = true) {
  const feed: string[] = []
  const said: Notification[] = []
  const toasts: string[] = []
  const ctx = {
    engine: {
      use: () => {},
      status: { zone: '' },
      pushFeed: (_kind: string, text: string) => feed.push(text),
      notify: (ns: Notification[]) => said.push(...ns)
    },
    store: { triggers: { get: () => [] }, settings: { get: () => ({ achievementCues: cues, hunterToasts, overlays: [] }) }, respawns: { get: () => ({}) } },
    windows: { toast: (title: string, body: string) => toasts.push(`${title} | ${body}`) },
    achievementFiles: { exported: async () => ({ file: 'x', modified: EXPORT_AT, sections }) }
  } as unknown as AppContext
  const hunter = new HunterPlanner(new LogHistory(join(h.dir, 'log-history.json'), {}), h.dir)
  hunter.register(ctx)
  return { hunter, feed, said, toasts }
}

const killsOf = (...k: { name: string; at: number; zone: string }[]): SlayerKills => new Map(k.map((x) => [x.name.toLowerCase(), { name: x.name, times: [x.at], zones: [x.zone] }]))

describe('a Hunter named killed is said at once', () => {
  it('says a wanted named killed in its zone (Permafrost Keep is the Caverns), once', async () => {
    const { hunter, feed, said, toasts } = setUp()
    const at = Date.now() - 5000
    const kill = { name: 'A goblin alchemist', at, zone: 'Permafrost Keep' }
    const kills = killsOf(kill, { name: 'An ice goblin', at, zone: 'Permafrost Keep' })
    await hunter.namedDown('Kelwyn_neriak', kills, [kill, { name: 'An ice goblin', at, zone: 'Permafrost Keep' }])
    expect(feed).toEqual([expect.stringMatching(/^Hunter: a goblin alchemist killed in Permafrost Keep at .* · Hunter of The Permafrost Caverns, 1 of 3 left$/)])
    expect(said).toEqual([
      expect.objectContaining({ kind: 'text', text: '✓ Hunter: a goblin alchemist' }),
      expect.objectContaining({ kind: 'speak', text: 'Hunter named down: a goblin alchemist.' })
    ])
    expect(toasts).toEqual([expect.stringMatching(/^Hunter: a goblin alchemist killed \| Permafrost Keep at .* · Hunter of The Permafrost Caverns, 1 of 3 left$/)])
    // The same kill read again says nothing.
    await hunter.namedDown('Kelwyn_neriak', kills, [kill])
    expect(feed).toHaveLength(1)
  })

  it('says nothing of a mob no Hunter achievement wants, a named killed in another zone, or a stale kill', async () => {
    const { hunter, feed, toasts } = setUp()
    const now = Date.now()
    const elsewhere = { name: 'A goblin alchemist', at: now, zone: 'The Misty Thicket' }
    await hunter.namedDown('Kelwyn_neriak', killsOf(elsewhere), [elsewhere])
    const stale = { name: 'A goblin archaeologist', at: now - 20 * 60_000, zone: 'Permafrost Keep' }
    await hunter.namedDown('Kelwyn_neriak', killsOf(stale), [stale])
    expect(feed).toEqual([])
    expect(toasts).toEqual([])
  })

  it('keeps the overlay and speech quiet with the achievement cues off, but still writes the feed and the notification', async () => {
    const { hunter, feed, said, toasts } = setUp(false)
    const kill = { name: 'A goblin archaeologist', at: Date.now(), zone: 'Permafrost Keep' }
    await hunter.namedDown('Kelwyn_neriak', killsOf(kill), [kill])
    expect(feed).toHaveLength(1)
    expect(toasts).toHaveLength(1)
    expect(said).toEqual([])
  })

  it('pops no Windows notification with that switched off', async () => {
    const { hunter, feed, said, toasts } = setUp(true, false)
    const kill = { name: 'A goblin archaeologist', at: Date.now(), zone: 'Permafrost Keep' }
    await hunter.namedDown('Kelwyn_neriak', killsOf(kill), [kill])
    expect(feed).toHaveLength(1)
    expect(said).toHaveLength(2)
    expect(toasts).toEqual([])
  })
})
