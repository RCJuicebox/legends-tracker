import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/main/storeCore'
import { moveRemembered, type KeptStorage } from '../src/renderer/src/movedSettings'

// What the window's local storage held before the faction plan and the Live page's checklist were
// kept in settings.json: moved there once.

function storage(items: Record<string, string>): KeptStorage {
  const keys = Object.keys(items)
  return { length: keys.length, key: (i) => keys[i] ?? null, getItem: (k) => (Object.hasOwn(items, k) ? items[k] : null) }
}

describe('moving what local storage held into settings.json', () => {
  it('moves the assumptions, each character’s choices and the checklist flags, and names the keys to forget', () => {
    const choices = { locks: { 'Guards of Qeynos': 'a1' }, excluded: ['a2'], perHour: { a3: 20 } }
    const { settings, keys } = moveRemembered(
      defaultSettings(),
      storage({
        'lt:factions.plan.settings': JSON.stringify({ travelMin: 12 }),
        'lt:factions.plan.Tester_neriak': JSON.stringify(choices),
        'lt:factions.plan.Tester_qeynos': JSON.stringify({ locks: {}, excluded: [], perHour: {} }),
        'lt:setup.hidden': 'true',
        'lt:setup.accepted': JSON.stringify(['sound']),
        'lt:setup.arranged': 'true',
        'lt:factions.view': JSON.stringify('plan')
      })
    )
    expect(settings.factionPlan).toEqual({ assumptions: { travelMin: 12 }, choices: { Tester_neriak: choices } })
    expect(settings.setup).toEqual({ hidden: true, accepted: ['sound'], arranged: true })
    // Only what moved goes; the page and tab choices stay in the window's storage.
    expect(keys.sort()).toEqual(
      ['lt:factions.plan.Tester_neriak', 'lt:factions.plan.Tester_qeynos', 'lt:factions.plan.settings', 'lt:setup.accepted', 'lt:setup.arranged', 'lt:setup.hidden'].sort()
    )
  })

  it('leaves what settings.json already has, and drops what cannot be read', () => {
    const s = defaultSettings()
    s.factionPlan = { assumptions: { travelMin: 5 }, choices: { Tester_neriak: { locks: {}, excluded: ['kept'], perHour: {} } } }
    s.setup = { hidden: false, accepted: ['sound'], arranged: true }
    const { settings, keys } = moveRemembered(
      s,
      storage({
        'lt:factions.plan.settings': JSON.stringify({ travelMin: 12 }),
        'lt:factions.plan.Tester_neriak': JSON.stringify({ excluded: ['old'] }),
        'lt:factions.plan.Tester_qeynos': '{ not json',
        'lt:setup.hidden': 'false',
        'lt:setup.accepted': JSON.stringify(['sound', 'log', 4])
      })
    )
    expect(settings.factionPlan).toEqual(s.factionPlan)
    expect(settings.setup).toEqual({ hidden: false, accepted: ['sound', 'log'], arranged: true })
    expect(keys).toHaveLength(5)
  })

  it('changes nothing when there is nothing to move', () => {
    const s = defaultSettings()
    const moved = moveRemembered(s, storage({ 'lt:factions.view': '"plan"', other: '1' }))
    expect(moved.settings).toBe(s)
    expect(moved.keys).toEqual([])
  })
})
