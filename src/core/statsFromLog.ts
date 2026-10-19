import { meleeRates, type MeleeProfile } from './meleeTally'
import { skillId, type SkillValues } from './skillAchievements'
import { restrictions } from './gearFinder'
import { itemKey, wornTotals, type InvItem } from './inventory'
import { statsFor } from './wornGear'
import { WEAPON_SKILLS } from './combatModel'
import type { ItemInfo } from '../shared/types'
import type { StatsFromLog } from '../shared/ipc'

// What Stats › Combat would otherwise have the player type (LT-739): the crit and hit rates the log's
// own melee measures, every skill's last value from the skill-up lines, and from the worn gear the
// Primary's weapon skill and the ATK items give.

/** The skill ids of the weapon skills, by the name an item's "Skill:" gives ("1H Slashing"). */
const WEAPON_BY_NAME = new Map(WEAPON_SKILLS.map(([id, name]) => [name.toLowerCase(), id]))

export function statsFromLog(o: { profile: MeleeProfile | null; skills: SkillValues; worn: InvItem[]; items: Record<string, ItemInfo> }): StatsFromLog {
  const rates = o.profile ? meleeRates(o.profile) : null
  const skills: Record<number, number> = {}
  for (const [name, v] of Object.entries(o.skills)) {
    const id = skillId(name)
    if (id !== null) skills[id] = Math.max(skills[id] ?? 0, v.value)
  }
  const primary = o.worn.find((it) => it.location === 'Primary')
  const info = primary ? o.items[itemKey(primary.name)] : undefined
  const skill = info?.found ? restrictions(info.statsblock).skill.toLowerCase() : ''
  const weapon = primary ? (WEAPON_BY_NAME.get(skill) ?? null) : WEAPON_BY_NAME.get('hand to hand')!
  const totals = o.worn.length ? wornTotals(o.worn, (it) => statsFor(o.items, it.name)) : null
  return {
    ...(rates && rates.hits + rates.misses > 0 ? { melee: { ...rates, from: o.profile!.from, to: o.profile!.to } } : {}),
    skills,
    ...(weapon !== null && weapon !== undefined ? { weapon } : {}),
    ...(totals ? { itemATK: totals.attack } : {})
  }
}
