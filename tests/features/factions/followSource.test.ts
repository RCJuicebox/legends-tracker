import { afterAll, describe, expect, it, vi } from 'vitest'
import { promises as fs, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Notification } from '../../../src/shared/runtime'
import type { AppContext } from '../../../src/main/context'
import type { FollowedPlan, FollowStep } from '../../../src/features/factions/tracker'
import { tempDir } from '../../tempDir'

// The faction plan followed on the achievements overlay (followSource.ts): the Plan tab hands a plan
// over, each read sets the standings against it, a step done is said, a step picked is the one worked
// on, and a start reads the plan back from faction-follow.json. The standings are stood in for; the
// arithmetic is the tracker's (core/achievementTracking.test.ts).

const h = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => h.dir }, ipcMain: { handle: () => {}, on: () => {} } }))
h.dir = tempDir('eql-faction-follow-')
const { FactionFollow } = await import('../../../src/features/factions/followSource')

const WHO = 'Tester_neriak'
/** A followed step made by hand: `per` a unit's amounts, `units` as planned at `unitSec` each. */
const step = (id: string, finish: string[], per: Record<string, number>, units: number, unitSec: number): FollowStep => ({
  id,
  kind: 'kill',
  title: id,
  zone: 'Neriak',
  finish,
  lift: [],
  per,
  units,
  unitSec
})
/** Five hand-ins for B, then twenty kills for A. */
const PLAN: FollowedPlan = { at: 0, steps: [step('hand-ins', ['B'], { B: 10 }, 5, 6), step('camp', ['A'], { A: 5 }, 20, 60)], names: { B: 'The B Achievement' } }

/** The standings as the Standings tab would read them now, and what each read of them was for. */
const now = { standings: { A: 1900, B: 1950 } as Record<string, number>, done: new Set<string>(), asked: 0 }
const said: Notification[] = []
const changed: string[] = []
const ctx = {
  store: { dir: h.dir, settings: { get: () => ({ achievementCues: true }) } },
  engine: { notify: (ns: Notification[]) => said.push(...ns) }
} as unknown as AppContext
const standingsNow = async () => {
  now.asked++
  const byAchievement = Object.fromEntries(Object.entries(now.standings).map(([f, s]) => [`the ${f.toLowerCase()} achievement`, { faction: f, standing: s }]))
  return { standings: now.standings, done: now.done, byAchievement }
}
const at = (zone = '', moved: Record<string, number> = {}, tracksFaction = false) => ({ zone, moved, tracksFaction })
/** As LiveAchievements wires it: a page that changed what is followed has it read again. */
function wire(follow: InstanceType<typeof FactionFollow>) {
  follow.onChange = async (c) => {
    changed.push(c)
    await follow.read(c, at())
  }
  return follow
}

afterAll(async () => {
  await fs.rm(h.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('the faction plan followed', () => {
  it('reads nothing without a plan, unless a faction achievement is tracked', async () => {
    const follow = wire(new FactionFollow(ctx, standingsNow))
    expect(follow.has(WHO)).toBe(false)
    expect(follow.raisedByPlan(WHO)).toEqual([])
    await follow.read(WHO, at())
    expect([follow.view, follow.byAchievement, now.asked]).toEqual([null, null, 0])
    // A tracked faction achievement wants its standing: read, but no step to show.
    await follow.read(WHO, at('', {}, true))
    expect(follow.view).toBeNull()
    expect(follow.byAchievement).toEqual({ 'the a achievement': { faction: 'A', standing: 1900 }, 'the b achievement': { faction: 'B', standing: 1950 } })
    expect(follow.viewFor_(WHO)).toBeNull()
  })

  it('follows the plan handed over: the step it is on, its progress, a step done said, a step picked worked on', async () => {
    const follow = wire(new FactionFollow(ctx, standingsNow))
    await follow.follow(WHO, PLAN)
    expect(changed).toEqual([WHO])
    expect(follow.has(WHO)).toBe(true)
    expect(follow.raisedByPlan(WHO)).toEqual(['B', 'A'])
    expect(follow.viewFor_(WHO)).toMatchObject({ steps: 2, done: 0, current: { index: 0, unitsLeft: 5 } })
    expect(follow.viewFor_('Someone_else')).toBeNull()
    // A hand-in landed.
    now.standings = { A: 1900, B: 1960 }
    await follow.read(WHO, at('Neriak', { B: 10 }))
    expect(follow.view?.current).toMatchObject({ index: 0, unitsLeft: 4 })
    expect(said).toEqual([])
    // The player picked the camp on the Plan tab: it is the one worked on, until hand-ins land again.
    changed.length = 0
    await follow.followStep(WHO, 1)
    expect(changed).toEqual([WHO])
    expect(follow.view?.current).toMatchObject({ index: 1, unitsLeft: 20 })
    await follow.followStep(WHO, 9)
    expect(changed).toEqual([WHO])
    // B reached 2000 and its achievement is done: the achievement flashes, and the step done is said with the camp to go on to.
    now.standings = { A: 1900, B: 2000 }
    now.done = new Set(['B'])
    await follow.read(WHO, at('Neriak', { B: 40 }))
    expect(follow.view).toMatchObject({ done: 1, current: { index: 1 } })
    expect(said.map((n) => n.kind)).toEqual(['text', 'text', 'speak'])
    expect(said[0]).toMatchObject({ text: '✓ The B Achievement' })
    expect(said[1]).toMatchObject({ text: 'Faction step done · next: camp (Neriak)' })
    expect(said[2]).toMatchObject({ kind: 'speak', text: expect.stringContaining('Faction step done. Next,') })
    said.length = 0
    // Where it stands is kept, and read back at a start.
    await follow.flush()
    const kept = JSON.parse(await fs.readFile(join(h.dir, 'faction-follow.json'), 'utf8'))
    expect(kept[WHO].state).toMatchObject({ done: [0], active: 1, synced: true })
    const again = wire(new FactionFollow(ctx, standingsNow))
    expect([again.has(WHO), again.view]).toEqual([true, null])
    await again.read(WHO, at())
    expect(again.view).toMatchObject({ done: 1, current: { index: 1, unitsLeft: 20 } })
    expect(again.byAchievement?.['the a achievement']).toEqual({ faction: 'A', standing: 1900 })
    // Another character played: nothing read applies to it.
    again.reset()
    expect([again.view, again.byAchievement]).toEqual([null, null])
    // The plan let go: the old one is read once more first (a step done then is still said), then nothing is followed.
    changed.length = 0
    await again.follow(WHO, null)
    expect(changed).toEqual([WHO, WHO])
    expect(again.has(WHO)).toBe(false)
    await again.read(WHO, at())
    expect(again.view).toBeNull()
    await again.flush()
    expect(JSON.parse(await fs.readFile(join(h.dir, 'faction-follow.json'), 'utf8'))).toEqual({})
  })

  it('starts from the copy kept when the file is not JSON, and with nothing followed when there is none, the file set aside', async () => {
    const file = join(h.dir, 'faction-follow.json')
    const bak = join(h.dir, 'faction-follow.bak.json')
    const setAside = async () => (await fs.readdir(h.dir)).filter((f) => f.startsWith('faction-follow.corrupt-')).length
    // The run before kept a copy with the plan in it (as JsonFile does before its first write): that is read in the file's place.
    expect(JSON.parse(await fs.readFile(bak, 'utf8'))[WHO]).toBeTruthy()
    const garbage = '{"Tester_neriak": {"plan": "not a plan"'
    writeFileSync(file, garbage)
    let follow = wire(new FactionFollow(ctx, standingsNow))
    expect(follow.has(WHO)).toBe(true)
    expect(await setAside()).toBe(1)
    // No copy either: nothing followed, and a plan followed now is kept afresh.
    await fs.rm(bak, { force: true })
    writeFileSync(file, garbage)
    follow = wire(new FactionFollow(ctx, standingsNow))
    expect(follow.has(WHO)).toBe(false)
    expect(await setAside()).toBe(2)
    await follow.read(WHO, at())
    expect(follow.view).toBeNull()
    await follow.follow(WHO, PLAN)
    await follow.flush()
    expect(JSON.parse(await fs.readFile(file, 'utf8'))[WHO].plan).toEqual(PLAN)
  })
})
