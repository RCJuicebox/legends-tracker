// The character's own melee, day by day, from their log: what gear effects that act on swings are
// weighed against. Each day keeps plain counters, so days add up and a window can be taken:
//   active          milliseconds spent swinging (gaps between swings up to MELEE_GAP_MS)
//   m|bash|h / |d / |x    a melee skill's hits, damage and misses ("bash", "kick", "punch" …)
//   p|Lifebite|n / |d     a proc's firings and damage: spell damage from you with no cast of that
//                         spell just before it (the meter's rule)

import { parseCombatLine, SELF } from './combatLines'
import { CAST_WINDOW_MS, spellBase } from './combatMeter'
import { localDay } from './dates'
import type { LogLine } from './logLine'

type Days = Record<string, Record<string, number>>

/** Swings further apart than this are two stretches of fighting: the time between is not counted. */
export const MELEE_GAP_MS = 6000

/** A fresh counter: it remembers the last swing and the last casts across the lines it reads. */
export function meleeCounter(): (line: LogLine, into: Days) => void {
  let lastSwing = 0
  const casts = new Map<string, number>()
  return (line, into) => {
    const ev = parseCombatLine(line.text)
    if (!ev) return
    const t = line.time
    if (ev.kind === 'cast') {
      if (ev.source === SELF) casts.set(spellBase(ev.spell), t)
      return
    }
    const add = (key: string, v: number) => {
      const day = (into[localDay(t)] ??= {})
      day[key] = (day[key] ?? 0) + v
    }
    const swing = () => {
      if (lastSwing && t >= lastSwing && t - lastSwing <= MELEE_GAP_MS) add('active', t - lastSwing)
      lastSwing = t
    }
    if (ev.kind === 'damage' && ev.source === SELF) {
      if (ev.how === 'melee') {
        add(`m|${ev.skill}|h`, 1)
        add(`m|${ev.skill}|d`, ev.amount)
        swing()
      } else if (ev.how === 'spell') {
        const cast = casts.get(spellBase(ev.skill))
        if (cast === undefined || t - cast > CAST_WINDOW_MS || t < cast) {
          add(`p|${ev.skill}|n`, 1)
          add(`p|${ev.skill}|d`, ev.amount)
        }
      }
    } else if (ev.kind === 'miss' && ev.source === SELF) {
      add(`m|${ev.skill}|x`, 1)
      swing()
    }
  }
}

export interface SkillUse {
  hits: number
  damage: number
  misses: number
}

export interface MeleeProfile {
  /** Minutes spent swinging. */
  activeMin: number
  /** Melee damage (procs and spells aside) and its rate per minute swinging. */
  damage: number
  dpm: number
  /** Per melee skill as the log names it ("bash", "kick", "punch"). */
  skills: Record<string, SkillUse>
  /** Per proc as the log names it ("Lifebite"). */
  procs: Record<string, { count: number; damage: number }>
  /** The first and last day counted, "2026-09-10"; '' when nothing was. */
  from: string
  to: string
}

/** Counters summed over a window (as the day tally hands them back) read as a profile. */
export function meleeProfile(counts: Record<string, number>, window: { from: string; to: string }): MeleeProfile {
  const skills: Record<string, SkillUse> = {}
  const procs: Record<string, { count: number; damage: number }> = {}
  let damage = 0
  for (const [key, v] of Object.entries(counts)) {
    const [kind, name, what] = key.split('|')
    if (kind === 'm') {
      const s = (skills[name] ??= { hits: 0, damage: 0, misses: 0 })
      if (what === 'h') s.hits += v
      else if (what === 'd') {
        s.damage += v
        damage += v
      } else if (what === 'x') s.misses += v
    } else if (kind === 'p') {
      const p = (procs[name] ??= { count: 0, damage: 0 })
      if (what === 'n') p.count += v
      else if (what === 'd') p.damage += v
    }
  }
  const activeMin = (counts.active ?? 0) / 60_000
  return { activeMin, damage, dpm: activeMin > 0 ? damage / activeMin : 0, skills, procs, from: window.from, to: window.to }
}
