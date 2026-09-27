import { describe, expect, it } from 'vitest'
import { effectScore, itemEffects, procDamage, procOf, procsPerMinute, procWorth, wornEffectOf, wornStats, wornWorth, type EffectSpell } from '../src/core/itemEffects'
import { meleeCounter, meleeProfile } from '../src/core/meleeTally'
import { optimizeGear, type Piece } from '../src/core/gearOptimizer'
import { parseInventory, parseStatsBlock } from '../src/core/inventory'
import { restrictions, type Weights } from '../src/core/upgrades'
import { parseLogLine } from '../src/core/logLine'
import { PRESETS } from './helpers'

// Torrid Corruptor's stats block as eqlwiki has it, and its two spells as the EQL spell file has them.
const TORRID = `MAGIC ITEM  LORE ITEM  NO DROP  <br>
Slot: PRIMARY<br>
Skill: 2H Slashing  Atk Delay: 44<br>
DMG: 33 <br>
STR: +15  CHA: -30 INT: +5 WIS: +5 DEX: +5  HP: +25  MANA: +25<br>
Effect:  [[Oathbreaker's Curse]] (Combat, Casting Time: Instant) at Level 45<br>
Worn Effect: [[Unrighteous Bash]]
WT: 0.1  Size: LARGE<br>
Class: PAL SHD<br>
Race: ALL<br>`
const UNRIGHTEOUS_BASH: EffectSpell = {
  name: 'Unrighteous Bash', formula: 50, cap: 0, beneficial: true,
  effects: [{ spa: 227, base: 1, base2: 10 }, { spa: 220, base: 15, base2: 10 }, { spa: 226, base: 1, base2: 0 }]
}
const OATHBREAKERS_CURSE: EffectSpell = {
  name: "Oathbreaker's Curse", formula: 2, cap: 9, beneficial: false,
  effects: [{ spa: 0, base: -80, base2: 0, formula: 100, max: 80 }, { spa: 457, base: 1000, base2: 0 }, { spa: 116, base: 9, base2: 0 }]
}
const LIFEBITE: EffectSpell = { name: 'Lifebite', formula: 0, cap: 0, beneficial: false, effects: [{ spa: 0, base: -36, base2: 0, formula: 102, max: 42 }] }

const fromLog = (text: string) => {
  const days: Record<string, Record<string, number>> = {}
  const count = meleeCounter()
  for (const raw of text.trim().split('\n')) count(parseLogLine(raw.trim())!, days)
  const sum: Record<string, number> = {}
  for (const d of Object.values(days)) for (const [k, v] of Object.entries(d)) sum[k] = (sum[k] ?? 0) + v
  return meleeProfile(sum, { from: '2026-09-25', to: '2026-09-25' })
}

describe('your melee from the log', () => {
  const profile = fromLog(`
    [Fri Sep 25 12:00:00 2026] You punch a forsaken revenant for 60 points of damage.
    [Fri Sep 25 12:00:02 2026] You bash a forsaken revenant for 40 points of damage.
    [Fri Sep 25 12:00:04 2026] You try to bash a forsaken revenant, but miss!
    [Fri Sep 25 12:00:04 2026] A forsaken revenant has taken 36 damage from your Envenomed Bolt X.
    [Fri Sep 25 12:00:05 2026] You hit a forsaken revenant for 42 points of disease damage by Lifebite.
    [Fri Sep 25 12:00:06 2026] You begin casting Ice Spear.
    [Fri Sep 25 12:00:08 2026] You hit a forsaken revenant for 207 points of cold damage by Ice Spear.
    [Fri Sep 25 12:00:10 2026] You punch a forsaken revenant for 60 points of damage.
    [Fri Sep 25 12:01:00 2026] You punch a skeleton for 60 points of damage.`)

  it('counts swings by skill, and the time between swings up to six seconds apart', () => {
    expect(profile.skills.bash).toEqual({ hits: 1, damage: 40, misses: 1 })
    expect(profile.skills.punch).toEqual({ hits: 3, damage: 180, misses: 0 })
    // 12:00:00 to 12:00:10 in steps of 2, 2, 6 (the gap to 12:00:10 is six seconds); 12:01:00 starts again.
    expect(profile.activeMin).toBeCloseTo(10 / 60, 6)
    expect(profile.dpm).toBeCloseTo(220 / (10 / 60), 6)
  })

  it('takes spell damage with no cast of it just before as a proc', () => {
    expect(profile.procs).toEqual({ Lifebite: { count: 1, damage: 42 } })
  })
})

describe('effects on gear', () => {
  it('reads worn effects written "Effect: X (Worn)", as most pages have them', () => {
    expect(wornEffectOf("Slot: BACK<br>\nEffect:  [[Enduring Breath]] (Worn)<br>\nClass: ALL<br>")).toBe('Enduring Breath')
    expect(wornEffectOf('Effect: [[Flowing Thought I]] (Worn, Casting Time: Instant)<br>')).toBe('Flowing Thought I')
    // A clicky or a focus is no worn effect.
    expect(wornEffectOf('Effect:  [[Levitate]] (Must Equip, Casting Time: Instant) at Level 45<br>')).toBe('')
    expect(wornEffectOf('Focus Effect: [[Spell Haste II]]<br>')).toBe('')
  })

  it('says what a utility or stat worn effect does, and prices its stats as an item’s', () => {
    const breath: EffectSpell = { name: 'Enduring Breath', formula: 0, cap: 0, beneficial: true, effects: [{ spa: 14, base: 1, base2: 0 }] }
    expect(wornWorth(breath, meleeProfile({}, { from: '', to: '' })).does).toEqual(['breathe underwater'])
    const battle: EffectSpell = { name: 'Aura of Battle', formula: 0, cap: 0, beneficial: true, effects: [{ spa: 2, base: 10, base2: 0 }, { spa: 15, base: 1, base2: 0 }, { spa: 10, base: 0, base2: 0 }] }
    expect(wornWorth(battle, meleeProfile({}, { from: '', to: '' })).does).toEqual(['attack +10', 'mana +1 a tick'])
    const s = wornStats(battle, 50)
    expect([s.attack, s.manaRegen, s.ac]).toEqual([10, 1, 0])
  })

  it('reads the worn effect and the combat proc from a stats block', () => {
    expect(wornEffectOf(TORRID)).toBe('Unrighteous Bash')
    expect(procOf(TORRID)).toBe("Oathbreaker's Curse")
    expect(wornEffectOf('Slot: CHEST<br>\nAC: 5<br>')).toBe('')
    expect(procOf('Slot: CHEST<br>\nAC: 5<br>')).toBe('')
  })

  it('takes a worn exaltation’s worn effect and a proc exaltation’s proc in place of the item’s', () => {
    const inv = parseInventory(
      [
        'Location\tName\tID\tCount\tSlots',
        "Primary\tWu's Fist of Mastery +10\t1\t1\t10",
        'Primary-Slot9\tTorrid Corruptor (Exaltation)\t2\t1\t10',
        "Primary-Slot10\tCherista's Fangs (Exaltation)\t3\t1\t10"
      ].join('\n')
    )
    const own: Record<string, { worn: string; proc: string }> = {
      "wu's fist of mastery": { worn: '', proc: '' },
      'torrid corruptor': { worn: 'Unrighteous Bash', proc: "Oathbreaker's Curse" },
      "cherista's fangs": { worn: '', proc: 'Lifebite' }
    }
    const fx = itemEffects(inv.worn[0], (n) => own[n.replace(/ \(Exaltation\)$/, '').replace(/ \+\d+$/, '').toLowerCase()])
    expect(fx.worn).toEqual([{ name: 'Unrighteous Bash', via: 'Torrid Corruptor (Exaltation)' }])
    expect(fx.procs).toEqual([{ name: 'Lifebite', via: "Cherista's Fangs (Exaltation)" }])
  })
})

describe('what an effect is worth', () => {
  // Ten minutes swinging: 110 bashes tried (11 a minute, near the 12 a 5 s cooldown allows), 100 of them hits for 40 each.
  const profile = meleeProfile({ active: 600_000, 'm|bash|h': 100, 'm|bash|d': 4000, 'm|bash|x': 10, 'm|punch|h': 600, 'm|punch|d': 48_000 }, { from: 'a', to: 'b' })

  it("prices Unrighteous Bash: +15 on each bash hit, and bashing a second sooner when bash is used on cooldown", () => {
    const w = wornWorth(UNRIGHTEOUS_BASH, profile)
    expect(w.does).toEqual(['bash ready 1s sooner', '+15 damage to each bash', 'bash while holding a two-handed weapon'])
    // 10 hits a minute × 15, plus 11 tries a minute at a 4 s cooldown instead of 5: 11 × (5/4 − 1) = 2.75 more,
    // landing 10/11 of the time for 40 + 15.
    expect(w.dpm).toBeCloseTo(10 * 15 + 2.75 * (10 / 11) * 55, 6)
  })

  it('does not credit a shorter cooldown to a skill hardly used', () => {
    const rare = meleeProfile({ active: 600_000, 'm|bash|h': 5, 'm|bash|d': 200, 'm|punch|h': 600, 'm|punch|d': 48_000 }, { from: 'a', to: 'b' })
    expect(wornWorth(UNRIGHTEOUS_BASH, rare).dpm).toBeCloseTo(0.5 * 15, 6)
  })

  it("prices a proc from the log when it has fired, else from EQEmu's rate and the spell file", () => {
    const seen = meleeProfile({ active: 600_000, 'm|punch|h': 600, 'm|punch|d': 48_000, 'p|Lifebite|n': 30, 'p|Lifebite|d': 1260 }, { from: 'a', to: 'b' })
    // Two fists carry it: 3 a minute between them, 1.5 each, 42 a firing.
    expect(procWorth(LIFEBITE, seen, { level: 50, dex: 200, carriers: 2 }).dpm).toBeCloseTo(1.5 * 42, 6)
    // Never fired: 2 a minute raised 15% by 200 DEX, and the spell's 42 at level 50 (36 + 50, capped at 42).
    expect(procsPerMinute(200)).toBeCloseTo(2.3, 6)
    expect(procWorth(LIFEBITE, profile, { level: 50, dex: 200, carriers: 1 }).dpm).toBeCloseTo(2.3 * 42, 6)
  })

  it('gives a proc that lands only on undead or summoned creatures no value', () => {
    // Dismiss Summoned (Thelvorn, Blade of Light): 180 damage, target type 11, summoned creatures only.
    const dismiss: EffectSpell = { name: 'Dismiss Summoned', formula: 0, cap: 0, beneficial: false, targetType: 11, effects: [{ spa: 0, base: -180, base2: 0 }] }
    const w = procWorth(dismiss, profile, { level: 50, dex: 200, carriers: 1 })
    expect(w.dpm).toBe(0)
    expect(w.does).toContain('works only on summoned creatures')
    expect(procWorth({ ...dismiss, name: 'Dismiss Undead', targetType: 10 }, profile, { level: 50, dex: 200, carriers: 1 }).dpm).toBe(0)
  })

  it('counts a damage-over-time proc for every tick', () => {
    // 80 a tick for level/2 + 5 ticks, capped at 9.
    expect(procDamage(OATHBREAKERS_CURSE, 50)).toBe(80 * 9)
  })

  it('holds a damage-over-time proc to its damage kept up the whole time: a firing refreshes it', () => {
    // 2.3 a minute × 720 would be 1,656; 80 a tick, 10 ticks a minute, is the most it does.
    const w = procWorth(OATHBREAKERS_CURSE, profile, { level: 50, dex: 200, carriers: 1 })
    expect(w.dpm).toBe(800)
    expect(w.basis).toContain('refreshes rather than stacks')
  })

  it("counts no more of a skill than its cooldown allows: more swings under its name are another skill's", () => {
    // Kelwyn's log: 19 bash swings a minute, where a 5 s cooldown allows 12 (an Iksar's tail rake lands as a bash).
    const iksar = meleeProfile({ active: 600_000, 'm|bash|h': 108, 'm|bash|d': 10_800, 'm|bash|x': 85, 'm|punch|h': 600, 'm|punch|d': 48_000 }, { from: 'a', to: 'b' })
    const w = wornWorth(UNRIGHTEOUS_BASH, iksar)
    const hitRate = 108 / 193
    // 12 a minute: 12 × hitRate hits × 15, and 12 × 0.25 more uses landing hitRate of the time for 100 + 15.
    expect(w.dpm).toBeCloseTo(12 * hitRate * 15 + 3 * hitRate * 115, 6)
    expect(w.basis).toContain('the most a 5s cooldown allows')
  })

  it('reads damage a minute as the weights do: 1% of melee damage is worth the weapon damage weight', () => {
    // 5,200 a minute of melee; 52 more is 1%.
    expect(effectScore(52, profile, 12)).toBeCloseTo(12, 6)
  })
})

describe('the optimizer and effects', () => {
  const wearer = { classes: ['shd'], race: '', level: 50 }
  const weights: Weights = { ...PRESETS.Balanced, ac: 1, hp: 0, mana: 0, end: 0, str: 0, sta: 0, agi: 0, dex: 0, wis: 0, int: 0, cha: 0, resists: 0, haste: 0, attack: 0, hpRegen: 0, manaRegen: 0, endRegen: 0, ratio: 0 }
  const piece = (name: string, location: string, block: string, extra: Partial<Piece> = {}): Piece => ({
    item: { location, name, id: 0, count: 1, augs: [] }, from: location === 'Bag' ? 'bags' : 'worn', key: name.toLowerCase(), r: restrictions(block),
    stats: parseStatsBlock(block), foci: [], lore: false, ...extra
  })
  const charm = (n: string, ac: number) => piece(n, 'Any Slot', `Slot: CHARM<br>\nAC: ${ac}<br>\nClass: ALL<br>\nRace: ALL<br>`)
  const effects = { worn: (names: string[]) => (names.includes('Unrighteous Bash') ? 30 : 0), proc: (n: string) => (n === 'Lifebite' ? 20 : 0) }

  it('wears a piece in an Any slot for its worn effect, and counts one worn effect once', () => {
    const torrid = piece('Torrid Corruptor +4', 'Bag', TORRID, { worn: ['Unrighteous Bash'], procs: ["Oathbreaker's Curse"] })
    const twin = piece('Other Corruptor', 'Bag', TORRID, { worn: ['Unrighteous Bash'] })
    const plan = optimizeGear({ pieces: [charm('Red Charm', 10), charm('Blue Charm', 10), torrid, twin], wearer, weights, twoHanders: false, focusValue: () => 0, effects })
    const anySlots = plan.after.filter((_, i) => plan.slots[i] === 'Any Slot').map((p) => p?.item.name)
    // One corruptor for the worn effect (30 over a charm's 10), the other charm stays: a second copy of it adds nothing.
    expect(anySlots.filter((n) => n?.includes('Corruptor'))).toHaveLength(1)
    expect(plan.effectsAfter).toBe(30)
  })

  it('counts a proc only on a weapon in the hands', () => {
    const fang = (n: string, where: string) => piece(n, where, 'Slot: PRIMARY SECONDARY<br>\nSkill: 1H Piercing Atk Delay: 20<br>\nDMG: 10<br>\nClass: ALL<br>\nRace: ALL<br>', { procs: ['Lifebite'] })
    const plan = optimizeGear({ pieces: [fang('Fang A', 'Primary'), fang('Fang B', 'Any Slot')], wearer, weights, twoHanders: false, focusValue: () => 0, effects })
    expect(plan.effectsBefore).toBe(20)
    // The second fang goes to the off hand, where its proc counts too.
    expect(plan.effectsAfter).toBe(40)
    expect(plan.after[plan.slots.indexOf('Secondary')]?.item.name).toBe('Fang B')
  })

  it('puts an exaltation only in a piece that shares a class of the character with it', () => {
    // Kelwyn is SHD/MNK/SHM: a monk-only fist and an SK-only proc exaltation are each theirs, but
    // together no class may wear them. An all-class blade takes it instead.
    const trio = { classes: ['shd', 'mnk', 'shm'], race: '', level: 50 }
    const fist = piece("Wu's Fist", 'Primary', 'Slot: PRIMARY SECONDARY<br>\nSkill: Hand to Hand Atk Delay: 22<br>\nDMG: 16<br>\nClass: MNK<br>\nRace: ALL<br>')
    const blade = piece('Plain Blade', 'Secondary', 'Slot: PRIMARY SECONDARY<br>\nSkill: 1H Slashing Atk Delay: 22<br>\nDMG: 16<br>\nClass: ALL<br>\nRace: ALL<br>')
    const khyldorn = {
      item: { location: 'Storage', name: 'Khyldorn the Blood Drinker (Exaltation)', id: 1, count: 1, augs: [] }, from: 'storage' as const, focus: '', worn: '', proc: 'Lifebite',
      r: restrictions('Slot: PRIMARY<br>\nClass: SHD<br>\nRace: ALL<br>')
    }
    const onlyFist = optimizeGear({ pieces: [fist], wearer: trio, weights, twoHanders: false, focusValue: () => 0, effects, exaltations: [khyldorn] })
    expect(onlyFist.after.some((p) => p?.exalt)).toBe(false)
    const both = optimizeGear({ pieces: [fist, blade], wearer: trio, weights, twoHanders: false, focusValue: () => 0, effects, exaltations: [khyldorn] })
    expect(both.after.filter((p) => p?.exalt).map((p) => p!.item.name)).toEqual(['Plain Blade'])
  })

  it('puts a stored proc exaltation in a weapon of its own kind', () => {
    const fist = piece("Wu's Fist", 'Primary', 'Slot: PRIMARY SECONDARY<br>\nSkill: Hand to Hand Atk Delay: 22<br>\nDMG: 16<br>\nClass: ALL<br>\nRace: ALL<br>')
    const fangs = {
      item: { location: 'Storage', name: "Cherista's Fangs (Exaltation)", id: 1, count: 1, augs: [] }, from: 'storage' as const, focus: '', worn: '', proc: 'Lifebite',
      r: restrictions('Slot: PRIMARY SECONDARY<br>\nClass: ALL<br>\nRace: ALL<br>')
    }
    const plan = optimizeGear({ pieces: [fist], wearer, weights, twoHanders: false, focusValue: () => 0, effects, exaltations: [fangs] })
    const main = plan.after[plan.slots.indexOf('Primary')]
    expect(main?.exalt?.item.name).toBe("Cherista's Fangs (Exaltation)")
    expect(main?.exaltSlot).toBe('proc')
    expect(plan.effectsAfter).toBe(20)
  })
})
