import { describe, expect, it, vi } from 'vitest'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLogLine } from '../../../src/core/logLine'
import type { AppContext } from '../../../src/main/context'
import type { EngineFeature } from '../../../src/main/engine'
import type { FeedItem, Notification } from '../../../src/shared/types'
import { tempDir } from '../../tempDir'

// Goals › Epics' live cue against a log on disk: a line the tailer hands the engine, written to the
// log as the game writes it, cues on the Live page's feed and the alert overlay while the module is on
// and the piece is still wanted, and not once enough is held.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))

h.dir = tempDir('lt-epics-cue-')
process.env['EQL_USER_DATA'] = h.dir
mkdirSync(join(h.dir, 'local'), { recursive: true })
const { EpicTracker } = await import('../../../src/features/epics/main')
const { LogHistory } = await import('../../../src/main/sources/logHistory')

const logs = join(h.dir, 'game', 'Logs')
mkdirSync(logs, { recursive: true })
const logPath = join(logs, 'eqlog_Kelwyn_neriak.txt')
writeFileSync(logPath, `[Tue Sep 29 21:00:00 2026] You have entered Upper Guk.\r\n`)

const settings = { modules: { epics: false } as Record<string, boolean>, characters: { Kelwyn_neriak: { level: 50, classLevels: { 'Shadow Knight': 50 }, focusSources: [] } } }
const features: EngineFeature[] = []
const feed: Pick<FeedItem, 'kind' | 'text'>[] = []
const alerts: Notification[] = []
const ctx = {
  store: { dir: h.dir, settings: { get: () => settings } },
  engine: {
    use: (f: EngineFeature) => features.push(f),
    pushFeed: (kind: FeedItem['kind'], text: string) => feed.push({ kind, text }),
    notify: (ns: Notification[]) => alerts.push(...ns)
  },
  characterKey: () => 'Kelwyn_neriak',
  historyOf: (c: string) => ({ logPath: join(logs, `eqlog_${c}.txt`), archiveDir: join(logs, 'Archive'), stem: `eqlog_${c}` }),
  inventoryFiles: { exported: async () => null }
} as unknown as AppContext

const epics = EpicTracker.create({ logHistory: new LogHistory(join(h.dir, 'log-history.json'), EpicTracker.consumers), dir: h.dir })
epics.register(ctx)
const part = features.find((f) => f.id === 'epics')!

/** A line as the game writes it and the tailer then hands it on: true when the part took it. */
async function replay(stamp: string, text: string): Promise<boolean | void> {
  const raw = `[Tue Sep 29 ${stamp} 2026] ${text}`
  appendFileSync(logPath, `${raw}\r\n`)
  const took = part.line!(parseLogLine(raw)!)
  await epics.cuesSaid()
  return took
}

describe('the Epics drop cue', () => {
  it('says nothing while the module is off', async () => {
    expect(await replay('21:01:00', 'The froglok shin lord has been slain by Kelwyn!')).toBe(false)
    expect(feed).toEqual([])
  })

  it('says a named that drops a piece still wanted is slain', async () => {
    settings.modules.epics = true
    expect(await replay('21:02:00', 'The froglok shin lord has been slain by Kelwyn!')).toBe(true)
    expect(feed).toEqual([{ kind: 'loot', text: 'The froglok shin lord slain, drops Ghoulbane: Shadow Knight epic, for the Corrupted Ghoulbane' }])
    expect(await replay('21:02:01', 'a giant rat has been slain by Kelwyn!')).toBe(false)
  })

  it('says a piece looted that is still wanted, on the feed and the alert overlay', async () => {
    feed.length = 0
    alerts.length = 0
    expect(await replay('21:02:30', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--")).toBe(true)
    const text = 'Ghoulbane dropped: Shadow Knight epic, for the Corrupted Ghoulbane'
    expect(feed).toEqual([{ kind: 'loot', text }])
    expect(alerts).toEqual([expect.objectContaining({ kind: 'text', text })])
  })

  it('says nothing of a piece already held enough of, or one no class wants', async () => {
    feed.length = 0
    expect(await replay('21:30:00', "--You have looted a Ghoulbane from the froglok shin lord's corpse.--")).toBe(true)
    expect(await replay('21:30:05', 'The froglok shin lord has been slain by Kelwyn!')).toBe(true)
    expect(await replay('21:30:10', "--You have looted a Rusty Dagger from a gnoll's corpse.--")).toBe(false)
    expect(await replay('21:30:20', "--Brenna has looted a Ghoulbane from the froglok shin lord's corpse.--")).toBe(false)
    expect(feed).toEqual([])
  })
})
