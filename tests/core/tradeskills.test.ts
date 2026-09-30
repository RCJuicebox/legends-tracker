import { describe, expect, it } from 'vitest'
import { eraOf } from '../../src/core/gearFinder'
import {
  craftEras,
  parseCrafted,
  parsePurchase,
  parseSkillPage,
  parseVendors,
  parseWikiCoin,
  recipeIndex,
  recipeKey,
  shopping,
  unitPrice,
  type Recipe
} from '../../src/core/tradeskills'
import { parseInventory } from '../../src/core/inventory'
import { parseSources } from '../../src/core/wikiItem'

// Purchase and inventory lines are the game's own (Kelwyn's, September 2026). Wiki snippets are made
// up in the layout eqlwiki's pages use; no wiki text is kept in this repo.

describe('recipes from the wiki', () => {
  it('reads a product page’s recipe and yield, adding up repeated ingredients', () => {
    const page = `{{Itempage
|itemname = Test Draught
|playercrafted =

* [[Skill Alchemy|Alchemy]] (Trivial: 120, yields 5)
** [[Small Vial]] + [[Small Vial]] + [[Small Vial]] + [[Herb A]]
* [[Skill Brewing|Brewing]] (Trivial: 40)
** 2x [[Water Flask]] + [[Herb B]] x 3

}}</onlyinclude>`
    expect(parseCrafted('Test Draught', page)).toEqual([
      {
        product: 'Test Draught',
        skill: 'Alchemy',
        trivial: 120,
        yields: 5,
        ingredients: [
          { name: 'Small Vial', count: 3 },
          { name: 'Herb A', count: 1 }
        ],
        from: 'page'
      },
      {
        product: 'Test Draught',
        skill: 'Brewing',
        trivial: 40,
        yields: 1,
        ingredients: [
          { name: 'Water Flask', count: 2 },
          { name: 'Herb B', count: 3 }
        ],
        from: 'page'
      }
    ])
  })

  it('reads a tradeskill page’s tables, whatever columns sit between the items', () => {
    const page = `
{| class="wikitable"
! Trivial !! Recipe !! Kind !! Ingredient 1 !! Ingredient 2 !! Ingredient 3
|-
| 244 || [[Test Elixir]] || Buff || [[Sap]] || [[Vine]] ||
|-
| 151-212 || [[Test Tonic]] || Utility || [[Sap]] || [[Small Vial]] x5 ||
|-
| notes || [[Not A Recipe]] || only one item || || ||
|}`
    const r = parseSkillPage('Skill Alchemy', page)
    expect(r.map((x) => [x.product, x.trivial, x.ingredients])).toEqual([
      [
        'Test Elixir',
        244,
        [
          { name: 'Sap', count: 1 },
          { name: 'Vine', count: 1 }
        ]
      ],
      [
        'Test Tonic',
        212,
        [
          { name: 'Sap', count: 1 },
          { name: 'Small Vial', count: 5 }
        ]
      ]
    ])
    expect(r[0]).toMatchObject({ skill: 'Alchemy', yields: 1, from: 'table' })
  })

  it('keeps each recipe once', () => {
    const a: Recipe = { product: 'X', skill: 'Alchemy', trivial: 10, yields: 1, ingredients: [{ name: 'A', count: 1 }], from: 'table' }
    const b: Recipe = { ...a, trivial: 20 }
    const c: Recipe = { ...a, ingredients: [{ name: 'B', count: 1 }] }
    const idx = recipeIndex([[a], [b, c]])
    expect(idx).toHaveLength(2)
    expect(idx.find((r) => recipeKey(r) === recipeKey(a))?.trivial).toBe(20)
  })

  it('reads who sells an ingredient', () => {
    const page = `|soldby =

{{ItemWhereTable|
{{ItemWhereRow   | [[Rivervale]]      | [[Kizzie Mintopp]]          |               |  }}
{{ItemWhereRow   | [[Neriak - Foreign Quarter]] | [[Gambel Quick]] | Gambels Greens, far north | (253, -59) }}
{{ItemWhereRowVel| [[Cabilis|West Cabilis]] | [[Jaxxtz]] | | (-41, 513) }}
}}

}}</onlyinclude>`
    expect(parseVendors(page)).toEqual([
      { zone: 'Rivervale', npc: 'Kizzie Mintopp', note: '' },
      { zone: 'Neriak - Foreign Quarter', npc: 'Gambel Quick', note: 'Gambels Greens, far north' },
      { zone: 'West Cabilis', npc: 'Jaxxtz', note: '' }
    ])
  })

  it('reads the wiki’s coin shorthand', () => {
    expect(parseWikiCoin('4g 7s 6c')).toBe(476)
    expect(parseWikiCoin('1s')).toBe(10)
    expect(parseWikiCoin('35p from vendor')).toBe(35_000)
    expect(parseWikiCoin('0.524pp')).toBe(524)
    expect(parseWikiCoin('')).toBe(0)
  })
})

describe('what was paid', () => {
  it('reads purchases from the log', () => {
    const p = parsePurchase('You purchased 100 Small Vial from Kizzie Mintopp for  1 platinum.', 5)!
    expect(p).toEqual({ item: 'Small Vial', count: 100, merchant: 'Kizzie Mintopp', copper: 1000, at: 5 })
    expect(unitPrice(p)).toBe(10)
    expect(parsePurchase('You purchased 5 Heliotrope from Sithgok for  246 platinum 8 gold 8 silver.', 0)).toMatchObject({ item: 'Heliotrope', count: 5, copper: 246_880 })
    expect(parsePurchase('You purchased a Medicine Bag from Sithgok for  2 gold.', 0)).toMatchObject({ item: 'Medicine Bag', count: 1, copper: 200 })
    expect(parsePurchase('You looted a Small Vial from a gnoll.', 0)).toBeNull()
  })
})

describe('a batch', () => {
  const r: Recipe = {
    product: 'Distillate',
    skill: 'Alchemy',
    trivial: 302,
    yields: 5,
    from: 'page',
    ingredients: [
      { name: 'Comfrey', count: 1 },
      { name: 'Katuka Bark', count: 1 },
      { name: 'Small Vial', count: 5 }
    ]
  }
  const have: Record<string, number> = { Comfrey: 12, 'Katuka Bark': 3, 'Small Vial': 800 }
  const prices: Record<string, number> = { Comfrey: 35_000, 'Katuka Bark': 524, 'Small Vial': 10 }

  it('counts what to buy and what it costs', () => {
    const s = shopping(
      r,
      10,
      (n) => have[n] ?? 0,
      (n) => ({ unit: prices[n], from: 'paid' })
    )
    expect(s.canMake).toBe(3)
    expect(s.lines.map((l) => [l.name, l.need, l.toBuy, l.cost])).toEqual([
      ['Comfrey', 10, 0, 0],
      ['Katuka Bark', 10, 7, 7 * 524],
      ['Small Vial', 50, 0, 0]
    ])
    expect(s.toBuy).toBe(7 * 524)
    expect(s.batch).toBe(10 * 35_000 + 10 * 524 + 50 * 10)
    expect(s.each).toBeCloseTo(s.batch / 50, 6)
    expect(s.unpriced).toBe(false)
  })

  it('says when a price is missing', () => {
    const s = shopping(
      r,
      1,
      () => 0,
      (n) => (n === 'Comfrey' ? { unit: 0, from: 'none' } : { unit: prices[n], from: 'wiki' })
    )
    expect(s.unpriced).toBe(true)
    expect(s.toBuy).toBe(524 + 50)
  })
})

describe('the tradeskill depot', () => {
  it('is read from the inventory export', () => {
    const inv = parseInventory(
      [
        'Location\tName\tID\tCount\tSlots',
        'General 1\tSmall Vial\t13\t100\t0',
        'Personal-Depot1\tImp Blood\t7885\t972\t10',
        'Personal-Depot2\tEssence of Fire\t7886\t303\t10'
      ].join('\n')
    )
    expect(inv.depot.map((i) => [i.name, i.count])).toEqual([
      ['Imp Blood', 972],
      ['Essence of Fire', 303]
    ])
    expect(inv.bags).toHaveLength(1)
  })
})

describe('where an item comes from', () => {
  it('reads drops by zone, forage and crafting from an item page', () => {
    const page = `{{Itempage
|itemname = Test Ink
|dropsfrom =

[[Kedge Keep]]

* [[a test mermaid]]
* [[a test seahorse]]

[[Siren's Grotto]]

* [[a test walrus]]

|foraged =
* [[Everfrost Peaks]]
|recipes =

* [[Alchemy]]

}}</onlyinclude>`
    expect(parseSources(page)).toEqual({
      drops: [
        { zone: 'Kedge Keep', mobs: ['a test mermaid', 'a test seahorse'] },
        { zone: "Siren's Grotto", mobs: ['a test walrus'] }
      ],
      foraged: ['Everfrost Peaks'],
      crafted: false
    })
  })
})

describe('crafted items and their eras', () => {
  // eqlwiki's Enchanted Dwarven Plate Greaves page, 2026-09-27: one ingredient a line, under markers.
  const greaves = `<onlyinclude>{{Itempage
|itemname    = Enchanted Dwarven Plate Greaves
|playercrafted = 

* [[Blacksmithing]] (Trivial: 208)
** '''Yield: Enchanted Dwarven Plate Greaves''' x1
** In [[Forge|Stormguard Forge]]:
:: {{SmIcon|567}} 1 x [[Dwarven Smithy Hammer]] - Bought, Returned on Failure, Returned on Success
:: {{SmIcon|703}} 1 x [[Earthen Temper]] - Crafted
:: {{SmIcon|620}} 1 x [[Enchanted Brellium Jointing]] - Crafted
:: {{SmIcon|1036}} 3 x [[Enchanted Folded Brellium Sheet]] - Crafted
:: {{SmIcon|555}} 1 x [[Leather Padding]] - Crafted
:: {{SmIcon|1151}} 1 x [[Small Plate Greaves Mold]] - Bought
}}</onlyinclude>`

  it('reads a recipe laid out one ingredient a line, the container left out', () => {
    expect(parseCrafted('Enchanted Dwarven Plate Greaves', greaves)).toEqual([
      {
        product: 'Enchanted Dwarven Plate Greaves',
        skill: 'Blacksmithing',
        trivial: 208,
        yields: 1,
        from: 'page',
        ingredients: [
          { name: 'Dwarven Smithy Hammer', count: 1 },
          { name: 'Earthen Temper', count: 1 },
          { name: 'Enchanted Brellium Jointing', count: 1 },
          { name: 'Enchanted Folded Brellium Sheet', count: 3 },
          { name: 'Leather Padding', count: 1 },
          { name: 'Small Plate Greaves Mold', count: 1 }
        ]
      }
    ])
  })

  const recipes = [
    ...parseCrafted('Enchanted Dwarven Plate Greaves', greaves),
    { product: 'Enchanted Folded Brellium Sheet', ingredients: [{ name: 'Enchanted Block of Brellium', count: 1 }] },
    // Two ways to make a tonic: one needs a Luclin herb, the other nothing out of the ordinary.
    { product: 'Tonic', ingredients: [{ name: 'Luclin Herb', count: 1 }] },
    { product: 'Tonic', ingredients: [{ name: 'Water', count: 1 }] },
    // A loop: each made from the other.
    { product: 'Loop A', ingredients: [{ name: 'Loop B', count: 1 }] },
    { product: 'Loop B', ingredients: [{ name: 'Loop A', count: 1 }] }
  ]
  const eras = {
    'Enchanted Dwarven Plate Greaves': '',
    'Small Plate Greaves Mold': 'Epics',
    'Enchanted Block of Brellium': 'Classic',
    'Luclin Herb': 'Luclin',
    Water: '',
    'Leather Padding': '',
    'Earthen Temper': ''
  }

  it('takes an untagged product’s eras from its ingredients, down its recipes, the fewest-era recipe first', () => {
    const made = craftEras(recipes, eras)
    expect(made['Enchanted Dwarven Plate Greaves']).toEqual(['Classic', 'Epics'])
    expect(made['Enchanted Folded Brellium Sheet']).toEqual(['Classic'])
    expect(made.Tonic).toBeUndefined()
    expect(made['Loop A']).toBeUndefined()
  })

  it('puts a crafted item in the latest era its ingredients need', () => {
    const made = craftEras(recipes, eras)
    const item = (title: string) => ({ title, statsblock: '', icon: 0, focus: '', era: '', zones: [], mobs: [], quest: false, crafted: true, craftEras: made[title] })
    // Epics counts as Kunark, which is out of era.
    expect(eraOf(item('Enchanted Dwarven Plate Greaves'), new Map())).toEqual({ era: 'Kunark', inferred: true, by: 'recipe' })
    expect(eraOf(item('Enchanted Folded Brellium Sheet'), new Map())).toEqual({ era: 'Classic', inferred: true, by: 'recipe' })
    // One that also drops in a Classic zone can be had there, whatever its recipe needs.
    const dropped = { ...item('Enchanted Dwarven Plate Greaves'), zones: ['Kaladim'] }
    expect(eraOf(dropped, new Map([['Kaladim', 'Classic']]))).toEqual({ era: 'Classic', inferred: true, by: 'zone' })
  })
})
