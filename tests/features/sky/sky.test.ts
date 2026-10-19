import { describe, expect, it } from 'vitest'
import { parseLogLine } from '../../../src/core/logLine'
import {
  emptySkyCharacter,
  emptySkyTally,
  heldOf,
  joinSkyTallies,
  lastLooted,
  loggedCounts,
  questOfReward,
  questOfTrade,
  readSkyLine,
  sanitizeSkyCharacter,
  SKY_QUESTS,
  wishDone,
  wishLeft,
  type SkyState,
  type SkyTally
} from '../../../src/features/sky/core'
import { questMatch, questView, shoppingList, sortViews } from '../../../src/features/sky/views'

// Plan › Plane of Sky: the Tests as the wiki lists them, the Sky's items counted from the log, and the
// wish list's sums. The loot lines are real ones' wording; the hand-in is the wording every NPC trade has.

const FISTS = 'Monk Test of Fists'
const SAPPHIRE = 'nebulous sapphire'

function read(lines: string[], into: SkyTally = emptySkyTally()): SkyTally {
  for (const raw of lines) {
    const line = parseLogLine(raw)
    if (line) readSkyLine(line, into)
  }
  return into
}

const at = (hms: string, text: string) => `[Tue Sep 29 ${hms} 2026] ${text}`

describe('the Tests', () => {
  it('are every class’s, as the wiki lists them', () => {
    expect(SKY_QUESTS.length).toBeGreaterThanOrEqual(90)
    expect(new Set(SKY_QUESTS.map((q) => q.cls)).size).toBe(16)
    const fists = questOfReward("Wu's Fist of Mastery +7")!
    expect(fists.name).toBe(FISTS)
    expect(fists.giver).toBe('Holwin')
    expect(fists.runes).toEqual(['Wind Rune Neza'])
    expect(fists.items).toEqual([
      { name: 'Nebulous Sapphire', drops: [{ island: 7, mob: 'Sister of the Spire' }], noDrop: true },
      {
        name: 'Brass Knuckles',
        drops: [
          { island: 1.5, mob: 'Noble Dojorn' },
          { island: 4, mob: 'Overseer of Air' },
          { island: 8, mob: 'The Hand of Veeshan' }
        ]
      }
    ])
    // Every item a Test takes has a place it drops.
    expect(SKY_QUESTS.flatMap((q) => q.items).filter((i) => !i.drops.length)).toEqual([])
  })

  it('are found by every word typed, in the name, class, giver, reward or what they take', () => {
    const fists = SKY_QUESTS.find((q) => q.name === FISTS)!
    expect(['', 'monk fists', 'holwin', 'wu’s', 'sister spire', 'brass'].map((f) => questMatch(fists, f.replace('’', "'")))).toEqual([true, true, true, true, true, true])
    expect(questMatch(fists, 'monk bard')).toBe(false)
  })

  it('names the Test a trade with a giver was by the items in it', () => {
    expect(questOfTrade('Holwin', ['Nebulous Sapphire', 'Brass Knuckles'])?.name).toBe(FISTS)
    expect(questOfTrade('Holwin', ['Wind Rune Caza'])?.name).toBe('Monk Test of Strength')
    expect(questOfTrade('Holwin', ['Rusty Dagger'])).toBeNull()
    expect(questOfTrade('Tylfon', ['Nebulous Sapphire'])).toBeNull()
  })
})

describe('the log', () => {
  it('counts what was kept or stored, never what was sold as it dropped, nor other people’s loot or other items', () => {
    const t = read([
      at('22:01:24', "You looted a Nebulous Sapphire from Sister of the Spire's corpse and sold it for free."),
      at('22:08:45', "You looted a Wind Rune Meda from Eye of Veeshan's corpse and stored it in your currency"),
      at('22:09:00', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
      at('22:09:01', "--Kelwyn has looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
      at('22:09:02', "--You have looted 2 Bone Chips from a putrid skeleton's corpse.--")
    ])
    expect(loggedCounts(t)).toEqual({ [SAPPHIRE]: 1, 'wind rune meda': 1 })
  })

  it('takes away what a completed trade took, and counts the Test it was; a cancelled trade takes nothing', () => {
    const t = read([
      at('21:00:00', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
      at('21:00:01', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"),
      at('21:00:02', "You looted a Wind Rune Neza from a blade storm's corpse and stored it in your currency"),
      at('21:10:00', 'You offered 1 Nebulous Sapphire to Holwin.'),
      at('21:10:02', 'You have cancelled the trade.'),
      at('21:11:00', 'You offered 1 Nebulous Sapphire to Holwin.'),
      at('21:11:01', 'You offered 1 Brass Knuckles to Holwin.'),
      at('21:11:02', 'You offered 1 Wind Rune Neza to Holwin.'),
      at('21:11:03', 'You complete the trade with Holwin.')
    ])
    expect(loggedCounts(t)).toEqual({ [SAPPHIRE]: 1, 'wind rune neza': 0, 'brass knuckles': 0 })
    expect(Object.keys(t.runs)).toEqual([FISTS])
    expect(t.runs[FISTS]).toHaveLength(1)
    expect(t.trade).toBeUndefined()
  })

  it('takes one away for a merge of two held copies, whatever their +N', () => {
    const t = read([
      at('12:00:00', "--You have looted a Wu's Fist of Mastery from Reward Chest.--"),
      at('12:00:01', "--You have looted a Wu's Fist of Mastery from Reward Chest.--"),
      at('12:18:30', "You have successfully merged two items together to create a new item: Wu's Fist of Mastery +1")
    ])
    expect(loggedCounts(t)).toEqual({ 'wus fist of mastery': 1 })
    expect(lastLooted(t)['wus fist of mastery']).toBe(parseLogLine(at('12:00:01', 'x'))!.time)
  })

  it('keeps a trade open across reads, and joins stretches in order', () => {
    const first = read([at('21:00:00', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--"), at('21:10:00', 'You offered 1 Nebulous Sapphire to Holwin.')])
    expect(first.trade).toEqual({ npc: 'Holwin', items: { 'Nebulous Sapphire': 1 } })
    read([at('21:10:05', 'You complete the trade with Holwin.')], first)
    const second = read([at('22:00:00', "--You have looted a Nebulous Sapphire from Sister of the Spire's corpse.--")])
    const all = joinSkyTallies([first, second])
    expect(loggedCounts(all)[SAPPHIRE]).toBe(1)
    expect(all.runs[FISTS]).toHaveLength(1)
  })
})

/** A character's state with nothing in it but what a test gives. */
const skyState = (p: Partial<SkyState> = {}): SkyState => ({
  character: 'Kelwyn_neriak',
  ...emptySkyCharacter(),
  logged: {},
  last: {},
  runs: {},
  classes: [],
  exported: null,
  achieved: null,
  respawns: {},
  ...p
})

describe('the wish list', () => {
  const runs = { [FISTS]: [100, 300] }
  const state = skyState({ logged: { [SAPPHIRE]: 1, 'wind rune neza': 3 }, adjust: { 'brass knuckles': 1 }, runs, wishes: [{ quest: FISTS, want: 3, since: 200 }] })

  it('counts the hand-ins since a wish was made, and those added by hand', () => {
    expect(wishDone(state.wishes[0], runs)).toBe(1)
    expect(wishLeft(state.wishes[0], runs)).toBe(2)
    expect(wishLeft({ quest: FISTS, want: 3, since: 200, extra: 5 }, runs)).toBe(0)
  })

  it('needs each item as many times as a wish has left, and adds the wishes up', () => {
    const v = questView(
      SKY_QUESTS.find((q) => q.name === FISTS)!,
      state,
      'log'
    )
    expect(v.times).toBe(2)
    expect(v.want).toBe(3)
    expect(v.needs.map((n) => [n.item.name, n.have, n.need])).toEqual([
      ['Wind Rune Neza', 3, 2],
      ['Nebulous Sapphire', 1, 2],
      ['Brass Knuckles', 1, 2]
    ])
    expect(v.ready).toBe(true)
    expect(v.missing).toBe(0)
    expect(v.near).toBeCloseTo(4 / 6)
    // By the first island each drops on: Brass Knuckles from Noble Island (1.5).
    expect(shoppingList(state, 'log').map((r) => [r.item.name, r.have, r.need, r.for])).toEqual([
      ['Wind Rune Neza', 3, 2, [FISTS]],
      ['Brass Knuckles', 1, 2, [FISTS]],
      ['Nebulous Sapphire', 1, 2, [FISTS]]
    ])
  })

  it('puts a correction on the log’s count, never under none, and sorts the ready Tests first', () => {
    expect(heldOf({ logged: { [SAPPHIRE]: 1 }, adjust: { [SAPPHIRE]: -4 } }, 'Nebulous Sapphire')).toBe(0)
    const views = SKY_QUESTS.slice(0, 3).map((q) => questView(q, skyState(), 'log'))
    const rune = SKY_QUESTS[2].runes[0].toLowerCase()
    const sorted = SKY_QUESTS.slice(0, 3)
      .map((q) => questView(q, skyState({ logged: { [rune]: 1 } }), 'log'))
      .sort(sortViews('near'))
    expect(views.every((v) => !v.ready && v.near === 0)).toBe(true)
    expect(sorted[0].quest.name).toBe(SKY_QUESTS[2].name)
  })

  it('reads sky.json back as wishes for Tests there are and whole-number corrections for the Sky’s items', () => {
    expect(
      sanitizeSkyCharacter({
        wishes: [
          { quest: FISTS, want: 2, since: 5 },
          { quest: FISTS, want: 9, since: 6 },
          { quest: 'Monk Test of Nothing', want: 1, since: 1 },
          { quest: 'Monk Test of Sight', want: 500, since: 1, extra: -3 }
        ],
        adjust: { [SAPPHIRE]: 2, 'bone chips': 4, 'brass knuckles': 0.5 }
      })
    ).toEqual({
      wishes: [
        { quest: FISTS, want: 2, since: 5 },
        { quest: 'Monk Test of Sight', want: 99, since: 1 }
      ],
      adjust: { [SAPPHIRE]: 2 },
      favorites: [],
      ignored: [],
      turnIns: {}
    })
    expect(sanitizeSkyCharacter(null)).toEqual(emptySkyCharacter())
    expect(
      sanitizeSkyCharacter({
        favorites: [FISTS, FISTS, 'Nope', 3],
        ignored: ['Monk Test of Sight'],
        turnIns: { [FISTS]: 2, 'Monk Test of Sight': -1, Nope: 1, 'Monk Test of Speed': 500 }
      })
    ).toMatchObject({ favorites: [FISTS], ignored: ['Monk Test of Sight'], turnIns: { [FISTS]: 2, 'Monk Test of Sight': -1 } })
  })
})
