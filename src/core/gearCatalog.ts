import { itemKey, mergeLevel, parseStatsBlock, scaledStats, type InvItem } from './inventory'
import { canWear, eraOf, isLore, isTwoHanded, restrictions, score, weightsForSlot, type HandWeights, type Wearer, type Weights } from './upgrades'
import { SLOT_LAYOUT, type EffectValue, type Piece } from './gearOptimizer'
import type { CatalogItem } from './wikiItem'

// The optimizer's all-gear mode: pieces the character does not own that one of their classes may
// wear, from the eras shown. As the finder has them: as they drop (+0), or at the merge level of
// what is worn in the slot (the lower of a pair), one piece a level. Each slot keeps its best dozen
// by stats, focus and effects; the search picks among those and what is owned.

export const HANDS = ['Primary', 'Secondary']
/** Each kind of slot once; the Any slots take what the others do. */
const SLOT_NAMES = [...new Set(SLOT_LAYOUT)].filter((s) => s !== 'Any Slot')
export const CATALOG_PER_SLOT = 12

export interface CatalogPiecesInput {
  /** The wiki's catalog, eras and race lines put right. */
  items: CatalogItem[]
  /** Eras the era buttons hide. */
  hiddenEras: string[]
  /** Item keys the character owns (worn, carried, stored, on the pet, and their exaltations). */
  owned: Set<string>
  zones: Map<string, string>
  eraStatus?: Record<string, 'in' | 'out'>
  wearer: Wearer
  twoHanders: boolean
  /** An item's own worn effect and proc, by name. */
  effectsOfItem: (name: string) => { worn: string; proc: string } | undefined
  focusValue: (names: string[]) => number
  effects: EffectValue | null
  weights: Weights
  compare: 'drop' | 'level'
  /** What is worn now, for the merge level a slot's pieces are judged at. */
  worn: InvItem[]
  hands: HandWeights | null
}

/** The best of what is not owned, slot by slot, for the optimizer's all-gear mode. */
export function catalogPieces(o: CatalogPiecesInput): Piece[] {
  const { items, owned, zones, eraStatus, wearer, twoHanders, effectsOfItem, weights } = o
  const hidden = new Set(o.hiddenEras)
  const best = new Map<string, { p: Piece; v: number }[]>()
  const slotLevel = new Map<string, number>()
  if (o.compare === 'level')
    for (const s of SLOT_NAMES) {
      const levels = o.worn.filter((w) => w.location === s).map((w) => mergeLevel(w.name))
      slotLevel.set(s, levels.length ? Math.min(...levels) : 0)
    }
  for (const c of items) {
    const key = itemKey(c.title)
    if (owned.has(key) || /^Summoned:/i.test(c.title)) continue
    if (hidden.has(eraOf(c, zones, eraStatus).era)) continue
    const r = restrictions(c.statsblock)
    const slots = SLOT_NAMES.filter((s) => canWear(r, wearer, s) && !(s === 'Primary' && isTwoHanded(r) && !twoHanders))
    if (!slots.length) continue
    const fx = effectsOfItem(c.title)
    const base = parseStatsBlock(c.statsblock)
    const atLevel = new Map<number, Piece>()
    const pieceAt = (level: number): Piece => {
      let p = atLevel.get(level)
      if (!p) {
        const name = level ? `${c.title} +${level}` : c.title
        atLevel.set(level, (p = {
          item: { location: 'Catalog', name, id: 0, count: 1, augs: [] }, from: 'catalog', key, r, stats: level ? scaledStats(base, level) : base,
          foci: c.focus ? [c.focus] : [], worn: fx?.worn ? [fx.worn] : [], procs: fx?.proc ? [fx.proc] : [], lore: isLore(c.statsblock)
        }))
      }
      return p
    }
    const extra = (c.focus ? o.focusValue([c.focus]) : 0) + (o.effects && fx?.worn ? o.effects.worn([fx.worn]) : 0)
    for (const s of slots) {
      const p = pieceAt(slotLevel.get(s) ?? 0)
      const proc = o.effects && fx?.proc && HANDS.includes(s) ? o.effects.proc(fx.proc) : 0
      const v = score(p.stats!, weightsForSlot(weights, s, o.hands)) + extra + proc
      const list = best.get(s) ?? []
      list.push({ p, v })
      best.set(s, list)
    }
  }
  const keep = new Set<Piece>()
  for (const list of best.values()) for (const { p } of list.sort((a, b) => b.v - a.v).slice(0, CATALOG_PER_SLOT)) keep.add(p)
  return [...keep]
}
