import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../../../src/main/context'
import type { EngineFeature } from '../../../src/main/engine/feature'
import type { CrawlData } from '../../../src/features/crawl/core'
import { tempDir } from '../../tempDir'

// Motes › Crawl route's main side against a game folder on disk: the run followed line by line as the
// engine hands them over, kept in crawl.json, shown on the overlay's track only in its own instance,
// and the route drawn on (and taken off) the game's map in the app's own map set.

type Handler = (e: unknown, ...args: unknown[]) => unknown
const h = vi.hoisted(() => ({ dir: '', handlers: new Map<string, Handler>() }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: (channel: string, fn: Handler) => void h.handlers.set(channel, fn), on: () => {} } }))

h.dir = tempDir('lt-crawl-main-')
process.env['EQL_USER_DATA'] = h.dir
const { CrawlGuide, markRoute, sanitizeRun } = await import('../../../src/features/crawl/main')
const { rendererUrl } = await import('../../../src/main/push')
const OWN = { senderFrame: { url: rendererUrl() + 'index.html' } }
const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(h.handlers.get(channel)!(OWN, ...args)) as Promise<T>

const game = join(h.dir, 'game')
mkdirSync(join(game, 'maps'), { recursive: true })
writeFileSync(join(game, 'maps', 'kedge.txt'), 'L 0, 0, 300, 10, 0, 300, 0, 0, 0\r\nL 0, 0, -80, 10, 0, -80, 0, 0, 0\r\n', 'latin1')
writeFileSync(join(game, 'maps', 'kedge_1.txt'), "P -30, -128, 299, 150, 0, 200, 3, to_Dagnor's_Cauldron\r\n", 'latin1')

const status = { zone: '' }
let feature: EngineFeature | undefined
const spoken = vi.fn()
const ctx = { installDir: () => game, engine: { status, use: (f: EngineFeature) => void (feature = f), notify: spoken } } as unknown as AppContext
const guide = CrawlGuide.create({ dir: h.dir, logHistory: null as never })
const changed = vi.fn()
guide.onChange = changed
guide.register(ctx)
let now = 1_000_000
const say = (text: string) => {
  const zone = /^You have entered (.+)\.$/.exec(text)?.[1]
  if (zone) status.zone = zone
  return feature!.line!({ text, time: (now += 1000) })
}
const track = () => guide.track({ character: 'Kelwyn_neriak', zone: status.zone, exported: null }).crawl

describe('a crawl run followed from the log', () => {
  it('starts in an instance of a zone with a route, and nowhere else', () => {
    say('You have entered Kedge Keep.')
    expect(track()).toBeNull()
    say('You have entered Befallen 1 (Awakened).')
    expect(track()).toBeNull()
    say('Player Kelwyn creating instance Kedge Keep 453.')
    say('You have entered Kedge Keep 1 (Awakened).')
    expect(track()).toMatchObject({ zone: 'Kedge Keep 1 (Awakened)', route: 'Kedge Keep', visited: 0, next: { n: 1 } })
    expect(changed).toHaveBeenCalled()
  })

  it('ticks the rares as they die, keeps the run through a step outside, and says when it is completed', async () => {
    expect(say('You have slain a lancer swordfish!')).toBe(false)
    expect(say('You have slain a fierce impaler!')).toBe(true)
    expect(track()).toMatchObject({ visited: 1, killed: 1, next: { n: 2 } })
    // Out to the zone and back into the same instance: the same run.
    say('You have entered Kedge Keep.')
    expect(track()).toBeNull()
    // A rare dying elsewhere is not this run's.
    say('You have slain Undertow!')
    say('You have entered Kedge Keep 1 (Awakened).')
    expect(track()).toMatchObject({ visited: 1, killed: 1 })
    say('Cauldronbubble has been slain by Jabartik!')
    expect(track()).toMatchObject({ visited: 2, killed: 2 })
    say('You have completed the Dungeon Crawl and earned reward loot!')
    expect(track()?.done).toBe(true)
    await guide.flush()
    expect(sanitizeRun(JSON.parse(readFileSync(join(h.dir, 'crawl.json'), 'utf8')).run)).toMatchObject({
      instance: 'Kedge Keep 1 (Awakened)',
      killed: { 'fierce impaler': expect.any(Number) }
    })
  })

  it('starts over in a new instance of the same name, and drops the run for another character', () => {
    say('Kelwyn has been removed from Kedge Keep.')
    say('You have entered Kedge Keep 1 (Awakened).')
    expect(track()).toMatchObject({ visited: 0, killed: 0 })
    feature!.reset!()
    expect(track()).toBeNull()
  })

  it('gives the page the route, the map with its heights and the run', async () => {
    say('Player Kelwyn creating instance Kedge Keep 454.')
    say('You have entered Kedge Keep 4 (Refined).')
    say('You have slain a fierce impaler!')
    const data = await call<CrawlData>('crawl:route')
    expect(data.zones).toContain('Kedge Keep')
    expect(data.route?.name).toBe('Kedge Keep')
    expect(data.lines).toEqual([0, 0, 300, 10, 0, 300, 0, 0, -80, 10, 0, -80])
    expect(data).toMatchObject({ marked: false, campsMarked: false, here: true, run: { instance: 'Kedge Keep 4 (Refined)' } })
    // A zone with no route asked for: the one being played in.
    expect((await call<CrawlData>('crawl:route', 'Befallen')).route?.name).toBe('Kedge Keep')
  })

  it('says the stop to go to next aloud, until the cues are switched off', async () => {
    const said = (text: string) => [{ kind: 'speak', text, interrupt: false }]
    spoken.mockClear()
    say('Player Kelwyn creating instance Kedge Keep 455.')
    say('You have entered Kedge Keep 2 (Adaptive).')
    expect(spoken).toHaveBeenLastCalledWith(said('Move to fierce impaler.'))
    say('You have slain a fierce impaler!')
    expect(spoken).toHaveBeenLastCalledWith(said('Move to golden haired mermaid.'))
    expect(spoken).toHaveBeenCalledTimes(2)
    // A common mob says nothing.
    say('You have slain a lancer swordfish!')
    expect(spoken).toHaveBeenCalledTimes(2)
    expect((await call<CrawlData>('crawl:route')).cues).toBe(true)
    expect(await call<boolean>('crawl:cues', false)).toBe(false)
    expect((await call<CrawlData>('crawl:route')).cues).toBe(false)
    say('You have slain a golden haired mermaid!')
    expect(spoken).toHaveBeenCalledTimes(2)
    await call('crawl:cues', true)
    say('You have slain Cauldronbubble!')
    expect(spoken).toHaveBeenLastCalledWith(said('Move to Coralyn Kelpmaiden.'))
    // A rare seen up at a stop after its move was said, then killed: the same stop is not said twice.
    say('You have slain Estrella of Gloomwater!')
    expect(spoken).toHaveBeenLastCalledWith(said('Move to Priestess Auraia.'))
    const times = spoken.mock.calls.length
    say('Nyrein the Beguiled - a rare creature - glares at you threateningly -- looks like quite a gamble. (Lvl: 52)')
    say('You have slain Nyrein the Beguiled!')
    expect(spoken).toHaveBeenCalledTimes(times)
    // The switch is kept with the run.
    await guide.flush()
    expect(JSON.parse(readFileSync(join(h.dir, 'crawl.json'), 'utf8')).cues).toBe(true)
  })

  it('follows a crawl in a base instance, which carries the zone’s own name', async () => {
    const said = (text: string) => [{ kind: 'speak', text, interrupt: false }]
    // The open zone: no run, and a rare dying there is nobody's.
    say('Kelwyn has been removed from Kedge Keep.')
    say('You have entered Kedge Keep.')
    expect(track()).toBeNull()
    expect(say('You have slain a fierce impaler!')).toBe(false)
    // An instance made of it: the same name, now a run.
    spoken.mockClear()
    say('Player Kelwyn creating instance Kedge Keep 1360.')
    say('Kedge Keep is now available to you.')
    say('You have entered Kedge Keep.')
    expect(track()).toMatchObject({ zone: 'Kedge Keep', route: 'Kedge Keep', visited: 0, next: { n: 1 } })
    expect(spoken).toHaveBeenLastCalledWith(said('Move to fierce impaler.'))
    expect(say('You have slain a fierce impaler!')).toBe(true)
    expect(track()).toMatchObject({ visited: 1, next: { n: 2 } })
    expect((await call<CrawlData>('crawl:route')).here).toBe(true)
    // A step outside and back: the same run, while it goes on.
    say("You have entered Dagnor's Cauldron.")
    expect(track()).toBeNull()
    say('You have entered Kedge Keep.')
    expect(track()).toMatchObject({ visited: 1, next: { n: 2 } })
    // Completed and removed from it: the zone of that name is the open one again.
    say('You have completed the Dungeon Crawl and earned reward loot!')
    expect(track()?.done).toBe(true)
    say('Kelwyn has been removed from Kedge Keep.')
    say('You have entered Kedge Keep.')
    expect(track()).toBeNull()
    expect(say('You have slain Undertow!')).toBe(false)
    expect((await call<CrawlData>('crawl:route')).here).toBe(false)
  })

  it('goes on with a run when the app starts in the middle of it', async () => {
    now = Date.now()
    say('Player Kelwyn creating instance Kedge Keep 1361.')
    say('You have entered Kedge Keep.')
    say('You have slain a fierce impaler!')
    await guide.flush()
    // Another copy of the feature over the same file, as after a restart: the engine already knows the zone.
    const again = CrawlGuide.create({ dir: h.dir, logHistory: null as never })
    again.register(ctx)
    expect(again.track({ character: 'Kelwyn_neriak', zone: status.zone, exported: null }).crawl).toMatchObject({ visited: 1, next: { n: 2 } })
    // The tests after this one go on with the first copy.
    guide.register(ctx)
  })
})

describe('the route on the game’s map', () => {
  it('is drawn on a layer of its own in the app’s map set, and taken off again', async () => {
    const set = join(game, 'maps', 'LegendsTracker')
    const r = await call<{ folder: string; lines: number }>('crawl:mark', 'Kedge Keep', true)
    expect(r.folder).toBe(set)
    expect(r.lines).toBeGreaterThan(20)
    // The game's maps copied in; its own files as they were.
    expect(readFileSync(join(set, 'kedge.txt'), 'latin1')).toContain('L 0, 0, 300')
    expect(existsSync(join(game, 'maps', 'kedge_2.txt'))).toBe(false)
    const layer = readFileSync(join(set, 'kedge_2.txt'), 'latin1')
    expect(layer).toMatch(/^P 0\.0000, 0\.0000, -9000\.0000, 0, 0, 0, 1, LegendsTracker_crawl_route\r\nL /)
    expect(layer).toMatch(/\r\nP [-\d.]+, [-\d.]+, [-\d.]+, \d+, \d+, \d+, 3, 1_fierce_impaler_then_down\r\n/)
    // Where the way climbs or drops between stops, a small label says which.
    expect(layer).toMatch(/\r\nP [-\d.]+, [-\d.]+, [-\d.]+, \d+, \d+, \d+, 2, up\r\n/)
    expect(layer).toMatch(/\r\nP [-\d.]+, [-\d.]+, [-\d.]+, \d+, \d+, \d+, 2, down\r\n/)
    expect((await call<CrawlData>('crawl:route', 'Kedge Keep')).marked).toBe(true)
    await call('crawl:mark', 'Kedge Keep', false)
    expect(existsSync(join(set, 'kedge_2.txt'))).toBe(false)
    expect((await call<CrawlData>('crawl:route', 'Kedge Keep')).marked).toBe(false)
    await expect(call('crawl:mark', 'Befallen', true)).rejects.toThrow('No route')
  })

  it('puts the places to sit on a layer of their own, apart from the route', async () => {
    const set = join(game, 'maps', 'LegendsTracker')
    await call('crawl:mark', 'Kedge Keep', true, 'camps')
    const layer = readFileSync(join(set, 'kedge_3.txt'), 'latin1')
    expect(layer).toMatch(/^P 0\.0000, 0\.0000, -9000\.0000, 0, 0, 0, 1, LegendsTracker_places_to_sit\r\nL /)
    expect(layer).toMatch(/\r\nP [-\d.]+, [-\d.]+, [-\d.]+, \d+, \d+, \d+, 3, Sit_A_\d+_spots_levels_28-36\r\n/)
    expect(existsSync(join(set, 'kedge_2.txt'))).toBe(false)
    expect(await call<CrawlData>('crawl:route', 'Kedge Keep')).toMatchObject({ marked: false, campsMarked: true })
    await call('crawl:mark', 'Kedge Keep', true)
    expect(await call<CrawlData>('crawl:route', 'Kedge Keep')).toMatchObject({ marked: true, campsMarked: true })
    await call('crawl:mark', 'Kedge Keep', false, 'camps')
    expect(existsSync(join(set, 'kedge_3.txt'))).toBe(false)
    expect(await call<CrawlData>('crawl:route', 'Kedge Keep')).toMatchObject({ marked: true, campsMarked: false })
    await call('crawl:mark', 'Kedge Keep', false, 'route')
  })

  it('keeps a layer the game has of its own under the route, and gives it back', async () => {
    writeFileSync(join(game, 'maps', 'kedge_2.txt'), 'P 1, 2, 3, 0, 0, 0, 2, Safe_Den', 'latin1')
    const set = join(game, 'maps', 'LegendsTracker')
    await markRoute(game, 'kedge', ['L 1, 1, 1, 2, 2, 2, 255, 0, 0'])
    expect(readFileSync(join(set, 'kedge_2.txt'), 'latin1')).toBe(
      'P 1, 2, 3, 0, 0, 0, 2, Safe_Den\r\nP 0.0000, 0.0000, -9000.0000, 0, 0, 0, 1, LegendsTracker_crawl_route\r\nL 1, 1, 1, 2, 2, 2, 255, 0, 0\r\n'
    )
    await markRoute(game, 'kedge', [])
    expect(readFileSync(join(set, 'kedge_2.txt'), 'latin1')).toBe('P 1, 2, 3, 0, 0, 0, 2, Safe_Den')
    await expect(markRoute('', 'kedge', [])).rejects.toThrow('game folder')
  })
})

describe('crawl.json read back', () => {
  it('is a run with an instance, a start and times by name, or nothing', () => {
    expect(sanitizeRun({ instance: 'Kedge Keep 1 (Awakened)', startedAt: 5, killed: { undertow: 9, x: 'y' }, up: null, doneAt: 12 })).toEqual({
      instance: 'Kedge Keep 1 (Awakened)',
      startedAt: 5,
      killed: { undertow: 9 },
      up: {},
      doneAt: 12
    })
    expect(sanitizeRun({ instance: '', startedAt: 5 })).toBeNull()
    expect(sanitizeRun({ instance: 'x' })).toBeNull()
    expect(sanitizeRun(null)).toBeNull()
  })
})
