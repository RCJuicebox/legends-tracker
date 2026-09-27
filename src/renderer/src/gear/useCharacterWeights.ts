import { useCallback, useMemo } from 'react'
import { useInvoke } from '../hooks'
import { useRemembered } from '../remember'
import { readSheet } from '../../../core/statsSheet'
import { characterAc } from '../../../core/statsModel'
import { wornSummary } from '../../../core/wornGear'
import { handWeights, type HandWeights, type Wearer } from '../../../core/upgrades'
import { conversions, rawWeights, ROLE_PRESETS, type RoleWeights } from '../../../core/statValue'
import { aaTotal } from '../../../core/aa'
import { DOUBLE_ATTACK, DUAL_WIELD, TRIPLE_ATTACK, TRIPLE_CLASSES, doubleAttackChance, dualWieldChance, handSwings, tripleAttackChance } from '../../../core/combatModel'
import type { CharacterSheet, InventoryView } from '../../../shared/types'
import { useCharacterRecord, withRecord } from '../character'

// Who the character is (classes, level, race, AC against the soft cap, how each hand swings) and what
// a point of each item stat is worth to them, with the finder's controls that decide it.

/** AC past the soft cap is worth a quarter of AC under it, in every weighting. */
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
  const sheetStats = useMemo(() => withRecord(readSheet(sheet?.stats), record), [sheet, record])
  const trio = sheetStats.classes.filter(Boolean)
  const capsQ = useInvoke(trio.length ? 'stats:caps' : null, [trio, sheetStats.level])
  const acCaps = capsQ.data?.ac ?? null
  const factors = useMemo(() => capsQ.data?.factors ?? {}, [capsQ.data])

  const stats = sheetStats
  // The same array for as long as the classes are the same, so memos and effects can depend on it.
  const classKey = (stats.classes ?? []).filter(Boolean).join(',')
  const classes = useMemo(() => (classKey ? classKey.split(',') : []), [classKey])
  const level = stats.level ?? 50
  // Custom weights saved before a weight existed read it as the Balanced role has it.
  const role = useMemo(() => (preset === 'Custom' ? { ...ROLE_PRESETS.Balanced, ...custom } : (ROLE_PRESETS[preset] ?? ROLE_PRESETS.Balanced)), [preset, custom])
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
  const acState = useMemo(() => {
    const w = sheetStats.window?.values.AC
    if (w && w.length >= 2) return { over: w[0] > w[1], mitigation: w[0], cap: w[1], from: 'your last Stats window read' }
    if (!acCaps) return null
    const r = characterAc(sheetStats, acCaps, view.inventory ? wornSummary(view, sheet) : null)
    return { over: r.over, mitigation: r.mitigation, cap: r.effCap, from: 'the AC calculator' }
  }, [sheetStats, acCaps, view, sheet])
  const overCap = capMode === 'auto' ? !!acState?.over : capMode === 'over'
  const weights = useMemo(() => {
    const w = rawWeights(role, conv)
    return overCap ? { ...w, ac: w.ac * AC_OVER_CAP } : w
  }, [role, conv, overCap])
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
    overCap,
    secondaryInUse,
    twoHanders,
    wearer,
    controls: { ratioFirst, setRatioFirst, preset, setPreset, custom, setCustom, twoHandMode, setTwoHandMode, capMode, setCapMode }
  }
}
