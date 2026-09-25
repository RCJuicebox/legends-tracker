// AC, the way the server works it out. Every step is a transcription of Dzarn's "What is your 'Real
// AC'?" post (an EverQuest developer, reposted to r/EQLegends by neodraykl), with integer maths
// throughout: each division truncates, as the game's does. Avoidance follows EQEmu's GetTotalDefense.
//
// On EverQuest Legends this reproduces the Inventory window's three AC figures (mitigation, soft cap,
// avoidance) exactly, checked against in-game readings across several gear and buff changes.

export const CLASSES = [
  ['war', 'Warrior'], ['pal', 'Paladin'], ['shd', 'Shadowknight'], ['rng', 'Ranger'],
  ['mnk', 'Monk'], ['brd', 'Bard'], ['rog', 'Rogue'], ['ber', 'Berserker'], ['bst', 'Beastlord'],
  ['clr', 'Cleric'], ['dru', 'Druid'], ['shm', 'Shaman'],
  ['enc', 'Enchanter'], ['mag', 'Magician'], ['nec', 'Necromancer'], ['wiz', 'Wizard']
] as const

export type ClassId = (typeof CLASSES)[number][0]

/** The game files number classes the classic way: 1 Warrior … 16 Berserker. */
export const CLASS_NUMBER: Record<ClassId, number> = {
  war: 1, clr: 2, pal: 3, rng: 4, shd: 5, dru: 6, mnk: 7, brd: 8, rog: 9, shm: 10, nec: 11, wiz: 12, mag: 13, enc: 14, bst: 15, ber: 16
}

export const className = (c: string) => CLASSES.find(([id]) => id === c)?.[1] ?? c

/** Cloth casters: defence counts half, AC buffs and Hero's Fortitude a third. */
const SILK: string[] = ['enc', 'mag', 'nec', 'wiz']
/** Armor of Wisdom counts a third for these, a quarter for everyone else. */
const AOW3: string[] = ['dru', 'enc', 'mag', 'nec', 'wiz']

/** Monk weight soft and hard caps by level: [from level, hard, soft]. */
const MONK_WEIGHT: [number, number, number][] = [
  [1, 30, 14], [15, 32, 15], [30, 34, 16], [45, 36, 17], [51, 38, 18], [55, 40, 20], [60, 45, 24], [62, 47, 24], [64, 50, 24],
  [65, 53, 26], [70, 53, 28], [75, 53, 30], [80, 54, 31], [85, 55, 32], [90, 56, 33], [95, 57, 34], [100, 58, 35]
]

export function monkWeightCaps(level: number): { hard: number; soft: number } {
  let row = MONK_WEIGHT[0]
  for (const r of MONK_WEIGHT) if (level >= r[0]) row = r
  return { hard: row[1], soft: row[2] }
}

export interface AcInputs {
  /** The character's classes; the sturdiest decides the cap, any of them earns a class bonus. */
  trio: string[]
  /** The class whose defence divisors apply: the one the soft cap came from. */
  cls: string
  race: 'iksar' | 'other'
  level: number
  defense: number
  /** Agility as the Inventory window shows it. */
  agility: number
  heroicAgility: number
  heroicStrength: number
  /** Total carried weight (monks only). */
  weight: number
  drunk: number
  /** AC on every equipped item but ammo. */
  itemAC: number
  /** AC on the shield in the secondary slot; 0 without one. */
  shieldAC: number
  itemAvoidance: number
  foodDrinkAC: number
  tributeAC: number
  acBuffs: number
  armorOfWisdom: number
  herosFortitude: number
  /** SPA 259, Combat Stability: raises the soft cap by this %. */
  combatStability: number
  /** SPA 172, melee avoidance AAs, %. */
  evasion: number
  softCap: number
  multiplier: number
}

const idiv = (a: number, b: number) => Math.trunc(a / b)

/** Avoidance AC, the post's Computed Defence: defence skill and agility, plus item avoidance up to 100. */
export function computedDefense(i: AcInputs) {
  const skill = idiv(i.defense * 400, 225)
  const agi = idiv(8000 * (i.agility - 40), 36000)
  const hagi = idiv(i.heroicAgility, 10)
  const avoid = Math.min(100, i.itemAvoidance)
  const raw = skill + agi + hagi + avoid
  const value = i.drunk / 2
  let red = 1
  if (value > 20) red = Math.min(1, (110 - value) / 100)
  const out = Math.trunc(raw * red)
  return { skill, agi, hagi, avoid, raw, red, total: out < 1 ? 1 : out }
}

/** Monk weight, rogue and beastlord agility, and the Iksar racial. */
export function raceClassBonus(i: AcInputs) {
  const out = { monk: 0, cls: 0, iksar: 0, monkPenalty: false, caps: null as null | { hard: number; soft: number }, total: 0 }
  const has = (c: string) => i.trio.includes(c)
  const tier = (a: number) => (a < 80 ? 1 : a < 85 ? 2 : a < 90 ? 3 : a < 100 ? 4 : 5)
  if (has('mnk')) {
    const c = monkWeightCaps(i.level)
    out.caps = c
    if (i.weight < c.hard - 1) {
      let bonus = i.level + 5
      if (i.weight > c.soft) {
        let r = Math.min(100, (i.weight - c.soft) * 6.66667)
        r = (100 - r) / 100
        bonus = Math.max(0, Math.trunc(bonus * r))
      }
      out.monk = idiv(4 * bonus, 3)
    } else if (i.weight > c.hard + 1) {
      const m = Math.min(1, (i.weight - (c.hard - 10)) / 100)
      out.monk = -Math.trunc(m * idiv(4 * (i.level + 5), 3))
      out.monkPenalty = true
    }
  } else if (has('rog') && i.level > 30 && i.agility > 75) {
    out.cls = Math.min(12, idiv((i.level - 26) * tier(i.agility), 4))
  } else if (has('bst') && i.level > 10) {
    out.cls = Math.min(16, idiv((i.level - 6) * tier(i.agility), 5))
  }
  if (i.race === 'iksar') out.iksar = Math.min(35, Math.max(10, i.level))
  out.total = out.monk + out.cls + out.iksar
  return out
}

/**
 * The AC Sum. `server` applies the anti-twink cap below level 50 (25 + 6 × level on worn AC), which
 * the Inventory window never shows.
 */
export function acSum(i: AcInputs, server: boolean) {
  const silk = SILK.includes(i.cls)
  const gear = i.itemAC + i.foodDrinkAC + i.tributeAC
  const eqmath = idiv(gear * 4, 3)
  const twink = 25 + 6 * i.level
  let s = eqmath
  let twinkCapped = false
  if (server && i.level < 50 && s > twink) {
    s = twink
    twinkCapped = true
  }
  const rc = raceClassBonus(i)
  s = Math.max(0, s + rc.total)
  const def = silk ? idiv(i.defense, 2) : idiv(i.defense, 3)
  const buffs = silk ? idiv(i.acBuffs, 3) : idiv(i.acBuffs, 4)
  const aow = AOW3.includes(i.cls) ? idiv(i.armorOfWisdom, 3) : idiv(i.armorOfWisdom, 4)
  const hf = silk ? idiv(i.herosFortitude, 3) : idiv(i.herosFortitude, 4)
  const agi = i.agility > 70 ? idiv(i.agility, 20) : 0
  s = Math.max(0, s + def + buffs + aow + hf + agi)
  return { gear, eqmath, twink, twinkCapped, rc, def, buffs, aow, hf, agi, silk, total: s }
}

export function computeAc(i: AcInputs) {
  const d = computedDefense(i)
  const disp = acSum(i, false)
  const srv = acSum(i, true)
  // A shield's AC already sits in the gear total; this second tally, with heroic strength riding
  // along, lifts the soft cap.
  const shield = i.shieldAC > 0 ? i.shieldAC + idiv(i.heroicStrength, 10) : 0
  const displayed = idiv(1000 * (disp.total + d.total), 350 + 497)
  const stability = idiv(i.softCap * i.combatStability, 100)
  const capWithAA = i.softCap + stability
  const effCap = shield + capWithAA
  const over = srv.total > effCap
  let kept = 0
  let lost = 0
  let mitigation = srv.total
  if (over) {
    kept = Math.trunc((srv.total - effCap) * i.multiplier)
    mitigation = effCap + kept
    lost = srv.total - effCap - kept
  }
  // EQEmu's GetTotalDefense: Computed Defence + 10, then SPA 172 evasion as a percentage.
  const avoidance = Math.floor(((d.total + 10) * (100 + (i.evasion || 0))) / 100)
  return { d, disp, srv, shield, displayed, stability, capWithAA, effCap, over, kept, lost, mitigation, avoidance }
}

/** What one more point of these inputs is worth in mitigation AC, measured, so every truncation counts. */
export function marginal(i: AcInputs, keys: (keyof AcInputs)[], step = 30): number {
  const a = computeAc(i).mitigation
  const j = { ...i } as Record<string, unknown>
  for (const k of keys) j[k] = (i[k] as number) + step
  return (computeAc(j as unknown as AcInputs).mitigation - a) / step
}
