import { className, computeAc, marginal, type AcInputs } from '../../../core/acModel'
import {
  baseAccuracy,
  classicCritChance,
  damageBonusPct,
  DOUBLE_ATTACK,
  doubleAttackChance,
  DUAL_WIELD,
  dualWieldChance,
  MELEE_CLASSES,
  OFFENSE,
  stanceAccuracy,
  strengthOffense,
  swingsPerRound,
  TRIPLE_ATTACK,
  TRIPLE_CLASSES,
  tripleAttackChance,
  WEAPON_SKILLS,
  windowOffense
} from '../../../core/combatModel'
import { aaTotal } from '../../../core/aa'
import { fractionPct as pct, num } from '../format'
import type { StatsSheet } from '../statsSheet'

// The Stats page's sums, apart from how they are shown: what the AC and Combat tabs compute, the
// notes they make and the step-by-step trace. Also the AC result for other pages.

export interface Caps {
  skills: { id: number; cap: number; from: string }[]
  ac: Record<string, { cap: number; mult: number }>
}

export type AcCaps = Caps['ac']
export type Row = [label: string, value?: string | number, note?: string]
export type Note = [kind: '' | 'good' | 'warn' | 'tip', title: string, text: string]

/** The inputs a file, the game's tables or the AAs fill in unless the player types over them. */
export type AutoKey = keyof StatsSheet['overrides']
export type Auto = Record<AutoKey, number | undefined>
export type Val = (k: AutoKey) => number
export type Skill = (id: number) => number

/** Worn gear as the AC sum needs it. */
export interface GearAc {
  totals: { ac: number }
  shield: boolean
  shieldAC: number
}

/** The character's classes, once each; a warrior when none is set. */
export function classTrio(s: StatsSheet): string[] {
  const set = [...new Set(s.classes.filter(Boolean))]
  return set.length ? set : ['war']
}

/**
 * The sturdiest class sets the soft cap; the cap and its multiplier rise together through the whole
 * table, so the highest cap never brings a worse multiplier.
 */
export function primaryClass(trio: string[], acCaps: AcCaps): string {
  return trio.reduce((best, c) => ((acCaps[c]?.cap ?? 0) > (acCaps[best]?.cap ?? 0) ? c : best), trio[0])
}

export function autoValues(s: StatsSheet, acCaps: AcCaps, primary: string, gear: GearAc | null): Auto {
  return {
    itemAC: gear ? gear.totals.ac : undefined,
    shieldAC: gear ? (gear.shield ? gear.shieldAC : 0) : undefined,
    softCap: acCaps[primary]?.cap,
    multiplier: acCaps[primary]?.mult,
    combatStability: s.aa ? aaTotal(s.aa, 'softcap_pct') : undefined,
    evasion: s.aa ? aaTotal(s.aa, 'avoidance_pct') : undefined,
    spa169: s.aa ? aaTotal(s.aa, 'melee_crit_pct') : undefined,
    attackAA: s.aa ? aaTotal(s.aa, 'attack') : undefined,
    ambidexterity: s.aa ? aaTotal(s.aa, 'dual_wield_pct') : undefined
  }
}

/** A typed-over figure, else the filled-in one, else 0. */
export const valOf = (s: StatsSheet, auto: Auto): Val => (k) => s.overrides[k] ?? auto[k] ?? 0

export function acInputs(s: StatsSheet, trio: string[], primary: string, val: Val, skill: Skill): AcInputs {
  return {
    trio,
    cls: primary,
    race: s.race,
    level: s.level,
    defense: skill(15),
    agility: s.agility,
    heroicAgility: s.heroicAgility,
    heroicStrength: s.heroicStrength,
    weight: s.weight,
    drunk: s.drunk,
    itemAC: val('itemAC'),
    shieldAC: val('shieldAC'),
    itemAvoidance: s.itemAvoidance,
    foodDrinkAC: s.foodDrinkAC,
    tributeAC: s.tributeAC,
    acBuffs: s.acBuffs,
    armorOfWisdom: s.armorOfWisdom,
    herosFortitude: s.herosFortitude,
    combatStability: val('combatStability'),
    evasion: val('evasion'),
    softCap: val('softCap'),
    multiplier: val('multiplier')
  }
}

/**
 * The AC calculator's result for a character from what the tracker knows: the sheet, worn gear, the
 * game's soft cap table for its classes, and its AAs. For pages other than Stats.
 */
export function characterAc(s: StatsSheet, acCaps: AcCaps, gear: GearAc | null) {
  const trio = classTrio(s)
  const primary = primaryClass(trio, acCaps)
  const val = valOf(s, autoValues(s, acCaps, primary, gear))
  return computeAc(acInputs(s, trio, primary, val, (id) => s.skills[id] ?? 0))
}

/** The AC tab: the result, what it means for this character, and every step. */
export function acReport(i: AcInputs, primary: string) {
  const r = computeAc(i)
  const full = Math.min(r.srv.total, r.effCap)
  const sum = Math.max(1, r.srv.total)
  const notes: Note[] = []
  if (r.srv.twinkCapped)
    notes.push(['warn', 'The anti-twink cap is biting.', `Below level 50 the server holds worn AC at 25 + 6 × level = ${num(r.srv.twink)}, cutting ${num(r.disp.eqmath - r.srv.twink)}. Your Inventory window never shows that cut.`])
  if (r.shield) notes.push(['good', `Your shield carries ${num(r.shield)} AC.`, 'It lifts the soft cap point for point, so every one of those counts in full.'])
  else notes.push(['tip', 'No shield.', 'A shield raises the soft cap by its own AC, which makes shield AC the best AC in the game.'])
  if (r.over) {
    const g = marginal(i, ['itemAC'])
    const sh = r.shield ? marginal(i, ['shieldAC', 'itemAC']) : 0
    notes.push([
      '',
      `One more AC on gear is worth ${g.toFixed(2)} mitigation AC;`,
      r.shield ? `one more on your shield is worth ${sh.toFixed(2)}, about ${g > 0 ? (sh / g).toFixed(1) : '—'}× as much.` : 'a shield would be worth far more, because its AC lifts the cap as well.'
    ])
    const buff = marginal(i, ['acBuffs'])
    notes.push(['', `An AC buff point is worth ${buff.toFixed(2)}.`, `Buff AC counts a ${r.srv.silk ? 'third' : 'quarter'} before the cap, where gear counts 4/3.`])
  } else notes.push(['good', 'You are under the soft cap.', `${num(r.effCap - r.srv.total)} to go, and every point counts in full until then.`])
  if (r.srv.rc.caps) {
    const c = r.srv.rc.caps
    if (r.srv.rc.monkPenalty) notes.push(['warn', 'Over the monk weight hard cap.', `Carrying ${num(i.weight)} against a hard cap of ${c.hard} costs you ${num(-r.srv.rc.monk)} AC.`])
    else notes.push([r.srv.rc.monk > 0 ? 'good' : '', `Monk weight bonus: ${num(r.srv.rc.monk)} AC.`, `Soft cap ${c.soft}, hard cap ${c.hard}, carrying ${num(i.weight)}.`])
  }
  if (r.srv.rc.cls) notes.push(['good', `Agility bonus: ${num(r.srv.rc.cls)} AC.`, `From level ${i.level} at ${num(i.agility)} agility.`])
  if (r.srv.rc.iksar) notes.push(['good', `Iksar racial: ${num(r.srv.rc.iksar)} AC.`, 'Your level, held between 10 and 35.'])
  if (r.d.red < 1) notes.push(['warn', 'Drunk enough to lose avoidance.', `Your Computed Defence is cut to ${Math.round(r.d.red * 100)}% of ${num(r.d.raw)}.`])

  const rows: Row[] = [
    ['#Avoidance: Computed Defence, then EQEmu'],
    [`defence ${num(i.defense)} × 400 / 225`, r.d.skill, 'Defense skill, from the Combat tab'],
    [`8000 × (${num(i.agility)} agility − 40) / 36000`, r.d.agi],
    [`heroic agility ${num(i.heroicAgility)} / 10`, r.d.hagi],
    ['item avoidance, up to 100', r.d.avoid],
    ["Dzarn's Computed Defence", r.d.total],
    [`+ 10, × (100 + ${num(i.evasion)}% avoidance AAs) / 100`, r.avoidance, 'EQEmu GetTotalDefense, SPA 172'],
    ['#AC Sum'],
    ['AC on every equipped item but ammo', i.itemAC],
    ...(i.foodDrinkAC ? [['food and drink', i.foodDrinkAC] as [string, number]] : []),
    ...(i.tributeAC ? [['tribute and trophies', i.tributeAC] as [string, number]] : []),
    ['× 4 / 3', r.disp.eqmath],
    ...(r.srv.twinkCapped ? [[`server only: held at 25 + 6 × ${i.level}`, r.srv.twink, 'anti-twink'] as [string, number, string]] : []),
    ...(r.srv.rc.total ? [['race and class bonus', r.srv.rc.total] as [string, number]] : []),
    [`defence skill / ${r.srv.silk ? 2 : 3}`, r.srv.def],
    ...(i.acBuffs ? [[`AC buffs / ${r.srv.silk ? 3 : 4}`, r.srv.buffs] as [string, number]] : []),
    ...(i.armorOfWisdom ? [['Armor of Wisdom', r.srv.aow] as [string, number]] : []),
    ...(i.herosFortitude ? [["Hero's Fortitude", r.srv.hf] as [string, number]] : []),
    ...(r.srv.agi ? [[`agility over 70: ${num(i.agility)} / 20`, r.srv.agi] as [string, number]] : []),
    ['AC Sum, as the server has it', r.srv.total],
    ['#Mitigation AC'],
    [`${className(primary)} soft cap`, i.softCap, 'Resources/ACMitigation.txt'],
    [`+ Combat Stability ${num(i.combatStability)}%`, r.capWithAA, 'SPA 259'],
    ...(r.shield ? [[`+ shield ${num(i.shieldAC)} and heroic strength / 10`, r.effCap] as [string, number]] : []),
    ['effective soft cap', r.effCap],
    ...(r.over
      ? ([
          [`${num(r.srv.total)} − ${num(r.effCap)}, the part over the cap`, r.srv.total - r.effCap],
          [`× ${i.multiplier} post-cap multiplier`, r.kept],
          ['Mitigation AC', r.mitigation]
        ] as [string, number][])
      : ([['under the cap, so nothing is lost', r.mitigation]] as [string, number][])),
    ['#For reference'],
    ["Dzarn's displayed AC", r.displayed, 'EverQuest Legends does not show this one']
  ]
  return { r, full, sum, notes, rows }
}

/** The Combat tab: attack line, swings and crit, what they mean for this character, and every step. */
export function combatReport(s: StatsSheet, val: Val, trio: string[], caps: Caps, skill: Skill) {
  const lvl = s.level
  const capOf = (id: number) => caps.skills.find((x) => x.id === id)?.cap ?? 0
  const weaponName = WEAPON_SKILLS.find(([id]) => id === s.weapon)?.[1] ?? 'Hand to Hand'
  const wsk = skill(s.weapon)
  const offense = windowOffense(wsk, s.strength)
  const acc = baseAccuracy(skill(OFFENSE), wsk)
  const da = skill(DOUBLE_ATTACK)
  const dw = skill(DUAL_WIELD)
  const dp = doubleAttackChance(da, lvl, s.doubleAttackBonus)
  const canTriple = trio.some((c) => TRIPLE_CLASSES.includes(c))
  const taRoll = canTriple ? tripleAttackChance(skill(TRIPLE_ATTACK)) : 0
  const wp = capOf(DUAL_WIELD) ? dualWieldChance(dw, lvl, val('ambidexterity')) : 0
  const swings = swingsPerRound({ double: dp, triple: taRoll, dual: wp, doubleSkill: da })
  const innate = trio.some((c) => c === 'war' || c === 'ber') && lvl >= 12
  const classic = classicCritChance({ innate, dex: s.dexterity, heroicDex: s.heroicDex, dexCap: s.dexCap, spa169: val('spa169'), difficulty: s.critDifficulty })
  const crit = s.measuredCrit > 0 ? s.measuredCrit / 100 : classic.p
  const monk = trio.includes('mnk')
  const melee = trio.some((c) => MELEE_CLASSES.includes(c))

  const notes: Note[] = [
    ['good', `Attack line: ${num(offense)} / ${num(acc)}.`, `Offense is your ${weaponName} skill (${num(wsk)}) plus ${num(strengthOffense(s.strength))} from strength. Accuracy is Offense skill + weapon skill + 17, times 1.21. Both are EQEmu's formulas and match the stats window exactly.`],
    ['good', `${swings.toFixed(3)} swings a round.`, "EQEmu's attack rounds: double attack over 500, triple attack as skill ÷ (skill + 800) after a double, dual wield over 375. Hour-long parses on the test dummies matched it to within 0.01."]
  ]
  if (val('attackAA') || s.itemATK)
    notes.push(['', 'ATK does not show in the window.', `Your ${num(val('attackAA') + s.itemATK)} ATK from AAs and gear is left out of Offense, as the window leaves it out.`])
  if (s.measuredCrit > 0) notes.push(['good', 'Using your measured crit rate.', `The classic model gives ${pct(classic.p)} for this character, which parses contradict. The measurement wins.`])
  notes.push([
    'warn',
    'The classic crit model does not hold on EverQuest Legends.',
    'Parses give 11-12% for classes the classic model says cannot crit, unmoved by stance or a 50-point dexterity buff. Enter a measured rate.'
  ])
  if (val('spa169') > 40) notes.push(['warn', 'That crit bonus looks like an EQ Live number.', 'Combat Fury tops out at 5% on EverQuest Legends; Live values run to 230%.'])
  if (capOf(DUAL_WIELD) && da && da < 150) notes.push(['', 'Your offhand cannot double attack yet.', `That needs a double attack skill of 150; yours is ${num(da)}.`])
  if (melee)
    notes.push(
      offense < 115
        ? ['warn', 'Under 115 Offense you get no damage bonus.', `EQEmu gates the melee damage table at 115 and you are at ${num(offense)}.`]
        : ['', `Your damage table averages ${damageBonusPct(monk, offense).toFixed(1)}% of base.`, `${monk ? 'Monks have their own row' : 'The standard row'} in EQEmu's table.`]
    )

  const rows: Row[] = [
    ['#Attack line'],
    [`${weaponName} skill`, wsk],
    [`strength ${num(s.strength)}: (2 × str − 150) ÷ 3`, `+${num(strengthOffense(s.strength))}`, 'Mob::offense'],
    ['Offense', offense, 'first number'],
    [`Offense skill (cap ${num(capOf(OFFENSE))})`, skill(OFFENSE)],
    [`(Offense + ${weaponName} + 17) × 121 ÷ 100`, acc, 'compute_tohit'],
    ['in Offensive (+25%)', stanceAccuracy(acc, 25)],
    ['#Swings'],
    [`double attack (${num(da)} + level ${lvl}) / 500${s.doubleAttackBonus ? ` × ${100 + s.doubleAttackBonus}%` : ''}`, pct(dp), 'CheckDoubleAttack'],
    ...(canTriple
      ? ([
          [`triple attack skill ${num(skill(TRIPLE_ATTACK))}: c × 100 / (c + 800)`, pct(taRoll), 'CheckTripleAttack'],
          ['per round, after a double', pct(dp * taRoll)]
        ] as [string, string, string?][])
      : []),
    ...(capOf(DUAL_WIELD)
      ? ([[`dual wield (${num(dw)} + level ${lvl}${val('ambidexterity') ? ` + ${val('ambidexterity')}` : ''}) / 375`, pct(wp), 'CheckDualWield']] as [string, string, string][])
      : []),
    ['average swings a round', swings.toFixed(3)],
    ['#Crit'],
    ...(s.measuredCrit > 0 ? ([['your measured rate', pct(s.measuredCrit / 100), 'from a parse']] as [string, string, string][]) : []),
    ['innate melee crit (classic model)', innate ? 'yes' : 'no', innate ? 'Warrior or Berserker' : ''],
    ['classic model', pct(classic.p), `term ${classic.term.toFixed(1)} against ${num(s.critDifficulty)}`]
  ]
  return { weaponName, offense, acc, dp, crit, swings, notes, rows }
}
