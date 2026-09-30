import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { aaHistoryView, addAaLine, emptyAaTally, joinAaTallies, parseAaLine, withAaList, type AaTally } from '../../src/core/aaHistory'
import { aaConsumer } from '../../src/main/aaHistory'
import { characterLogFile } from '../../src/main/storeCore'
import type { AaSummary } from '../../src/core/aa'

const T0 = new Date(2026, 8, 15, 14, 0, 0).getTime()
const at = (sec: number) => T0 + sec * 1000

/** One stretch of log read the way LogHistory reads it: every line through the consumer's reader. */
function tally(lines: [number, string][]): AaTally {
  const into = aaConsumer.empty()
  const read = aaConsumer.reader()
  for (const [sec, text] of lines) read({ time: at(sec), text }, into)
  return into
}

const view = (lines: [number, string][]) => aaHistoryView(tally(lines))

describe('AA lines', () => {
  it('reads a first rank, a rank raised, and their cost', () => {
    expect(parseAaLine('You have gained the ability "Combat Stability" at a cost of 2 ability points.')).toEqual({ kind: 'rank', name: 'Combat Stability', rank: 1, cost: 2 })
    expect(parseAaLine('You have improved Combat Stability 3 at a cost of 6 ability points.')).toEqual({ kind: 'rank', name: 'Combat Stability', rank: 3, cost: 6 })
    expect(parseAaLine('You have improved Innate Lung Capacity 2 at a cost of 1 ability point.')).toEqual({ kind: 'rank', name: 'Innate Lung Capacity', rank: 2, cost: 1 })
  })

  it('takes a name that ends in a number up to the rank', () => {
    expect(parseAaLine('You have improved Weapon Mastery of the Scout 2 at a cost of 6 ability points.')).toMatchObject({ name: 'Weapon Mastery of the Scout', rank: 2 })
  })

  it("leaves a toggled ability's state off its name", () => {
    expect(parseAaLine('You have gained the ability "Symphonic Aura: Disabled" at a cost of 0 ability points.')).toMatchObject({ name: 'Symphonic Aura', rank: 1, cost: 0 })
    expect(parseAaLine('You have improved Symphonic Aura: Enabled 2 at a cost of 0 ability points.')).toMatchObject({ name: 'Symphonic Aura', rank: 2 })
  })

  it('reads refunds, points, the full pool and list lines', () => {
    expect(parseAaLine('The alternate ability Master of All has been refunded.')).toEqual({ kind: 'refund', name: 'Master of All' })
    expect(parseAaLine('You have gained an ability point!  You now have 11 ability points.')).toEqual({ kind: 'points', total: 11 })
    expect(parseAaLine('You have gained an ability point!  You now have 1 ability point.')).toEqual({ kind: 'points', total: 1 })
    expect(parseAaLine('You have gained 2 ability point(s)!  You now have 4 ability point(s).')).toEqual({ kind: 'points', total: 4 })
    expect(parseAaLine('You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.')).toEqual({ kind: 'cap' })
    expect(parseAaLine('You must spend some of your ability points. You will no longer gain ability points.')).toEqual({ kind: 'cap' })
    expect(parseAaLine('Ability #33: Combat Stability')).toEqual({ kind: 'list' })
  })

  it('ignores lines that only look like them', () => {
    expect(parseAaLine('You have gained the ability to use Double Attack.')).toBeNull()
    expect(parseAaLine('You have gained a level! Welcome to level 12!')).toBeNull()
    expect(parseAaLine('You have become better at Tailoring! (12)')).toBeNull()
    expect(parseAaLine('You earned a refund of your instance charge.')).toBeNull()
    expect(parseAaLine("Aldric tells the group, 'You have improved Combat Fury 2 at a cost of 2 ability points.'")).toBeNull()
    expect(parseAaLine('Description: This passive ability increases your melee avoidance by 10%.')).toBeNull()
  })
})

describe('AAs bought, from the log', () => {
  it('gives each ability its last rank and what it cost, most recently raised first', () => {
    const v = view([
      [0, 'You have gained the ability "Combat Stability" at a cost of 2 ability points.'],
      [1, 'You have gained the ability "Finishing Blow" at a cost of 2 ability points.'],
      [2, 'You have improved Combat Stability 2 at a cost of 4 ability points.'],
      [3, 'You have improved Combat Stability 3 at a cost of 6 ability points.']
    ])
    expect(v.bought.map((a) => [a.name, a.rank, a.spent])).toEqual([
      ['Combat Stability', 3, 12],
      ['Finishing Blow', 1, 2]
    ])
    expect(v.bought[0].ranks.map((r) => [r.rank, r.cost])).toEqual([
      [1, 2],
      [2, 4],
      [3, 6]
    ])
    expect(v.bought[0].last).toBe(at(3))
    expect(v.spent).toBe(14)
  })

  it('keeps the last rank the log gave even when earlier ones are missing', () => {
    const v = view([
      [0, 'You have improved Innate Eminence 4 at a cost of 3 ability points.'],
      [1, 'You have improved Innate Eminence 5 at a cost of 3 ability points.']
    ])
    expect(v.bought[0]).toMatchObject({ name: 'Innate Eminence', rank: 5, spent: 6 })
  })

  it('puts abilities whose every rank cost nothing apart, as granted', () => {
    const v = view([
      [0, 'You have gained the ability "Lay on Hands" at a cost of 0 ability points.'],
      [1, 'You have improved Lay on Hands 2 at a cost of 0 ability points.'],
      [2, 'You have gained the ability "Symphonic Aura: Disabled" at a cost of 0 ability points.'],
      [3, 'You have improved Symphonic Aura: Disabled 3 at a cost of 3 ability points.']
    ])
    expect(v.granted.map((a) => [a.name, a.rank, a.granted])).toEqual([['Lay on Hands', 2, true]])
    expect(v.bought.map((a) => [a.name, a.rank, a.spent])).toEqual([['Symphonic Aura', 3, 3]])
  })

  it('gives back every rank a refund names, and counts a purchase after it afresh', () => {
    const lines: [number, string][] = [
      [0, 'You have gained the ability "Master of All" at a cost of 5 ability points.'],
      [1, 'You have improved Master of All 2 at a cost of 5 ability points.'],
      [100, 'The alternate ability Master of All has been refunded.']
    ]
    const refunded = view(lines).bought[0]
    expect(refunded).toMatchObject({ rank: 0, spent: 0, refundedAt: at(100), refunds: [at(100)], last: at(100) })
    expect(refunded.ranks.every((r) => r.refunded)).toBe(true)

    const again = view([...lines, [200, 'You have gained the ability "Master of All" at a cost of 10 ability points.']]).bought[0]
    expect(again).toMatchObject({ rank: 1, spent: 10, refundedAt: 0, refunds: [at(100)] })
    expect(again.ranks.map((r) => [r.cost, r.refunded])).toEqual([
      [5, true],
      [5, true],
      [10, false]
    ])
  })

  it('starts from the first line read', () => {
    expect(view([[5, 'You say, hello']]).from).toBe(at(5))
    expect(view([]).from).toBe(0)
  })
})

describe('AA points', () => {
  it('takes the last total reported less what was bought after it', () => {
    const v = view([
      [0, 'You have gained an ability point!  You now have 10 ability points.'],
      [1, 'You have improved Combat Fury 2 at a cost of 2 ability points.'],
      [2, 'You have gained 2 ability point(s)!  You now have 10 ability point(s).'],
      [3, 'You have improved Combat Fury 3 at a cost of 3 ability points.']
    ])
    expect(v.points).toEqual({ total: 10, at: at(2), spentSince: 3, unspent: 7, refundSince: false })
  })

  it('counts a purchase in the same second as the report only if it came after it', () => {
    const before = view([
      [0, 'You have improved Combat Fury 2 at a cost of 2 ability points.'],
      [0, 'You have gained an ability point!  You now have 5 ability points.']
    ])
    expect(before.points).toMatchObject({ spentSince: 0, unspent: 5 })
  })

  it('says when a refund since the report may have given more back', () => {
    const v = view([
      [0, 'You have gained an ability point!  You now have 3 ability points.'],
      [1, 'The alternate ability Master of All has been refunded.']
    ])
    expect(v.points).toMatchObject({ unspent: 3, refundSince: true })
  })

  it('has none until the game reports a total', () => {
    expect(view([[0, 'You have improved Combat Fury 2 at a cost of 2 ability points.']]).points).toBeNull()
  })

  it('says the pool is full until a point is spent or gained', () => {
    const full: [number, string][] = [
      [0, 'You have gained an ability point!  You now have 30 ability points.'],
      [1, 'You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.']
    ]
    expect(view(full).capAt).toBe(at(1))
    // A granted rank spends nothing.
    expect(view([...full, [2, 'You have improved Lay on Hands 3 at a cost of 0 ability points.']]).capAt).toBe(at(1))
    expect(view([...full, [2, 'You have improved Combat Fury 2 at a cost of 2 ability points.']]).capAt).toBe(0)
    expect(view([...full, [2, 'You have gained an ability point!  You now have 29 ability points.']]).capAt).toBe(0)
    expect(view([[0, 'You must spend some of your ability points. You will no longer gain ability points.']]).capAt).toBe(at(0))
  })
})

describe('/alternateadv lists in the log', () => {
  it('knows the newest list by its first line, however long it takes to print', () => {
    const v = view([
      [0, 'Ability #1: Innate Eminence'],
      [1, 'Ability #33: Combat Stability'],
      [600, 'Ability #1: Innate Eminence'],
      [601, 'Description: This passive ability increases your strength, stamina, agility, dexterity, wisdom, intelligence, and charisma by 10 points.'],
      [602, 'Ability #33: Combat Stability']
    ])
    expect(v.listAt).toBe(at(600))
    expect(view([[0, 'You say, hello']]).listAt).toBe(0)
  })
})

describe('AA history over a log and its archives', () => {
  const archive = tally([
    [0, 'Ability #1: Innate Eminence'],
    [1, 'You have gained the ability "Combat Stability" at a cost of 2 ability points.'],
    [2, 'You have gained an ability point!  You now have 8 ability points.'],
    [3, 'You have improved Combat Stability 2 at a cost of 4 ability points.'],
    [4, 'You have reached the AA point cap, and cannot gain any further experience until some of your stored AA point pool is used.']
  ])

  it("joins them oldest first, counting the live log's purchases against the archive's report", () => {
    const live = tally([
      [1000, 'You say, hello'],
      [1001, 'You have improved Combat Stability 3 at a cost of 6 ability points.']
    ])
    const v = aaHistoryView(joinAaTallies([archive, live]))
    expect(v.bought[0]).toMatchObject({ name: 'Combat Stability', rank: 3, spent: 12 })
    expect(v.points).toMatchObject({ total: 8, at: at(2), spentSince: 10, unspent: 0 })
    expect(v.capAt).toBe(0)
    expect(v.from).toBe(at(0))
    expect(v.listAt).toBe(at(0))
  })

  it("takes the later stretch's report, cap and list over the earlier's", () => {
    const live = tally([
      [1000, 'Ability #33: Combat Stability'],
      [1001, 'You have gained an ability point!  You now have 3 ability points.'],
      [1002, 'You have improved Combat Stability 3 at a cost of 6 ability points.'],
      [1003, 'You must spend some of your ability points. You will no longer gain ability points.']
    ])
    const v = aaHistoryView(joinAaTallies([archive, live]))
    expect(v.points).toMatchObject({ total: 3, spentSince: 6, unspent: 0 })
    expect(v.capAt).toBe(at(1003))
    expect(v.listAt).toBe(at(1000))
  })

  it('is empty with nothing read', () => {
    const v = aaHistoryView(joinAaTallies([emptyAaTally(), emptyAaTally()]))
    expect(v).toEqual({ bought: [], granted: [], spent: 0, points: null, capAt: 0, listAt: 0, from: 0 })
  })

  it('reads a stretch one line at a time, as LogHistory feeds it', () => {
    const into = emptyAaTally()
    addAaLine(into, { time: at(0), text: 'You have gained the ability "Combat Fury" at a cost of 1 ability points.' })
    addAaLine(into, { time: at(1), text: 'You have improved Combat Fury 2 at a cost of 2 ability points.' })
    expect(into.events).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(into))).toEqual(into)
  })
})

describe('AAs in the /alternateadv list the log never saw bought', () => {
  const list = (abilities: [string, number | null][]): AaSummary => ({
    when: 'Thu Sep 24 20:38:13 2026',
    count: abilities.length,
    abilities: abilities.map(([name, cost], i) => ({ id: i, name, cost, description: '', effects: {} })),
    totals: {}
  })

  it('adds them after the ones the log knows, bought or granted by their cost', () => {
    const logged = view([[0, 'You have improved Combat Stability 3 at a cost of 6 ability points.']])
    const v = withAaList(
      logged,
      list([
        ['combat stability', 6],
        ['Packrat', 1],
        ['Gather Party', 0],
        ['Symphonic Aura: Enabled', 3]
      ])
    )
    expect(v.bought.map((a) => [a.name, a.listOnly])).toEqual([
      ['Combat Stability', false],
      ['Packrat', true],
      ['Symphonic Aura', true]
    ])
    expect(v.granted.map((a) => [a.name, a.listOnly, a.granted])).toEqual([['Gather Party', true, true]])
    expect(v.bought[1]).toMatchObject({ rank: 0, spent: 0, last: 0, ranks: [] })
  })

  it('leaves the view as it is without a list', () => {
    const v = view([[0, 'You have improved Combat Stability 3 at a cost of 6 ability points.']])
    expect(withAaList(v, null)).toBe(v)
  })
})

describe("a character's live log", () => {
  const install = 'C:\\Games\\EverQuest Legends'
  const watched = 'D:\\Elsewhere\\eqlog_Kelwyn_neriak.txt'

  it('is the watched log for the character being played', () => {
    expect(characterLogFile('Kelwyn_neriak', 'Kelwyn_neriak', watched, install)).toBe(watched)
  })

  it("is another character's own file in the game's Logs folder, never the watched one", () => {
    expect(characterLogFile('Brenna_neriak', 'Kelwyn_neriak', watched, install)).toBe(join(install, 'Logs', 'eqlog_Brenna_neriak.txt'))
  })

  it('falls back to the Logs folder with no log watched', () => {
    expect(characterLogFile('Kelwyn_neriak', 'Kelwyn_neriak', '', install)).toBe(join(install, 'Logs', 'eqlog_Kelwyn_neriak.txt'))
  })
})
