import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseZone, emptySources, joinSources, shareSources, sourceReader, usualAmount, type FactionSourceTallies } from '../src/features/factions/attribution'
import { parseFactionPageFull, type FactionRow } from '../src/features/factions/core'
import { parseQuestPage, readHandIn } from '../src/features/factions/questPages'
import {
  buildCatalog,
  classSwapName,
  classSwapOf,
  DEFAULT_SETTINGS,
  factionNamer,
  howHad,
  itemsToLookUp,
  KEEP_MAXED,
  NO_CHOICES,
  planFactions,
  planFor,
  plannable,
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
import {
  allaFactionLaidOut,
  allaNeeds,
  allaQuestAmounts,
  bandMax,
  bandMin,
  parseAllaFaction,
  parseAllaIndex,
  questKey,
  type AllaFaction
} from '../src/features/factions/allakhazam'

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

  it('counts what went into one trade window together: two daggers put in one at a time and the gold', () => {
    const lines: [number, string][] = [[0, 'You have entered The Greater Faydark.']]
    let t0 = 10
    // A trade Tylfon gives nothing for (one dagger, no gold), then three that each give +5.
    lines.push([t0, 'You offered 1 Rusty Dagger to Tylfon.'], [t0 + 2, "Tylfon says, 'Nice, where's the rest?'"], [t0 + 2, 'You complete the trade with Tylfon.'])
    // Each next trade starts a second after Tylfon answers the one before, as quick clicking does.
    for (let i = 0; i < 3; i++) {
      t0 += i ? 4 : 8
      lines.push(
        [t0, 'You offered 1 Rusty Dagger to Tylfon.'],
        [t0 + 1, 'You offered 1 Rusty Dagger to Tylfon.'],
        [t0 + 2, 'You offered 2 Gold to Tylfon.'],
        [t0 + 3, "Tylfon says, 'Well, well, I didn't think you could do it.'"],
        [t0 + 3, adjusted("Tunare's Scouts", 5)],
        [t0 + 3, 'You complete the trade with Tylfon.']
      )
    }
    lines.push([t0 + 60, 'You have entered Kelethin.'])
    const t = settled(read(lines)).acts['turnin|the greater faydark|tylfon']
    expect(t).toMatchObject({ n: 3, items: { 'Rusty Dagger': { count: 6, done: 3 }, Gold: { count: 6, done: 3 } } })
    // So each of Tylfon's hand-ins takes two daggers and two gold, the coin last.
    const tylfon = buildCatalog(
      catalogInput({
        factions: ["Tunare's Scouts"],
        targets: ["Tunare's Scouts"],
        sources: settled(read(lines)),
        bought: { 'rusty dagger': { merchant: 'Harg Tonicka', each: 20 } }
      })
    ).activities.find((a) => a.npc === 'Tylfon')!
    expect(tylfon.items?.map((it) => [it.name, it.count, it.how])).toEqual([
      ['Rusty Dagger', 2, 'bought'],
      ['Gold', 2, 'coin']
    ])
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

  it('does not take a groupmate talking in the same second for an NPC; a lone-named NPC once it was offered something', () => {
    const s = settled(
      read([
        [0, 'You have entered Blackburrow.'],
        [4, "Aldric says, 'inc'"],
        [4, adjusted('Silent Fist Clan', 5)],
        [10, 'You offered 1 Rusty Dagger to Tylfon.'],
        // Long enough after the offer that only Tylfon's words say who it was.
        [25, "Tylfon says, 'Well, well, I didn't think you could do it.'"],
        [25, adjusted("Tunare's Scouts", 5)]
      ])
    )
    expect(Object.keys(s.acts)).toEqual(['turnin|blackburrow|tylfon'])
    expect(s.unexplained).toBe(1)
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

// Trimmed from eqlwiki's Supplies for the New Sebilisian Expedition: its first block is never closed.
// Trimmed from eqlwiki's Rat Ear Pie Quest: Rephas gives Grilled Rat Ears for Rat Ears, and takes them back for as much again.
const RAT_EAR_PIE = `{| class="questTopTable"
! ''' Quest Giver: '''
| [[Rephas]]
|}
He doesn't have much to say about rat ears, but if you give him the regular [[Rat Ears]] (common drop from rats) he'll give you an item called [[Grilled Rat Ears]] (edible and stackable).
<div class='facblock'>
* Your faction standing with [[Arcane Scientists]] has been adjusted by 5.
* Your faction standing with [[Freeport Militia ]] has been adjusted by -1.
</div>
'''If you give the [[Grilled Rat Ears]] back to him, you receive a [[Fish Scales]], faction, and experience.'''
<div class='facblock'>
* Your faction standing with [[Arcane Scientists]] has been adjusted by 5.
* Your faction standing with [[Freeport Militia ]] has been adjusted by -1.
</div>`

const SUPPLIES = `{| class="questTopTable"
! ''' Start Zone: '''
| [[The Northern Desert of Ro]]
|-
! ''' Quest Giver: '''
| [[Crusader Iktra]]
|}
Upon handing Crusader Iktra (4) [[Metal Bits]] (made via [[Blacksmithing]] 2 [[Small Pieces of Ore]] & 1 [[Water Flask]] - both available from [[Klok Rento]] in the [[New Sebilis Expedition]].

[[Crusader Iktra]] says 'Thank you, [Race]. This will go a ways towards rebuilding our ships.'

Your faction standing with New Sebilisian Expedition has been adjusted by 5.

---

'''[[Small Piece of High Quality Ore]]''' can drop from goblins in zones like [[Permafrost]] and [[High Keep]].

Upon handing Crusader Iktra (1) [[Small Piece of High Quality Ore]]:

<div class="facblock">
* Your faction standing with [[New Sebilisian Expedition]] has been adjusted by 10.

Upon handing Crusader Iktra (1) [[Small Brick of High Quality Ore]]:

: Crusader Iktra says 'Thank you, [Player].'

<div class="facblock">
* Your faction standing with [[New Sebilisian Expedition]] has been adjusted by 15.

</div>
{{exp}}`

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

  it('reads "Give [[Item]] to [[NPC]]" with no article or count, and leaves out where the NPC is', () => {
    expect(readHandIn('Give [[Kobold Hide]] to [[Tabure Ahendle]].')).toEqual({ handIn: [{ item: 'Kobold Hide', count: 1 }], npc: 'Tabure Ahendle' })
    expect(readHandIn('Give [[Kobold Hide]] to [[Tabure Ahendle]].', ['Tabure Ahendle'])).toEqual({ handIn: [{ item: 'Kobold Hide', count: 1 }], npc: 'Tabure Ahendle' })
    expect(readHandIn('Bring 4 [[Bone Chips]] to [[Gunlok Jure]] in [[Kaladim]].')).toMatchObject({ handIn: [{ item: 'Bone Chips', count: 4 }], npc: 'Gunlok Jure' })
    // The NPC first: still the NPC.
    expect(readHandIn('Give [[Tabure Ahendle]] a [[Kobold Hide]].')).toEqual({ handIn: [{ item: 'Kobold Hide', count: 1 }], npc: 'Tabure Ahendle' })
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

  it('ends a block left open at the next hand-in, and reads faction lines written with no block', () => {
    const q = parseQuestPage('Supplies for the New Sebilisian Expedition', SUPPLIES)!
    expect(q.steps.map((s) => [s.handIn.map((h) => `${h.count} ${h.item}`).join(' + '), s.hits['New Sebilisian Expedition']])).toEqual([
      ['4 Metal Bits', 5],
      ['1 Small Piece of High Quality Ore', 10],
      ['1 Small Brick of High Quality Ore', 15]
    ])
  })

  it('leaves out what the NPC gives back and how the item is made, and keeps what is given back', () => {
    expect(readHandIn("if you give him the regular [[Rat Ears]] (common drop from rats) he'll give you an item called [[Grilled Rat Ears]] (edible). More text.")).toEqual({
      handIn: [{ item: 'Rat Ears', count: 1 }],
      npc: '',
      gives: ['Grilled Rat Ears']
    })
    expect(readHandIn("'''If you give him 3 [[Giant Rat Ear]]s, you receive a recipe for [[Rat Ear Pie]] ([[Giant Rat Ear]] + [[Baking Spirits]]).'''").handIn).toEqual([
      { item: 'Giant Rat Ear', count: 3 }
    ])
    expect(readHandIn('Upon handing Crusader Iktra (4) [[Metal Bits]] (made via [[Blacksmithing]] 2 [[Small Pieces of Ore]] & 1 [[Water Flask]]').handIn).toEqual([
      { item: 'Metal Bits', count: 4 }
    ])
  })

  it("reads P99's way of writing an amount, and a faction line without 'standing'", () => {
    const q = parseQuestPage(
      'Pie',
      `'''Give [[Rat Ears]] to [[Rephas]].'''
<div class='facblock'>
* Your faction standing with [[Arcane Scientists]] has gotten better.<span class='oppfac'>(+5)</span>
* Your faction standing with [[Freeport Militia ]] '''has gotten worse'''.<span class='profac'>(-1)</span>
</div>
Killing him results in these faction adjustments:
<div class='facblock'>
* Your faction with [[Dismal Rage]] got worse. (-5)
</div>`
    )!
    expect(q.steps.map((s) => s.hits)).toEqual([{ 'Arcane Scientists': 5, 'Freeport Militia': -1 }, { 'Dismal Rage': -5 }])
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

// A faction page and the faction list, made up in the shape of Allakhazam's.
const ALLA_PAGE = `<html><head><title>Test Rangers :: Factions :: EverQuest :: ZAM</title></head><body><h1>Test Rangers</h1>
<table class="db-page"><tbody>
<tr><td colspan="2"><h2>The following quests require Test Rangers faction</h2></td></tr>
<tr><td colspan="2"><table class="datatable"><thead><tr><th>Quest Name</th><th>Minimum Faction Required</th><th>Maximum Faction Allowed</th></tr></thead><tbody>
<tr><td class="dr"><a href="q1">Ranger Summons</a></td><td class="dr"></td><td class="dr"></td></tr>
<tr><td class="lr"><a href="q2">Acorn Delivery</a></td><td class="lr">Amiable</td><td class="lr"></td></tr>
<tr><td class="dr"><a href="q3">Bandit Bounty</a></td><td class="dr"></td><td class="dr">Dubious</td></tr>
</tbody></table></td></tr>
<tr><td><h2>Zones in which you can <em>raise</em> the faction</h2></td><td><h2>Zones in which you can <em>lower</em> the faction</h2></td></tr>
<tr><td valign="top"><ul><li><a href="z1">Test Woods</a></li></ul></td><td valign="top"><ul></ul></td></tr>
<tr><td><h2>NPCs you can kill to <em>raise</em> the faction</h2></td><td><h2>Quests you can do to <em>raise</em> the faction</h2></td></tr>
<tr><td valign="top"><ul><li><a href="n1">a thorn wolf</a> (<a href="z1">Test Woods</a>) +2</li></ul></td>
<td valign="top"><ul><li><a href="q2">Acorn Delivery</a> +15</li><li><a href="q2">Acorn Delivery</a> +20</li><li><a href="q3">Bandit Bounty</a> +5</li></ul></td></tr>
<tr><td><h2>NPCs you kill to <em>lower</em> the faction</h2></td><td><h2>Quests you do to <em>lower</em> the faction</h2></td></tr>
<tr><td valign="top"><ul><li><a href="n2">Ranger Holt</a> (<a href="z1">Test Woods</a>) -50</li><li><a href="n3">Ranger Vell</a> (<a href="z1">Test Woods</a>)</li></ul></td><td valign="top"><ul> </ul></td></tr>
</tbody></table></body></html>`
const ALLA_LIST = `<ul><li><a href="https://everquest.allakhazam.com/db/faction.html?faction=7">Test Rangers</a></li>
<li><a href="https://everquest.allakhazam.com/db/faction.html?faction=9">King Ak&#39;Anon</a></li><li><a href="https://everquest.allakhazam.com/db/zone.html?z=1">Test Woods</a></li></ul>`

describe("Allakhazam's faction pages", () => {
  it('reads a faction page: the quests that want a con, and what kills and quests do to it', () => {
    expect(parseAllaFaction(7, ALLA_PAGE)).toEqual({
      id: 7,
      name: 'Test Rangers',
      needs: [
        { quest: 'Ranger Summons', min: '', max: '' },
        { quest: 'Acorn Delivery', min: 'Amiable', max: '' },
        { quest: 'Bandit Bounty', min: '', max: 'Dubious' }
      ],
      mobs: [
        { name: 'a thorn wolf', zone: 'Test Woods', amount: 2 },
        { name: 'Ranger Holt', zone: 'Test Woods', amount: -50 },
        { name: 'Ranger Vell', zone: 'Test Woods', amount: null }
      ],
      quests: [
        { name: 'Acorn Delivery', amount: 15 },
        { name: 'Acorn Delivery', amount: 20 },
        { name: 'Bandit Bounty', amount: 5 }
      ]
    })
    expect(parseAllaFaction(7, '<html><body>Not found</body></html>')).toBeNull()
  })

  it("reads the site's own markup (a page saved from it, trimmed)", () => {
    const html = readFileSync(join(__dirname, 'fixtures', 'alla-faction-66.html'), 'utf8')
    expect(allaFactionLaidOut(html)).toBe(true)
    const page = parseAllaFaction(66, html)!
    expect(page.name).toBe("Tunare's Scouts")
    expect(page.needs).toEqual([
      { quest: 'Kelethin Guild Summons: Rogue', min: '', max: '' },
      { quest: 'Kelethin Scouts - #1 - Cape', min: 'Amiable', max: '' },
      { quest: 'Kelethin Scouts - #2 - Blade', min: 'Kindly', max: '' },
      { quest: 'Tunarean Scout Tunic', min: 'Dubious', max: '' }
    ])
    expect(page.mobs).toContainEqual({ name: 'a mature arborean', zone: 'Greater Faydark', amount: 1 })
    expect(page.mobs).toContainEqual({ name: 'Expin', zone: 'Greater Faydark', amount: -800 })
    expect(page.mobs).toContainEqual({ name: 'Geeda', zone: 'Greater Faydark', amount: null })
    expect(page.quests).toContainEqual({ name: 'Pixie Dust', amount: 15 })
    expect(page.quests.filter((q) => q.name === 'Kelethin Scouts - #1 - Cape').map((q) => q.amount)).toEqual([10, 20])
  })

  it('tells a page in a shape it does not know from a faction with nothing listed', () => {
    // Titled, but none of the headings the site prints on every faction page: not to be kept.
    const odd = '<html><head><title>Test Rangers :: Factions :: EverQuest :: ZAM</title></head><body><div class="new-layout">…</div></body></html>'
    expect(allaFactionLaidOut(odd)).toBe(false)
    // Every heading there and every list empty: a faction the site knows nothing more of.
    const empty = ALLA_PAGE.replace(/<li>[\s\S]*?<\/li>/g, '').replace(/<tr><td class="[dl]r">[\s\S]*?<\/tr>/g, '')
    expect(allaFactionLaidOut(empty)).toBe(true)
    expect(parseAllaFaction(7, empty)).toMatchObject({ needs: [], mobs: [], quests: [] })
  })

  it('reads the faction list into the site numbers, by faction name however it is spelled', () => {
    expect(parseAllaIndex(ALLA_LIST)).toEqual({ testrangers: 7, kingakanon: 9 })
  })

  it('takes a quest amount only when the page gives the quest one, and a need no better than a band', () => {
    const page = parseAllaFaction(7, ALLA_PAGE)!
    const id = (f: string) => f
    expect(Object.fromEntries(allaQuestAmounts([page], id))).toEqual({ banditbounty: { 'Test Rangers': 5 } })
    expect(allaNeeds([page], id).get('banditbounty')).toEqual([{ faction: 'Test Rangers', band: 'Dubious', max: -101 }])
    expect(allaNeeds([page], id).has('rangersummons')).toBe(false)
  })

  it('knows the cons by their words, and a quest by its name however it is written', () => {
    expect([bandMin('Amiable'), bandMin('Kindly'), bandMin('Dubious'), bandMin(''), bandMin('Friendly?')]).toEqual([100, 500, -500, undefined, undefined])
    // No better than Dubious: just under Apprehensive.
    expect([bandMax('Dubious'), bandMax('Ally'), bandMax('')]).toEqual([-101, undefined, undefined])
    expect(questKey('Rat Ear Pie Quest')).toBe(questKey('rat ear pie'))
    expect(questKey('Tunare Scouts Dagger')).toBe('tunarescoutsdagger')
  })

  // Two factions' pages, made up in Allakhazam's shape.
  const scouts: AllaFaction = {
    id: 66,
    name: "Tunare's Scouts",
    needs: [
      { quest: 'Pixie Dust', min: 'Amiable', max: '' },
      { quest: 'Tunarean Scout Tunic', min: 'Dubious', max: '' }
    ],
    mobs: [
      { name: 'a mature arborean', zone: 'Greater Faydark', amount: 1 },
      { name: 'an arborean sapling', zone: 'Greater Faydark', amount: 1 },
      { name: 'Expin', zone: 'Greater Faydark', amount: -800 }
    ],
    quests: [
      { name: 'Pixie Dust', amount: 15 },
      { name: 'Kelethin Scouts - #1 - Cape', amount: 10 },
      { name: 'Kelethin Scouts - #1 - Cape', amount: 20 }
    ]
  }
  const arboreans: AllaFaction = {
    id: 400,
    name: 'Arboreans of the Faydark',
    needs: [],
    mobs: [{ name: 'a mature arborean', zone: 'Greater Faydark', amount: -5 }],
    quests: []
  }
  const pixie = {
    page: 'Pixie Dust',
    givers: ['Tylfon'],
    zones: ['Kelethin'],
    level: 1,
    steps: [{ hits: { "Tunare's Scouts": 1 }, guessed: ["Tunare's Scouts"], handIn: [{ item: 'Pixie Dust', count: 1 }], npc: 'Tylfon', line: '' }]
  }
  const input = (over: Partial<CatalogInput> = {}) =>
    catalogInput({
      factions: ["Tunare's Scouts", 'Arboreans of the Faydark'],
      targets: ["Tunare's Scouts"],
      pages: [
        {
          page: "Tunare's Scouts",
          raise: { mobs: [{ name: 'an arborean sapling', zone: 'Greater Faydark', note: '' }], quests: ['Pixie Dust'], zones: [] },
          lower: { mobs: [], quests: [], zones: [] }
        }
      ],
      quests: { 'Pixie Dust': pixie },
      items: { 'pixie dust': item({ vendors: [{ zone: 'Kelethin', npc: 'Merchant', note: '' }] }) },
      alla: [scouts, arboreans],
      ...over
    })

  it("puts each mob's kill together from every page naming it, with the pages' amounts", () => {
    const camps = buildCatalog(input()).activities.filter((a) => a.kind === 'kill')
    // The sapling is eqlwiki's too, with no amount: Allakhazam's camp has it, with one.
    expect(camps).toHaveLength(1)
    expect(camps[0]).toMatchObject({ zone: 'Greater Faydark', site: 'Allakhazam', mobs: ['a mature arborean', 'an arborean sapling'], common: 2 })
    // The mature arborean lowers the Arboreans by 5 and the sapling not at all: -2.5 a kill.
    expect(camps[0].hits).toEqual({ "Tunare's Scouts": 1, 'Arboreans of the Faydark': -2.5 })
    expect(camps[0].guessed).toBeUndefined()
  })

  it('holds a quest back until the con Allakhazam says its NPC wants, and takes its amount where the walkthrough gives none', () => {
    const low = buildCatalog(input({ cons: { "Tunare's Scouts": -200 } })).activities.find((a) => a.kind === 'quest')!
    expect(low).toMatchObject({ hits: { "Tunare's Scouts": 15 }, needs: 'Amiable', blocked: "needs Amiable with Tunare's Scouts; you con Dubious (-200), 300 short" })
    expect(low.guessed).toBeUndefined()
    expect(buildCatalog(input({ cons: { "Tunare's Scouts": 150 } })).activities.find((a) => a.kind === 'quest')!.blocked).toBeUndefined()
    // Without a con to go by (no race on the record), nothing is held back.
    expect(buildCatalog(input()).activities.find((a) => a.kind === 'quest')!.blocked).toBeUndefined()
  })

  it('says which gate factions it has no con for, rather than taking them as met in silence', () => {
    // A con for another faction but none for the Scouts: not in the export or the achievements list.
    const unknown = buildCatalog(input({ cons: { 'Arboreans of the Faydark': 0 } })).activities.find((a) => a.kind === 'quest')!
    expect(unknown.blocked).toBeUndefined()
    expect(unknown.conUnknown).toEqual(["Tunare's Scouts"])
    expect(buildCatalog(input({ cons: { "Tunare's Scouts": -200 } })).activities.find((a) => a.kind === 'quest')!.conUnknown).toBeUndefined()
  })
})

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
    // The quest rounds known from play (Message Intercept raises Steel Warriors) are not kills.
    const activities = buildCatalog(catalogInput({ sources: settled(read(lines)) })).activities.filter((a) => a.kind === 'kill')
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
    // The walkthrough's steps; the quest rounds known from play (Message Intercept raises Steel Warriors too) aside.
    const steps = buildCatalog(input).activities.filter((a) => a.kind === 'quest' && a.page === 'Q')
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

  it('takes what play has shown over the wikis: a quest that does not repeat, an item only one mob drops', () => {
    const input = catalogInput({
      factions: ['Arcane Scientists', 'New Sebilisian Expedition'],
      targets: ['Arcane Scientists', 'New Sebilisian Expedition'],
      pages: [
        { page: 'Arcane Scientists', raise: { mobs: [], quests: ['Illegible Cantrip Quest'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } },
        { page: 'New Sebilisian Expedition', raise: { mobs: [], quests: ['Supplies for the New Sebilisian Expedition'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }
      ],
      quests: {
        'Illegible Cantrip Quest': {
          page: 'Illegible Cantrip Quest',
          givers: ['Tara Neklene'],
          zones: ['West Freeport'],
          level: 5,
          steps: [{ hits: { 'Arcane Scientists': 10 }, guessed: [], handIn: [{ item: 'Illegible Cantrip', count: 1, from: 'orc apprentice' }], npc: 'Tara', line: '' }]
        },
        'Supplies for the New Sebilisian Expedition': parseQuestPage('Supplies for the New Sebilisian Expedition', SUPPLIES)!
      }
    })
    const steps = buildCatalog(input).activities
    expect(steps.find((a) => a.title === 'Illegible Cantrip Quest')?.once).toBe('cannot be done over and over')
    const ore = steps.find((a) => a.items?.[0]?.name === 'Small Piece of High Quality Ore')
    expect(ore?.items?.[0]).toMatchObject({ how: 'drop', where: 'the Goblin Janitor (Runnyeye)', named: 1 })
    expect(ore?.once).toBeUndefined()
    // Bought is bought, whatever the walkthrough says drops it.
    const bought = buildCatalog({ ...input, bought: { 'small piece of high quality ore': { merchant: 'Klok Lagnoz', each: 169 } } }).activities
    expect(bought.find((a) => a.items?.[0]?.name === 'Small Piece of High Quality Ore')?.items?.[0]).toMatchObject({ how: 'bought', where: 'Klok Lagnoz' })
  })

  it("holds back a quest until the character cons high enough for its NPC, with Allakhazam's amount and camp", () => {
    const dagger = {
      page: 'Tunare Scouts Dagger',
      givers: ['Tylfon'],
      zones: ['Kelethin'],
      level: 1,
      steps: [{ hits: { "Tunare's Scouts": 1 }, guessed: ["Tunare's Scouts"], handIn: [{ item: 'Rusty Dagger', count: 2 }], npc: 'Tylfon', line: '' }]
    }
    const input = (con: number) =>
      catalogInput({
        factions: ["Tunare's Scouts", 'Emerald Warriors'],
        targets: ["Tunare's Scouts"],
        pages: [{ page: "Tunare's Scouts", raise: { mobs: [], quests: ['Tunare Scouts Dagger'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { 'Tunare Scouts Dagger': dagger },
        items: { 'rusty dagger': item({ vendors: [{ zone: 'Greater Faydark', npc: 'Merchant', note: '' }] }) },
        cons: { "Tunare's Scouts": con }
      })
    // An Iksar at 0: Threatening, and a faked Indifferent is not enough for Amiable.
    const [camp, quest] = buildCatalog(input(-750)).activities
    // Allakhazam's +1 is +5 in play, and each hand-in takes two Gold with the two daggers.
    expect(quest).toMatchObject({ title: 'Tunare Scouts Dagger', hits: { "Tunare's Scouts": 5 }, needs: 'Amiable' })
    expect(quest.items?.map((it) => [it.name, it.count, it.how])).toEqual([
      ['Rusty Dagger', 2, 'vendor'],
      ['Gold', 2, 'coin']
    ])
    expect(quest.guessed).toBeUndefined()
    expect(quest.blocked).toBe("needs Amiable with Tunare's Scouts; you con Threatening (-750), 850 short")
    // Closed now, but the plan may raise Tunare's Scouts to where Tylfon takes it: what he wants goes with it.
    expect(quest.gate).toEqual([{ faction: "Tunare's Scouts", band: 'Amiable', min: 100 }])
    expect(plannable(quest, NO_CHOICES)).toBe(true)
    expect(plannable({ ...quest, gate: undefined }, NO_CHOICES)).toBe(false)
    expect(plannable({ ...quest, gate: undefined }, { ...NO_CHOICES, locks: { "Tunare's Scouts": quest.id } })).toBe(true)
    // The arboreans of Greater Faydark, which eqlwiki does not list, raise it meanwhile.
    expect(camp).toMatchObject({ kind: 'kill', zone: 'Greater Faydark', site: 'Allakhazam', hits: { "Tunare's Scouts": 1, 'Emerald Warriors': 1 } })
    expect(plannable(camp, NO_CHOICES)).toBe(true)
    // At Amiable the NPC takes it.
    expect(buildCatalog(input(100)).activities[1].blocked).toBeUndefined()
  })

  it('plans the quest rounds known from play, with their amounts and pace', () => {
    const input = (con: number) =>
      catalogInput({
        factions: [
          'Dismal Rage',
          'Opal Darkbriar',
          'Knights of Truth',
          'Priests of Marr',
          'Steel Warriors',
          'The Freeport Militia',
          'Coalition of Tradefolk Underground',
          'The Spurned',
          'The Dead'
        ],
        targets: ['Dismal Rage', 'The Spurned'],
        cons: { 'Dismal Rage': con }
      })
    const acts = buildCatalog(input(869)).activities
    // Message Intercept the evil way: milk to Mojax, *Duggin's note, the note to Raltur; the log's pace.
    const note = acts.find((a) => a.id === 'cycle:message intercept')!
    // A round of the quest, handed in at last to Raltur; the milk goes to Mojax.
    expect(note).toMatchObject({
      kind: 'quest',
      title: 'Message Intercept',
      npc: 'Raltur Caliskon',
      source: 'log',
      seen: 112,
      measured: 180,
      needs: 'Amiable',
      guessed: ['Opal Darkbriar']
    })
    expect(note.hits).toEqual({
      'Dismal Rage': 19,
      'Opal Darkbriar': 5,
      'Knights of Truth': 7,
      'Priests of Marr': 10,
      'Steel Warriors': 5,
      'The Freeport Militia': -3,
      'Coalition of Tradefolk Underground': -1
    })
    expect(note.items?.[0]).toMatchObject({ name: 'Bottle of Milk', count: 1, to: 'Mojax Hikspin' })
    expect(note.blocked).toBeUndefined()
    // Raltur takes the note only at Amiable.
    expect(buildCatalog(input(50)).activities.find((a) => a.id === 'cycle:message intercept')!.blocked).toMatch(/^needs Amiable with Dismal Rage/)
    // The Spurned: a lore note from Wallin Slyfoot to Draxiz N`Ryt, one a round trip.
    const spurned = acts.find((a) => a.id === 'cycle:innoruuk disciple')!
    expect(spurned).toMatchObject({ hits: { 'The Spurned': 10, 'The Dead': -1 }, source: 'wiki', site: 'Allakhazam' })
    expect(spurned.items?.[0]).toMatchObject({ name: 'Note', how: 'drop', sec: 180 })
    expect(unitTime(spurned, DEFAULT_SETTINGS).seconds).toBeGreaterThanOrEqual(180)
    // Draxiz eats the note below Dubious with The Spurned, faking or not: a Wood Elf (-550) swaps race for it.
    const low = buildCatalog({
      ...input(869),
      cons: { 'Dismal Rage': 869, 'The Spurned': -550 },
      swapCons: { Human: { 'The Spurned': -200 }, 'Dark Elf': { 'The Spurned': 100 }, 'High Elf': { 'The Spurned': -650 } }
    }).activities.find((a) => a.id === 'cycle:innoruuk disciple')!
    expect(low.blocked).toBe('needs Dubious with The Spurned; you con Threatening (-550), 50 short')
    // The race at the best con first: Dark Elf (Amiable) before Human (Dubious).
    expect(low.swap).toEqual(['Dark Elf', 'Human'])
    // Priests of Innoruuk: Saxarivza Zaxun's note to Perrir Zexus, +200 a note, one a /say, all in one trip; a faked con will do for Perrir.
    const note200 = buildCatalog(
      catalogInput({ factions: ['Priests of Innoruuk', 'Primordial Malice'], targets: ['Priests of Innoruuk'], cons: { 'Priests of Innoruuk': -650 } })
    ).activities.find((a) => a.id === 'cycle:innoruuk recommendation')!
    expect(note200).toMatchObject({ kind: 'quest', npc: 'Perrir Zexus', zone: 'East Freeport', source: 'wiki', hits: { 'Priests of Innoruuk': 200, 'Primordial Malice': -800 } })
    expect(note200.items?.[0]).toMatchObject({ name: 'Note', sec: 5 })
    // Indigo Brotherhood: Bone Chips to Vexia D`Ynth, four a task, from the bags.
    const chips = buildCatalog(catalogInput({ factions: ['Indigo Brotherhood'], targets: ['Indigo Brotherhood'], have: { 'bone chips': 574 } })).activities.find(
      (a) => a.id === 'cycle:track, stalk, hunt#bone chips'
    )!
    expect(chips).toMatchObject({ npc: 'Vexia D`Ynth', zone: 'Neriak Commons', hits: { 'Indigo Brotherhood': 5 } })
    expect(chips.items?.[0]).toMatchObject({ name: 'Bone Chips', count: 4, have: 574 })
    expect(chips.blocked).toBeUndefined()
    // The walkthrough's own step (one Giant Bat Fur to "Guardians of the Vale") is left out for it.
    const misread = buildCatalog(
      catalogInput({
        factions: ['Indigo Brotherhood'],
        targets: ['Indigo Brotherhood'],
        pages: [{ page: 'Indigo Brotherhood', raise: { mobs: [], quests: ['Track, Stalk, Hunt'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: {
          'Track, Stalk, Hunt': {
            page: 'Track, Stalk, Hunt',
            givers: ['Vexia D`Ynth'],
            zones: ['Neriak Commons'],
            level: 1,
            steps: [{ hits: { 'Indigo Brotherhood': 5 }, guessed: [], handIn: [{ item: 'Giant Bat Fur', count: 1 }], npc: 'Guardians of the Vale', line: '' }]
          }
        }
      })
    ).activities.filter((a) => a.title === 'Track, Stalk, Hunt')
    expect(misread.map((a) => a.id)).toEqual(['cycle:track, stalk, hunt#bone chips'])
    // Crushbone's elven slaves are three spawns: a camp of them goes at their respawn.
    const slaves = buildCatalog(
      catalogInput({
        factions: ['Indigo Brotherhood'],
        targets: ['Indigo Brotherhood'],
        pages: [
          {
            page: 'Indigo Brotherhood',
            raise: { mobs: [{ name: 'an elven slave (male)', zone: 'Crushbone', note: '' }], quests: [], zones: [] },
            lower: { mobs: [], quests: [], zones: [] }
          }
        ]
      })
    ).activities.find((a) => a.kind === 'kill' && a.zone === 'Crushbone')!
    expect(slaves).toMatchObject({ common: 0, named: 1 })
    expect(slaves.few).toBe(3)
    // Three a respawn, however fast the log saw the first three go.
    expect(unitTime({ ...slaves, measured: 200 }, DEFAULT_SETTINGS).seconds).toBe((DEFAULT_SETTINGS.namedRespawnMin * 60) / 3)
    // Notes in the bags are other notes: the round's own comes from Saxarivza on the way.
    const held = buildCatalog(catalogInput({ factions: ['Priests of Innoruuk'], targets: ['Priests of Innoruuk'], have: { note: 41, 'bottle of milk': 30 } })).activities.find(
      (a) => a.id === 'cycle:innoruuk recommendation'
    )!
    expect(held.items?.[0].have).toBeUndefined()
    expect(note200.blocked).toBeUndefined()
    expect(note200.gate).toBeUndefined()
    // Merchants of Erudin: lanterns to Jyle Windshot for Wooden Shards, one a hand-in to Emil Parsini: his +5s from the log, the rest guessed.
    const erudin = buildCatalog(
      catalogInput({ factions: ['Merchants of Erudin', 'Faydarks Champions'], targets: ['Merchants of Erudin'], cons: { 'Faydarks Champions': 2000 } })
    ).activities.find((a) => a.id === 'cycle:peacekeeper staff quest')!
    expect(erudin).toMatchObject({ npc: 'Emil Parsini', zone: 'Toxxulia Forest', source: 'wiki', needs: 'Indifferent' })
    expect(erudin.hits['Merchants of Erudin']).toBe(5)
    expect(erudin.hits['High Council of Erudin']).toBe(5)
    expect(erudin.guessed).not.toContain('Merchants of Erudin')
    expect(erudin.guessed).toContain('High Guard of Erudin')
    expect(erudin.items?.[0]).toMatchObject({ name: 'Small Lantern', count: 1, to: 'Jyle Windshot' })
    expect(erudin.blocked).toBeUndefined()
    // Jyle gives nothing below Indifferent with Faydarks Champions, faking or not.
    const hostile = buildCatalog(
      catalogInput({ factions: ['Merchants of Erudin', 'Faydarks Champions'], targets: ['Merchants of Erudin'], cons: { 'Faydarks Champions': -200 } })
    ).activities.find((a) => a.id === 'cycle:peacekeeper staff quest')!
    expect(hostile.blocked).toMatch(/^needs Indifferent with Faydarks Champions/)
    // From Dismal Rage 1044, 51 rounds of 19.
    const plan = planFactions({ targets: [{ faction: 'Dismal Rage', achievement: 'Dismal Rage', standing: 1044 }], maxed: [], activities: acts }, DEFAULT_SETTINGS)
    expect(plan.steps.map((st) => [st.activity.id, st.units])).toEqual([['cycle:message intercept', 51]])
  })

  it("takes Message Intercept's two ways as rounds, and the log's *Duggin kills and Sir Lucan's notes as parts of them", () => {
    const lucan = handIns(
      'Sir Lucan D`Lere',
      'West Freeport',
      5,
      [
        ['The Freeport Militia', 25],
        ['Coalition of Tradefolk Underground', 5],
        ['Knights of Truth', -2]
      ],
      'Note'
    )
    const duggin = settled(
      read([
        [0, 'You have entered West Commonlands.'],
        [5, adjusted('Knights of Truth', 5)],
        [5, adjusted('Priests of Marr', 5)],
        [5, 'You have slain Duggin Scumber!'],
        [9, adjusted('Knights of Truth', 5)],
        [9, adjusted('Priests of Marr', 5)],
        [9, 'You have slain Duggin Scumber!'],
        [99, 'You have entered Nowhere.']
      ])
    )
    const acts = buildCatalog(
      catalogInput({
        factions: ['The Freeport Militia', 'Knights of Truth', 'Priests of Marr', 'Steel Warriors', 'Coalition of Tradefolk Underground', 'Dismal Rage'],
        targets: ['The Freeport Militia', 'Knights of Truth'],
        sources: joinSources([lucan, duggin])
      })
    ).activities
    expect(acts.map((a) => a.id).sort()).toEqual(['cycle:message intercept', 'cycle:message intercept#lucan'])
    expect(acts.find((a) => a.id === 'cycle:message intercept#lucan')).toMatchObject({
      npc: 'Sir Lucan D`Lere',
      source: 'log',
      hits: { 'The Freeport Militia': 22, 'Knights of Truth': 8, 'Priests of Marr': 8, 'Steel Warriors': 5, 'Coalition of Tradefolk Underground': 4, 'Dismal Rage': -1 }
    })
    // The good way asks no con of the player; Raltur wants Dismal Rage at Amiable.
    expect(acts.find((a) => a.id === 'cycle:message intercept#lucan')!.gate).toBeUndefined()
    expect(acts.find((a) => a.id === 'cycle:message intercept')!.gate).toEqual([{ faction: 'Dismal Rage', band: 'Amiable', min: 100 }])
  })

  it('also finds ways to raise a faction a quest wants more of than the character cons, where that quest raises an achievement', () => {
    const page = (name: string, quests: string[], mobs: FactionRow['name'][] = []) => ({
      page: name,
      raise: { mobs: mobs.map((m) => ({ name: m, zone: 'Test Woods', note: '' })), quests, zones: [] },
      lower: { mobs: [], quests: [], zones: [] }
    })
    const acorn = {
      page: 'Acorn Delivery',
      givers: ['Ranger Holt'],
      zones: ['Test Woods'],
      level: 1,
      steps: [{ hits: { 'Test Rangers': 15 }, guessed: [], handIn: [{ item: 'Acorn', count: 1 }], npc: 'Ranger Holt', line: '' }]
    }
    const input = (con: number) =>
      catalogInput({
        factions: ['Test Rangers', 'Wood Folk'],
        targets: ['Test Rangers'],
        pages: [page('Test Rangers', ['Acorn Delivery']), page('Wood Folk', [], ['a wood sprite'])],
        quests: { 'Acorn Delivery': acorn },
        items: { acorn: item({ vendors: [{ zone: 'Test Woods', npc: 'Merchant', note: '' }] }) },
        alla: [parseAllaFaction(7, ALLA_PAGE.replaceAll('Test Rangers', 'Wood Folk'))!],
        cons: { 'Wood Folk': con }
      })
    // Holt wants Amiable with Wood Folk: short of it, the sprites that raise Wood Folk are a way to open his quest.
    const short = buildCatalog(input(-50)).activities
    expect(short.find((a) => a.title === 'Acorn Delivery')).toMatchObject({
      blocked: expect.stringMatching(/^needs Amiable with Wood Folk/),
      gate: [{ faction: 'Wood Folk', band: 'Amiable', min: 100 }]
    })
    expect(short.some((a) => a.mobs?.includes('a wood sprite'))).toBe(true)
    // At Amiable already, nothing needs raising.
    expect(buildCatalog(input(150)).activities.some((a) => a.mobs?.includes('a wood sprite'))).toBe(false)
  })

  it('takes a hand-in the log saw once as repeatable when the walkthrough makes it so, with what its NPC wants', () => {
    const silks = {
      page: 'Spiderling Silks',
      givers: ['Sylia Windlehands'],
      zones: ['Kelethin'],
      level: 1,
      steps: [
        {
          hits: { Songweavers: 5 },
          guessed: [],
          handIn: [{ item: 'Spiderling Silk', count: 4 }],
          npc: 'Sylia Windlehands',
          line: 'Hand Sylia Windlehands 4 Spiderling Silks, unstacked.'
        }
      ]
    }
    const input = (cons: Record<string, number>) =>
      catalogInput({
        factions: ['Song Weavers'],
        targets: ['Song Weavers'],
        sources: handIns('Sylia Windlehands', 'Greater Faydark', 1, [['Song Weavers', 5]], 'Spiderling Silk'),
        pages: [{ page: 'Songweavers', raise: { mobs: [], quests: ['Spiderling Silks'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { 'Spiderling Silks': silks },
        cons
      })
    // Once in the log: a one-time reward, as far as the log alone can tell.
    const alone = buildCatalog({ ...input({}), pages: [], quests: {} }).activities
    expect(alone.map((a) => [a.id, a.once])).toEqual([['turnin:greaterfaydark:sylia windlehands', 'done once in your logs']])
    // The walkthrough says it repeats, and Sylia wants Amiable (from play): the log's hand-in, with both.
    const [sylia, ...rest] = buildCatalog(input({ 'Song Weavers': 105 })).activities
    expect(rest).toEqual([])
    expect(sylia).toMatchObject({
      id: 'turnin:greaterfaydark:sylia windlehands',
      source: 'log',
      hits: { 'Song Weavers': 5 },
      needs: 'Amiable',
      gate: [{ faction: 'Song Weavers', band: 'Amiable', min: 100 }]
    })
    expect(sylia.once).toBeUndefined()
    expect(sylia.blocked).toBeUndefined()
    expect(plannable(sylia, NO_CHOICES)).toBe(true)
    // At Indifferent she takes nothing.
    expect(buildCatalog(input({ 'Song Weavers': 55 })).activities[0].blocked).toMatch(/^needs Amiable with Song Weavers/)
  })

  it("takes Allakhazam's amount for a quest only on a step going the same way", () => {
    const recommendation = {
      page: 'Innoruuk Recommendation',
      givers: ['Savarixsa Zexus'],
      zones: ['Grobb'],
      level: 1,
      steps: [
        {
          hits: { 'Priests of Innoruuk': 10, 'Primordial Malice': 1 },
          guessed: ['Primordial Malice'],
          handIn: [{ item: 'Leatherfoot Raider Skullcap', count: 1 }],
          npc: 'Perrir',
          line: ''
        }
      ]
    }
    const alla: AllaFaction = { id: 9, name: 'Primordial Malice', needs: [], mobs: [], quests: [{ name: 'Innoruuk Recommendation', amount: -840 }] }
    const skullcap = buildCatalog(
      catalogInput({
        factions: ['Priests of Innoruuk', 'Primordial Malice'],
        targets: ['Priests of Innoruuk'],
        pages: [{ page: 'Priests of Innoruuk', raise: { mobs: [], quests: ['Innoruuk Recommendation'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { 'Innoruuk Recommendation': recommendation },
        items: { 'leatherfoot raider skullcap': item({ sources: { drops: [{ zone: 'Nektulos Forest', mobs: ['a Leatherfoot raider'] }], foraged: [], crafted: false } }) },
        alla: [alla]
      })
    ).activities.find((a) => a.title === 'Innoruuk Recommendation' && a.kind === 'quest' && a.id.startsWith('quest:'))!
    // The skullcap "got better": Allakhazam's -840 is the note's, so the usual gain stands in.
    expect(skullcap.hits['Primordial Malice']).toBe(5)
    expect(skullcap.guessed).toEqual(['Primordial Malice'])
  })

  it("takes Jeet's Scrap Metal as Cleaner VII's, one a kill, and Mater's 300 gold with each Ogre Head", () => {
    const quest = (page: string, npc: string, item: string) => ({
      page,
      givers: [npc],
      zones: ['North Kaladim'],
      level: 1,
      steps: [{ hits: { 'Miners Guild 628': 15 }, guessed: [], handIn: [{ item, count: 1 }], npc, line: '' }]
    })
    const acts = buildCatalog(
      catalogInput({
        factions: ['Miners Guild 628'],
        targets: ['Miners Guild 628'],
        pages: [{ page: 'Miners Guild 628', raise: { mobs: [], quests: ["Miner's Cap", 'Miners Pick'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { "Miner's Cap": quest("Miner's Cap", 'Jeet', 'Scrap Metal'), 'Miners Pick': quest('Miners Pick', 'Mater', 'Ogre Head') },
        items: { 'scrap metal': item({ sources: { drops: [{ zone: 'Steamfont Mountains', mobs: ['rogue clockwork'] }], foraged: [], crafted: false } }) }
      })
    ).activities
    expect(acts.find((a) => a.title === "Miner's Cap")!.items).toEqual([
      { name: 'Scrap Metal', count: 1, how: 'drop', where: 'Cleaner VII (North Kaladim), lore: one at a time', named: 1 }
    ])
    expect(acts.find((a) => a.title === 'Miners Pick')!.items?.map((it) => [it.name, it.count, it.how])).toEqual([
      ['Ogre Head', 1, 'unknown'],
      ['Gold', 300, 'coin']
    ])
  })

  it('leaves out a quest whose items do not drop in classic', () => {
    const eye = {
      page: "Xelha's Cyclops Eye",
      givers: ['Xelha Nevagon'],
      zones: ['East Freeport'],
      level: 1,
      steps: [
        { hits: { 'Dismal Rage': 1, 'Knights of Truth': -1, 'Opal Dark Briar': 1 }, guessed: [], handIn: [{ item: 'cyclops eye', count: 1 }], npc: 'Xelha Nevagon', line: '' }
      ]
    }
    const quest = buildCatalog(
      catalogInput({
        factions: ['Dismal Rage', 'Knights of Truth', 'Opal Darkbriar'],
        targets: ['Dismal Rage'],
        pages: [{ page: 'Dismal Rage', raise: { mobs: [], quests: ["Xelha's Cyclops Eye"], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { "Xelha's Cyclops Eye": eye }
      })
    ).activities.find((a) => a.title === "Xelha's Cyclops Eye")!
    expect(quest.once).toBe('cyclops eyes do not drop in classic')
    expect(plannable(quest, NO_CHOICES)).toBe(false)
  })

  it('offers a race swap for a quest another race opens, and plans it when that beats the other ways', () => {
    const dagger = {
      page: 'Tunare Scouts Dagger',
      givers: ['Tylfon'],
      zones: ['Kelethin'],
      level: 1,
      steps: [{ hits: { "Tunare's Scouts": 1 }, guessed: ["Tunare's Scouts"], handIn: [{ item: 'Rusty Dagger', count: 2 }], npc: 'Tylfon', line: '' }]
    }
    // An Iksar at 0 cons Threatening; as a Wood Elf (+100) the NPC would take it, as a Human (-1) not.
    const catalog = buildCatalog(
      catalogInput({
        factions: ["Tunare's Scouts", 'Emerald Warriors'],
        targets: ["Tunare's Scouts"],
        pages: [{ page: "Tunare's Scouts", raise: { mobs: [], quests: ['Tunare Scouts Dagger'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { 'Tunare Scouts Dagger': dagger },
        items: { 'rusty dagger': item({ vendors: [{ zone: 'Greater Faydark', npc: 'Merchant', note: '' }] }) },
        cons: { "Tunare's Scouts": -750 },
        swapCons: { 'Wood Elf': { "Tunare's Scouts": 100 }, Human: { "Tunare's Scouts": -1 } }
      })
    )
    const quest = catalog.activities.find((a) => a.kind === 'quest')!
    expect(quest.swap).toEqual(['Wood Elf'])
    // Without what it wants to go by, as before: open to the races in `swap`, when swaps are planned.
    const bare = { ...quest, gate: undefined }
    expect(plannable(bare, NO_CHOICES)).toBe(false)
    expect(plannable(bare, NO_CHOICES, true)).toBe(true)
    // Without the races' modifiers, the plan goes by what the catalog found.
    const input: PlanInput = { targets: [{ faction: "Tunare's Scouts", achievement: "Tunare's Scouts", standing: 0 }], maxed: [], activities: catalog.activities }
    // A hand-in of two bought daggers is seconds; 2000 arborean kills are a day: the plan swaps race for it, once.
    const swapped = planFactions(input, DEFAULT_SETTINGS)
    expect(swapped.steps.map((st) => st.activity.title)).toEqual(['Tunare Scouts Dagger'])
    expect(swapped.steps[0].swap).toBe(DEFAULT_SETTINGS.swapMin * 60)
    expect(swapped.steps[0].seconds).toBeGreaterThan(DEFAULT_SETTINGS.swapMin * 60)
    // With swaps off, the arboreans it is.
    const own = planFactions(input, { ...DEFAULT_SETTINGS, raceSwaps: false })
    expect(own.steps.map((st) => st.activity.kind)).toEqual(['kill'])
    expect(own.steps[0].swap).toBe(0)
    expect(own.seconds).toBeGreaterThan(swapped.seconds)
    // A quest no race opens stays out.
    const none = buildCatalog(
      catalogInput({
        factions: ["Tunare's Scouts"],
        targets: ["Tunare's Scouts"],
        pages: [{ page: "Tunare's Scouts", raise: { mobs: [], quests: ['Tunare Scouts Dagger'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
        quests: { 'Tunare Scouts Dagger': dagger },
        cons: { "Tunare's Scouts": -750 },
        swapCons: { Human: { "Tunare's Scouts": -1 } }
      })
    ).activities.find((a) => a.kind === 'quest')!
    expect(none.swap).toBeUndefined()
    expect(plannable({ ...none, gate: undefined }, NO_CHOICES, true)).toBe(false)
    expect(planFactions({ ...input, activities: [none] }, DEFAULT_SETTINGS).steps).toEqual([])
  })

  it('makes what the NPC gives back, handed back for as much again, one unit with the hand-in before it', () => {
    const rephas = parseQuestPage('Rat Ear Pie Quest', RAT_EAR_PIE)!
    expect(rephas.steps[0].gives).toEqual(['Grilled Rat Ears'])
    const input = catalogInput({
      factions: ['Arcane Scientists', 'Freeport Militia'],
      targets: ['Arcane Scientists'],
      pages: [{ page: 'Arcane Scientists', raise: { mobs: [], quests: ['Rat Ear Pie Quest'], zones: [] }, lower: { mobs: [], quests: [], zones: [] } }],
      quests: { 'Rat Ear Pie Quest': rephas }
    })
    const [pie, ...rest] = buildCatalog(input).activities
    expect(rest).toEqual([])
    expect(pie).toMatchObject({ npc: 'Rephas', hits: { 'Arcane Scientists': 10, 'Freeport Militia': -2 }, handIns: 2, back: 'Grilled Rat Ears' })
    expect(pie.once).toBeUndefined()
    // Rat Ears as found in play: about four minutes each from rats; two hand-ins a unit.
    expect(pie.items).toEqual([{ name: 'Rat Ears', count: 1, how: 'drop', where: 'rats, such as in Misty Thicket', sec: 240 }])
    expect(unitTime(pie, DEFAULT_SETTINGS).seconds).toBe(240 + 2 * DEFAULT_SETTINGS.handInSec)

    // Done in the log: the hand-ins of both are that one unit too, at the log's amounts.
    const log = joinSources([
      handIns('Rephas', 'Qeynos Hills', 3, [['Arcane Scientists', 5]], 'Rat Ears'),
      handIns('Rephas', 'Qeynos Hills', 3, [['Arcane Scientists', 5]], 'Grilled Rat Ears')
    ])
    const logged = buildCatalog({ ...input, sources: log }).activities
    expect(logged.map((a) => [a.source, a.items?.[0]?.name, a.hits['Arcane Scientists'], a.handIns, a.back])).toEqual([['log', 'Rat Ears', 10, 2, 'Grilled Rat Ears']])
  })

  it("keeps a quest's hand-in of other things than the log saw go to that NPC, and one written on two pages once", () => {
    const supplied = parseQuestPage('Supplies for the New Sebilisian Expedition', SUPPLIES)!
    const input = catalogInput({
      factions: ['New Sebilisian Expedition'],
      targets: ['New Sebilisian Expedition'],
      sources: handIns('Crusader Iktra', 'The Northern Desert of Ro', 3, [['New Sebilisian Expedition', 15]], 'Small Brick of High Quality Ore'),
      pages: [
        {
          page: 'New Sebilisian Expedition',
          raise: { mobs: [], quests: ['Supplies for the New Sebilisian Expedition', 'Metal Bits for the New Sebilisian Expedition'], zones: [] },
          lower: { mobs: [], quests: [], zones: [] }
        }
      ],
      quests: {
        'Supplies for the New Sebilisian Expedition': supplied,
        'Metal Bits for the New Sebilisian Expedition': { ...supplied, page: 'Metal Bits for the New Sebilisian Expedition', steps: [supplied.steps[0]] }
      }
    })
    const ways = buildCatalog(input).activities.map((a) => `${a.source} ${a.items?.map((it) => `${it.count} ${it.name}`).join(' + ')}`)
    expect(ways).toEqual(['log 1 Small Brick of High Quality Ore', 'wiki 4 Metal Bits', 'wiki 1 Small Piece of High Quality Ore'])
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

describe('what quests want, race unlocks, and steps that open a way', () => {
  const TS = "Tunare's Scouts"
  // An Iksar cons Tunare's Scouts 750 under its standing, a Wood Elf 100 over; Tylfon's dagger wants Amiable (100).
  const mods = { Iksar: { [TS]: -750 }, 'Wood Elf': { [TS]: 100 }, Human: {} }
  const camp = act('arboreans', { [TS]: 1 }, 80, { zone: 'Greater Faydark' })
  const dagger: PlanActivity = {
    id: 'dagger',
    kind: 'quest',
    title: 'Tunare Scouts Dagger',
    zone: 'Kelethin',
    npc: 'Tylfon',
    hits: { [TS]: 1 },
    source: 'log',
    seen: 100,
    measured: 1800,
    items: [{ name: 'Rusty Dagger', count: 2, how: 'bought', where: 'Harg Tonicka', each: 10 }],
    gate: [{ faction: TS, band: 'Amiable', min: 100 }]
  }
  const target = [{ faction: TS, achievement: TS, standing: 0 }]

  it("raises a faction to what a quicker quest's NPC wants first, then does the quest", () => {
    const races = { own: 'Iksar', unlocked: [], mods }
    const plan = planFactions({ targets: target, maxed: [], activities: [camp, dagger], races }, S)
    expect(plan.steps.map((st) => [st.activity.id, st.units])).toEqual([
      ['arboreans', 850],
      ['dagger', 1150]
    ])
    expect(plan.steps[0]).toMatchObject({ finishes: [], restores: false, reaches: [{ faction: TS, to: 850, band: 'Amiable', opens: 'Tunare Scouts Dagger' }] })
    expect(plan.steps[1]).toMatchObject({ finishes: [TS], reaches: [] })
    expect(plan.steps.every((st) => !st.race)).toBe(true)
    // 850 kills and quick hand-ins, where 2000 kills are a day.
    const kills = planFactions({ targets: target, maxed: [], activities: [camp], races }, S)
    expect(plan.seconds).toBeLessThan(kills.seconds * 0.6)
    // The order kept while the standing moves: the step there to open the way, then the quest.
    const kept = planFactions({ targets: [{ ...target[0], standing: 400 }], maxed: [], activities: [camp, dagger], races }, S, NO_CHOICES, plan.shape)
    expect(kept.kept).toBe(true)
    expect(kept.steps.map((st) => [st.activity.id, st.units])).toEqual([
      ['arboreans', 450],
      ['dagger', 1150]
    ])
  })

  it('swaps to a race it has unlocked whose con its NPC takes, and says what its own would con', () => {
    const plan = planFactions({ targets: target, maxed: [], activities: [camp, dagger], races: { own: 'Iksar', unlocked: ['Wood Elf'], mods } }, S)
    expect(plan.steps.map((st) => [st.activity.id, st.units])).toEqual([['dagger', 2000]])
    expect(plan.steps[0]).toMatchObject({ race: 'Wood Elf', swap: S.swapMin * 60, why: { faction: TS, band: 'Amiable', con: -750 } })
    // With swaps off, its own race: the kills first.
    const own = planFactions({ targets: target, maxed: [], activities: [camp, dagger], races: { own: 'Iksar', unlocked: ['Wood Elf'], mods } }, { ...S, raceSwaps: false })
    expect(own.steps.map((st) => st.activity.id)).toEqual(['arboreans', 'dagger'])
    expect(own.steps.every((st) => !st.race)).toBe(true)
  })

  it('puts a class the NPC likes in the trio where only the gated quest raises the faction, while it is short', () => {
    const SW = 'Song Weavers'
    // A Wood Elf cons Song Weavers +50 with Monk, Shadow Knight and Shaman, +100 with a Bard in the trio;
    // Sylia wants Amiable, and her silks are the only way to raise it.
    const silks: PlanActivity = {
      ...dagger,
      id: 'silks',
      title: 'Spiderling Silks',
      npc: 'Sylia Windlehands',
      hits: { [SW]: 5 },
      gate: [{ faction: SW, band: 'Amiable', min: 100 }]
    }
    const input: PlanInput = {
      targets: [{ faction: SW, achievement: SW, standing: 5 }],
      maxed: [],
      activities: [silks],
      races: { own: 'Wood Elf', unlocked: [], mods: { 'Wood Elf': { [SW]: 50 }, [classSwapName('Wood Elf', 'Bard')]: { [SW]: 100 } } }
    }
    const plan = planFactions(input, S)
    expect(plan.unplanned).toEqual([])
    expect(plan.steps.map((st) => st.activity.id)).toEqual(['silks'])
    expect(plan.steps[0]).toMatchObject({ race: 'Wood Elf + Bard', swap: S.swapMin * 60, why: { faction: SW, band: 'Amiable', con: 55 } })
    expect(classSwapOf(plan.steps[0].race!)).toBe('Bard')
    expect(classSwapOf('Dark Elf')).toBeNull()
    // Without the swap nothing opens it.
    expect(planFactions(input, { ...S, raceSwaps: false }).unplanned).toEqual([SW])
  })

  it('counts a race unlock: its factions are to do too, and once it is done the plan may swap to that race', () => {
    const EW = 'Emerald Warriors'
    const input: PlanInput = {
      targets: target,
      standings: { [EW]: 0 },
      maxed: [],
      activities: [camp, dagger, act('bows', { [EW]: 20 }, 3600, { zone: 'Kelethin' })],
      unlocks: [{ achievement: 'Race Unlock - Wood Elf', race: 'Wood Elf', factions: [EW] }],
      races: { own: 'Iksar', unlocked: [], mods }
    }
    const plan = planFactions(input, S)
    // Emerald Warriors is no achievement to do here, but the race unlock wants it maxed.
    expect(plan.targets.map((t) => [t.faction, t.achievement])).toEqual([
      [TS, TS],
      [EW, 'Race Unlock - Wood Elf']
    ])
    expect(plan.steps.map((st) => st.activity.id)).toEqual(['bows', 'dagger'])
    expect(plan.steps[0]).toMatchObject({ finishes: [EW], unlocks: ['Race Unlock - Wood Elf'] })
    expect(plan.steps[1]).toMatchObject({ race: 'Wood Elf', finishes: [TS] })
    expect(plan.unplanned).toEqual([])
    // Half Elf's comes with Wood Elf's.
    const half = planFactions(
      { ...input, unlocks: [...input.unlocks!, { achievement: 'Race Unlock - Half Elf', race: 'Half Elf', factions: [], anyOf: ['Race Unlock - Wood Elf'] }] },
      S
    )
    expect(half.steps[0].unlocks).toEqual(['Race Unlock - Wood Elf', 'Race Unlock - Half Elf'])
  })

  it('with race unlocks first, does them before the rest', () => {
    const input: PlanInput = {
      targets: [
        { faction: 'Quick', achievement: 'Quick', standing: 1900 },
        { faction: 'U', achievement: 'U', standing: 0 }
      ],
      maxed: [],
      activities: [act('quick', { Quick: 10 }, 600), act('slow', { U: 10 }, 60)],
      unlocks: [{ achievement: 'Race Unlock - Troll', race: 'Troll', factions: ['U'] }]
    }
    // As quick either way, so the quick achievement first: stopping part way leaves the most done.
    expect(planFactions(input, S).steps.map((st) => st.activity.id)).toEqual(['quick', 'slow'])
    const first = planFactions(input, { ...S, unlocksFirst: true })
    expect(first.steps.map((st) => st.activity.id)).toEqual(['slow', 'quick'])
    expect(first.steps[0].unlocks).toEqual(['Race Unlock - Troll'])
  })

  it("with race unlocks first, still does what is quick on the way: Raltur's notes for Dismal Rage before Sir Lucan's", () => {
    const [FM, KoT, DR] = ['The Freeport Militia', 'Knights of Truth', 'Dismal Rage']
    const round: Omit<PlanActivity, 'id' | 'npc' | 'hits'> = {
      kind: 'turnin',
      title: 'Message Intercept',
      zone: 'West Commonlands',
      source: 'log',
      seen: 100,
      measured: 180,
      items: [{ name: 'Bottle of Milk', count: 1, how: 'bought', where: 'Pincia Brownloe', each: 5 }]
    }
    const lucan: PlanActivity = { ...round, id: 'lucan', npc: 'Sir Lucan D`Lere', hits: { [FM]: 22, [KoT]: 8, [DR]: -1 } }
    const raltur: PlanActivity = { ...round, id: 'raltur', npc: 'Raltur Caliskon', hits: { [DR]: 19, [KoT]: 7, [FM]: -3 }, gate: [{ faction: DR, band: 'Amiable', min: 100 }] }
    const input: PlanInput = {
      targets: [{ faction: DR, achievement: DR, standing: 0 }],
      standings: { [FM]: 0, [KoT]: 0 },
      maxed: [],
      activities: [lucan, raltur, act('guards', { [DR]: 5 }, 300, { zone: 'West Freeport' })],
      unlocks: [{ achievement: 'Race Unlock - Human (Freeport)', race: 'Human', factions: [FM, KoT] }],
      races: { own: 'Wood Elf', unlocked: [], mods: { 'Wood Elf': {}, Human: {} } }
    }
    const plan = planFactions(input, { ...S, unlocksFirst: true })
    // Dismal Rage raised to Amiable, then maxed by Raltur's notes (Knights of Truth +7 each too), then Sir Lucan's for the unlock:
    // not 250 of Sir Lucan's first, with Dismal Rage taken to -250 and raised back after.
    expect(plan.steps.map((st) => [st.activity.id, st.units])).toEqual([
      ['guards', 20],
      ['raltur', 100],
      ['lucan', 163]
    ])
    expect(plan.steps[1].finishes).toEqual([DR])
    expect(plan.steps[2].unlocks).toEqual(['Race Unlock - Human (Freeport)'])
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
