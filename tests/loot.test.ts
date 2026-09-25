import { describe, expect, it } from 'vitest'
import { fmtCoin, LootLedger, parseCoin, parseLootLine } from '../src/core/loot'
import { parseItemUse, plainText } from '../src/core/wikiItem'
import { parseLogLine } from '../src/core/logLine'

// Lines copied from the log.

describe('loot lines', () => {
  const p = parseLootLine
  it('reads what auto-loot did with each item', () => {
    expect(p("You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.")).toEqual({
      kind: 'loot', looter: 'You', item: 'Shadow Rage Helm +4', count: 1, source: 'Cleric of Innoruuk', outcome: 'sold', copper: 0
    })
    expect(p("You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.")).toMatchObject({ item: 'Fetid Skin', source: 'A fetid fiend', outcome: 'sold', copper: 679 })
    expect(p("You looted a Fire Emerald Ring +4 from an ire ghast's corpse and sold it for 107 platinum, 1 gold, 4 silver and 3 copper.")).toMatchObject({ copper: 107_143 })
    expect(p("You looted a Crystallized Sulfur from an ire ghast's corpse and stored it in your tradeskill depot")).toMatchObject({ item: 'Crystallized Sulfur', source: 'An ire ghast', outcome: 'depot' })
    expect(p("You looted 2 Giant Bat Wing from a sonic bat's corpse and stored it in your tradeskill depot")).toMatchObject({ count: 2, outcome: 'depot' })
    expect(p("You looted a Mote of Major Potential from a loathling lich's corpse and stored it in your currency")).toMatchObject({ outcome: 'currency' })
    expect(p('You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency')).toMatchObject({ count: 4, source: 'Reward Chest', outcome: 'currency' })
    expect(p('You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6')).toEqual({
      kind: 'loot', looter: 'You', item: 'Indicolite Bracer +4', count: 1, source: 'Reward Chest', outcome: 'merged', copper: 0, into: 'Indicolite Bracer +6'
    })
  })
  it('reads what was kept, yours and a group-mate\'s', () => {
    expect(p("--You have looted a Star Ruby from a fetid fiend's corpse.--")).toEqual({ kind: 'loot', looter: 'You', item: 'Star Ruby', count: 1, source: 'A fetid fiend', outcome: 'kept', copper: 0 })
    expect(p("--You have looted 2 Bone Chips from a putrid skeleton's corpse.--")).toMatchObject({ item: 'Bone Chips', count: 2 })
    expect(p("--You have looted a Note from *Duggin Scumber's corpse.--")).toMatchObject({ item: 'Note', source: 'Duggin Scumber' })
    expect(p("--Aldric has looted a Rusty Sword from a skeleton's corpse.--")).toMatchObject({ looter: 'Aldric', item: 'Rusty Sword', outcome: 'kept' })
  })
  it('reads coin from corpses and from sales', () => {
    expect(p('You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.')).toEqual({ kind: 'coin', copper: 4298, from: 'corpse', bag: false })
    expect(p('You receive 3 copper from the corpse.')).toMatchObject({ copper: 3 })
    expect(p('You receive 6 gold from Zok Zribb.')).toEqual({ kind: 'coin', copper: 600, from: 'Zok Zribb', bag: false })
    expect(p('You receive  52 platinum 2 gold 8 silver 5 copper from Melixis for the contents of your bag.')).toEqual({ kind: 'coin', copper: 52_285, from: 'Melixis', bag: true })
    expect(p('You receive no experience for defeating this creature as you are in a raid.')).toBeNull()
    expect(parseCoin('1 platinum and 8 silver')).toBe(1080)
    expect(fmtCoin(107_143)).toBe('107p 1g 4s 3c')
    expect(fmtCoin(0)).toBe('nothing')
  })
  it('leaves other lines alone', () => {
    expect(p("Melixis told you, 'I'll give you 10 platinum 1 gold 3 silver 3 copper for the Mammoth Tusks.'")).toBeNull()
    expect(p('You have entered The Plane of Fear 4 (Refined).')).toBeNull()
  })
})

describe('LootLedger', () => {
  const feed = (l: LootLedger, text: string, session = 's1', zone = 'The Plane of Fear 4 (Refined)') => {
    for (const raw of text.trim().split('\n')) l.handle(parseLogLine(raw.trim())!, zone, session)
  }
  it('files loot and coin under the session, newest first, with the +N split off', () => {
    const l = new LootLedger()
    feed(l, `
      [Thu Sep 24 20:00:01 2026] You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.
      [Thu Sep 24 20:00:02 2026] You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.
      [Thu Sep 24 20:00:03 2026] --You have looted a Star Ruby from a fetid fiend's corpse.--
      [Thu Sep 24 20:00:04 2026] You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.`)
    feed(l, '[Thu Sep 24 20:10:00 2026] You receive 6 gold from Zok Zribb.', 's2', 'Neriak')
    const snap = l.snapshot()
    expect(snap.entries.map((e) => [e.item, e.base, e.plus, e.outcome, e.sessionId])).toEqual([
      ['Fetid Skin', 'Fetid Skin', 0, 'sold', 's1'],
      ['Star Ruby', 'Star Ruby', 0, 'kept', 's1'],
      ['Shadow Rage Helm +4', 'Shadow Rage Helm', 4, 'sold', 's1']
    ])
    expect(snap.coin).toEqual({ s1: { corpse: 4298, sales: 679 }, s2: { corpse: 0, sales: 600 } })
    l.reset()
    expect(l.snapshot().entries).toEqual([])
  })
})

describe('what an item is for, from its page', () => {
  const PAGE = `{{Classic Era}}
<onlyinclude>{{Itempage
|notes       = {{Item Lore | This key unlocks the portal to the island of the [[Overseer of Air]].<br>Once activated this key is saved. }}
|merchant_value = 238p 9s 5c
|itemname    = Key of Beasts
|lucy_img_ID = 651
|statsblock  =
No Trade<br>
WT: 1.0  Size: SMALL<br>
|dropsfrom =

[[Plane of Sky]]

* [[Gorgalosk]]

|relatedquests =

* [[Plane of Sky Keys]]
* [[Islands of Sky Keys|Islands]]

|recipes =

* [[Jewelcrafting]]
** [[Silver Blue Diamond Ring]] (Trivial: 75)
** [[Blue Diamond Electrum Earring]] (Trivial: 148)
* [[Spell Research]]
** [[Practice Rune (Azia)]] (Trivial:21)
}}</onlyinclude>`
  it('reads the notes, quests, recipes and value', () => {
    expect(parseItemUse(PAGE)).toEqual({
      notes: 'This key unlocks the portal to the island of the Overseer of Air. Once activated this key is saved.',
      quests: ['Plane of Sky Keys', 'Islands'],
      recipes: ['Jewelcrafting: Silver Blue Diamond Ring (75)', 'Jewelcrafting: Blue Diamond Electrum Earring (148)', 'Spell Research: Practice Rune (Azia) (21)'],
      value: '238p 9s 5c'
    })
    expect(parseItemUse('{{Itempage\n|notes = \n|statsblock = \nSlot: HEAD<br>\n}}')).toEqual({ notes: '', quests: [], recipes: [], value: '' })
    expect(plainText("'''Bold''' and [[a link|words]]<br>next")).toBe('Bold and words next')
  })
})
