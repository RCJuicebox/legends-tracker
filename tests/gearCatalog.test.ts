import { describe, expect, it } from 'vitest'
import { CATALOG_PER_SLOT, catalogPieces, type CatalogPiecesInput } from '../src/core/gearCatalog'
import { PRESETS } from './helpers'
import { parseInventory } from '../src/core/inventory'
import type { CatalogItem } from '../src/core/wikiItem'

// The Gear optimizer's all-gear mode: what the character does not own that its classes may wear, the
// best dozen per slot, as they drop or at the merge level of what is worn there.

const item = (title: string, block: string, o: Partial<CatalogItem> = {}): CatalogItem => ({
  title,
  statsblock: block,
  icon: 0,
  focus: '',
  era: 'Classic',
  zones: [],
  mobs: [],
  quest: false,
  crafted: false,
  ...o
})
const ring = (title: string, ac: number, o: Partial<CatalogItem> = {}) => item(title, `Slot: FINGER<br>\nAC: ${ac}<br>\nClass: ALL<br>\nRace: ALL<br>`, o)

const worn = parseInventory(['Location\tName\tID\tCount\tSlots', 'Fingers\tPlain Ring +3\t1\t1\t10', 'Fingers\tOther Ring +5\t2\t1\t10'].join('\n')).worn

function input(items: CatalogItem[], o: Partial<CatalogPiecesInput> = {}): CatalogPiecesInput {
  return {
    items,
    hiddenEras: [],
    owned: new Set(),
    zones: new Map(),
    wearer: { classes: ['shd'], race: 'IKS', level: 50 },
    twoHanders: true,
    effectsOfItem: () => undefined,
    focusValue: () => 0,
    effects: null,
    weights: PRESETS.Tank,
    compare: 'drop',
    worn,
    hands: null,
    ...o
  }
}

describe("the optimizer's catalog pieces", () => {
  it('leaves out what is owned, summoned, not wearable or in a hidden era', () => {
    const pieces = catalogPieces(
      input(
        [
          ring('Better Ring', 10),
          ring('Owned Ring', 20),
          ring('Summoned: Ring', 90),
          item('Warrior Ring', 'Slot: FINGER<br>\nAC: 40<br>\nClass: WAR<br>\nRace: ALL<br>'),
          ring('Velious Ring', 50, { era: 'Velious' })
        ],
        { owned: new Set(['owned ring']), hiddenEras: ['Velious'] }
      )
    )
    expect(pieces.map((p) => p.item.name)).toEqual(['Better Ring'])
    expect(pieces[0]).toMatchObject({ from: 'catalog', key: 'better ring', stats: { ac: 10 } })
  })

  it('at the merge level of the weaker of a pair of worn slots, when asked', () => {
    const [p] = catalogPieces(input([ring('Better Ring', 10)], { compare: 'level' }))
    expect(p.item.name).toBe('Better Ring +3')
    expect(p.stats!.ac).toBeGreaterThan(10)
  })

  it('keeps the best dozen a slot, by stats and what its focus and worn effect are worth', () => {
    const many = Array.from({ length: CATALOG_PER_SLOT + 3 }, (_, i) => ring(`Ring ${i + 1}`, i + 1))
    const focused = ring('Focus Ring', 1, { focus: 'Extended Enhancement II' })
    const pieces = catalogPieces(input([...many, focused], { focusValue: (names) => (names.includes('Extended Enhancement II') ? 1000 : 0) }))
    expect(pieces).toHaveLength(CATALOG_PER_SLOT)
    expect(pieces.map((p) => p.item.name)).toContain('Focus Ring')
    expect(pieces.map((p) => p.item.name)).not.toContain('Ring 1')
    expect(pieces.find((p) => p.item.name === 'Focus Ring')?.foci).toEqual(['Extended Enhancement II'])
  })
})
