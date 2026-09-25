// Tradeskills, for the consumables a player keeps making: a recipe's ingredients, how many of each
// the character has, where to buy them, and what a batch costs.
//
// Recipes come from eqlwiki: the tradeskill pages' tables for the list, and the product's own item
// page ("playercrafted") for the exact recipe and how many a combine yields. Vendors come from each
// ingredient's page ("soldby"). Prices are what the player paid, from their log's
// "You purchased 100 Small Vial from Kizzie Mintopp for 1 platinum." lines; failing that, the wiki's
// merchant value, which is what a vendor asks at best.

import { linkTexts, field } from './wikiItem'
export { parseVendors, type Vendor } from './wikiItem'
import { parseWikiTables } from './wikiTable'
import { parseCoin } from './loot'

export interface Ingredient {
  name: string
  count: number
}

export interface Recipe {
  /** What it makes: the product's page title. */
  product: string
  skill: string
  trivial: number
  /** Items one combine makes; 1 when the wiki does not say. */
  yields: number
  ingredients: Ingredient[]
  /** 'page' when read from the product's own page, 'table' from a tradeskill page's table. */
  from: 'page' | 'table'
}

/** The tradeskill pages whose tables list recipes. */
export const TRADESKILL_PAGES = [
  'Skill Alchemy', 'Skill Baking', 'Skill Blacksmithing', 'Skill Brewing', 'Skill Fletching', 'Skill Jewelcrafting', 'Skill Pottery',
  'Skill Tailoring', 'Skill Tinkering'
]

export const skillOf = (page: string) => page.replace(/^Skill /, '')

/** Adds up a list that names an ingredient more than once ("Small Vial + Small Vial …"). */
function tally(parts: Ingredient[]): Ingredient[] {
  const out = new Map<string, Ingredient>()
  for (const p of parts) {
    const k = p.name.toLowerCase()
    const had = out.get(k)
    if (had) had.count += p.count
    else out.set(k, { ...p })
  }
  return [...out.values()]
}

/** "[[Small Vial]] x 5", "2x [[Sickle Leaf]]", "[[Comfrey]]": the item and how many. */
function ingredientOf(text: string): Ingredient | null {
  const name = linkTexts(text)[0]
  if (!name) return null
  const n = /\bx\s*(\d+)\b/i.exec(text.replace(/\[\[[^\]]*\]\]/g, ' ')) ?? /\b(\d+)\s*x\b/i.exec(text.replace(/\[\[[^\]]*\]\]/g, ' '))
  return { name, count: n ? Number(n[1]) : 1 }
}

/**
 * The recipes on a product's page:
 *   * [[Skill Alchemy|Alchemy]] (Trivial: 302, yields 5)
 *   ** [[Comfrey]] + [[Deepwater Ink]] + [[Katuka Bark]] + [[Small Vial]] x 5
 */
export function parseCrafted(product: string, content: string): Recipe[] {
  const out: Recipe[] = []
  let head: { skill: string; trivial: number; yields: number } | null = null
  for (const line of field(content, 'playercrafted').split('\n')) {
    const t = line.trim()
    if (t.startsWith('**') && head) {
      const ingredients = tally(t.replace(/^\*+/, '').split(/\s\+\s/).map(ingredientOf).filter((x): x is Ingredient => !!x))
      if (ingredients.length) out.push({ product, ...head, ingredients, from: 'page' })
    } else if (t.startsWith('*')) {
      const skill = linkTexts(t)[0] ?? ''
      head = { skill: skill.replace(/^Skill /, ''), trivial: Number(/trivial:?\s*(\d+)/i.exec(t)?.[1] ?? 0), yields: Number(/yields?\s*(\d+)/i.exec(t)?.[1] ?? 1) }
    }
  }
  return out
}

/**
 * A tradeskill page's tables: each row with a trivial and at least two items is a recipe, the first
 * item made from the rest. The tables lay out differently page to page; anything else in a row (a
 * category, a note) is not a link and is passed over.
 */
export function parseSkillPage(page: string, wikitext: string): Recipe[] {
  const skill = skillOf(page)
  const out: Recipe[] = []
  for (const t of parseWikiTables(wikitext)) {
    for (const row of t.rows) {
      const trivialCell = row.find((c) => /^\s*\d+(?:\s*-\s*\d+)?\s*$/.test(c))
      const items = row.filter((c) => /\[\[/.test(c))
      if (!trivialCell || items.length < 2) continue
      const product = linkTexts(items[0])[0]
      if (!product || /^(Skill |Category:|File:)/i.test(product)) continue
      const ingredients = tally(items.slice(1).flatMap((c) => c.split(/\s\+\s/).map(ingredientOf).filter((x): x is Ingredient => !!x)))
      if (!ingredients.length) continue
      out.push({ product, skill, trivial: Math.max(...trivialCell.split('-').map(Number)), yields: 1, ingredients, from: 'table' })
    }
  }
  return out
}

/** A recipe's identity: its product and what goes in, so two recipes for one product stay apart. */
export const recipeKey = (r: Pick<Recipe, 'product' | 'ingredients'>) =>
  `${r.product.toLowerCase()}|${r.ingredients.map((i) => `${i.name.toLowerCase()}x${i.count}`).sort().join('+')}`

/** Every recipe once, by product: the same product in two tables is kept once, the higher trivial winning ties. */
export function recipeIndex(lists: Recipe[][]): Recipe[] {
  const out = new Map<string, Recipe>()
  for (const r of lists.flat()) {
    const k = recipeKey(r)
    const had = out.get(k)
    if (!had || r.trivial > had.trivial) out.set(k, r)
  }
  return [...out.values()].sort((a, b) => a.product.localeCompare(b.product) || a.trivial - b.trivial)
}

// ---- prices ----

/** The wiki's shorthand coin, "4g 7s 6c" or "35p" or "1.2pp", in copper; 0 when there is none. */
export function parseWikiCoin(text: string): number {
  let copper = 0
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(pp|p|gp|g|sp|s|cp|c)\b/gi)) {
    const n = Number(m[1])
    const u = m[2][0].toLowerCase()
    copper += n * (u === 'p' ? 1000 : u === 'g' ? 100 : u === 's' ? 10 : 1)
  }
  return Math.round(copper)
}

// ---- what the player paid ----

export interface Purchase {
  item: string
  count: number
  merchant: string
  /** What the lot cost, in copper. */
  copper: number
  at: number
}

const RE_PURCHASE = /^You purchased (?:(\d+) )?(.+?) from (.+?) for\s+(.+)\.$/

/** "You purchased 100 Small Vial from Kizzie Mintopp for  1 platinum." */
export function parsePurchase(text: string, at: number): Purchase | null {
  const m = RE_PURCHASE.exec(text)
  if (!m) return null
  const copper = parseCoin(m[4])
  const count = Number(m[1] ?? 1) || 1
  return { item: m[2].replace(/^an? /i, ''), count, merchant: m[3], copper, at }
}

/** The price of one, from the last purchase of it. */
export const unitPrice = (p: Pick<Purchase, 'count' | 'copper'>) => p.copper / p.count

// ---- a batch ----

export type PriceSource = 'paid' | 'typed' | 'wiki' | 'none'

export interface ShoppingLine {
  name: string
  perCombine: number
  need: number
  have: number
  toBuy: number
  /** Copper for one; 0 when not known. */
  unit: number
  priceFrom: PriceSource
  /** What the ones still to buy cost. */
  cost: number
}

export interface Shopping {
  lines: ShoppingLine[]
  /** Combines the ingredients on hand make. */
  canMake: number
  /** What buying everything still missing costs, in copper, counting only known prices. */
  toBuy: number
  /** What the whole batch costs at these prices, ingredients on hand included. */
  batch: number
  /** One product, at these prices. */
  each: number
  /** Something still to buy has no known price, so the total to buy is short. */
  unpriced: boolean
}

export function shopping(r: Recipe, combines: number, have: (name: string) => number, price: (name: string) => { unit: number; from: PriceSource }): Shopping {
  const lines = r.ingredients.map((i): ShoppingLine => {
    const h = have(i.name)
    const need = i.count * combines
    const toBuy = Math.max(0, need - h)
    const p = price(i.name)
    return { name: i.name, perCombine: i.count, need, have: h, toBuy, unit: p.unit, priceFrom: p.from, cost: toBuy * p.unit }
  })
  const batch = lines.reduce((s, l) => s + l.need * l.unit, 0)
  return {
    lines,
    canMake: Math.min(...r.ingredients.map((i) => Math.floor(have(i.name) / i.count))),
    toBuy: lines.reduce((s, l) => s + l.cost, 0),
    batch,
    each: combines > 0 ? batch / (combines * Math.max(1, r.yields)) : 0,
    unpriced: lines.some((l) => l.priceFrom === 'none' && l.toBuy > 0)
  }
}
