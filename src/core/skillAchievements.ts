import type { AchSection } from '../shared/character'
import { SKILL_NAMES } from './combatModel'

// General › Skills: "Shaman's Casting Proficiency, Level 50", each objective "Reach the maximum skill
// in Divination at level 50." The achievements export lists the open objectives with no count; the
// log says each time a skill goes up ("You have become better at Divination! (190)"), and the game's
// skillcaps.txt gives the cap. The cap to reach is taken to be the Skills window's: the best of the
// character's classes at that level. Checked on one character (Shadow Knight, Monk, Shaman, all 50):
// it and the class's own cap each account for every open objective but one, and the Skills window
// shows the best cap. A skill raised at a guildmaster prints no line, so the log's value can be low.
//
// The Tradeskill sections ("Baking (150)") name the number themselves: "Reach 150 skill in Baking",
// no level and no cap to look up (LT-730). The same skill-up lines move them.

/** "You have become better at Divination! (190)". */
const BETTER = /^You have become better at (.+)! \((\d+)\)$/

/** A skill-up line's skill and its value now; null for any other line. */
export function skillUp(text: string): { skill: string; value: number } | null {
  const m = BETTER.exec(text)
  return m ? { skill: m[1], value: Number(m[2]) } : null
}

/** Each skill's last value the log gave, and when: over a stretch, or the whole history joined. */
export type SkillValues = Record<string, { value: number; at: number }>

/** Stretches' values as one, given oldest first: the later line wins. */
export function joinSkillValues(stretches: SkillValues[]): SkillValues {
  const out: SkillValues = {}
  for (const s of stretches) for (const [k, v] of Object.entries(s)) if (!out[k] || v.at >= out[k].at) out[k] = v
  return out
}

/**
 * Names the objectives and the log give otherwise than the game's tables: "Channelling", an Iksar's
 * "Tail Rake", the Tradeskill objectives' "Smithing" and "Jewelcrafting" (the log and the tables say
 * Blacksmithing and Jewelry Making).
 */
const SKILL_ALIASES: Record<string, number> = {
  channelling: 13,
  dragonpunch: 21,
  tailrake: 21,
  handtohand: 28,
  smithing: 63,
  jewelcrafting: 68
}

const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
const BY_NAME = new Map(Object.entries(SKILL_NAMES).map(([id, n]) => [norm(n), Number(id)]))

/** The skill's number in the game's tables, from the name an objective or a skill-up line gives; null when not one of them. */
export function skillId(name: string): number | null {
  const k = norm(name)
  return SKILL_ALIASES[k] ?? BY_NAME.get(k) ?? null
}

/** A skill objective still open. */
export interface SkillGoal {
  achievement: string
  /** The class the achievement is for, as the game names it: "Shadow Knight"; '' for a Tradeskill objective, which is any class's. */
  className: string
  /** As the objective names it. */
  skill: string
  /** The level whose cap is to be reached; 0 when the objective names the number itself. */
  level: number
  /** The number the objective itself asks for ("Reach 150 skill in Baking"); none when it asks for the cap. */
  goal?: number
}

const OBJECTIVE = /^Reach the maximum skill in (.+?) at level (\d+)\.?$/
const GOAL = /^Reach (\d+) skill in (.+?)\.?$/
const CLASS_OF = /^(.+?)'s .*Proficiency/

/** The skill an objective wants, in either wording; null for an objective that is not one. */
export function skillObjective(text: string): string | null {
  return OBJECTIVE.exec(text)?.[1] ?? GOAL.exec(text)?.[2] ?? null
}

/** The skill objectives the achievements export lists as still open. */
export function skillGoals(sections: AchSection[]): SkillGoal[] {
  const out: SkillGoal[] = []
  for (const sec of sections)
    for (const a of sec.ach) {
      if (a.d) continue
      for (const c of a.c) {
        if (c.d) continue
        const m = OBJECTIVE.exec(c.t)
        if (m) out.push({ achievement: a.n, className: CLASS_OF.exec(a.n)?.[1] ?? '', skill: m[1], level: Number(m[2]) })
        else {
          const g = GOAL.exec(c.t)
          if (g) out.push({ achievement: a.n, className: '', skill: g[2], level: 0, goal: Number(g[1]) })
        }
      }
    }
  return out
}

/** The log's last value of the skill an objective names, whatever name the log gives it. */
export function skillValue(values: SkillValues, skill: string): { value: number; at: number } | null {
  const id = skillId(skill)
  let best: { value: number; at: number } | null = null
  for (const [name, v] of Object.entries(values)) {
    const same = id !== null ? skillId(name) === id : norm(name) === norm(skill)
    if (same && (!best || v.at > best.at)) best = v
  }
  return best
}
