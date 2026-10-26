// The character's own melee, day by day, from their log: what gear effects that act on swings are
// weighed against. Each day keeps plain counters, so days add up and a window can be taken:
//   active          milliseconds spent swinging (gaps between swings up to MELEE_GAP_MS)
//   m|bash|h / |d / |x / |c    a melee skill's hits, damage, misses and crits ("bash", "kick", "punch" …)
//   p|Lifebite|n / |d     a proc's firings and damage: spell damage from you with no cast of that
//                         spell just before it (the meter's rule)
//   p|Lifebite|a / |i     melee time between one firing and the next, and how many such gaps: the
//                         time it was worn, so the days before it was (or after it came off) leave its
//                         rate alone

import { parseCombatLine, SELF } from './combatLines'
import { CAST_WINDOW_MS, spellBase } from './combatMeter'
import { localDay } from './dates'
import type { LogLine } from './logLine'

type Days = Record<string, Record<string, number>>

/** Swings further apart than this are two stretches of fighting: the time between is not counted. */
const MELEE_GAP_MS = 6000

/**
 * More swinging than this between two firings of a proc is taken as time it was not worn: it counts
 * toward neither. Two a minute almost never goes 20 minutes without one.
 */
export const PROC_WORN_GAP_MS = 20 * 60_000

/** A fresh counter: it remembers the last swing and the last casts across the lines it reads. */
export function meleeCounter(): (line: LogLine, into: Days) => void {
  let lastSwing = 0
  // Melee time so far, and where it stood at each proc's last firing.
  let swung = 0
  const fired = new Map<string, number>()
  const casts = new Map<string, number>()
  return (line, into) => {
    // Everything counted here is the player's own, and the log starts each such line "You ": the
    // rest (most of a raid's lines) never reach the parser.
    if (!line.text.startsWith('You ')) return
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
      if (lastSwing && t >= lastSwing && t - lastSwing <= MELEE_GAP_MS) {
        add('active', t - lastSwing)
        swung += t - lastSwing
      }
      lastSwing = t
    }
    if (ev.kind === 'damage' && ev.source === SELF) {
      if (ev.how === 'melee') {
        add(`m|${ev.skill}|h`, 1)
        add(`m|${ev.skill}|d`, ev.amount)
        // What the Stats page's crit rate is measured from (LT-739): a Crippling Blow or Slay Undead is one.
        if (ev.mods.includes('critical') || ev.mods.includes('crippling blow') || ev.mods.includes('slay undead')) add(`m|${ev.skill}|c`, 1)
        swing()
      } else if (ev.how === 'spell') {
        const cast = casts.get(spellBase(ev.skill))
        if (cast === undefined || t - cast > CAST_WINDOW_MS || t < cast) {
          add(`p|${ev.skill}|n`, 1)
          add(`p|${ev.skill}|d`, ev.amount)
          const last = fired.get(ev.skill)
          if (last !== undefined && swung - last <= PROC_WORN_GAP_MS) {
            add(`p|${ev.skill}|a`, swung - last)
            add(`p|${ev.skill}|i`, 1)
          }
          fired.set(ev.skill, swung)
        }
      }
    } else if (ev.kind === 'miss' && ev.source === SELF) {
      add(`m|${ev.skill}|x`, 1)
      swing()
    }
  }
}

interface SkillUse {
  hits: number
  damage: number
  misses: number
  /** Hits that crit. */
  crits: number
}

export interface MeleeProfile {
  /** Minutes spent swinging. */
  activeMin: number
  /** Melee damage (procs and spells aside) and its rate per minute swinging. */
  damage: number
  dpm: number
  /** Per melee skill as the log names it ("bash", "kick", "punch"). */
  skills: Record<string, SkillUse>
  /**
   * Per proc as the log names it ("Lifebite"): its firings and damage, and the melee minutes between
   * firings (`wornMin`, over `gaps` of them), which is its rate while worn.
   */
  procs: Record<string, { count: number; damage: number; wornMin: number; gaps: number }>
  /** The first and last day counted, "2026-09-10"; '' when nothing was. */
  from: string
  to: string
}

/** Every melee skill's hits, crits and misses together: what a crit rate and a hit rate are measured from (LT-739). */
export function meleeRates(p: MeleeProfile): { hits: number; crits: number; misses: number } {
  let hits = 0
  let crits = 0
  let misses = 0
  for (const s of Object.values(p.skills)) {
    hits += s.hits
    crits += s.crits
    misses += s.misses
  }
  return { hits, crits, misses }
}

/** Counters summed over a window (as the day tally hands them back) read as a profile. */
export function meleeProfile(counts: Record<string, number>, window: { from: string; to: string }): MeleeProfile {
  const skills: Record<string, SkillUse> = {}
  const procs: MeleeProfile['procs'] = {}
  let damage = 0
  for (const [key, v] of Object.entries(counts)) {
    const [kind, name, what] = key.split('|')
    if (kind === 'm') {
      const s = (skills[name] ??= { hits: 0, damage: 0, misses: 0, crits: 0 })
      if (what === 'h') s.hits += v
      else if (what === 'd') {
        s.damage += v
        damage += v
      } else if (what === 'x') s.misses += v
      else if (what === 'c') s.crits += v
    } else if (kind === 'p') {
      const p = (procs[name] ??= { count: 0, damage: 0, wornMin: 0, gaps: 0 })
      if (what === 'n') p.count += v
      else if (what === 'd') p.damage += v
      else if (what === 'a') p.wornMin += v / 60_000
      else if (what === 'i') p.gaps += v
    }
  }
  const activeMin = (counts.active ?? 0) / 60_000
  return { activeMin, damage, dpm: activeMin > 0 ? damage / activeMin : 0, skills, procs, from: window.from, to: window.to }
}
