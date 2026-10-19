import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../src/main/context'
import type { AchievementTrack } from '../../src/shared/tracking'
import { parseAchievements } from '../../src/core/achievements'
import { parseRaceTable } from '../../src/core/raceNames'
import { tempDir } from '../tempDir'

// The Slayer counts since the achievements export, through the real LiveAchievements and the Slayer
// feature that holds them (LT-626, LT-623): a temp log, two exports, a restart that reads on from
// where it got to (slayer-since.json), and the new export teaching what counts (slayer-facts.json).
// Nothing private is spied on: the engine's own hooks drive it and the published track is read.

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('../../src/main/paths', () => ({ cacheDir: () => join(h.dir, 'cache') }))

const { LiveAchievements } = await import('../../src/main/liveAchievements')
const { SlayerPlanner } = await import('../../src/features/slayer/main')
const { LogHistory } = await import('../../src/main/sources/logHistory')

const GAME = parseRaceTable(['54^11^Orc^0^', '54^12^Orcs^0^', '18^11^Giant^0^', '18^12^Giants^0^'].join('\r\n'))
const EXPORT = (orcs: number, giants: number) =>
  ['Slayer: Conquest', 'I\tOrc Stomp!', `I\t\tOrcs and Wereorcs.\t${orcs}/5000`, 'I\tA Giant Problem', `I\t\tGiants.\t${giants}/1000`].join('\n')
const stamp = (d: Date) => d.toString().replace(/^(\w{3}) (\w{3}) (\d{2}) (\d{4}) (\d{2}:\d{2}:\d{2}).*$/, '$1 $2 $3 $5 $4')

let root: string
let log: string
let exportFile: string
let exported: { modified: number; text: string } | null = null
let published: AchievementTrack[]

function context(): AppContext {
  return {
    store: {
      dir: h.dir,
      settings: { get: () => ({ achievementCues: false, overlays: [] }) },
      characterByKey: () => ({ level: 50, classLevels: {}, focusSources: [] }),
      respawns: { get: () => ({}) }
    },
    characterKey: () => 'Kelwyn_neriak',
    engine: { status: { zone: 'Clan Crushbone', watching: true, lastLineAt: 0 }, meter: { kindOf: () => ({ kind: 'mob' }) }, notify: () => {}, use: () => {}, pushFeed: () => {} },
    overlays: { isShown: false, achievements: (t: AchievementTrack) => void published.push(t) },
    windows: { mainShown: true, toMain: () => {} },
    achievementFiles: {
      exported: async () => exported && { file: 'Kelwyn_neriak-Achievements.txt', modified: exported.modified, sections: parseAchievements(exported.text).sections },
      marks: async () => ({ ticks: [], tracked: [] })
    },
    historyOf: () => ({ logPath: log, archiveDir: join(root, 'archive'), stem: 'eqlog_Kelwyn_neriak', elsewhere: [] }),
    logHistory: { reachable: async () => true },
    gameTables: { get: async () => GAME },
    npcPages: { ready: async () => undefined, race: () => null, lookUp: async () => false },
    hunter: { isBroken: () => false },
    skills: { view: async () => ({}) }
  } as unknown as AppContext
}

/** A start of the app: the Slayer feature (which holds the counts) and the live achievements (which say when to read) on one context. */
function start(ctx: AppContext) {
  const slayer = new SlayerPlanner(new LogHistory(join(h.dir, 'log-history.json'), SlayerPlanner.consumers), h.dir)
  slayer.register(ctx)
  Object.assign(ctx, { slayer, features: [slayer] })
  const live = new LiveAchievements(ctx)
  live.register(ctx)
  return { live, slayer }
}

/** Waits for the published track to satisfy `test`. */
async function until<T>(test: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = test()
    if (v) return v
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('gave up waiting')
}

const T0 = new Date(2026, 9, 18, 12, 0, 0)
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)
const kill = (sec: number, mob: string) => `[${stamp(at(sec))}] You have slain ${mob}!\r\n`

beforeEach(async () => {
  h.dir = tempDir('lt-slayer-')
  root = h.dir
  await fs.mkdir(join(root, 'cache'), { recursive: true })
  log = join(root, 'eqlog_Kelwyn_neriak.txt')
  exportFile = join(root, 'Kelwyn_neriak-Achievements.txt')
  published = []
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('the Slayer counts since the export', () => {
  it('count the kills after the export, read on from where they got to after a restart, and are taught by the next export', async () => {
    // The log before and after the export written at T0 + 60 s: two orcs before (counted by the export), two after.
    await fs.writeFile(log, kill(10, 'an orc pawn') + kill(40, 'an orc pawn') + kill(100, 'an orc pawn') + kill(130, 'an orc pawn') + kill(140, 'a hill giant'))
    await fs.writeFile(exportFile, EXPORT(3014, 100))
    exported = { modified: T0.getTime() + 60_000, text: EXPORT(3014, 100) }
    const ctx = context()
    let { live, slayer } = start(ctx)
    live.watch(true)
    live.feature.tick!(Date.now())
    let track = await until(() => published.find((t) => t.slayer))
    const rows = () => Object.fromEntries(track.slayer!.rows.map((r) => [r.name, [r.count, r.since]]))
    expect(rows()).toEqual({ 'Orc Stomp!': [3014, 2], 'A Giant Problem': [100, 1] })
    await slayer.flush()
    // Another orc, read a moment after the kill's line.
    await fs.appendFile(log, kill(200, 'an orc pawn'))
    live.feature.line!({ text: 'You have slain an orc pawn!', time: Date.now() })
    live.feature.tick!(Date.now() + 20_000)
    track = await until(() => published.find((t) => t.slayer?.rows[0].since === 3))
    expect(rows()['Orc Stomp!']).toEqual([3014, 3])
    await slayer.flush()

    // A restart: the counts come back from slayer-since.json and the log is read on from where it got to,
    // so a line changed before that point is not seen, and one added after it is.
    const kept = JSON.parse(await fs.readFile(join(root, 'cache', 'slayer-since.json'), 'utf8'))
    expect(kept.readTo).toBe((await fs.stat(log)).size)
    const text = await fs.readFile(log, 'latin1')
    await fs.writeFile(log, text.replace(kill(130, 'an orc pawn'), kill(130, 'a hill giant')) + kill(260, 'an orc pawn'), 'latin1')
    published = []
    ;({ live, slayer } = start(ctx))
    live.watch(true)
    live.feature.tick!(Date.now())
    track = await until(() => published.find((t) => t.slayer))
    expect(rows()).toEqual({ 'Orc Stomp!': [3014, 4], 'A Giant Problem': [100, 1] })

    // A new export at T0 + 300 s: Orc Stomp! rose by the four orcs, A Giant Problem by the one giant. The
    // kills before it are set against the rise and settled; the counts since start over.
    exported = { modified: T0.getTime() + 300_000, text: EXPORT(3018, 101) }
    published = []
    live.feature.tick!(Date.now() + 60_000)
    track = await until(() => published.find((t) => t.slayer?.exportAt === exported!.modified))
    expect(rows()).toEqual({ 'Orc Stomp!': [3018, 0], 'A Giant Problem': [101, 0] })
    expect(slayer.live.fact('an orc pawn', 'orc stomp!')).toBe(true)
    await slayer.flush()
    const facts = JSON.parse(await fs.readFile(join(root, 'slayer-facts.json'), 'utf8'))
    expect(facts.mobs['an orc pawn']['orc stomp!']).toMatchObject({ counts: true, kills: 4, rise: 4 })
  })
})
