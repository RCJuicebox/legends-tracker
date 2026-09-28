import type { AchSection } from '../shared/character'
import { SKILL_NAMES } from './combatModel'

// General › Skills: "Shaman's Casting Proficiency, Level 50", each objective "Reach the maximum skill
// in Divination at level 50." The achievements export lists the open objectives with no count; the
// log says each time a skill goes up ("You have become better at Divination! (190)"), and the game's
// skillcaps.txt gives the cap. The cap to reach is taken to be the Skills window's: the best of the
// character's classes at that level. Checked on one character (Shadow Knight, Monk, Shaman, all 50):
// it and the class's own cap each account for every open objective but one, and the Skills window
// shows the best cap. A skill raised at a guildmaster prints no line, so the log's value can be low.

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

/** Names the objectives and the log give otherwise than the game's tables: "Channelling", an Iksar's "Tail Rake". */
const SKILL_ALIASES: Record<string, number> = {
  channelling: 13,
  dragonpunch: 21,
  tailrake: 21,
  handtohand: 28
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
  /** The class the achievement is for, as the game names it: "Shadow Knight". */
  className: string
  /** As the objective names it. */
  skill: string
  level: number
}

const OBJECTIVE = /^Reach the maximum skill in (.+?) at level (\d+)\.?$/
const CLASS_OF = /^(.+?)'s .*Proficiency/

/** The skill objectives the achievements export lists as still open. */
export function skillGoals(sections: AchSection[]): SkillGoal[] {
  const out: SkillGoal[] = []
  for (const sec of sections)
    for (const a of sec.ach) {
      if (a.d) continue
      for (const c of a.c) {
        const m = c.d ? null : OBJECTIVE.exec(c.t)
        if (m) out.push({ achievement: a.n, className: CLASS_OF.exec(a.n)?.[1] ?? '', skill: m[1], level: Number(m[2]) })
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
