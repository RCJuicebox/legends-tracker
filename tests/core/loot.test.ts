import { describe, expect, it } from 'vitest'
import {
  dropRates,
  fmtCoin,
  itemWorth,
  lastSales,
  LootLedger,
  LootSinceTally,
  mergeLoot,
  parseCoin,
  parseLootLine,
  sessionWorth,
  withLootSince,
  type LootEntry,
  type LootSnapshot
} from '../../src/core/loot'
import type { Inventory } from '../../src/shared/types'
import { parseOffer } from '../../src/core/tradeskills'
import { parseItemUse, plainText } from '../../src/core/wikiItem'
import { parseLogLine } from '../../src/core/logLine'

// Lines copied from the log.

describe('loot lines', () => {
  const p = parseLootLine
  it('reads what auto-loot did with each item', () => {
    expect(p("You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.")).toEqual({
      kind: 'loot',
      looter: 'You',
      item: 'Shadow Rage Helm +4',
      count: 1,
      source: 'Cleric of Innoruuk',
      outcome: 'sold',
      copper: 0
    })
    expect(p("You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.")).toMatchObject({
      item: 'Fetid Skin',
      source: 'A fetid fiend',
      outcome: 'sold',
      copper: 679
    })
    expect(p("You looted a Fire Emerald Ring +4 from an ire ghast's corpse and sold it for 107 platinum, 1 gold, 4 silver and 3 copper.")).toMatchObject({ copper: 107_143 })
    expect(p("You looted a Crystallized Sulfur from an ire ghast's corpse and stored it in your tradeskill depot")).toMatchObject({
      item: 'Crystallized Sulfur',
      source: 'An ire ghast',
      outcome: 'depot'
    })
    expect(p("You looted 2 Giant Bat Wing from a sonic bat's corpse and stored it in your tradeskill depot")).toMatchObject({ count: 2, outcome: 'depot' })
    // Stored in the Dragon Hoard (LT-513).
    expect(p("You looted an Apothic Crown +4 from a spite golem's corpse and stored it in your Dragon Hoard")).toMatchObject({
      item: 'Apothic Crown +4',
      source: 'A spite golem',
      outcome: 'hoard',
      copper: 0
    })
    expect(p("You looted a Mote of Major Potential from a loathling lich's corpse and stored it in your currency")).toMatchObject({ outcome: 'currency' })
    expect(p('You looted 4 Mote of Major Potential from Reward Chest and stored it in your currency')).toMatchObject({ count: 4, source: 'Reward Chest', outcome: 'currency' })
    expect(p('You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6')).toEqual({
      kind: 'loot',
      looter: 'You',
      item: 'Indicolite Bracer +4',
      count: 1,
      source: 'Reward Chest',
      outcome: 'merged',
      copper: 0,
      into: 'Indicolite Bracer +6'
    })
  })
  it("reads what was kept, yours and a group-mate's", () => {
    expect(p("--You have looted a Star Ruby from a fetid fiend's corpse.--")).toEqual({
      kind: 'loot',
      looter: 'You',
      item: 'Star Ruby',
      count: 1,
      source: 'A fetid fiend',
      outcome: 'kept',
      copper: 0
    })
    expect(p("--You have looted 2 Bone Chips from a putrid skeleton's corpse.--")).toMatchObject({ item: 'Bone Chips', count: 2 })
    expect(p("--You have looted a Note from *Duggin Scumber's corpse.--")).toMatchObject({ item: 'Note', source: 'Duggin Scumber' })
    expect(p("--Aldric has looted a Rusty Sword from a skeleton's corpse.--")).toMatchObject({ looter: 'Aldric', item: 'Rusty Sword', outcome: 'kept' })
  })
  it('reads coin from corpses and from sales', () => {
    expect(p('You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.')).toEqual({ kind: 'coin', copper: 4298, from: 'corpse', bag: false })
    expect(p('You receive 3 copper from the corpse.')).toMatchObject({ copper: 3 })
    expect(p('You receive 2 gold and 3 silver as your split.')).toEqual({ kind: 'coin', copper: 230, from: 'corpse', bag: false })
    expect(p('You receive 6 gold from Zok Zribb.')).toEqual({ kind: 'coin', copper: 600, from: 'Zok Zribb', bag: false })
    // A stack sold: the merchant's name stops before "for the" (LT-513).
    expect(p('You receive 4 gold 7 silver 6 copper from Melixis for the Large Cloth Shirt(s).')).toEqual({ kind: 'coin', copper: 476, from: 'Melixis', bag: false })
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
    feed(
      l,
      `
      [Thu Sep 24 20:00:01 2026] You receive 4 platinum, 2 gold, 9 silver and 8 copper from the corpse.
      [Thu Sep 24 20:00:02 2026] You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.
      [Thu Sep 24 20:00:03 2026] --You have looted a Star Ruby from a fetid fiend's corpse.--
      [Thu Sep 24 20:00:04 2026] You looted a Fetid Skin from a fetid fiend's corpse and sold it for 6 gold, 7 silver and 9 copper.`
    )
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

describe('gear looted since the inventory export', () => {
  const tally = (after: number, text: string) => {
    const t = new LootSinceTally(after)
    const changed = text
      .trim()
      .split('\n')
      .map((raw) => t.add(parseLogLine(raw.trim())!))
    return { view: t.view(), changed }
  }
  const exportAt = new Date(2026, 9, 22, 20, 0, 0, 500).getTime()

  it('counts what you kept or merged after the export, not what auto-loot sold or stored, nor what a groupmate looted', () => {
    const { view, changed } = tally(
      exportAt,
      `
      [Thu Oct 22 20:00:00 2026] --You have looted a Star Ruby from a fetid fiend's corpse.--
      [Thu Oct 22 20:01:00 2026] --You have looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse.--
      [Thu Oct 22 20:02:00 2026] You looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse and sold it for free.
      [Thu Oct 22 20:03:00 2026] You looted an Apothic Crown +4 from a spite golem's corpse and stored it in your Dragon Hoard
      [Thu Oct 22 20:04:00 2026] --Kelwyn has looted a Bone Mask from a putrid skeleton's corpse.--
      [Thu Oct 22 20:05:00 2026] --You have looted a Shadow Rage Helm +4 from Cleric of Innoruuk's corpse.--
      [Thu Oct 22 20:06:00 2026] You looted an Indicolite Bracer +4 from Reward Chest to create an Indicolite Bracer +6`
    )
    // The line stamped in the export's own second is in the export.
    expect(changed).toEqual([false, true, false, false, false, true, true])
    expect(view.kept).toEqual([{ name: 'Shadow Rage Helm +4', count: 2, at: new Date(2026, 9, 22, 20, 5).getTime() }])
    expect(view.merged).toEqual([{ name: 'Indicolite Bracer +6', at: new Date(2026, 9, 22, 20, 6).getTime() }])
  })

  const item = (location: string, name: string) => ({ location, name, id: 1, count: 1, augs: [] })
  const inv: Inventory = {
    worn: [item('Wrist', 'Indicolite Bracer +3'), item('Wrist', 'Indicolite Bracer +5')],
    bags: [item('General 1-Slot1', 'Star Ruby')],
    bank: [],
    sharedBank: [],
    depot: [],
    keyRing: [{ kind: 'Equipment', name: 'Apothic Crown +2', id: 2 }]
  }

  it('adds the gear kept, a copy each, and raises the copy a merge most likely went into', () => {
    const isGear = (name: string) => !/Star Ruby/.test(name)
    const r = withLootSince(
      inv,
      {
        kept: [
          { name: 'Shadow Rage Helm +4', count: 2, at: 1 },
          { name: 'Star Ruby', count: 3, at: 1 }
        ],
        merged: [
          { name: 'Indicolite Bracer +6', at: 2 },
          { name: 'Shadow Rage Helm +5', at: 3 },
          { name: 'Apothic Crown +3', at: 4 },
          { name: 'Fungus Covered Scale Tunic +2', at: 5 }
        ]
      },
      isGear
    )
    expect(r.added.map((it) => [it.location, it.name])).toEqual([
      ['Looted', 'Shadow Rage Helm +5'],
      ['Looted', 'Shadow Rage Helm +4']
    ])
    expect(r.inventory.worn.map((it) => it.name)).toEqual(['Indicolite Bracer +3', 'Indicolite Bracer +6'])
    expect(r.inventory.keyRing[0].name).toBe('Apothic Crown +3')
    expect(r.raised).toBe(3)
    // The export itself is left as it was.
    expect(inv.worn[1].name).toBe('Indicolite Bracer +5')
    expect(inv.keyRing[0].name).toBe('Apothic Crown +2')
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
      value: '238p 9s 5c',
      vendors: [],
      sources: { drops: [{ zone: 'Plane of Sky', mobs: ['Gorgalosk'] }], foraged: [], crafted: false }
    })
    expect(parseItemUse('{{Itempage\n|notes = \n|statsblock = \nSlot: HEAD<br>\n}}')).toEqual({
      notes: '',
      quests: [],
      recipes: [],
      value: '',
      vendors: [],
      sources: { drops: [], foraged: [], crafted: false }
    })
    expect(plainText("'''Bold''' and [[a link|words]]<br>next")).toBe('Bold and words next')
  })
})

describe('loot pushed to a page (LT-369)', () => {
  const e = (id: number) => ({ id, item: `Item ${id}` }) as LootEntry
  const view = (ids: number[], addedOnly?: { oldest: number }): LootSnapshot => ({ entries: ids.map(e), coin: {}, reading: '', ...(addedOnly ? { addedOnly } : {}) })

  it('puts new entries on top of those the page has, dropping what main no longer keeps', () => {
    const had = view([5, 4, 3, 2])
    const next = mergeLoot(had, view([7, 6], { oldest: 3 }))
    expect(next.entries.map((x) => x.id)).toEqual([7, 6, 5, 4, 3])
    expect(next).not.toHaveProperty('addedOnly')
  })

  it('takes a whole list as it is, and a list of new ones as whole when it has nothing', () => {
    expect(mergeLoot(view([5, 4]), view([9])).entries.map((x) => x.id)).toEqual([9])
    expect(mergeLoot(null, view([9], { oldest: 1 })).entries.map((x) => x.id)).toEqual([9])
    // An entry sent again is not doubled.
    expect(mergeLoot(view([6, 5]), view([6], { oldest: 5 })).entries.map((x) => x.id)).toEqual([6, 5])
  })
})

describe('what loot is worth (LT-725, LT-744)', () => {
  const entry = (o: Partial<LootEntry>): LootEntry => ({
    id: 1,
    at: 0,
    zone: 'Plane of Fear',
    sessionId: 's1',
    looter: 'You',
    item: 'Bone Chips',
    base: 'Bone Chips',
    plus: 0,
    count: 1,
    source: 'a skeleton',
    outcome: 'kept',
    copper: 0,
    ...o
  })

  it("reads a merchant's offer, with this character's price", () => {
    expect(parseOffer("McNeal Jocub told you, 'I'll give you 1 silver 4 copper for the Dark Shield of Ebon.'", 5)).toEqual({
      item: 'Dark Shield of Ebon',
      merchant: 'McNeal Jocub',
      copper: 14,
      at: 5
    })
    expect(parseOffer("Aldric told you, 'thanks'", 5)).toBeNull()
  })

  it('prices by the last sale of the name, else the offer, else the wiki; a session sums what it kept', () => {
    const entries = [entry({ id: 3, base: 'Bone Chips', outcome: 'sold', copper: 30, count: 3 }), entry({ id: 2, base: 'Bone Chips', outcome: 'sold', copper: 99 })]
    const sales = lastSales(entries)
    expect(sales.get('bone chips')).toBe(10)
    const offers = { 'dark shield of ebon': { copper: 14 } }
    expect(itemWorth('Bone Chips', { sales, offers, wikiValue: '5s' })).toEqual({ copper: 10, from: 'sold' })
    expect(itemWorth('Dark Shield of Ebon', { sales, offers, wikiValue: '5s' })).toEqual({ copper: 14, from: 'offer' })
    expect(itemWorth('Rusty Axe', { sales, offers, wikiValue: '2g 8s 6c' })).toEqual({ copper: 286, from: 'wiki' })
    expect(itemWorth('Rusty Axe', { sales, offers })).toBeNull()
    const kept = [entry({ base: 'Bone Chips', count: 4 }), entry({ base: 'Unknown', count: 1 }), entry({ base: 'Bone Chips', outcome: 'sold', copper: 10 })]
    expect(sessionWorth(kept, (e) => itemWorth(e.base, { sales, offers }))).toEqual({ copper: 40, priced: 1, items: 2 })
  })
})

describe('drop rates per mob (FEAT-037)', () => {
  const e = (at: number, source: string, base: string, count = 1): LootEntry => ({
    id: at,
    at,
    zone: 'Befallen',
    sessionId: 's',
    looter: 'You',
    item: base,
    base,
    plus: 0,
    count,
    source,
    outcome: 'kept',
    copper: 0
  })
  it('counts kills from the fights kept and drops from the same span, by the corpse', () => {
    const fight = (startedAt: number, dead: string[]) => ({
      startedAt,
      enemies: Object.fromEntries(dead.map((d) => [d.toLowerCase(), false])),
      entities: Object.fromEntries(dead.map((d) => [d.toLowerCase(), { name: d } as never]))
    })
    const rows = dropRates(
      [e(50, 'a haunted chest', 'Mote of Major Potential'), e(150, 'a haunted chest', 'Mote of Major Potential', 3), e(160, 'a skeleton', 'Bone Chips')],
      [fight(100, ['a haunted chest']), fight(140, ['a haunted chest', 'a skeleton']), fight(170, ['a haunted chest']), fight(180, ['a haunted chest'])]
    )
    expect(rows).toEqual([
      { mob: 'a haunted chest', kills: 4, items: [{ item: 'Mote of Major Potential', n: 3, perKill: 0.75 }] },
      { mob: 'a skeleton', kills: 1, items: [{ item: 'Bone Chips', n: 1, perKill: 1 }] }
    ])
  })
})
