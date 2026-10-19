import { canWear, restrictions, ANY_SLOT, type Wearer } from './gearFinder'
import { itemKey, mergeLevel } from './inventory'
import type { CatalogItem } from './wikiItem'

// Keep, sell or merge fodder (FEAT-034): a word on each owned piece on Gear's "Where everything is",
// from what the app already knows. Worn, or put on by the optimiser's best set: keep. A second copy of
// a worn item: fodder, to merge the worn one up a level. A piece of equipment none of the character's
// classes can wear, that no starred recipe takes: sell, at the wiki's merchant value. Anything else
// gets no word: a quest item or a tradeskill one is not the app's to judge.

export type Verdict = { verdict: 'keep' | 'fodder' | 'sell'; why: string }

export function judgeOwned(o: {
  name: string
  kind: 'worn' | 'bags' | 'bank' | 'keyring'
  worn: readonly string[]
  /** Names the optimiser's best set would put on. */
  picks: ReadonlySet<string>
  /** The wiki's equipment, by item key. */
  catalog: ReadonlyMap<string, CatalogItem>
  wearer: Wearer | null
  /** Item keys a starred recipe takes. */
  wanted: ReadonlySet<string>
  /** The wiki's merchant value, when known. */
  value?: string
}): Verdict | null {
  const k = itemKey(o.name)
  if (o.kind === 'worn') return { verdict: 'keep', why: 'worn' }
  if (o.picks.has(o.name)) return { verdict: 'keep', why: 'the best set wears it' }
  if (o.wanted.has(k)) return { verdict: 'keep', why: 'a starred recipe takes it' }
  const twin = o.worn.find((w) => itemKey(w) === k)
  if (twin && mergeLevel(twin) < 10 && o.catalog.has(k)) return { verdict: 'fodder', why: `merges your worn ${twin} up to +${mergeLevel(twin) + 1}` }
  const item = o.catalog.get(k)
  if (item && o.wearer?.classes.length && !canWear(restrictions(item.statsblock), o.wearer, ANY_SLOT))
    return { verdict: 'sell', why: `none of your classes can wear it${o.value ? `; it sells for ${o.value}` : ''}` }
  return null
}
