import { useCallback, useMemo } from 'react'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { readStatsInputs } from '../../../core/statsInputs'
import { acWorth, characterAcInputs } from '../../../core/statsModel'
import { computeAc } from '../../../core/acModel'
import { wornSummary } from '../../../core/wornGear'
import { handWeights, type HandWeights, type Wearer } from '../../../core/gearFinder'
import { conversions, derivedMelee, meleeSlopes, rawWeights, ROLE_PRESETS, type RoleWeights } from '../../../core/statValue'
import { aaTotal } from '../../../core/aa'
import {
  DOUBLE_ATTACK,
  DUAL_WIELD,
  TRIPLE_ATTACK,
  TRIPLE_CLASSES,
  WEAPON_SKILLS,
  doubleAttackChance,
  dualWieldChance,
  handSwings,
  tripleAttackChance,
  windowOffense
} from '../../../core/combatModel'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { useCharacterRecord, withRecord } from '../character'

// Who the character is (classes, level, race, AC against the soft cap, how each hand swings) and what
// a point of each item stat is worth to them, with the finder's controls that decide it.

/** AC past the soft cap, where the AC model cannot say (no classes set): a quarter of AC under it. */
export const AC_OVER_CAP = 0.25

/** Each hand's weight, and what it came from. */
export interface HandInfo extends HandWeights {
  swings: { main: number; off: number }
  dualWield: number
  doubleAttack: number
  ambidexterity: number
  /** The chance the offhand swings in a round. */
  dual: number
}

/** How far weapon ratio outweighs the rest in the hands when weapons go by ratio first: 1% of weapon damage then counts 100 times over. */
const RATIO_FIRST = 100

export function useCharacterWeights(view: InventoryView, sheet: CharacterSheet | null) {
  const [preset, setPreset] = useRemembered<string>('finder.preset', 'Balanced')
  // v2: weapon ratio per 1% of damage. Custom weights saved before keep their place against the
  // Melee role, whose weight went from 80 to 12.
  const [savedCustom, saveCustom] = useRemembered<RoleWeights & { v?: number }>('finder.roleWeights', { ...ROLE_PRESETS.Balanced, v: 2 })
  const custom = useMemo<RoleWeights>(() => {
    const { v, ...w } = savedCustom
    return v === 2 ? w : { ...w, ratio: Math.round((w.ratio ?? 0) * (12 / 80) * 10) / 10 }
  }, [savedCustom])
  const setCustom = useCallback((w: RoleWeights) => saveCustom({ ...w, v: 2 }), [saveCustom])
  const [twoHandMode, setTwoHandMode] = useRemembered<'auto' | 'one' | 'any'>('finder.twoHand', 'auto')
  const [capMode, setCapMode] = useRemembered<'auto' | 'over' | 'under'>('finder.acCap', 'auto')
  const { record } = useCharacterRecord(view.character)
  const sheetStats = useMemo(() => withRecord(readStatsInputs(sheet?.stats), record), [sheet, record])
  const trio = sheetStats.classes.filter(Boolean)
  const capsQ = useInvoke(trio.length ? 'stats:caps' : null, [trio, sheetStats.level])
  const acCaps = capsQ.data?.ac ?? null
  const factors = useMemo(() => capsQ.data?.factors ?? {}, [capsQ.data])

  const stats = sheetStats
  // The same array for as long as the classes are the same, so memos and effects can depend on it.
  const classKey = (stats.classes ?? []).filter(Boolean).join(',')
  const classes = useMemo(() => (classKey ? classKey.split(',') : []), [classKey])
  const level = stats.level ?? 50
  // What 1% more melee damage takes in Offense and haste, at this character's numbers (LT-738): the
  // Stats window's Attack and Attack Speed when read, else its best weapon skill and strength.
  const slopes = useMemo(() => {
    const w = sheetStats.window?.values ?? {}
    const bestWeapon = Math.max(0, ...WEAPON_SKILLS.map(([id]) => sheetStats.skills[id] ?? 0))
    const offense = w.Attack?.[0] ?? windowOffense(bestWeapon, w.Strength?.[0] ?? (sheetStats.strength || 150))
    // Attack Speed reads 100 with no haste; a guess until a reading with known haste settles it.
    const speed = w['Attack Speed']?.[0]
    return meleeSlopes({ monk: classKey.split(',').includes('mnk'), offense, hastePct: speed && speed > 100 ? speed - 100 : 0 })
  }, [sheetStats, classKey])
  // Custom weights saved before a weight existed read it as the Balanced role has it. The Melee role's
  // Offense and haste are derived from its weapon damage weight at this character's numbers.
  const role = useMemo(() => {
    if (preset === 'Custom') return { ...ROLE_PRESETS.Balanced, ...custom }
    if (preset === 'Melee') return derivedMelee(ROLE_PRESETS.Melee, slopes)
    return ROLE_PRESETS[preset] ?? ROLE_PRESETS.Balanced
  }, [preset, custom, slopes])
  // What a point of each stat buys this character: its classes, its current stats (the Stats
  // window's when read, else the sheet's), and its AAs.
  const conv = useMemo(() => {
    const w = sheetStats.window?.values ?? {}
    const cur = (label: string, fallback: number) => w[label]?.[0] ?? fallback
    return conversions({
      classes: sheetStats.classes.filter(Boolean),
      factors,
      stats: {
        STR: cur('Strength', sheetStats.strength || 150),
        STA: cur('Stamina', 150),
        AGI: cur('Agility', sheetStats.agility || 150),
        DEX: cur('Dexterity', sheetStats.dexterity || 150),
        WIS: cur('Wisdom', 150),
        INT: cur('Intelligence', 150)
      },
      hpBonusPct: aaTotal(sheetStats.aa, 'base_hp_pct'),
      evasionPct: sheetStats.overrides.evasion ?? aaTotal(sheetStats.aa, 'avoidance_pct')
    })
  }, [sheetStats, factors])
  // Over the soft cap or not: the game's own Stats window when it has been read (mitigation above
  // the soft cap means over), else the AC calculator.
  const acIn = useMemo(() => (acCaps ? characterAcInputs(sheetStats, acCaps, view.inventory ? wornSummary(view, sheet) : null) : null), [sheetStats, acCaps, view, sheet])
  const acState = useMemo(() => {
    const w = sheetStats.window?.values.AC
    if (w && w.length >= 2) return { over: w[0] > w[1], mitigation: w[0], cap: w[1], from: 'your last Stats window read' }
    if (!acIn) return null
    const r = computeAc(acIn)
    return { over: r.over, mitigation: r.mitigation, cap: r.effCap, from: 'the AC calculator' }
  }, [sheetStats, acIn])
  const overCap = capMode === 'auto' ? !!acState?.over : capMode === 'over'
  // What a point of gear AC and of shield AC is worth, from the AC model with every truncation (LT-737):
  // 1 under the cap, the class's post-cap multiplier over it, and a shield's lifting the cap too.
  const acFactor = useMemo(() => {
    if (capMode === 'under') return { gear: 1, shield: 1 }
    const m = acIn ? acWorth(acIn) : null
    if (capMode === 'auto' && !overCap) return { gear: 1, shield: 1 }
    // Over the cap by the Stats window, though the calculator puts it under: the model's slope past its own cap.
    if (m && m.gear < 1) return m
    return { gear: AC_OVER_CAP, shield: m && m.shield > AC_OVER_CAP ? m.shield : 1 }
  }, [acIn, capMode, overCap])
  const weights = useMemo(() => {
    const w = rawWeights(role, conv)
    return { ...w, ac: w.ac * acFactor.gear, shieldAc: w.ac * acFactor.shield }
  }, [role, conv, acFactor])
  // How much each hand's weapon counts, from how often it swings: EQEmu's attack rounds (the Stats
  // page's, checked against hour-long parses) on the skills the log's skill-up lines give. Unknown
  // (no Dual Wield skill in the log) counts both hands alike.
  const hands = useMemo<HandInfo | null>(() => {
    const k = sheetStats.skills
    const dw = k[DUAL_WIELD] ?? 0
    if (!dw) return null
    const da = k[DOUBLE_ATTACK] ?? 0
    const amb = sheetStats.overrides.ambidexterity ?? aaTotal(sheetStats.aa, 'dual_wield_pct')
    const double = doubleAttackChance(da, level, sheetStats.doubleAttackBonus)
    const triple = classes.some((c) => TRIPLE_CLASSES.includes(c)) ? tripleAttackChance(k[TRIPLE_ATTACK] ?? 0) : 0
    const dual = dualWieldChance(dw, level, amb)
    const swings = handSwings({ double, triple, dual, doubleSkill: da })
    return { ...handWeights(swings), swings, dualWield: dw, doubleAttack: da, ambidexterity: amb, dual }
  }, [sheetStats, level, classes])
  // "Weapons: best ratio first": in the hands, weapon ratio outweighs everything else, whatever the
  // other weights, so the weights pick among weapons of about the same ratio. Only the hands' weapon
  // ratio is raised: worn effects, procs and merges are weighed as before.
  const [ratioFirst, setRatioFirst] = useRemembered<boolean>('finder.ratioFirst', true)
  const weaponHands = useMemo<HandWeights | null>(
    () => (ratioFirst ? { main: (hands?.main ?? 1) * RATIO_FIRST, off: (hands?.off ?? 1) * RATIO_FIRST } : hands),
    [ratioFirst, hands]
  )
  // Two-handers only when the secondary hand is free, unless the player says otherwise.
  const secondaryInUse = !!view.inventory?.worn.some((it) => it.location === 'Secondary')
  const twoHanders = twoHandMode === 'any' || (twoHandMode === 'auto' && !secondaryInUse)
  const wearer = useMemo<Wearer>(() => ({ classes, race: stats.race === 'iksar' ? 'IKS' : '', level }), [classes, stats.race, level])

  return {
    stats,
    classes,
    level,
    role,
    conv,
    weights,
    hands,
    weaponHands,
    acState,
    acFactor,
    overCap,
    secondaryInUse,
    twoHanders,
    wearer,
    controls: { ratioFirst, setRatioFirst, preset, setPreset, custom, setCustom, twoHandMode, setTwoHandMode, capMode, setCapMode }
  }
}
