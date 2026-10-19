import { describe, expect, it } from 'vitest'
import { judgeOwned } from '../../src/core/gearJudge'
import type { CatalogItem } from '../../src/core/wikiItem'

describe('keep, sell or merge fodder (FEAT-034)', () => {
  const item = (title: string, block: string) => ({ title, statsblock: block }) as unknown as CatalogItem
  const catalog = new Map([
    ['cloak of flames', item('Cloak of Flames', 'Slot: BACK<br>Class: ALL<br>AC: 10')],
    ['warrior ring', item('Warrior Ring', 'Slot: FINGERS<br>Class: WAR<br>AC: 2')]
  ])
  const base = { worn: ['Cloak of Flames +5'], picks: new Set<string>(), catalog, wearer: { classes: ['mnk', 'shd'], race: '', level: 100 }, wanted: new Set<string>() }

  it('keeps what is worn, put on by the best set, or a starred recipe takes', () => {
    expect(judgeOwned({ ...base, name: 'Cloak of Flames +5', kind: 'worn' })?.verdict).toBe('keep')
    expect(judgeOwned({ ...base, name: 'Warrior Ring', kind: 'bags', picks: new Set(['Warrior Ring']) })?.why).toBe('the best set wears it')
    expect(judgeOwned({ ...base, name: 'Bone Chips', kind: 'bank', wanted: new Set(['bone chips']) })?.verdict).toBe('keep')
  })

  it('calls a second copy of a worn item fodder, and sells what none of your classes can wear', () => {
    expect(judgeOwned({ ...base, name: 'Cloak of Flames', kind: 'bags' })).toEqual({ verdict: 'fodder', why: 'merges your worn Cloak of Flames +5 up to +6' })
    expect(judgeOwned({ ...base, name: 'Warrior Ring', kind: 'bank', value: '4g' })).toEqual({ verdict: 'sell', why: 'none of your classes can wear it; it sells for 4g' })
    // Not equipment the wiki knows: not the app's to judge.
    expect(judgeOwned({ ...base, name: 'Tattered Note', kind: 'bags' })).toBeNull()
  })
})
