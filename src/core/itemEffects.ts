// Worn effects and combat procs on gear, and what they are worth to one character. An item's stats
// block names them ("Worn Effect: [[Unrighteous Bash]]", "Effect: [[Siphon]] (Combat, …)"); the spell
// file says what they do. Their worth is damage a minute, from the character's own melee in the log
// (see meleeTally): an effect adding 1% to their melee damage is worth the role's weapon damage weight.
//
// Exaltations work as they do for focus effects: gear holds them in slots 7-10 (focus, click, worn,
// proc), and a worn exaltation's worn effect takes the place of the item's own, a proc exaltation's
// proc the place of its proc.
//
// What is valued, and how:
//   worn, SPA 220  +N damage to a skill's hits: hits a minute × N
//   worn, SPA 227  a skill's reuse N seconds shorter: used on cooldown (near the most it can be), it
//                  is used that much more often; the extra uses land as often and hit as hard as now
//   worn, SPA 185  +N% damage to a skill (every skill for -1): that skill's damage a minute × N%
//   proc           firings a minute × damage a firing. Firings: as the log counts them when the
//                  character has fired it (split over the weapons in hand that carry it), else
//                  EQEmu's rate: 2 a minute, raised 0.075% a point of DEX. Damage: as the log has
//                  it, else the spell's direct damage, or its damage a tick over its duration; one
//                  that lasts no more than kept up the whole time, since a firing refreshes it.
// Anything else they do (a two-handed bash, a stun, a debuff) is listed without a value.

import type { InvItem } from './inventory'
import type { MeleeProfile } from './meleeTally'
import type { Spell } from './spells'
import { effectValue } from './effectValue'
import { formulaTicks } from './durations'

/** What the spell file says about an effect's spell, as much as valuing it needs. */
export type EffectSpell = Pick<Spell, 'name' | 'effects' | 'formula' | 'cap' | 'beneficial'>

const RE_WORN = /Worn Effect:\s*(?:\[\[)?([^\]|<\n]+?)(?:\|[^\]]*)?(?:\]\])?\s*(?:<br>|\n|$|\()/i
const RE_PROC = /(?<!Worn )Effect:\s*(?:\[\[)?([^\]|<\n(]+?)(?:\|[^\]]*)?(?:\]\])?\s*\(Combat/i

/** The worn effect an item's stats block names; '' for none. */
export function wornEffectOf(statsblock: string): string {
  return RE_WORN.exec(statsblock)?.[1].trim() ?? ''
}

/** The combat proc an item's stats block names; '' for none. */
export function procOf(statsblock: string): string {
  return RE_PROC.exec(statsblock)?.[1].trim() ?? ''
}

export interface ItemEffects {
  /** Each with the exaltation it comes from ('' for the item's own). */
  worn: { name: string; via: string }[]
  procs: { name: string; via: string }[]
}

/**
 * The worn effect and proc an item carries, its exaltations counted: slot 9 (worn) and slot 10
 * (proc) exaltations bring their item's worn effect and proc in place of the host's.
 * `effectsOf` is an item's own, by name.
 */
export function itemEffects(item: InvItem, effectsOf: (name: string) => { worn: string; proc: string } | undefined): ItemEffects {
  const exalted = (slot: number) => item.augs.find((a) => /\(Exaltation\)$/i.test(a.name) && a.location.endsWith(`-Slot${slot}`))
  const own = effectsOf(item.name)
  const pick = (slot: number, kind: 'worn' | 'proc') => {
    const e = exalted(slot)
    const theirs = e ? effectsOf(e.name)?.[kind] : ''
    if (theirs) return [{ name: theirs, via: e!.name }]
    return own?.[kind] ? [{ name: own[kind], via: '' }] : []
  }
  return { worn: pick(9, 'worn'), procs: pick(10, 'proc') }
}

/** What an effect the value leaves out does, in a few words. */
const SPA_WORDS: Record<number, string> = {
  1: 'AC', 2: 'attack', 3: 'movement speed', 4: 'strength', 5: 'dexterity', 6: 'agility', 7: 'stamina', 8: 'intelligence', 9: 'wisdom',
  11: 'attack speed', 15: 'mana', 21: 'stun', 35: 'disease counters', 36: 'poison counters', 46: 'fire resist', 47: 'cold resist',
  48: 'poison resist', 49: 'disease resist', 50: 'magic resist', 55: 'rune', 59: 'damage shield', 116: 'curse counters'
}
const unvalued = (spa: number, base: number) =>
  SPA_WORDS[spa] ? `${base < 0 ? 'lowers' : 'raises'} ${SPA_WORDS[spa]} (not valued)` : `spell effect ${spa} (not valued)`

/** A melee skill by its classic id, as the log names its swings, and its reuse in seconds (EQEmu's). */
const SKILLS: Record<number, { verb: string; reuse: number; label: string }> = {
  8: { verb: 'backstab', reuse: 9, label: 'backstab' },
  10: { verb: 'bash', reuse: 5, label: 'bash' },
  26: { verb: 'kick', reuse: 7, label: 'flying kick' },
  30: { verb: 'kick', reuse: 5, label: 'kick' },
  74: { verb: 'frenzy', reuse: 9, label: 'frenzy' }
}
const skillLabel = (id: number) => SKILLS[id]?.label ?? `skill ${id}`

export interface EffectWorth {
  /** Damage a minute it adds; 0 when nothing it does is valued. */
  dpm: number
  /** What it does, in words, one line per effect. */
  does: string[]
  /** How the value was reached, when there is one. */
  basis: string
}

/** A skill's use a minute swinging: hits and misses both used it. */
/**
 * A skill's use a minute swinging: hits and misses both used it. No more than its cooldown allows:
 * more swings under its name than that are another skill the log names alike (an Iksar's tail rake
 * lands as a bash), which the skill's effects do not touch.
 */
function uses(profile: MeleeProfile, skill: { verb: string; reuse: number }) {
  const s = profile.skills[skill.verb]
  if (!s || profile.activeMin <= 0) return { perMin: 0, hitsPerMin: 0, hitRate: 0, avg: 0, capped: false }
  const tries = s.hits + s.misses
  const hitRate = tries ? s.hits / tries : 0
  const seen = tries / profile.activeMin
  const perMin = Math.min(seen, 60 / skill.reuse)
  return { perMin, hitsPerMin: perMin * hitRate, hitRate, avg: s.hits ? s.damage / s.hits : 0, capped: seen > perMin }
}

/** A worn effect: what it does and what it adds to the character's melee. */
export function wornWorth(spell: EffectSpell, profile: MeleeProfile): EffectWorth {
  const does: string[] = []
  const parts: string[] = []
  let dpm = 0
  const bonus: Record<number, number> = {}
  for (const e of spell.effects) if (e.spa === 220) bonus[e.base2] = (bonus[e.base2] ?? 0) + e.base
  for (const e of spell.effects) {
    const sk = SKILLS[e.base2]
    if (e.spa === 220) {
      does.push(`+${e.base} damage to each ${skillLabel(e.base2)}`)
      if (sk) {
        const u = uses(profile, sk)
        if (u.hitsPerMin) {
          dpm += u.hitsPerMin * e.base
          parts.push(`${u.hitsPerMin.toFixed(1)} ${sk.verb} hits a minute${u.capped ? ` (the most a ${sk.reuse}s cooldown allows)` : ''} × ${e.base}`)
        }
      }
    } else if (e.spa === 227) {
      does.push(`${skillLabel(e.base2)} ready ${e.base}s sooner`)
      if (sk && e.base < sk.reuse) {
        const u = uses(profile, sk)
        const most = 60 / sk.reuse
        // Only a skill used on cooldown is used more when the cooldown is shorter.
        if (u.perMin >= 0.6 * most) {
          const extra = u.perMin * (sk.reuse / (sk.reuse - e.base) - 1)
          dpm += extra * u.hitRate * (u.avg + (bonus[e.base2] ?? 0))
          parts.push(`${extra.toFixed(1)} more ${sk.label} uses a minute`)
        }
      }
    } else if (e.spa === 185) {
      const all = e.base2 === -1
      does.push(`+${e.base}% damage to ${all ? 'every skill' : skillLabel(e.base2)}`)
      const sk185 = SKILLS[e.base2]
      const u = sk185 ? uses(profile, sk185) : null
      const base = all ? profile.dpm : u ? u.hitsPerMin * u.avg : 0
      if (base) {
        dpm += (base * e.base) / 100
        parts.push(`${e.base}% of ${Math.round(base)} a minute`)
      }
    } else if (e.spa === 226) does.push('bash while holding a two-handed weapon')
    else if (e.spa !== 10 && e.spa !== 254) does.push(unvalued(e.spa, e.base))
  }
  return { dpm, does, basis: parts.join(' + ') }
}

/** A proc's damage each time it fires, from the spell file: direct damage, or damage a tick over its duration. */
export function procDamage(spell: EffectSpell, level: number): number {
  const hurt = (spa: number) => spell.effects.filter((e) => e.spa === spa && e.base < 0).reduce((s, e) => s + Math.abs(effectValue(e, level)), 0)
  const ticks = formulaTicks(level, spell.formula, spell.cap)
  // SPA 0 in a spell that lasts is damage every tick; SPA 79 lands once.
  const perTick = hurt(0)
  const direct = perTick + hurt(79)
  return ticks > 0 ? perTick * ticks + (direct - perTick) : direct
}

/**
 * The most a proc that lasts can do a minute: a new firing refreshes it on the target rather than
 * adding a second, so it does no more than its damage a tick kept up the whole time (10 ticks a
 * minute). Infinity for one that lands once.
 */
export function procCeiling(spell: EffectSpell, level: number): number {
  if (formulaTicks(level, spell.formula, spell.cap) <= 0) return Infinity
  return spell.effects.filter((e) => e.spa === 0 && e.base < 0).reduce((s, e) => s + Math.abs(effectValue(e, level)), 0) * 10
}

/** EQEmu's proc rate for a weapon with no rate of its own: 2 a minute, raised 0.075% for each point of DEX. */
export const procsPerMinute = (dex: number) => 2 * (1 + (dex * 0.075) / 100)

/**
 * A proc on one weapon in hand. `carriers` is how many weapons worn now carry it: the log's firings
 * are theirs together.
 */
export function procWorth(spell: EffectSpell, profile: MeleeProfile, o: { level: number; dex: number; carriers: number }): EffectWorth {
  const does: string[] = []
  const damage = procDamage(spell, o.level)
  if (damage > 0) does.push(`${Math.round(damage)} damage each time it fires`)
  for (const e of spell.effects) {
    if (e.spa === 0 || e.spa === 79 || e.spa === 10 || e.spa === 254) continue
    if (e.spa === 457) does.push('returns some of the damage as health')
    else if (e.spa === 21) does.push('stuns')
    else if (e.spa === 11) does.push(e.base > 100 ? `haste ${e.base - 100}%` : `slows ${100 - e.base}%`)
    else does.push(unvalued(e.spa, e.base))
  }
  const ceiling = procCeiling(spell, o.level)
  const capped = (dpm: number, basis: string): EffectWorth =>
    dpm > ceiling ? { dpm: ceiling, does, basis: `${basis}, held to ${Math.round(ceiling)}: it refreshes rather than stacks` } : { dpm, does, basis }
  const seen = profile.procs[spell.name]
  if (seen && seen.count >= 3 && profile.activeMin > 0) {
    const ppm = seen.count / profile.activeMin / Math.max(1, o.carriers)
    const each = seen.damage / seen.count
    // A proc that lasts is ticks the log books elsewhere: its first hit alone is short of it.
    const per = Math.max(each, damage)
    return capped(ppm * per, `${ppm.toFixed(2)} a minute as your log has it × ${Math.round(per)}`)
  }
  if (damage <= 0) return { dpm: 0, does, basis: '' }
  const ppm = procsPerMinute(o.dex)
  return capped(ppm * damage, `about ${ppm.toFixed(2)} a minute (EQEmu's rate) × ${Math.round(damage)}`)
}

/** Damage a minute as the weights read it: a 1% gain to the character's melee is worth `ratioWeight`. */
export function effectScore(dpm: number, profile: MeleeProfile, ratioWeight: number): number {
  return profile.dpm > 0 ? (dpm / profile.dpm) * 100 * ratioWeight : 0
}
