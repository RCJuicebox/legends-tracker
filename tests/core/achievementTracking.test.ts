import { describe, expect, it } from 'vitest'
import { achKey, objKey, parseAchievements } from '../../src/core/achievements'
import { trackedAchievements } from '../../src/core/trackedAchievements'
import { RaceIndex, raceWords, slayerCounters, slayerCounts, slayerLine, wikiRace, type SlayerKills } from '../../src/core/slayer'
import { joinSkillValues, skillGoals, skillId, skillUp, skillValue } from '../../src/core/skillAchievements'
import type { PlanSettings } from '../../src/shared/settings'
import type { PlanActivity } from '../../src/features/factions/catalog'
import { DEFAULT_SETTINGS } from '../../src/features/factions/ways'
import { planFactions } from '../../src/features/factions/planner'
import { itemsSaid } from '../../src/shared/tracking'
import {
  carryFollow,
  followedPlan,
  freshFollow,
  pickStep,
  readFollow,
  sanitizeFollowedPlan,
  sanitizeFollowState,
  sanitizeFollows,
  sayStep,
  type FollowedPlan,
  type FollowStep
} from '../../src/features/factions/tracker'

const EXPORT = [
  'Slayer: Conquest',
  "I\tPuttin' On The Dog",
  'I\t\tKobolds\t2645/5000',
  'I\tOrc Stomp!',
  'I\t\tOrcs and Wereorcs.\t2204/5000',
  "I\tDon't Bug Me",
  'I\t\tBeetles, Cliknars, Corathus Beasts, Drachnids, Insects, Leeches, Mosquitoes, Spiders, Ursarachnids.\t1051/5000',
  'I\tMight They Be Giants?',
  'I\t\tGiants\t257/5000',
  'I\tStrange Weather',
  'I\t\tChokidais, Drolvargs, Hynids, Lions, Pumas, Rotdogs, Tigers, Werewolves, Wolves, Worgs, and Wrulons.\t456/5000',
  'I\tI Hate Snakes!',
  'I\t\tAlligators, Basilisks, Crocodiles, Lizard Men, Sarnaks, Shissar, Snakes, Sokokar, and Turtles.\t463/5000',
  "I\tDoesn't Play Well With Others",
  'I\t\tThe playable races.\t4538/10000',
  'I\tDomo Arigato',
  'I\t\tClockwork: Beetles, Boars, Dragons, Rats, Snakes, Spiders, Gnomeworks, Copters, and Tin Soldiers.\t101/5000',
  'C\tAlready Done',
  'C\t\tGnolls\t5000/5000',
  'Slayer: Skill',
  'I\tStop Dragon This Out',
  'I\t\tDracoliches, Water Dragons, and Witherans.\t67/100',
  'I\tSpin Me Right Round',
  'I\t\tDervishes\t41/100',
  'EverQuest: General',
  'I\tNorrathian Slayer',
  'I\t\tHunter of Faydwer'
].join('\n')

const counters = slayerCounters(parseAchievements(EXPORT).sections)
const index = new RaceIndex(counters)
const names = (ids: number[]) => ids.map((i) => counters[i].name).sort()

describe('Slayer counts', () => {
  it("reads the open Slayer achievements' counts from the achievements export", () => {
    expect(counters.map((c) => c.name)).toEqual([
      "Puttin' On The Dog",
      'Orc Stomp!',
      "Don't Bug Me",
      'Might They Be Giants?',
      'Strange Weather',
      'I Hate Snakes!',
      "Doesn't Play Well With Others",
      'Domo Arigato',
      'Stop Dragon This Out',
      'Spin Me Right Round'
    ])
    expect(counters[0]).toEqual({ section: 'Slayer: Conquest', name: "Puttin' On The Dog", races: 'Kobolds', count: 2645, max: 5000 })
  })

  it('knows each listed race singular and plural', () => {
    expect(raceWords('Orcs and Wereorcs.')).toEqual(expect.arrayContaining(['orc', 'wereorc']))
    expect(raceWords('Corathus Beasts, Wolves, Brownies, Gingerbread Men, Sphinxes')).toEqual(
      expect.arrayContaining(['corathus beast', 'wolf', 'brownie', 'gingerbread man', 'sphinx'])
    )
    expect(raceWords('The playable races.')).toContain('dark elf')
    expect(raceWords('Clockwork: Beetles, Boars')).toEqual(['clockwork'])
    expect(raceWords('True Dragons')).toEqual(expect.arrayContaining(['true dragon', 'dragon']))
  })

  it("places a kill by the mob's name", () => {
    expect(names(index.byName('a kobold runt'))).toEqual(["Puttin' On The Dog"])
    expect(names(index.byName('an orc centurion'))).toEqual(['Orc Stomp!'])
    // "giant" before the kind is a size; after a place it is the race.
    expect(names(index.byName('a giant spider'))).toEqual(["Don't Bug Me"])
    expect(names(index.byName('a fire giant warrior'))).toEqual(['Might They Be Giants?'])
    expect(names(index.byName('a rattlesnake'))).toEqual(['I Hate Snakes!'])
    expect(names(index.byName('a dune spiderling'))).toEqual(["Don't Bug Me"])
    expect(names(index.byName('a lioness'))).toEqual(['Strange Weather'])
    expect(names(index.byName('a lizardman scout'))).toEqual(['I Hate Snakes!'])
    expect(names(index.byName('a Teir`Dal shadowknight'))).toEqual(["Doesn't Play Well With Others"])
    expect(names(index.byName('a werewolf'))).toEqual(['Strange Weather'])
    // A word that describes gives way to the one that names: a skeletal wolf is a wolf, counted once,
    // and a dwarven miner a dwarf.
    const undead = new RaceIndex([{ races: 'Skeletons' }, { races: 'Wolves' }, { races: 'Dwarves' }])
    expect(undead.byName('a skeletal wolf')).toEqual([1])
    expect(undead.byName('a skeleton')).toEqual([0])
    expect(undead.byName('a dwarven skeleton')).toEqual([0])
    expect(undead.byName('a dwarven miner')).toEqual([2])
    // A clockwork is a clockwork, whatever it is made to look like.
    expect(names(index.byName('a clockwork spider'))).toEqual(['Domo Arigato'])
    expect(index.byName('Terror')).toEqual([])
  })

  it("does not take the Dervish Cutthroats for Dervishes: they are the playable races' bandits", () => {
    expect(names(index.byName('a dervish cutthroat'))).toEqual(["Doesn't Play Well With Others"])
    expect(names(index.byName('a cutthroat dervish'))).toEqual(["Doesn't Play Well With Others"])
    // An Ogre: one of the playable races, not a Dervish.
    expect(names(index.byName('a dervish thug'))).toEqual(["Doesn't Play Well With Others"])
    // The Plane of Sky's blade storms are Dervishes, as eqlwiki gives their race.
    expect(index.byName('a blade storm')).toEqual([])
    expect(names(index.byRace('Dervish'))).toEqual(['Spin Me Right Round'])
  })

  it("places a kill by eqlwiki's race when the name does not say", () => {
    expect(names(index.byRace('Dark Elf'))).toEqual(["Doesn't Play Well With Others"])
    expect(names(index.byRace('Dragon Skeleton'))).toEqual(['Stop Dragon This Out'])
    expect(wikiRace('{{Namedmobpage\n| race = [[Dark Elf]]\n| zone = [[Neriak]]\n}}')).toBe('Dark Elf')
    expect(wikiRace('{{Namedmobpage|race=[[Troll|Trolls]]|level=12}}')).toBe('Trolls')
    expect(wikiRace('{{Namedmobpage\n| race =\n| zone = x\n}}')).toBeNull()
  })

  it('reads kills, pets and completions off the log', () => {
    expect(slayerLine('You have slain a kobold runt!')).toEqual({ kill: { mob: 'a kobold runt', by: 'You' } })
    expect(slayerLine('A gnoll has been slain by Vonartik!')).toEqual({ kill: { mob: 'A gnoll', by: 'Vonartik' } })
    expect(slayerLine('Kelwyn has been slain by a gnoll!')).toBeNull()
    expect(slayerLine("Vonartik told you, 'Attacking a minotaur slaver Master.'")).toEqual({ pet: 'Vonartik', engaged: 'a minotaur slaver' })
    expect(slayerLine('You hit a bixie drone for 45 points of poison damage by Envenomed Bolt.')).toEqual({ engaged: 'a bixie drone' })
    expect(slayerLine('A samhain has taken 100 damage by Rotting Flesh.')).toEqual({ engaged: 'A samhain' })
    expect(slayerLine('A bixie died.')).toEqual({ died: 'A bixie' })
    expect(slayerLine('You have completed achievement: Bear With Me')).toEqual({ completed: 'Bear With Me' })
    expect(slayerLine('You gain party experience!')).toBeNull()
  })

  it('adds the kills since the export to its counts, and says what it cannot place', () => {
    const kills: SlayerKills = new Map([
      ['a kobold runt', { name: 'a kobold runt', times: [10, 20, 30] }],
      ['cleric of innoruuk', { name: 'Cleric of Innoruuk', times: [40] }],
      ['terror', { name: 'Terror', times: [50, 60] }],
      ['a griffawn', { name: 'a griffawn', times: [70] }],
      ['a bat', { name: 'a bat', times: [80] }]
    ])
    const race: Record<string, string | null> = { 'Cleric of Innoruuk': 'Dark Elf', Terror: null, 'a bat': null }
    const got = slayerCounts(counters, index, kills, (m) => race[m], new Set(['orc stomp!']))
    const row = (n: string) => got.rows.find((r) => r.counter.name === n)!
    expect(row("Puttin' On The Dog")).toMatchObject({ since: 3, last: 30, done: false })
    expect(row("Doesn't Play Well With Others")).toMatchObject({ since: 1, last: 40 })
    expect(row('Orc Stomp!')).toMatchObject({ since: 0, done: true })
    expect(got.unplaced).toEqual([
      { name: 'Terror', n: 2 },
      { name: 'a bat', n: 1 }
    ])
    // Not looked up yet.
    expect(got.unknown).toEqual(['a griffawn'])
  })
})

// ---------- following a faction plan ----------

const S: PlanSettings = { ...DEFAULT_SETTINGS, travelMin: 10, keepMaxed: 0 }
const act = (id: string, hits: Record<string, number>, perHour: number, zone: string, kind: PlanActivity['kind'] = 'kill'): PlanActivity => ({
  id,
  kind,
  title: id,
  zone,
  hits,
  source: 'log',
  seen: 100,
  measured: perHour,
  ...(kind === 'turnin' ? { npc: id } : {})
})

function twoSteps(): FollowedPlan {
  const plan = planFactions(
    {
      targets: [
        { faction: 'A', achievement: 'The A Achievement', standing: 1900 },
        { faction: 'B', achievement: 'B', standing: 1950 }
      ],
      maxed: [],
      activities: [act('camp', { A: 5 }, 60, 'West Freeport'), act('Mojax', { B: 10 }, 600, 'West Commonlands', 'turnin')]
    },
    S
  )
  return followedPlan(plan, [
    { faction: 'A', achievement: 'The A Achievement', standing: 1900 },
    { faction: 'B', achievement: 'B', standing: 1950 }
  ])
}

describe('following a faction plan', () => {
  it('takes the plan as the Plan tab shows it', () => {
    const f = twoSteps()
    expect(f.steps.map((s) => [s.id, s.finish, s.per, s.units])).toEqual([
      ['Mojax', ['B'], { B: 10 }, 5],
      ['camp', ['A'], { A: 5 }, 20]
    ])
    expect(f.steps[1].unitSec).toBeCloseTo(60)
    expect(f.names).toEqual({ A: 'The A Achievement' })
  })

  it('counts down the step being worked on, and says when a step and an achievement are done', () => {
    const f = twoSteps()
    // First read: where the player starts; nothing is news.
    let r = readFollow(f, freshFollow(), { A: 1900, B: 1950 }, new Set())
    expect(r.events).toEqual([])
    expect(r.view.current).toMatchObject({ index: 0, unitsLeft: 5, progress: 0 })
    expect(r.view.next).toMatchObject({ index: 1, title: 'camp' })
    r = readFollow(f, r.state, { A: 1900, B: 1980 }, new Set())
    expect(r.view.current).toMatchObject({ index: 0, unitsLeft: 2 })
    expect(r.view.current!.progress).toBeCloseTo(0.6)
    r = readFollow(f, r.state, { A: 1900, B: 2000 }, new Set())
    expect(r.events).toEqual([
      { kind: 'achievement', faction: 'B', name: 'B' },
      { kind: 'step', index: 0, step: f.steps[0], next: f.steps[1] }
    ])
    expect(r.view).toMatchObject({ done: 1, current: { index: 1, unitsLeft: 20 }, next: null })
    // An achievement stays done when its standing drops again after.
    r = readFollow(f, r.state, { A: 2000, B: 1990 }, new Set())
    expect(r.events).toEqual([
      { kind: 'achievement', faction: 'A', name: 'The A Achievement' },
      { kind: 'step', index: 1, step: f.steps[1], next: null }
    ])
    expect(r.view.current).toBeNull()
  })

  it('works on the step the faction lines went the way of, or the one in the zone the player is in', () => {
    const f = twoSteps()
    const first = readFollow(f, freshFollow(), { A: 1900, B: 1950 }, new Set())
    expect(readFollow(f, first.state, { A: 1905, B: 1950 }, new Set(), { moved: { A: 5 } }).view.current).toMatchObject({ index: 1, unitsLeft: 19 })
    expect(readFollow(f, freshFollow(), { A: 1900, B: 1950 }, new Set(), { zone: 'West Freeport' }).view.current).toMatchObject({ index: 1 })
    // Done by the achievements export: the step is done whatever the standing.
    expect(readFollow(f, first.state, { A: 1900, B: 1950 }, new Set(['B'])).view.current).toMatchObject({ index: 1 })
  })

  it('follows a step there to open a way: done when the faction gets to what the next step wants', () => {
    const TS = "Tunare's Scouts"
    const dagger: PlanActivity = {
      ...act('dagger', { [TS]: 1 }, 1800, 'Kelethin', 'quest'),
      title: 'Tunare Scouts Dagger',
      items: [{ name: 'Rusty Dagger', count: 2, how: 'bought', where: 'Harg Tonicka', each: 10 }],
      gate: [{ faction: TS, band: 'Amiable', min: 100 }]
    }
    const target = [{ faction: TS, achievement: TS, standing: 0 }]
    const plan = planFactions(
      {
        targets: target,
        maxed: [],
        activities: [act('arboreans', { [TS]: 1 }, 80, 'Greater Faydark'), dagger],
        races: { own: 'Iksar', unlocked: [], mods: { Iksar: { [TS]: -750 } } }
      },
      S
    )
    const f = followedPlan(plan, target)
    expect(f.steps.map((s) => [s.id, s.finish, s.reach])).toEqual([
      ['arboreans', [], [{ faction: TS, to: 850, label: `${TS} for Tunare Scouts Dagger` }]],
      ['dagger', [TS], undefined]
    ])
    let r = readFollow(f, freshFollow(), { [TS]: 800 }, new Set())
    expect(r.view.current).toMatchObject({ index: 0, unitsLeft: 50, goals: [{ faction: TS, achievement: `${TS} for Tunare Scouts Dagger`, standing: 800, to: 850, done: false }] })
    r = readFollow(f, r.state, { [TS]: 850 }, new Set())
    expect(r.events).toEqual([{ kind: 'step', index: 0, step: f.steps[0], next: f.steps[1] }])
    expect(r.view.current).toMatchObject({ index: 1, unitsLeft: 1150 })
    // What a page sends is checked too.
    expect(sanitizeFollowedPlan(JSON.parse(JSON.stringify(f)))).toEqual(f)
  })

  it('follows a step the player picks, until the faction lines go toward another', () => {
    const f = twoSteps()
    // In West Commonlands, on the hand-ins there (step 1 of the plan is Mojax's).
    let r = readFollow(f, freshFollow(), { A: 1900, B: 1950 }, new Set(), { zone: 'West Commonlands' })
    expect(r.view.current).toMatchObject({ index: 0 })
    // Picked: the camp, counted from here, wherever the player is.
    r = readFollow(f, pickStep(r.state, 1), { A: 1900, B: 1950 }, new Set(), { zone: 'West Commonlands' })
    expect(r.view.current).toMatchObject({ index: 1, unitsLeft: 20, progress: 0 })
    // A hand-in to Mojax takes it back there.
    r = readFollow(f, r.state, { A: 1900, B: 1960 }, new Set(), { zone: 'West Commonlands', moved: { B: 10 } })
    expect(r.view.current).toMatchObject({ index: 0, unitsLeft: 4 })
  })

  /** A followed step made by hand: `per` a unit's amounts, `units` as planned at `unitSec` each. */
  const step = (id: string, goals: { finish?: string[]; lift?: string[] }, per: Record<string, number>, units: number, unitSec = 60, zone = 'Neriak'): FollowStep => ({
    id,
    kind: 'kill',
    title: id,
    zone,
    finish: goals.finish ?? [],
    lift: goals.lift ?? [],
    per,
    units,
    unitSec
  })
  const plan = (...steps: FollowStep[]): FollowedPlan => ({ at: 0, steps, names: {} })

  it('counts the time left by what each step still wants, not what was planned', () => {
    const f = plan(step('hand-ins', { finish: ['B'] }, { B: 10 }, 5, 6), step('camp', { finish: ['A'] }, { A: 5 }, 20, 60))
    // A has come on since the plan: the camp wants 10 kills, not 20.
    const r = readFollow(f, freshFollow(), { A: 1950, B: 1950 }, new Set())
    expect(r.view.current).toMatchObject({ index: 0, unitsLeft: 5 })
    expect(r.view.secondsLeft).toBe(5 * 6 + 10 * 60)
    // Never more than planned.
    expect(readFollow(f, freshFollow(), { A: 1000, B: 1950 }, new Set()).view.secondsLeft).toBe(5 * 6 + 20 * 60)
  })

  it('works on the step whose own amounts the faction lines match, then the one worked on before', () => {
    // Step 1's hand-in moves B and C by 20 and A by 2 on the side; step 0 is a camp for A at 5 a kill.
    const f = plan(step('camp', { finish: ['A'] }, { A: 5 }, 20), step('hand-in', { finish: ['B', 'C'] }, { B: 20, C: 20 }, 5))
    const first = readFollow(f, freshFollow(), { A: 1900, B: 1900, C: 1900 }, new Set())
    expect(first.view.current).toMatchObject({ index: 0 })
    expect(readFollow(f, first.state, { A: 1902, B: 1920, C: 1920 }, new Set(), { moved: { A: 2, B: 20, C: 20 } }).view.current).toMatchObject({ index: 1 })
    // Two steps that fit as well: the one worked on before stays.
    const g = plan(step('camp', { finish: ['A'] }, { A: 5 }, 20), step('camp too', { finish: ['A', 'E'] }, { A: 5, E: 5 }, 20))
    const on = readFollow(g, pickStep(freshFollow(), 1), { A: 1900, E: 1900 }, new Set())
    expect(readFollow(g, on.state, { A: 1905, E: 1900 }, new Set(), { moved: { A: 5 } }).view.current).toMatchObject({ index: 1 })
    // Several kills since the last read still fit the camp's amount.
    expect(readFollow(f, first.state, { A: 1915, B: 1900, C: 1900 }, new Set(), { moved: { A: 15, B: 1 } }).view.current).toMatchObject({ index: 0 })
  })

  it('counts down a faction the export does not list, from what the log moved it', () => {
    const f = plan(step('camp', { finish: ['F'] }, { F: 10 }, 200))
    let r = readFollow(f, freshFollow(), {}, new Set())
    expect(r.view.current).toMatchObject({ unitsLeft: 200 })
    r = readFollow(f, r.state, {}, new Set(), { moved: { F: 10 } })
    expect(r.view.current).toMatchObject({ unitsLeft: 199 })
    r = readFollow(f, r.state, {}, new Set(), { moved: { F: 20 } })
    expect(r.view.current).toMatchObject({ unitsLeft: 197 })
    expect(r.state.drift).toEqual({ F: 30 })
    // Once an export gives its standing, that counts.
    r = readFollow(f, r.state, { F: 100 }, new Set())
    expect(r.view.current).toMatchObject({ unitsLeft: 190 })
    expect(r.state.drift).toEqual({})
  })

  it('does not count a faction to bring back as done before the steps that lower it', () => {
    const f = plan(step('camp', { finish: ['A'] }, { A: 5 }, 20), step('lift', { lift: ['L'] }, { L: 10 }, 30, 10))
    // L is at 100: not lowered yet, so the step is still to come, at its planned 30.
    let r = readFollow(f, freshFollow(), { A: 1900, L: 100 }, new Set())
    expect(r.view).toMatchObject({ done: 0, current: { index: 0 } })
    expect(r.view.secondsLeft).toBe(20 * 60 + 30 * 10)
    r = readFollow(f, r.state, { A: 2000, L: -300 }, new Set())
    expect(r.view).toMatchObject({ done: 1, current: { index: 1, unitsLeft: 30 } })
    r = readFollow(f, r.state, { A: 2000, L: 0 }, new Set())
    expect(r.view).toMatchObject({ done: 2, current: null })
  })

  it('keeps the step worked on, its progress and what is done when the plan is searched again', () => {
    const f = twoSteps()
    let r = readFollow(f, pickStep(freshFollow(), 1), { A: 1900, B: 1950 }, new Set())
    r = readFollow(f, r.state, { A: 1950, B: 1950 }, new Set(), { moved: { A: 5 } })
    expect(r.view.current).toMatchObject({ index: 1, unitsLeft: 10, progress: 0.5 })
    // A re-plan puts a new way first and the camp second.
    const extra = { ...f.steps[0], id: 'new way', title: 'new way' }
    const g: FollowedPlan = { ...f, steps: [extra, f.steps[1], f.steps[0]] }
    const carried = carryFollow(f, r.state, g)
    expect(carried).toMatchObject({ active: 1, startUnits: { 1: 20 }, synced: true })
    const again = readFollow(g, carried, { A: 1950, B: 1950 }, new Set())
    expect(again.view.current).toMatchObject({ index: 1, unitsLeft: 10, progress: 0.5 })
    expect(again.events).toEqual([])
    // A step no longer in the plan is not carried.
    expect(carryFollow(f, r.state, { ...f, steps: [f.steps[0]] })).toMatchObject({ active: null, startUnits: {} })
  })

  it('checks the followed plans a file holds: an old or broken entry is dropped or mended, not thrown on', () => {
    const f = twoSteps()
    const state = { done: [1, 1, 7, -1, 'x'], reached: ['A', 3], active: 5, startUnits: { 0: 20, 9: 4, 1: -2 }, drift: { F: 30, '': 5, G: 'x', H: 0 }, synced: 'yes' }
    expect(sanitizeFollows({ Kelwyn: { plan: f, state }, Aldric: { plan: null }, Brenna: 'nothing', '': { plan: f } })).toEqual({
      Kelwyn: { plan: f, state: { done: [1], reached: ['A'], active: null, startUnits: { 0: 20 }, drift: { F: 30 }, synced: false } }
    })
    expect(sanitizeFollows([f])).toEqual({})
    expect(sanitizeFollowState(undefined, 2)).toEqual(freshFollow())
  })

  it('checks a plan sent by a page', () => {
    expect(sanitizeFollowedPlan(null)).toBeNull()
    expect(sanitizeFollowedPlan({ steps: 'no' })).toBeNull()
    const f = sanitizeFollowedPlan({
      at: 5,
      names: { A: 'x', B: 3 },
      steps: [
        { id: 'a', kind: 'kill', title: 't', finish: ['A', 4], per: { A: 5, B: 'x' }, units: 3.4, unitSec: -1 },
        { id: 'b', kind: 'dance' }
      ]
    })!
    expect(f).toEqual({ at: 5, names: { A: 'x' }, steps: [{ id: 'a', kind: 'kill', title: 't', zone: '', finish: ['A'], lift: [], per: { A: 5 }, units: 3, unitSec: 0 }] })
  })

  it("carries each hand-in's items to the overlay: what goes in, and what it is made into", () => {
    const plan = planFactions(
      {
        targets: [
          { faction: 'A', achievement: 'A', standing: 1900 },
          { faction: 'B', achievement: 'B', standing: 1950 }
        ],
        maxed: [],
        activities: [
          { ...act('Clurg', { A: 5 }, 600, 'Oggok', 'quest'), items: [{ name: 'Lizard Tail', count: 2, how: 'drop', where: 'lizardmen' }] },
          { ...act('Noxhil', { B: 10 }, 600, 'Oggok', 'quest'), items: [{ name: 'Fire Beetle Eye', count: 10, how: 'drop', where: '', makes: 'Box of Beetle Eyes' }] },
          act('camp', { A: 5 }, 1, 'West Freeport')
        ]
      },
      S
    )
    const f = followedPlan(plan, [])
    const byId = Object.fromEntries(f.steps.map((st) => [st.id, st.items]))
    expect(byId).toEqual({ Clurg: [{ name: 'Lizard Tail', count: 2 }], Noxhil: [{ name: 'Fire Beetle Eye', count: 10, makes: 'Box of Beetle Eyes' }] })
    // A kill has none.
    expect(twoSteps().steps.find((st) => st.id === 'camp')!.items).toBeUndefined()
    // A page sends them; what is not an item is dropped.
    const clurg = f.steps.find((st) => st.id === 'Clurg')!
    expect(sanitizeFollowedPlan({ ...f, steps: [{ ...clurg, items: [{ name: 'Lizard Tail', count: 2.4 }, { count: 3 }, 'x'] }] })!.steps[0].items).toEqual([
      { name: 'Lizard Tail', count: 2 }
    ])
    const r = readFollow(f, freshFollow(), { A: 1900, B: 1950 }, new Set())
    expect(r.view.current!.items).toEqual(byId[r.view.current!.id])
    expect(r.view.next!.items).toEqual(byId[f.steps[r.view.next!.index].id])
    expect(itemsSaid(byId.Noxhil!)).toBe('10 Fire Beetle Eye made into Box of Beetle Eyes')
    expect(
      itemsSaid([
        { name: 'Lizard Tail', count: 2 },
        { name: 'Gold', count: 1 }
      ])
    ).toBe('2 Lizard Tail + Gold')
  })

  it('says a step aloud', () => {
    expect(sayStep({ kind: 'kill', title: 'x', zone: 'West Freeport' })).toBe('the kill camp in West Freeport')
    expect(sayStep({ kind: 'turnin', title: 'x', zone: 'West Commonlands', npc: 'Mojax Hikspin' })).toBe('hand-ins to Mojax Hikspin in West Commonlands')
  })
})

// ---------- skill achievements ----------

describe('skill achievements', () => {
  const SKILLS = [
    'General: Skills',
    "I\tShaman's Casting Proficiency, Level 50",
    'I\t\tReach the maximum skill in Divination at level 50.',
    "I\tMonk's Specialized Proficiency, Level 50",
    'C\t\tReach the maximum skill in Flying Kick at level 50.',
    'I\t\tReach the maximum skill in Dragon Punch at level 50.',
    "C\tMonk's Combat Proficiency, Level 50",
    'C\t\tReach the maximum skill in Defense at level 50.'
  ].join('\n')

  it('reads the open skill objectives, with the class each is for', () => {
    expect(skillGoals(parseAchievements(SKILLS).sections)).toEqual([
      { achievement: "Shaman's Casting Proficiency, Level 50", className: 'Shaman', skill: 'Divination', level: 50 },
      { achievement: "Monk's Specialized Proficiency, Level 50", className: 'Monk', skill: 'Dragon Punch', level: 50 }
    ])
  })

  it('reads a skill-up line, and knows a skill by any name the game gives it', () => {
    expect(skillUp('You have become better at Divination! (190)')).toEqual({ skill: 'Divination', value: 190 })
    expect(skillUp('You have become better at Specialize Divination! (167)')).toEqual({ skill: 'Specialize Divination', value: 167 })
    expect(skillUp('You gain party experience!')).toBeNull()
    expect(skillId('Channelling')).toBe(skillId('Channeling'))
    expect(skillId('Hand To Hand')).toBe(28)
    expect(skillId('Dragon Punch')).toBe(21)
    expect(skillId('Tail Rake')).toBe(21)
    expect(skillId('1H Blunt')).toBe(0)
    expect(skillId('Common Tongue')).toBeNull()
  })

  it("takes the log's last value, under whatever name the log gives the skill", () => {
    const values = joinSkillValues([
      { 'Tail Rake': { value: 200, at: 10 }, Divination: { value: 150, at: 10 } },
      { 'Tail Rake': { value: 255, at: 20 }, 'Specialize Alteration': { value: 125, at: 30 } }
    ])
    // An Iksar's Dragon Punch is Tail Rake in the log.
    expect(skillValue(values, 'Dragon Punch')).toEqual({ value: 255, at: 20 })
    expect(skillValue(values, 'Divination')).toEqual({ value: 150, at: 10 })
    expect(skillValue(values, 'Bind Wound')).toBeNull()
  })
})

// ---------- tracked achievements ----------

describe('tracked achievements', () => {
  const sections = parseAchievements(
    [
      'Slayer: Conquest',
      "I\tPuttin' On The Dog",
      'I\t\tKobolds\t2645/5000',
      'General: Skills',
      "I\tShaman's Casting Proficiency, Level 50",
      'I\t\tReach the maximum skill in Divination at level 50.',
      'EverQuest: Progression',
      'I\tPriests of Marr',
      'I\t\tPriests of Marr',
      'EverQuest: Hunter',
      'I\tHunter of Befallen',
      'C\t\tCommander Windstream',
      'I\t\tGynok Moltor',
      'I\t\tThe Thaumaturgist',
      'I\t\tSkeletal Warlord',
      'I\t\t(Optional) Priest Amiaz'
    ].join('\n')
  ).sections
  const key = (sec: number, ach: number) => achKey(sections[sec], sections[sec].ach[ach])

  it('gives each tracked achievement its progress, in the order tracked', () => {
    const tracked = [key(3, 0), key(0, 0), 'EverQuest: Hunter > gone since', key(1, 0), key(2, 0)]
    const got = trackedAchievements(
      sections,
      // The Thaumaturgist ticked by hand on the Achievements page.
      { ticks: [objKey(sections[3], sections[3].ach[0], sections[3].ach[0].c[2])], tracked },
      {
        slayer: [{ name: "Puttin' On The Dog", section: 'Slayer: Conquest', races: 'Kobolds', count: 2645, since: 75, max: 5000, last: 1, done: false }],
        skills: [{ achievement: "Shaman's Casting Proficiency, Level 50", className: 'Shaman', skill: 'Divination', level: 50, value: 190, target: 250, last: 1 }],
        factions: { 'priests of marr': { faction: 'Priests of Marr', standing: 1285 } },
        // The log names it with its article.
        kills: new Map([['a gynok moltor', { times: [100, 200] }]])
      }
    )
    expect(got.map((t) => t.name)).toEqual(['Hunter of Befallen', "Puttin' On The Dog", "Shaman's Casting Proficiency, Level 50", 'Priests of Marr'])
    // Commander done in the export, the Thaumaturgist by hand, Gynok Moltor killed since: one named left.
    expect(got[0]).toMatchObject({ left: ['Skeletal Warlord'], total: 4, justDone: [{ name: 'Gynok Moltor', at: 200 }], done: false })
    expect(got[1]).toMatchObject({ count: { value: 2720, max: 5000, since: 75 } })
    expect(got[2]).toMatchObject({ skills: [{ skill: 'Divination', value: 190, target: 250 }] })
    expect(got[3]).toMatchObject({ count: { value: 1285, max: 2000, faction: 'Priests of Marr' } })
  })

  it('says one done when the game said so, or when nothing required is left', () => {
    const tracked = [key(0, 0), key(3, 0)]
    const got = trackedAchievements(
      sections,
      { ticks: [], tracked },
      { completed: new Set(["puttin' on the dog"]), kills: new Map(['Gynok Moltor', 'The Thaumaturgist', 'Skeletal Warlord'].map((n) => [n.toLowerCase(), { times: [5] }])) }
    )
    expect(got.map((t) => t.done)).toEqual([true, true])
  })
})
