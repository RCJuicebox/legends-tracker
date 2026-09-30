import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultStatsInputs, readStatsInputs, type StatsInputs } from '../../src/core/statsInputs'
import { acInputs, acReport, autoValues, characterAc, classTrio, combatReport, primaryClass, valOf } from '../../src/core/statsModel'
import { statsFor, wornSummary } from '../../src/core/wornGear'
import type { InventoryView } from '../../src/shared/types'

// The Stats page's own path to the AC figures: a saved sheet, the game's soft cap table for the
// character's classes, and the worn gear, the way other pages ask for them (characterAc). The same
// in-game reading the AC test pins (stats.test.ts) comes out of it.
const reading = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'baseline-2026-09-12.json'), 'utf8'))
const inputs = reading.calculator_check.inputs

describe('the Stats sheet', () => {
  it('a saved sheet over the defaults: new fields filled, a broken class list or stance list put back', () => {
    expect(readStatsInputs(null)).toEqual(defaultStatsInputs())
    const s = readStatsInputs({ level: 47, classes: ['shd'], stances: [], skills: { 15: 200 }, overrides: { softCap: 400 } })
    expect(s.level).toBe(47)
    expect(s.classes).toEqual(['war', '', ''])
    expect(s.stances).toEqual(defaultStatsInputs().stances)
    expect(s.skills).toEqual({ 15: 200 })
    expect(s.overrides).toEqual({ softCap: 400 })
    // What it hands back is its own: changing it leaves the saved one alone.
    const saved = { overrides: { softCap: 400 } }
    readStatsInputs(saved).overrides.softCap = 1
    expect(saved.overrides.softCap).toBe(400)
  })

  it('classes once each, a warrior when none; the sturdiest class sets the soft cap', () => {
    expect(classTrio({ ...defaultStatsInputs(), classes: ['shd', 'shd', ''] })).toEqual(['shd'])
    expect(classTrio({ ...defaultStatsInputs(), classes: ['', '', ''] })).toEqual(['war'])
    const caps = { shd: { cap: 392, mult: 0.33 }, mnk: { cap: 360, mult: 0.3 }, shm: { cap: 348, mult: 0.28 } }
    expect(primaryClass(['mnk', 'shd', 'shm'], caps)).toBe('shd')
  })

  it('typed figures win over what the gear and tables fill in', () => {
    const s: StatsInputs = { ...defaultStatsInputs(), classes: ['shd', 'mnk', 'shm'], overrides: { itemAC: 999 } }
    const auto = autoValues(s, { shd: { cap: 392, mult: 0.33 } }, 'shd', { totals: { ac: 257 }, shield: true, shieldAC: 40 })
    expect(auto).toMatchObject({ itemAC: 257, shieldAC: 40, softCap: 392, multiplier: 0.33 })
    const val = valOf(s, auto)
    expect(val('itemAC')).toBe(999)
    expect(val('shieldAC')).toBe(40)
    expect(val('evasion')).toBe(0)
  })

  it("reproduces the Inventory window's AC from the sheet, the soft cap table and the worn gear", () => {
    const s: StatsInputs = {
      ...defaultStatsInputs(),
      classes: ['shd', 'mnk', 'shm'],
      level: reading.character.level,
      race: 'iksar',
      skills: { 15: inputs.defense_skill },
      agility: inputs.functional_agility,
      heroicAgility: inputs.heroic_agility,
      itemAvoidance: inputs.item_avoidance,
      weight: 14,
      overrides: { combatStability: inputs.spa_259_pct, evasion: inputs.spa_259_pct }
    }
    const caps = { shd: { cap: inputs.soft_cap_table, mult: inputs.post_cap_multiplier }, mnk: { cap: 360, mult: 0.3 }, shm: { cap: 348, mult: 0.28 } }
    const r = characterAc(s, caps, { totals: { ac: inputs.worn_ac }, shield: true, shieldAC: inputs.shield_ac })
    expect([r.mitigation, r.effCap, r.avoidance]).toEqual(reading.vitals.ac)
  })
})

describe("the AC and Combat tabs' reports", () => {
  it('the AC tab: the result, the notes it makes and a step for each figure', () => {
    const s: StatsInputs = { ...defaultStatsInputs(), classes: ['shd', 'mnk', 'shm'], skills: { 15: 200 }, agility: 150 }
    const caps = { shd: { cap: 392, mult: 0.33 } }
    const val = valOf(s, autoValues(s, caps, 'shd', { totals: { ac: 257 }, shield: false, shieldAC: 0 }))
    const rep = acReport(
      acInputs(s, classTrio(s), 'shd', val, (id) => s.skills[id] ?? 0),
      'shd'
    )
    expect(rep.r.mitigation).toBeGreaterThan(0)
    expect(rep.notes.some(([, title]) => title === 'No shield.')).toBe(true)
    expect(rep.rows.length).toBeGreaterThan(5)
  })

  it('the Combat tab: the Attack line the window shows (373 offense, 625 accuracy for skill 270, STR 230, offense 230)', () => {
    const s: StatsInputs = { ...defaultStatsInputs(), classes: ['mnk', 'shd', 'shm'], weapon: 28, strength: 230, skills: { 28: 270, 33: 230 } }
    const caps = { skills: [{ id: 28, cap: 270, from: 'mnk' }], ac: {} }
    const rep = combatReport(s, valOf(s, {} as never), classTrio(s), caps, (id) => s.skills[id as 28 | 33] ?? 0)
    expect(rep.weaponName).toBe('Hand to Hand')
    expect(rep.offense).toBe(373)
    expect(rep.acc).toBe(625)
    expect(rep.rows.length).toBeGreaterThan(3)
  })
})

describe('worn gear', () => {
  const view: InventoryView = {
    character: 'Kelwyn_neriak',
    file: 'Kelwyn_neriak-Inventory.txt',
    modified: 1,
    error: '',
    items: {
      'band of the ring': { title: 'Band of the Ring', found: true, statsblock: 'Slot: FINGER<br>\nAC: 20<br>\nSTR: +5  AGI: +5  HP: +5<br>' },
      'stout shield': { title: 'Stout Shield', found: true, statsblock: 'Slot: SECONDARY<br>\nAC: 12<br>' },
      'unknown thing': { title: 'Unknown Thing', found: false, statsblock: '' }
    },
    inventory: {
      worn: [
        { location: 'Fingers', name: 'Band of the Ring +2', id: 1, count: 1, augs: [] },
        { location: 'Secondary', name: 'Stout Shield', id: 2, count: 1, augs: [] },
        { location: 'Head', name: 'Unknown Thing', id: 3, count: 1, augs: [] }
      ],
      bags: [],
      bank: [],
      sharedBank: [],
      depot: [],
      keyRing: []
    } as unknown as InventoryView['inventory']
  }

  it('an item at its merge level, when the wiki knows it', () => {
    expect(statsFor(view.items, 'Band of the Ring +2')?.ac).toBeGreaterThan(20)
    expect(statsFor(view.items, 'Unknown Thing')).toBeNull()
    expect(statsFor(view.items, 'Nothing at all')).toBeNull()
  })

  it('adds up what is worn, a shield by its name unless the sheet says otherwise, and typed AC over the wiki', () => {
    const w = wornSummary(view, null)
    expect(w.shieldByName).toBe(true)
    expect(w.shield).toBe(true)
    expect(w.shieldAC).toBe(12)
    expect(w.totals.ac).toBeGreaterThan(32)
    const typed = wornSummary(view, { acOverrides: { 'stout shield': 30 }, shield: false } as never)
    expect(typed.shield).toBe(false)
    expect(typed.shieldAC).toBe(0)
  })
})
