import { describe, expect, it } from 'vitest'
import { baseZone, emptySources, joinSources, shareSources, sourceReader, usualAmount, type FactionSourceTallies } from '../src/features/factions/attribution'
import { parseFactionPageFull, type FactionRow } from '../src/features/factions/core'
import { parseQuestPage, readHandIn } from '../src/features/factions/questPages'
import {
  buildCatalog,
  DEFAULT_SETTINGS,
  factionNamer,
  howHad,
  itemsToLookUp,
  KEEP_MAXED,
  NO_CHOICES,
  planFactions,
  planFor,
  unitTime,
  waysToRaise,
  zoneKey,
  type CatalogInput,
  type PlanActivity,
  type PlanInput,
  type PlanSettings
} from '../src/features/factions/planner'
import type { ItemInfo } from '../src/shared/types'
import { lookUp, moversOf } from '../src/features/factions/lookup'

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0)
const adjusted = (faction: string, n: number) => `Your faction standing with ${faction} has been adjusted by ${n}.`
const better = (faction: string) => `Your faction standing with ${faction} could not possibly get any better.`

/** Lines at the given seconds after T0 into a fresh stretch, or into `into` to go on with one. */
function read(lines: [number, string][], into: FactionSourceTallies = emptySources()): FactionSourceTallies {
  const r = sourceReader()
  for (const [s, text] of lines) r({ time: T0 + s * 1000, text }, into)
  return into
}

/** A stretch's tallies with anything left waiting settled, as a view sees them. */
const settled = (s: FactionSourceTallies) => joinSources([s])

describe('what caused a faction change', () => {
  it('puts a kill down to the mob named in the same second, in the zone without its instance', () => {
    const s = settled(
      read([
        [0, 'You have entered The Plane of Hate - Group 1 (Awakened).'],
        [5, 'You punch a putrid skeleton for 16 points of damage.'],
        [5, adjusted('Guards of Qeynos', 5)],
        [5, adjusted('Bloodsabers', -1)],
        [5, better('Antonius Bayle')],
        [5, "A putrid skeleton's corpse says, 'Bertoxxuloussss... shall find you.'"],
        [5, 'You have slain a putrid skeleton!']
      ])
    )
    const t = s.acts['kill|the plane of hate|a putrid skeleton']
    expect(t).toMatchObject({ kind: 'kill', zone: 'The Plane of Hate', name: 'A putrid skeleton', n: 1, top: ['Antonius Bayle'] })
    expect(t.hits).toEqual({ 'Guards of Qeynos': { '5': 1 }, Bloodsabers: { '-1': 1 } })
    expect(s.zones['the plane of hate'].n).toBe(1)
  })

  it("takes a groupmate's or a pet's kill, and never a pet or the player as the mob", () => {
    const s = settled(
      read([
        [0, 'You have entered Blackburrow.'],
        [3, adjusted('Silent Fist Clan', 5)],
        [3, 'Vonartik has been slain by a gnoll!'],
        [3, 'A gnoll has been slain by Aldric`s warder!']
      ])
    )
    expect(Object.keys(s.acts)).toEqual(['kill|blackburrow|a gnoll'])
  })

  it('puts a hand-in down to the NPC offered to, and counts what a stack of it did', () => {
    const lines: [number, string][] = [
      [0, 'You have entered Misty Thicket.'],
      [10, 'You offered 3 Bandages to Joogl Honeybugger.']
    ]
    // Legends takes the stack at once: one completion per item, each the NPC's line and its faction lines.
    for (let i = 0; i < 3; i++) {
      lines.push([11, "Joogl Honeybugger says, 'Oh thank you, Kelwyn.'"])
      lines.push([11, adjusted('Deeppockets', 5)])
      lines.push([11, adjusted('Coalition of Tradefolk Underground', -1)])
    }
    lines.push([30, 'You have entered Rivervale.'])
    const s = settled(read(lines))
    const t = s.acts['turnin|misty thicket|joogl honeybugger']
    expect(t).toMatchObject({ kind: 'turnin', n: 3, items: { Bandages: { count: 3, done: 3 } } })
    expect(usualAmount(t.hits['Deeppockets'])).toBe(5)
    // Three in the same second: a run, at a pace the log timed.
    expect(t.runN).toBe(2)
  })

  it('takes an NPC talking in the same second as the hand-in when the log wrote no offer', () => {
    const s = settled(
      read([
        [0, 'You have entered North Qeynos.'],
        [4, "Lashun Novashine says, 'Very well, young one.'"],
        [4, adjusted('Priests of Life', 5)]
      ])
    )
    expect(s.acts['turnin|north qeynos|lashun novashine'].n).toBe(1)
  })

  it('counts a change nothing explains, and puts it down to nothing', () => {
    const s = settled(read([[2, adjusted('Priests of Life', 5)]]))
    expect(s.acts).toEqual({})
    expect(s.unexplained).toBe(1)
  })

  it("carries a change across the live log's reads: its kill line may come in the next one", () => {
    const into = read([
      [0, 'You have entered Blackburrow.'],
      [5, adjusted('Silent Fist Clan', 5)]
    ])
    expect(into.open).toBeTruthy()
    read([[5, 'You have slain a gnoll!']], into)
    expect(settled(into).acts['kill|blackburrow|a gnoll'].n).toBe(1)
  })

  it('joins stretches oldest first', () => {
    const a = read([
      [0, 'You have entered Blackburrow.'],
      [5, adjusted('Silent Fist Clan', 5)],
      [5, 'You have slain a gnoll!'],
      [9, 'You have entered Qeynos Hills.']
    ])
    const b = read([
      [100, 'You have entered Blackburrow.'],
      [105, adjusted('Silent Fist Clan', 10)],
      [105, 'You have slain a gnoll!'],
      [109, 'You have entered Qeynos Hills.']
    ])
    const t = joinSources([a, b]).acts['kill|blackburrow|a gnoll']
    expect(t.n).toBe(2)
    expect(t.hits['Silent Fist Clan']).toEqual({ '5': 1, '10': 1 })
  })

  it("knows an instance's zone", () => {
    expect(baseZone('Kerra Isle 4 (Refined)')).toBe('Kerra Isle')
    expect(baseZone("Nagafen's Lair - Solo 4 (Fused)")).toBe("Nagafen's Lair")
    expect(baseZone('Guild Hall (Grand)')).toBe('Guild Hall (Grand)')
  })
})

describe('eqlwiki quest pages', () => {
  const page = `{| class="questTopTable"
! ''' Start Zone: '''
| [[Qeynos|South Qeynos]]
|-
! ''' Quest Giver: '''
| [[Tabure Ahendle]]
|-
! ''' Minimum Level: '''
| 4
|}
== Walkthrough ==
: Tabure Ahendle says, 'Bring me four [[Kobold Hide]]s and I will give you [[Rawhide Armor]].'
'''Hand [[Tabure Ahendle]] 4 [[Kobold Hide]]s.'''
<div class="facblock">
* Your faction standing with [[Steel Warriors]] has been adjusted by 20.
* Your faction standing with [[Guards of Qeynos]] got better. (+5)
* Your faction standing with [[The Freeport Militia]] got worse.
</div>
You receive a [[Sealed Letter]].
'''Give the [[Sealed Letter]] to [[Tabure Ahendle]].'''
<div class='facblock'>
* Your faction standing with [[Steel Warriors]] has been adjusted by 75.
</div>`

  it('reads the top table and each faction block, with its hand-in', () => {
    const q = parseQuestPage('Kobold Killing', page)!
    expect(q).toMatchObject({ page: 'Kobold Killing', givers: ['Tabure Ahendle'], zones: ['South Qeynos'], level: 4 })
    expect(q.steps).toHaveLength(2)
    expect(q.steps[0]).toMatchObject({ npc: 'Tabure Ahendle', handIn: [{ item: 'Kobold Hide', count: 4 }], guessed: ['The Freeport Militia'] })
    expect(q.steps[0].hits).toEqual({ 'Steel Warriors': 20, 'Guards of Qeynos': 5, 'The Freeport Militia': -1 })
    // Handed over by an NPC earlier in the walkthrough: a step of a chain.
    expect(q.steps[1].handIn).toEqual([{ item: 'Sealed Letter', count: 1, given: true }])
  })

  it('has no steps without a faction block', () => {
    expect(parseQuestPage('Nothing', "'''Hand [[Bob]] a [[Rock]].'''")).toBeNull()
  })

  it('finds who it goes to when the name is not linked, and a count said apart from the item', () => {
    expect(readHandIn("'''Give a [[Bottle of Milk]] to Mojax Hikspin.'''")).toEqual({ handIn: [{ item: 'Bottle of Milk', count: 1 }], npc: 'Mojax Hikspin' })
    expect(readHandIn('[[Lizard Tail|Lizard Tails]] drop from any lizardman. Hand 4 of them to Horgus.')).toMatchObject({ handIn: [{ item: 'Lizard Tail', count: 4 }], count: 4 })
  })

  it('keeps what the item is combined from, and the mob the walkthrough has you kill for it', () => {
    const q = parseQuestPage(
      'Beetles',
      `Combine 10 x [[Fire Beetle Eye]]s in the crate.
'''Hand in the [[Box of Beetle Eyes]] to [[Noxhil V\`Sek]].'''
<div class="facblock">
* Your faction standing with [[The Dead]] has been adjusted by 10.
</div>
You will have to kill Nillipuss multiple times to get four [[Jumjum Stalk]]s.
'''Bring the four [[Jumjum Stalk]] to Reebo.'''
<div class="facblock">
* Your faction standing with [[Storm Reapers]] has been adjusted by 10.
</div>`
    )!
    expect(q.steps[0].handIn[0]).toMatchObject({ item: 'Box of Beetle Eyes', madeOf: { item: 'Fire Beetle Eye', count: 10 } })
    expect(q.steps[1].handIn[0]).toMatchObject({ item: 'Jumjum Stalk', count: 4, from: 'Nillipuss' })
  })
})

describe('eqlwiki faction pages, both sides', () => {
  it('reads what raises and what lowers the faction, quests by the page they link', () => {
    const p = parseFactionPageFull(
      'Crimson Hands',
      `{{Factionpage|
| zones_raise =
* [[Paineel]]
| quests_raise =
* [[Innoruuk Symbol Quests|Innoruuk Disciple]]
* [[Heretic Battle]]
| mobs_raise =
* [[Guard Korlack]]  <span class='fmz'>(Paineel)</span>
* [[A kerran puma]] <span class='fmz'>(Kerra Island)</span>
| mobs_lower =
* [[Ghanlin Skyphire]] <span class='fmz'>(Erudin Palace - Wizard Guildmaster)</span>
}}`
    )!
    expect(p.raise.quests).toEqual(['Innoruuk Symbol Quests', 'Heretic Battle'])
    expect(p.raise.zones).toEqual(['Paineel'])
    expect(p.raise.mobs.map((m) => m.name)).toEqual(['Guard Korlack', 'A kerran puma'])
    expect(p.lower.mobs[0]).toEqual({ name: 'Ghanlin Skyphire', zone: 'Erudin Palace', note: 'Wizard Guildmaster' })
  })
})

describe('names', () => {
  it("puts the wiki's faction names the game's way", () => {
    const name = factionNamer(['Opal Darkbriar', 'The Freeport Militia', 'Ebon Mask', 'Deepmuses', "Tunare's Scouts"])
    expect(name('Opal Dark Briar')).toBe('Opal Darkbriar')
    expect(name('Freeport Militia')).toBe('The Freeport Militia')
    expect(name('Hall of the Ebon Mask')).toBe('Ebon Mask')
    expect(name('Deep Muses')).toBe('Deepmuses')
    expect(name("Tunare's Scouts")).toBe("Tunare's Scouts")
    expect(name('Kromzek')).toBe('Kromzek')
  })

  it('knows a place by either name', () => {
    expect(zoneKey('The Northern Plains of Karana')).toBe(zoneKey('North Karana'))
    expect(zoneKey('Kerra Isle 4 (Refined)')).toBe(zoneKey('Kerra Island'))
  })
})

// ---------- the catalog ----------

const item = (use: Partial<NonNullable<ItemInfo['use']>>): ItemInfo => ({ title: 'x', found: true, statsblock: '', use: { notes: '', quests: [], recipes: [], value: '', ...use } })

function catalogInput(over: Partial<CatalogInput> = {}): CatalogInput {
  return {
    factions: ['Steel Warriors', 'Priests of Marr', 'Dismal Rage', 'Guards of Qeynos', 'Knights of Truth'],
    targets: ['Steel Warriors', 'Priests of Marr'],
    sources: emptySources(),
    pages: [],
    quests: {},
    bought: {},
    have: {},
    items: {},
    ...over
  }
}

/** A log with `n` hand-ins to an NPC, each offered one item. */
function handIns(npc: string, zone: string, n: number, hits: [string, number][], itemName = 'Bottle of Milk'): FactionSourceTallies {
  const lines: [number, string][] = [[0, `You have entered ${zone}.`]]
  for (let i = 0; i < n; i++) {
    lines.push([10 + i * 5, `You offered 1 ${itemName} to ${npc}.`])
    lines.push([11 + i * 5, `${npc} says, 'Thank you.'`])
    for (const [f, v] of hits) lines.push([11 + i * 5, adjusted(f, v)])
  }
  lines.push([10 + n * 5 + 60, 'You have entered Nowhere.'])
  return settled(read(lines))
}

describe('the catalog', () => {
  it('takes hand-ins the log saw three times or more as repeatable, and fewer as done', () => {
    const sources = joinSources([
      handIns('Mojax Hikspin', 'West Commonlands', 3, [
        ['Priests of Marr', 5],
        ['Dismal Rage', -1]
      ]),
      handIns('Luxio Nulsis', 'East Freeport', 1, [['Steel Warriors', 100]], 'Odd Thing')
    ])
    const { activities } = buildCatalog(catalogInput({ sources, bought: { 'bottle of milk': { merchant: 'Bim Buskin', each: 4 } } }))
    const mojax = activities.find((a) => a.npc === 'Mojax Hikspin')!
    expect(mojax).toMatchObject({ kind: 'turnin', source: 'log', seen: 3, hits: { 'Priests of Marr': 5, 'Dismal Rage': -1 } })
    expect(mojax.once).toBeUndefined()
    expect(mojax.items).toEqual([{ name: 'Bottle of Milk', count: 1, how: 'bought', where: 'Bim Buskin', each: 4 }])
    expect(activities.find((a) => a.npc === 'Luxio Nulsis')!.once).toMatch(/once/)
  })

  it('groups kills in a zone that move the same factions into one camp', () => {
    const lines: [number, string][] = [[0, 'You have entered Blackburrow.']]
    const mobs = ['a gnoll', 'a gnoll', 'a gnoll guardsman']
    mobs.forEach((m, i) => {
      lines.push([10 + i * 30, adjusted('Steel Warriors', 5)])
      lines.push([10 + i * 30, adjusted('Knights of Truth', 5)])
      lines.push([10 + i * 30, `You have slain ${m}!`])
    })
    const { activities } = buildCatalog(catalogInput({ sources: settled(read(lines)) }))
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({ kind: 'kill', zone: 'Blackburrow', mobs: ['A gnoll', 'A gnoll guardsman'], seen: 3, common: 2, named: 0, hits: { 'Steel Warriors': 5 } })
  })

  it("plans a wiki quest step as repeatable only with one kind of item that can be had, not a chain's, and under 50 points", () => {
    const quest = (steps: { hits: Record<string, number>; handIn: { item: string; count: number; given?: boolean }[] }[]) => ({
      page: 'Q',
      givers: ['Giver'],
      zones: ['South Qeynos'],
      level: 1,
      steps: steps.map((s) => ({ ...s, guessed: [], npc: 'Giver', line: '' }))
    })
    const input = catalogInput({
      pages: [{ page: 'Steel Warriors', raise: { mobs: [], quests: ['Q'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
      quests: {
        Q: quest([
          { hits: { 'Steel Warriors': 10 }, handIn: [{ item: 'Kobold Hide', count: 4 }] },
          { hits: { 'Steel Warriors': 75 }, handIn: [{ item: 'Kobold Hide', count: 4 }] },
          { hits: { 'Steel Warriors': 10 }, handIn: [{ item: 'Sealed Letter', count: 1, given: true }] },
          { hits: { 'Steel Warriors': 10 }, handIn: [] },
          { hits: { 'Steel Warriors': 10 }, handIn: [{ item: 'Mystery', count: 1 }] }
        ])
      },
      items: { 'kobold hide': item({ sources: { drops: [{ zone: 'Toxxulia Forest', mobs: ['a kobold'] }], foraged: [], crafted: false } }) }
    })
    const steps = buildCatalog(input).activities.filter((a) => a.kind === 'quest')
    expect(steps.map((a) => a.once ?? '')).toEqual([
      '',
      'worth 75 at once',
      'a step of a chain',
      'the walkthrough shows no simple hand-in',
      'nothing says where its item comes from'
    ])
    expect(steps[0].items).toEqual([{ name: 'Kobold Hide', count: 4, how: 'drop', where: 'Toxxulia Forest' }])
    expect(itemsToLookUp(input)).toEqual(['Kobold Hide', 'Mystery'])
  })

  it('says how an item is come by: coin, bought before, a merchant, crafted, a drop from common or named mobs', () => {
    const items = {
      rock: item({ vendors: [{ zone: 'Rivervale', npc: 'Kizzie', note: '' }] }),
      'box of eyes': item({ sources: { drops: [], foraged: [], crafted: true } }),
      head: item({ sources: { drops: [{ zone: 'East Freeport', mobs: ['Lyda Nasin'] }], foraged: [], crafted: false } }),
      scalp: item({ sources: { drops: [{ zone: 'Highpass', mobs: ['an orc pawn', 'Captain Orc'] }], foraged: [], crafted: false } })
    }
    const has = { bought: { milk: { merchant: 'Bim', each: 3 } }, items }
    expect(howHad('Gold', has).how).toBe('coin')
    expect(howHad('Milk', has)).toEqual({ how: 'bought', where: 'Bim', each: 3 })
    expect(howHad('Rock', has)).toEqual({ how: 'vendor', where: 'Kizzie (Rivervale)' })
    expect(howHad('Box of Eyes', has).how).toBe('crafted')
    expect(howHad('Head', has)).toEqual({ how: 'drop', where: 'East Freeport', named: 1 })
    expect(howHad('Scalp', has)).toEqual({ how: 'drop', where: 'Highpass' })
    expect(howHad('Nothing Known', has).how).toBe('unknown')
  })

  it("learns from the player's other characters' logs: their hand-ins and camps, but not their kill pace", () => {
    const campLines = (zone: string, mob: string, n: number, gap: number): [number, string][] => {
      const lines: [number, string][] = [[0, `You have entered ${zone}.`]]
      for (let i = 0; i < n; i++) {
        lines.push([10 + i * gap, adjusted('Steel Warriors', 5)])
        lines.push([10 + i * gap, `You have slain ${mob}!`])
      }
      return lines
    }
    const own = settled(read(campLines('Blackburrow', 'a gnoll', 3, 60)))
    const alt = joinSources([
      handIns('Mojax Hikspin', 'West Commonlands', 4, [['Priests of Marr', 5]]),
      settled(read(campLines('Blackburrow', 'a gnoll', 20, 10))),
      settled(read(campLines('Everfrost Peaks', 'a kobold', 20, 10)))
    ])
    const shared = shareSources(own, [{ character: 'Kelwyn_neriak', sources: alt }])
    // Their kills are counted; their runs are not this character's pace.
    expect(shared.sources.acts['kill|blackburrow|a gnoll']).toMatchObject({ n: 23, runN: 2 })
    expect(shared.from['kill|blackburrow|a gnoll']).toEqual({ others: ['Kelwyn_neriak'], own: true })
    expect(shared.from['turnin|west commonlands|mojax hikspin']).toEqual({ others: ['Kelwyn_neriak'], own: false })
    const { activities } = buildCatalog(catalogInput({ sources: shared.sources, shared: shared.from }))
    const mojax = activities.find((a) => a.npc === 'Mojax Hikspin')!
    expect(mojax).toMatchObject({ source: 'log', seen: 4, others: ['Kelwyn_neriak'], theirs: true })
    const gnolls = activities.find((a) => a.zone === 'Blackburrow')!
    expect(gnolls).toMatchObject({ seen: 23, others: ['Kelwyn_neriak'] })
    expect(gnolls.theirs).toBeUndefined()
    // Only the other character killed kobolds: no pace of this one's to go by.
    const kobolds = activities.find((a) => a.zone === 'Everfrost Peaks')!
    expect(kobolds.theirs).toBe(true)
    expect(kobolds.measured).toBeUndefined()
  })

  it("marks a camp of a city's people, not its vermin", () => {
    const lines: [number, string][] = [[0, 'You have entered West Freeport.']]
    ;['Arem Ulosia', 'a Freeport guard', 'a sewer rat'].forEach((m, i) => {
      lines.push([10 + i * 30, adjusted(m === 'a sewer rat' ? 'Steel Warriors' : 'Priests of Marr', 5)])
      lines.push([10 + i * 30, `You have slain ${m}!`])
    })
    const { activities } = buildCatalog(catalogInput({ sources: settled(read(lines)) }))
    expect(activities.find((a) => a.hits['Priests of Marr'])!.city).toBe(true)
    expect(activities.find((a) => a.hits['Steel Warriors'])!.city).toBeUndefined()
  })
})

// ---------- the plan ----------

const S: PlanSettings = { ...DEFAULT_SETTINGS, travelMin: 10, keepMaxed: KEEP_MAXED.off }

function act(id: string, hits: Record<string, number>, perHour: number, over: Partial<PlanActivity> = {}): PlanActivity {
  return { id, kind: 'kill', title: id, zone: id, hits, source: 'log', seen: 100, measured: perHour, ...over }
}

describe('planFactions', () => {
  it('runs an activity until the achievement is done, counting the trip there', () => {
    const plan = planFactions({ targets: [{ faction: 'A', achievement: 'A', standing: 1990 }], maxed: [], activities: [act('camp', { A: 3 }, 60)] }, S)
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({ units: 4, finishes: ['A'], travel: 600 })
    expect(plan.seconds).toBeCloseTo(600 + 4 * 60)
  })

  it('finishes two achievements with one activity that raises both', () => {
    const plan = planFactions(
      {
        targets: [
          { faction: 'A', achievement: 'A', standing: 1900 },
          { faction: 'B', achievement: 'B', standing: 1950 }
        ],
        maxed: [],
        activities: [act('both', { A: 5, B: 5 }, 600), act('a-only', { A: 5 }, 600), act('b-only', { B: 5 }, 600)]
      },
      S
    )
    expect(plan.steps.map((s) => s.activity.id)).toEqual(['both'])
    expect(plan.steps[0].finishes.sort()).toEqual(['A', 'B'])
  })

  it('finishes an achievement before the work that lowers it, since a done one stays done', () => {
    // x lowers B a lot, y lowers A a little: B first with y (A drops to -200), then A with x, which may
    // take B down all it likes. The other way round, y would have to make B up from -2000: 600 units, not 420.
    const input: PlanInput = {
      targets: [
        { faction: 'A', achievement: 'A', standing: 0 },
        { faction: 'B', achievement: 'B', standing: 0 }
      ],
      maxed: [],
      activities: [act('x', { A: 10, B: -10 }, 360, { zone: 'z' }), act('y', { B: 10, A: -1 }, 360, { zone: 'z' })]
    }
    const plan = planFactions(input, S)
    expect(plan.steps.map((s) => s.activity.id)).toEqual(['y', 'x'])
    expect(plan.steps.map((s) => s.units)).toEqual([200, 220])
    expect(plan.steps[0]).toMatchObject({ finishes: ['B'], lowers: { A: 200 } })
    expect(plan.steps[1]).toMatchObject({ finishes: ['A'], maxedLowered: { B: 2200 } })
    expect(plan.seconds).toBeCloseTo(600 + 420 * 10)
  })

  it('builds around a locked-in way, and never uses one ruled out', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 1900 }],
      maxed: [],
      activities: [act('fast', { A: 10 }, 600), act('slow', { A: 5 }, 60)]
    }
    expect(planFactions(input, S).steps[0].activity.id).toBe('fast')
    const locked = planFactions(input, S, { ...NO_CHOICES, locks: { A: 'slow' } })
    expect(locked.steps[0]).toMatchObject({ activity: { id: 'slow' }, locked: ['A'] })
    expect(locked.options['A'].find((o) => o.activity.id === 'slow')!.chosen).toBe(true)
    expect(planFactions(input, S, { ...NO_CHOICES, excluded: ['fast'] }).steps[0].activity.id).toBe('slow')
  })

  it('leaves a once-only way out unless it is locked in, and says what nothing raises', () => {
    const input: PlanInput = {
      targets: [
        { faction: 'A', achievement: 'A', standing: 1900 },
        { faction: 'B', achievement: 'B', standing: 0 }
      ],
      maxed: [],
      activities: [act('boost', { A: 200 }, 60, { once: 'worth 200 at once' })]
    }
    const plan = planFactions(input, S)
    expect(plan.steps).toEqual([])
    expect(plan.unplanned.sort()).toEqual(['A', 'B'])
    const locked = planFactions(input, S, { ...NO_CHOICES, locks: { A: 'boost' } })
    expect(locked.steps[0]).toMatchObject({ units: 1, finishes: ['A'] })
    expect(locked.unplanned).toEqual(['B'])
  })

  it('hands in what the character holds first, at the hand-in pace', () => {
    const quest: PlanActivity = {
      id: 'q',
      kind: 'quest',
      title: 'Bone Chips',
      zone: 'Kaladim',
      hits: { A: 10 },
      source: 'log',
      seen: 50,
      items: [{ name: 'Bone Chips', count: 4, how: 'drop', where: 'Najena', have: 40 }]
    }
    const plan = planFactions({ targets: [{ faction: 'A', achievement: 'A', standing: 1850 }], maxed: [], activities: [quest] }, S)
    const unit = unitTime(quest, S)
    expect(unit.seconds).toBe(S.handInSec + 4 * S.gatherSec)
    expect(plan.steps[0]).toMatchObject({ units: 15, fromStock: 10 })
    expect(plan.seconds).toBeCloseTo(600 + 10 * S.handInSec + 5 * unit.seconds)
  })

  it('keeps maxed factions up when asked, if another way is not much slower', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 1900 }],
      maxed: ['M'],
      activities: [act('rough', { A: 10, M: -10 }, 600), act('kind', { A: 10 }, 540)]
    }
    expect(planFactions(input, S).steps[0].activity.id).toBe('rough')
    const kept = planFactions(input, { ...S, keepMaxed: KEEP_MAXED.strong })
    expect(kept.steps[0].activity.id).toBe('kind')
    expect(kept.maxedLost).toBe(0)
  })

  it('gives the same plan for the same choices', () => {
    const activities = Array.from({ length: 30 }, (_, i) => act(`a${i}`, { [`F${i % 7}`]: 3 + (i % 5), [`F${(i + 3) % 7}`]: -(i % 3) }, 30 + i * 7, { zone: `z${i % 4}` }))
    const input: PlanInput = { targets: Array.from({ length: 7 }, (_, i) => ({ faction: `F${i}`, achievement: `F${i}`, standing: i * 100 })), maxed: [], activities }
    const one = planFactions(input, S)
    const two = planFactions(input, S)
    expect(two.steps.map((s) => [s.activity.id, s.units])).toEqual(one.steps.map((s) => [s.activity.id, s.units]))
    expect(one.unplanned).toEqual([])
    for (const t of input.targets) expect(one.steps.some((s) => s.finishes.includes(t.faction))).toBe(true)
  })
})

/** A factions view row: a faction, where it stands, and its achievement as the Factions page sees it. */
function row(name: string, standing: number | null, done: boolean | null, from: 'achievements' | 'standing' | null = 'achievements'): FactionRow {
  return {
    name,
    net: 0,
    changes: 0,
    first: 0,
    last: 0,
    cap: null,
    recent: [],
    standing: standing === null ? null : { id: 1, value: standing, atExport: standing, since: 0, sinceAll: true },
    achievement: done === undefined ? null : { id: 80001, name: `${name} achievement`, done, from }
  }
}

describe('what the plan is for', () => {
  it("is the character's own achievements still to do, as the Standings tab lists them", () => {
    const factions = [row('Done Faction', 2000, true), row('Dropped Faction', 1200, true), row('Open Faction', 900, false), row('Maxed, No Achievement', 2000, null)]
    factions[3].achievement = null
    expect(planFor({ factions })).toEqual({
      targets: [{ faction: 'Open Faction', achievement: 'Open Faction achievement', standing: 900 }],
      maxed: ['Done Faction', 'Maxed, No Achievement'],
      achievementsExport: true,
      standings: { 'Done Faction': 2000, 'Dropped Faction': 1200, 'Open Faction': 900, 'Maxed, No Achievement': 2000 }
    })
  })

  it('plans more for a character that has done less', () => {
    const veteran = planFor({ factions: [row('A', 2000, true), row('B', 500, false)] })
    const fresh = planFor({ factions: [row('A', 0, false), row('B', 0, false)] })
    expect(veteran.targets.map((t) => t.faction)).toEqual(['B'])
    expect(fresh.targets.map((t) => t.faction)).toEqual(['A', 'B'])
  })

  it('without an achievements export, goes by the standing, and says so', () => {
    const got = planFor({ factions: [row('A', 2000, true, 'standing'), row('B', 1500, false, 'standing'), row('C', null, null, null)] })
    expect(got.targets.map((t) => [t.faction, t.standing])).toEqual([
      ['B', 1500],
      ['C', 0]
    ])
    expect(got.achievementsExport).toBe(false)
  })
})

describe('keeping the order while you play', () => {
  const activities = [act('slow-a', { A: 5 }, 60, { zone: 'za' }), act('fast-a', { A: 5 }, 600, { zone: 'zb' }), act('b', { B: 5 }, 600, { zone: 'zc' })]
  const at = (a: number, b: number): PlanInput => ({
    targets: [
      { faction: 'A', achievement: 'A', standing: a },
      { faction: 'B', achievement: 'B', standing: b }
    ],
    maxed: [],
    activities
  })

  it('keeps the order when only the standings moved, with the counts brought up to date', () => {
    const first = planFactions(at(1000, 1000), S)
    expect(first.kept).toBe(false)
    const later = planFactions(at(1500, 1000), S, NO_CHOICES, first.shape)
    expect(later.kept).toBe(true)
    expect(later.steps.map((s) => s.activity.id)).toEqual(first.steps.map((s) => s.activity.id))
    expect(later.steps.find((s) => s.finishes.includes('A'))!.units).toBe(100)
  })

  it('drops what is done from the kept order', () => {
    const first = planFactions(at(1000, 1000), S)
    const later = planFactions(at(2000, 1000), S, NO_CHOICES, first.shape)
    expect(later.kept).toBe(true)
    expect(later.steps.map((s) => s.activity.id)).toEqual(['b'])
  })

  it('searches afresh when the kept order leaves an achievement undone', () => {
    const onlyA = planFactions({ ...at(1000, 2000) }, S)
    const later = planFactions(at(1000, 1000), S, NO_CHOICES, onlyA.shape)
    expect(later.kept).toBe(false)
    expect(later.steps.flatMap((s) => s.finishes).sort()).toEqual(['A', 'B'])
  })
})

describe('the two goals', () => {
  const POSITIVE: PlanSettings = { ...S, goal: 'positive', positiveHours: 3 }

  it('counts where a faction ends, so points a later step gives back cost nothing', () => {
    // x lowers the maxed M all the way, y raises it all the way back: x first leaves M where it was.
    const input: PlanInput = {
      targets: [
        { faction: 'A', achievement: 'A', standing: 0 },
        { faction: 'B', achievement: 'B', standing: 0 }
      ],
      maxed: ['M'],
      activities: [act('x', { A: 10, M: -10 }, 600, { zone: 'z' }), act('y', { B: 10, M: 10 }, 600, { zone: 'z' })]
    }
    const plan = planFactions(input, { ...S, keepMaxed: KEEP_MAXED.strong })
    expect(plan.steps.map((s) => s.activity.id)).toEqual(['x', 'y'])
    expect(plan.maxedLost).toBe(0)
  })

  it('fastest takes the quicker way even when it leaves a faction below zero', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 0 }],
      maxed: [],
      standings: { A: 0, N: 100 },
      activities: [act('rough', { A: 10, N: -10 }, 600), act('kind', { A: 10 }, 300)]
    }
    const fastest = planFactions(input, S)
    expect(fastest.steps.map((s) => s.activity.id)).toEqual(['rough'])
    expect(fastest.steps[0].sinks).toEqual(['N'])
    expect(fastest.belowZero).toEqual({ now: 0, after: 1 })
    // Most factions positive: 20 minutes more is worth keeping N at 0 or above.
    const positive = planFactions(input, POSITIVE)
    expect(positive.steps.map((s) => s.activity.id)).toEqual(['kind'])
    expect(positive.belowZero).toEqual({ now: 0, after: 0 })
  })

  it('adds a step at the end that brings a faction back to 0 or above, when that is worth the time', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 0 }],
      maxed: [],
      standings: { A: 0, N: 100 },
      activities: [act('only', { A: 10, N: -10 }, 600, { zone: 'za' }), act('mend', { N: 10 }, 600, { zone: 'zb' })]
    }
    expect(planFactions(input, S).steps.map((s) => s.activity.id)).toEqual(['only'])
    const plan = planFactions(input, POSITIVE)
    expect(plan.steps.map((s) => [s.activity.id, s.units, s.restores])).toEqual([
      ['only', 200, false],
      ['mend', 190, true]
    ])
    expect(plan.steps[1].lifts).toEqual(['N'])
    expect(plan.belowZero.after).toBe(0)
  })

  it('brings a faction that is below zero now up to 0 when it is cheap, and leaves one that would take too long', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 1990 }],
      maxed: [],
      standings: { A: 1990, P: -10, Q: -2000 },
      activities: [act('a', { A: 10 }, 600, { zone: 'z' }), act('p', { P: 5 }, 600, { zone: 'z' }), act('q', { Q: 5 }, 60, { zone: 'z' })]
    }
    const plan = planFactions(input, POSITIVE)
    expect(plan.steps.map((s) => s.activity.id).sort()).toEqual(['a', 'p'])
    expect(plan.steps.find((s) => s.activity.id === 'p')!.lifts).toEqual(['P'])
    expect(plan.belowZero).toEqual({ now: 2, after: 1 })
    // Nothing is worth any time: no restores.
    expect(planFactions(input, { ...POSITIVE, positiveHours: 0 }).steps.map((s) => s.activity.id)).toEqual(['a'])
  })
})

describe('the city camps switch', () => {
  it('leaves city camps out when asked, unless one is locked in', () => {
    const input: PlanInput = {
      targets: [{ faction: 'A', achievement: 'A', standing: 1900 }],
      maxed: [],
      activities: [act('guards', { A: 10 }, 600, { city: true }), act('rats', { A: 10 }, 60)]
    }
    expect(planFactions(input, S).steps.map((s) => s.activity.id)).toEqual(['guards'])
    expect(planFactions(input, { ...S, avoidCity: true }).steps.map((s) => s.activity.id)).toEqual(['rats'])
    expect(planFactions(input, { ...S, avoidCity: true }, { ...NO_CHOICES, locks: { A: 'guards' } }).steps.map((s) => s.activity.id)).toEqual(['guards'])
  })
})

describe('what moved a faction, and what a mob or NPC does', () => {
  const lines: [number, string][] = [[0, 'You have entered Blackburrow.']]
  for (let i = 0; i < 4; i++) {
    lines.push([10 + i * 30, adjusted('Steel Warriors', 5)])
    lines.push([10 + i * 30, adjusted('Sabertooths of Blackburrow', -5)])
    lines.push([10 + i * 30, `You have slain ${i < 3 ? 'a gnoll' : 'a gnoll pup'}!`])
  }
  lines.push([200, 'You have entered Nowhere.'])
  const sources = settled(read(lines))

  it('lists what moved a faction in the logs, most points first', () => {
    const shared = shareSources(sources, [{ character: 'Kelwyn_neriak', sources: handIns('Pedalo', 'Everfrost Peaks', 20, [['Steel Warriors', 1]]) }])
    expect(moversOf('Steel Warriors', shared.sources, shared.from).map((m) => [m.name, m.n, m.total, m.amount, m.own, m.others])).toEqual([
      ['Pedalo', 20, 20, 1, false, ['Kelwyn_neriak']],
      ['A gnoll', 3, 15, 5, true, []],
      ['A gnoll pup', 1, 5, 5, true, []]
    ])
    expect(moversOf('Nobody', sources)).toEqual([])
  })

  it("finds a mob by part of its name, the logs' amounts first, then the wiki's direction", () => {
    const pages = [
      parseFactionPageFull(
        'Sabertooths of Blackburrow',
        `{{Factionpage|\n| mobs_raise =\n* [[a gnoll]] <span class='fmz'>(Blackburrow)</span>\n* [[a gnoll scout]] <span class='fmz'>(Qeynos Hills)</span>\n}}`
      )!
    ]
    const found = lookUp('gnoll', sources, {}, pages, (f) => f, { killUp: 5, killDown: -2, handUp: 5, handDown: -1 })
    expect(found.map((r) => [r.name, r.from, r.zone])).toEqual([
      ['A gnoll', 'log', 'Blackburrow'],
      ['A gnoll pup', 'log', 'Blackburrow'],
      ['a gnoll scout', 'wiki', 'Qeynos Hills']
    ])
    expect(found[0].hits).toEqual([
      { faction: 'Sabertooths of Blackburrow', amount: -5 },
      { faction: 'Steel Warriors', amount: 5 }
    ])
    expect(found[2].hits).toEqual([{ faction: 'Sabertooths of Blackburrow', amount: 5, guessed: true }])
    expect(lookUp('gn', sources, {}, pages, (f) => f, { killUp: 5, killDown: -2, handUp: 5, handDown: -1 })).toEqual([])
  })

  it('reckons the quickest ways to take any faction to 2000, as the plan would', () => {
    const acts = [act('slow', { A: 5 }, 60), act('quick', { A: 5 }, 600), act('other', { B: 5 }, 600)]
    const ways = waysToRaise(acts, 'A', 1500, S)
    expect(ways.map((w) => [w.activity.id, w.units])).toEqual([
      ['quick', 100],
      ['slow', 100]
    ])
    expect(ways[0].seconds).toBeCloseTo(600 + 100 * 6)
  })
})
