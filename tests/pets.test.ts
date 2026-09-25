import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  optimizePetGear, parsePetGuide, parseSummonPage, petMelee, petSlots, petSwing, PetGearReader, weaponDamageBonus,
  type PetGearReading, type PetMelee, type PetPiece
} from '../src/core/pets'
import { parseLogLine } from '../src/core/logLine'
import { parseWikiTables } from '../src/core/wikiTable'
import { parseStatsBlock, type ItemStats } from '../src/core/inventory'
import { restrictions } from '../src/core/upgrades'
import { scanPetLog } from '../src/main/pets'

// The gear list is the log's own (Kelwyn's, 2026-09-25). The wiki snippets are made up, in the
// layout the eqlwiki pet pages use; no wiki text is kept in this repo.

const GEAR_LINES = `[Fri Sep 25 12:19:36 2026] Your pet has the following items equipped:
[Fri Sep 25 12:19:36 2026] Arms: Lustrous Russet Vambraces +7
[Fri Sep 25 12:19:36 2026] Primary: Khyldorn the Blood Drinker +6
[Fri Sep 25 12:19:36 2026] Chest: Indicolite Breastplate +6
[Fri Sep 25 12:19:36 2026] Legs: Indicolite Greaves +6
[Fri Sep 25 12:19:36 2026] Waist: Belt of the Four Winds
[Fri Sep 25 12:19:40 2026] You begin casting Drain Spirit.`

describe('what the pet wears', () => {
  it('reads the /pet inventory check list from the log', () => {
    const got: PetGearReading[] = []
    const r = new PetGearReader((x) => got.push(x))
    for (const raw of GEAR_LINES.split('\n')) {
      const l = parseLogLine(raw)!
      r.handle(l.text, l.time)
    }
    expect(got).toHaveLength(1)
    expect(got[0].items).toEqual([
      { slot: 'Arms', name: 'Lustrous Russet Vambraces +7' },
      { slot: 'Primary', name: 'Khyldorn the Blood Drinker +6' },
      { slot: 'Chest', name: 'Indicolite Breastplate +6' },
      { slot: 'Legs', name: 'Indicolite Greaves +6' },
      { slot: 'Waist', name: 'Belt of the Four Winds' }
    ])
  })

  it('ends a list the log stopped adding to, and an empty one is still a list', () => {
    const got: PetGearReading[] = []
    const r = new PetGearReader((x) => got.push(x))
    r.handle('Your pet has the following items equipped:', 1000)
    r.tick(2000)
    expect(got).toEqual([])
    r.tick(5000)
    expect(got).toEqual([{ at: 1000, items: [] }])
  })

  it('finds the last list and the last pet summoned, reading the log backwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lt-pet-'))
    const log = join(dir, 'eqlog_Kelwyn_test.txt')
    const text = [
      '[Fri Sep 25 11:00:00 2026] You begin casting Frenzied Spirit X.',
      '[Fri Sep 25 11:00:10 2026] Your pet has the following items equipped:',
      '[Fri Sep 25 11:00:10 2026] Arms: Old Vambraces',
      ...GEAR_LINES.split('\n'),
      '[Fri Sep 25 12:30:00 2026] You begin casting Spirit of the Puma X.'
    ].join('\r\n')
    writeFileSync(log, text + '\r\n', 'latin1')
    const s = await scanPetLog(log, (name) => (name.startsWith('Frenzied Spirit') ? 'Frenzied Spirit' : null), 1 << 20)
    expect(s.summon).toEqual({ spell: 'Frenzied Spirit', at: new Date(2026, 8, 25, 11, 0, 0).getTime() })
    expect(s.gear?.items.map((i) => i.slot)).toEqual(['Arms', 'Primary', 'Chest', 'Legs', 'Waist'])
  })
})

describe('pet slots', () => {
  it('are 4 plus the classes’ bonuses, 12 at most', () => {
    expect(petSlots(['shd', 'mnk', 'shm'])).toBe(5)
    expect(petSlots(['enc', 'dru', 'shm'])).toBe(7)
    expect(petSlots(['mag', 'bst', 'nec'])).toBe(12)
    expect(petSlots(['war', 'clr', 'rog'])).toBe(4)
  })
})

describe('the pet from the wiki', () => {
  it('reads a summon page', () => {
    const page = `<ul>
    <li>Summoning Spell: [[Test Spirit]]</li>
    <li>Pet Classes: [[Beastlord]] / [[Warrior]]</li>
    <li>Pet Level: 30</li>
    <li>Hit Points: 2000 (+1/tick)</li>
    </ul>
    <li>Dual Wield: 40%</li>
    <ul><li>Strength: 110</li>
    <li>Stamina: 100</li>
    <li>Agility: 90?</li></ul>`
    const p = parseSummonPage('Test Spirit', page)
    expect(p).toMatchObject({ classes: ['bst', 'war'], level: 30, hp: 2000, dualWield: 0.4 })
    expect(p.stats).toMatchObject({ STR: 110, STA: 100, AGI: 90 })
    expect(p.unsure).toEqual(['Agility'])
    expect(parseSummonPage('X', '<li>Pet Classes: [[Shadow Knight]] / [[Warrior]]</li>').classes).toEqual(['shd', 'war'])
  })

  it('reads base melee from both table layouts, rowspans included', () => {
    const guide = `
{| class="eoTable2"
! Player Level
! Pet
! Pet Level
! Base Melee Ratio
!Bonus Damage
! Dual Wield
|-
| style="text-align:center;"|'''30'''
| [[Test Spirit Summon|Test Spirit]]
| 30
| 18/28 (0.643)
| +7
| 40%
|-
| '''2'''
| [[Test Animation Summon|Test Animation]]|| 5 || 7/30? (0.XXX)
| +?
|X?
|}

{| class="wikitable"
|+Tests
!Character Level
!Elemental
!Hit Points
!Damage
!Delay
!Ratio
!Bonus Damage
!Dual Wield
|-
|style="text-align: center;"|10
|style="text-align: center;"|[[Test: Water Summon|Water]]
|style="text-align: center;"|500
|style="text-align: center;" rowspan="2"| 12
|style="text-align: center;"|30
|style="text-align: center;"|0.400
|style="text-align: center;" rowspan="2"| +2
|style="text-align: center;" rowspan="2"| 20%
|-
|style="text-align: center;"|11
|style="text-align: center;"|[[Test: Fire Summon|Fire]]
|style="text-align: center;"|400
|style="text-align: center;"|24
|style="text-align: center;"|0.500
|}`
    expect(parseWikiTables(guide)[1].rows[1]).toEqual(['11', '[[Test: Fire Summon|Fire]]', '400', '12', '24', '0.500', '+2', '20%'])
    const m = parsePetGuide(guide)
    expect(m.get('test spirit')).toEqual({ damage: 18, delay: 28, bonus: 7, dualWield: 0.4, unsure: false })
    expect(m.get('test animation')).toMatchObject({ damage: 7, delay: 30, unsure: true })
    expect(m.get('test: water')).toMatchObject({ damage: 12, delay: 30, bonus: 2, dualWield: 0.2 })
    expect(m.get('test: fire')).toMatchObject({ damage: 12, delay: 24, bonus: 2, dualWield: 0.2 })
  })
})

describe('pet melee', () => {
  it('uses EQEmu’s weapon damage bonus', () => {
    expect(weaponDamageBonus(20, 30, false)).toBe(0)
    expect(weaponDamageBonus(36, 30, false)).toBe(3)
    expect(weaponDamageBonus(36, 30, false, true)).toBe(0)
    expect(weaponDamageBonus(36, 43, true)).toBe(8)
    expect(weaponDamageBonus(50, 70, true)).toBe(26)
  })

  const wolf: PetMelee = { damage: 20, delay: 28, bonus: 11, dualWield: 0.55 }
  it('follows the Pet Guide’s three weapon rules', () => {
    // A better ratio: the weapon's damage, delay and bonus.
    expect(petSwing(wolf, 36, { damage: 57, delay: 43, twoHanded: true })).toEqual({ damage: 57, delay: 43, bonus: 8 })
    // A worse ratio but more damage: its damage, the pet's own delay and bonus.
    expect(petSwing(wolf, 36, { damage: 30, delay: 60, twoHanded: false })).toEqual({ damage: 30, delay: 28, bonus: 11 })
    // Worse at both: nothing changes.
    expect(petSwing(wolf, 36, { damage: 10, delay: 30, twoHanded: false })).toEqual({ damage: 20, delay: 28, bonus: 11 })
  })

  it('gives up the off hand for a two-hander', () => {
    const bare = petMelee(wolf, 36, null, null)
    expect(bare).toBeCloseTo((11 + 30) / 28 + 0.55 * 30 / 28, 6)
    expect(petMelee(wolf, 36, { damage: 57, delay: 43, twoHanded: true }, null)).toBeCloseTo((8 + 85.5) / 43, 6)
  })
})

describe('pet gear optimizer', () => {
  const block = (lines: string[]) => lines.join('<br>')
  const piece = (name: string, lines: string[], from: PetPiece['from'] = 'bags', noPet = false): PetPiece => {
    const sb = block(lines)
    return { item: { location: 'General 1', name, id: 0, count: 1, augs: [] }, from, key: name.toLowerCase(), r: restrictions(sb), stats: parseStatsBlock(sb) as ItemStats, lore: false, noPet }
  }
  const weights = { ac: 5, hp: 1, mana: 0, end: 0, str: 1, sta: 1, agi: 1, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 10, attack: 1, hpRegen: 0, manaRegen: 0, endRegen: 0, ratio: 10 }
  const wearer = { classes: ['shd', 'mnk', 'shm', 'bst', 'war'], race: '', level: 36 }
  const wolf: PetMelee = { damage: 20, delay: 28, bonus: 11, dualWield: 0.55 }

  const chest = piece('Plate Chest', ['Slot: CHEST', 'AC: 30', 'Class: WAR'])
  const robe = piece('Silk Robe', ['Slot: CHEST', 'AC: 5', 'Class: WAR'])
  const belt = piece('Haste Belt', ['Slot: WAIST', 'AC: 2', 'Haste: 30%', 'Class: WAR'])
  const ring1 = piece('Ring A', ['Slot: FINGERS', 'HP: 50', 'Class: ALL'])
  const ring2 = piece('Ring B', ['Slot: FINGERS', 'HP: 40', 'Class: ALL'])
  const ring3 = piece('Ring C', ['Slot: FINGERS', 'HP: 30', 'Class: ALL'])
  const wizHat = piece('Wizard Hat', ['Slot: HEAD', 'AC: 50', 'Class: WIZ'])
  const noPetHelm = piece('Soulbound Helm', ['Slot: HEAD', 'AC: 40', 'Class: ALL'], 'bank', true)

  it('keeps to the slots the pet inventory holds, one per slot and two rings', () => {
    const plan = optimizePetGear({ pieces: [chest, robe, belt, ring1, ring2, ring3, wizHat, noPetHelm], current: [], capacity: 4, wearer, weights, melee: null, level: 36 })
    expect(plan.chosen.map((c) => c.piece.item.name).sort()).toEqual(['Haste Belt', 'Plate Chest', 'Ring A', 'Ring B'])
  })

  it('weighs a two-hander against dual wielding with the pet’s bare off hand', () => {
    const twoHander = piece('Big Axe', ['Slot: PRIMARY', 'Skill: 2H Slashing Atk Delay: 43', 'DMG: 57', 'Class: SHD'])
    const blade = piece('Fine Blade', ['Slot: PRIMARY SECONDARY', 'Skill: 1H Slashing Atk Delay: 20', 'DMG: 16', 'Class: WAR'])
    const blade2 = piece('Fine Blade II', ['Slot: PRIMARY SECONDARY', 'Skill: 1H Slashing Atk Delay: 20', 'DMG: 16', 'Class: WAR'])
    const plan = optimizePetGear({ pieces: [twoHander, blade, blade2], current: [], capacity: 3, wearer, weights, melee: wolf, level: 36 })
    const two = petMelee(wolf, 36, { damage: 57, delay: 43, twoHanded: true }, null)
    const dual = petMelee(wolf, 36, { damage: 16, delay: 20, twoHanded: false }, { damage: 16, delay: 20, twoHanded: false })
    const expected = dual > two ? ['Primary', 'Secondary'] : ['Primary']
    expect(plan.chosen.map((c) => c.slot)).toEqual(expected)
    expect(plan.chosen.some((c) => c.piece === twoHander && c.slot === 'Secondary')).toBe(false)
  })

  it('scores what the pet wears now against the plan', () => {
    const current = [{ piece: { ...robe, from: 'pet' as const }, slot: 'Chest' }]
    const plan = optimizePetGear({ pieces: [chest, current[0].piece], current, capacity: 1, wearer, weights, melee: null, level: 36 })
    expect(plan.chosen.map((c) => c.piece.item.name)).toEqual(['Plate Chest'])
    expect(plan.total - plan.current).toBe((30 - 5) * 5)
  })
})
