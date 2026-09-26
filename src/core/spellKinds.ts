// What kind of thing a spell is, read from its spell-file row. Shared by the buff tracker, the pet
// optimizer and the spell mote advice, and free of Node so the renderer can use it too.

import type { SpellEffect } from './spells'

/** Casting skills of songs: singing, brass, stringed, wind, percussion. */
export const SONG_SKILLS = [12, 41, 49, 54, 70]

/** The summoning effects: summon pet, summon skeleton pet, summon warder. */
export const SUMMON_SPAS = [33, 71, 106]

export function isSong(spell: { skill: number }): boolean {
  return SONG_SKILLS.includes(spell.skill)
}

export function summonsPet(spell: { effects: SpellEffect[] }): boolean {
  return spell.effects.some((e) => SUMMON_SPAS.includes(e.spa))
}
