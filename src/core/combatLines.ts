// EverQuest Legends combat lines, as the log prints them. Every shape here was taken from a real
// log (Kelwyn's, September 2026); the regular expressions are anchored so a line is never half-read.
//
//   You punch a fetid fiend for 48 points of damage. (Critical)
//   Jobarab slashes an ire ghast for 47 points of damage.
//   A forsaken revenant hits YOU for 122 points of damage.
//   You try to punch a scareling, but miss! (Riposte)
//   A scareling tries to hit YOU, but YOU dodge!
//   You hit a fetid fiend for 444 points of magic damage by Drain Spirit.
//   a fetid fiend hit you for 220 points of fire damage by Scorching Arrow.
//   Cleric of Innoruuk has taken 499 damage from your Odium X.
//   A loathling lich has taken 80 damage from Oathbreaker's Curse by Jobarab.
//   You have taken 105 damage from Scorching Arrow by a fetid fiend.
//   A fetid fiend is pierced by YOUR thorns for 3 points of non-melee damage.
//   YOU are burned by a fetid fiend's flames for 24 points of non-melee damage!
//   Dorran is burned by a decrepit warder's flames for 16 points of non-melee damage.
//   You healed Kelwyn for 444 hit points by Drain Spirit.
//   Brenna healed itself for 0 (80) hit points by Oathbreaker's Curse.
//   You healed Kelwyn over time for 235 hit points by Slugs Healing. (Critical)
//   You gain a rune for 32 points of absorption.
//   You have slain a forsaken revenant!  /  A skeleton has been slain by Gabartik!
//   Jobarab told you, 'Attacking a forsaken revenant Master.'

/** The player, however the log spells it: You, YOU, you, YOUR, or the character's own name. */
export const SELF = 'You'

export type MissOutcome = 'miss' | 'dodge' | 'parry' | 'block' | 'riposte' | 'absorb'

export type CombatEvent =
  | { kind: 'damage'; source: string; target: string; amount: number; how: 'melee' | 'spell' | 'dot' | 'ds'; skill: string; mods: string[] }
  | { kind: 'miss'; source: string; target: string; skill: string; outcome: MissOutcome; mods: string[] }
  | { kind: 'heal'; source: string; target: string; amount: number; raw: number; spell: string; hot: boolean; mods: string[] }
  | { kind: 'rune'; target: string; amount: number }
  | { kind: 'kill'; target: string; killer: string | null }
  | { kind: 'resist'; source: string; target: string; spell: string }
  | { kind: 'pet'; pet: string; owner: string }
  | { kind: 'group'; who: string; action: 'joined' | 'left' | 'invited' | 'youJoined' | 'youLeft' }
  | { kind: 'cast'; source: string; spell: string }

const VERBS_1ST = 'hit|slash|punch|kick|bash|pierce|crush|bite|claw|strike|shoot|backstab|frenzy|maul|gore|sting|slice|cleave|reave|smash|rake|lacerate|sweep|stomp|whip|burn|impale|gouge|blast'
const VERBS_3RD = 'hits|slashes|punches|kicks|bashes|pierces|crushes|bites|claws|strikes|shoots|backstabs|frenzies|mauls|gores|stings|slices|cleaves|reaves|smashes|rakes|lacerates|sweeps|stomps|whips|burns|impales|gouges|blasts'
const TAG = String.raw`(?: \((.+)\))?`

const RE_MELEE_YOU = new RegExp(String.raw`^You (${VERBS_1ST}) (.+?) for (\d+) points? of damage\.${TAG}$`)
const RE_MELEE = new RegExp(String.raw`^(.+?) (${VERBS_3RD}) (.+?) for (\d+) points? of damage\.${TAG}$`)
const RE_MISS_YOU = /^You try to (\w+) (.+?), but (.+)!(?: \((.+)\))?$/
const RE_MISS = /^(.+?) tries to (\w+) (.+?), but (.+)!(?: \((.+)\))?$/
const RE_SPELL_YOU = /^You hit (.+?) for (\d+) points? of (\w+) damage by (.+?)\.(?: \((.+)\))?$/
const RE_SPELL = /^(.+?) hit (.+?) for (\d+) points? of (\w+) damage by (.+?)\.(?: \((.+)\))?$/
const RE_DOT_YOU = /^(.+?) has taken (\d+) damage from your (.+?)\.(?: \((.+)\))?$/
const RE_DOT_ON_YOU = /^You have taken (\d+) damage from (.+?) by (.+?)\.(?: \((.+)\))?$/
const RE_DOT = /^(.+?) has taken (\d+) damage from (.+?) by (.+?)\.(?: \((.+)\))?$/
const RE_DOT_NO_CASTER = /^(.+?) has taken (\d+) damage by (.+?)\.(?: \((.+)\))?$/
const RE_DS_YOU = /^(.+?) is \w+ by YOUR (\w+) for (\d+) points? of non-melee damage\.$/
const RE_DS_ON_YOU = /^YOU are \w+ by (.+?)'s (\w+) for (\d+) points? of non-melee damage!$/
const RE_DS = /^(.+?) is \w+ by (.+?)'s (\w+) for (\d+) points? of non-melee damage\.$/
const RE_HEAL = /^(.+?) healed (.+?)( over time)? for (\d+)(?: \((\d+)\))? hit points by (.+?)\.(?: \((.+)\))?$/
const RE_RUNE = /^(.+?) gains? a rune for (\d+) points? of absorption\.$/
const RE_SLAIN_YOU = /^You have slain (.+)!$/
const RE_SLAIN_BY = /^(.+) has been slain by (.+)!$/
const RE_DIED = /^(.+) died\.$/
const RE_YOU_DIED = /^You died\.$/
const RE_YOU_SLAIN = /^You have been slain by (.+)!$/
const RE_RESIST_YOU = /^(.+?) resisted your (.+)!$/
const RE_RESIST = /^(.+?) resisted (.+?)'s (.+)!$/
// "<pet> told you, 'Attacking a fetid fiend Master.'" — only a pet of yours says this; a player's
// tell is present tense ("tells you").
const RE_PET_ATTACK = /^(.+?) told you, 'Attacking .+ Master\.'$/
const RE_PET_LEADER = /^(.+?) says, 'My leader is (.+?)\.'$/
const RE_JOINED = /^(.+) has joined the group\.$/
const RE_LEFT = /^(.+) has left the group\.$/
const RE_REMOVED = /^(.+) has been removed from the group\.$/
const RE_YOU_REMOVE = /^You remove (.+) from the group\.$/
// Accepting an invite logs only "You have joined the group.": the inviter's own join never prints,
// so the invite line is what names them.
const RE_INVITED = /^(.+) invites you to join a group\.$/
const RE_YOU_JOINED = /^You have joined the group\.$/
const RE_YOU_LEFT = /^(?:You have been removed from the group\.|You have left the group\.|Your group has been disbanded\.|You disband the group\.)$/
const RE_CAST_YOU = /^You begin (?:casting|singing) (.+)\.$/
const RE_CAST = /^(.+?) begins (?:casting|singing) (.+)\.$/

/** The log's spellings of the player, in any position. */
function self(name: string): string {
  return name === 'You' || name === 'YOU' || name === 'you' || name === 'YOUR' || name === 'your' ? SELF : name
}

/** "itself", "herself", "himself": the healer healed the healer. */
function reflexive(name: string): boolean {
  return name === 'itself' || name === 'herself' || name === 'himself' || name === 'themself' || name === 'themselves'
}

/** "(Riposte Critical)" → ["riposte", "critical"]; two-word modifiers stay one. */
export function parseMods(tag: string | undefined): string[] {
  if (!tag) return []
  return tag
    .replace(/Finishing Blow/g, 'finishing-blow')
    .replace(/Crippling Blow/g, 'crippling-blow')
    .replace(/Double Bow Shot/g, 'double-bow-shot')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase().replace(/-/g, ' '))
}

function outcomeOf(tail: string): MissOutcome | null {
  if (tail === 'miss' || tail === 'misses') return 'miss'
  if (tail.endsWith('absorbs the blow')) return 'absorb'
  if (/ dodges?$/.test(tail)) return 'dodge'
  if (/ parries$|^YOU parry$/.test(tail)) return 'parry'
  if (/ blocks?$/.test(tail)) return 'block'
  if (/ ripostes?$/.test(tail)) return 'riposte'
  return null
}

/** A spell name as the log prints it in a damage line; nothing to strip today, kept as one place to do it. */
const spell = (s: string) => s

/**
 * The combat event on a log line, or null for a line that is not one. Names come back as the log
 * spells them ("a fetid fiend", "Cleric of Innoruuk"), except the player, who is always `SELF`.
 */
export function parseCombatLine(text: string): CombatEvent | null {
  let m: RegExpExecArray | null
  const c = text.charCodeAt(0)
  // Most lines start "You"; the cheap checks first.
  if (c === 89 /* Y */) {
    if ((m = RE_MELEE_YOU.exec(text))) return { kind: 'damage', source: SELF, target: self(m[2]), amount: +m[3], how: 'melee', skill: m[1], mods: parseMods(m[4]) }
    if ((m = RE_MISS_YOU.exec(text))) {
      const outcome = outcomeOf(m[3])
      return outcome ? { kind: 'miss', source: SELF, target: self(m[2]), skill: m[1], outcome, mods: parseMods(m[4]) } : null
    }
    if ((m = RE_SPELL_YOU.exec(text))) return { kind: 'damage', source: SELF, target: self(m[1]), amount: +m[2], how: 'spell', skill: spell(m[4]), mods: parseMods(m[5]) }
    if ((m = RE_DOT_ON_YOU.exec(text))) return { kind: 'damage', source: m[3], target: SELF, amount: +m[1], how: 'dot', skill: spell(m[2]), mods: parseMods(m[4]) }
    if ((m = RE_DS_ON_YOU.exec(text))) return { kind: 'damage', source: m[1], target: SELF, amount: +m[3], how: 'ds', skill: `Damage shield (${m[2]})`, mods: [] }
    if ((m = RE_SLAIN_YOU.exec(text))) return { kind: 'kill', target: m[1], killer: SELF }
    if (RE_YOU_DIED.test(text)) return { kind: 'kill', target: SELF, killer: null }
    if ((m = RE_YOU_SLAIN.exec(text))) return { kind: 'kill', target: SELF, killer: m[1] }
    if (RE_YOU_JOINED.test(text)) return { kind: 'group', who: SELF, action: 'youJoined' }
    if (RE_YOU_LEFT.test(text)) return { kind: 'group', who: SELF, action: 'youLeft' }
    if ((m = RE_YOU_REMOVE.exec(text))) return { kind: 'group', who: m[1], action: 'left' }
    if ((m = RE_CAST_YOU.exec(text))) return { kind: 'cast', source: SELF, spell: m[1] }
  }
  if ((m = RE_MELEE.exec(text))) return { kind: 'damage', source: self(m[1]), target: self(m[3]), amount: +m[4], how: 'melee', skill: m[2], mods: parseMods(m[5]) }
  if ((m = RE_MISS.exec(text))) {
    // "tries to cast a spell on you, but you are protected." is a spell, not a swing.
    const outcome = outcomeOf(m[4])
    return outcome ? { kind: 'miss', source: self(m[1]), target: self(m[3]), skill: m[2], outcome, mods: parseMods(m[5]) } : null
  }
  if ((m = RE_SPELL.exec(text))) return { kind: 'damage', source: self(m[1]), target: self(m[2]), amount: +m[3], how: 'spell', skill: spell(m[5]), mods: parseMods(m[6]) }
  if ((m = RE_DOT_YOU.exec(text))) return { kind: 'damage', source: SELF, target: self(m[1]), amount: +m[2], how: 'dot', skill: spell(m[3]), mods: parseMods(m[4]) }
  if ((m = RE_DOT.exec(text))) return { kind: 'damage', source: self(m[4]), target: self(m[1]), amount: +m[2], how: 'dot', skill: spell(m[3]), mods: parseMods(m[5]) }
  if ((m = RE_DOT_NO_CASTER.exec(text))) return { kind: 'damage', source: '', target: self(m[1]), amount: +m[2], how: 'dot', skill: spell(m[3]), mods: parseMods(m[4]) }
  if ((m = RE_DS_YOU.exec(text))) return { kind: 'damage', source: SELF, target: self(m[1]), amount: +m[3], how: 'ds', skill: `Damage shield (${m[2]})`, mods: [] }
  if ((m = RE_DS.exec(text))) return { kind: 'damage', source: self(m[2]), target: self(m[1]), amount: +m[4], how: 'ds', skill: `Damage shield (${m[3]})`, mods: [] }
  if ((m = RE_HEAL.exec(text))) {
    const source = self(m[1])
    const target = reflexive(m[2]) ? source : self(m[2])
    const amount = +m[4]
    return { kind: 'heal', source, target, amount, raw: m[5] ? +m[5] : amount, spell: m[6], hot: !!m[3], mods: parseMods(m[7]) }
  }
  if ((m = RE_RUNE.exec(text))) return { kind: 'rune', target: self(m[1]), amount: +m[2] }
  if ((m = RE_SLAIN_BY.exec(text))) return { kind: 'kill', target: self(m[1]), killer: self(m[2]) }
  if ((m = RE_DIED.exec(text))) return { kind: 'kill', target: self(m[1]), killer: null }
  if ((m = RE_RESIST_YOU.exec(text))) return { kind: 'resist', source: SELF, target: self(m[1]), spell: m[2] }
  if ((m = RE_RESIST.exec(text))) return { kind: 'resist', source: self(m[2]), target: self(m[1]), spell: m[3] }
  if ((m = RE_PET_ATTACK.exec(text))) return { kind: 'pet', pet: m[1], owner: SELF }
  if ((m = RE_PET_LEADER.exec(text))) return { kind: 'pet', pet: m[1], owner: self(m[2]) }
  if ((m = RE_JOINED.exec(text))) return { kind: 'group', who: m[1], action: 'joined' }
  if ((m = RE_INVITED.exec(text))) return { kind: 'group', who: m[1], action: 'invited' }
  if ((m = RE_LEFT.exec(text)) || (m = RE_REMOVED.exec(text))) return { kind: 'group', who: m[1], action: 'left' }
  if ((m = RE_CAST.exec(text))) return { kind: 'cast', source: self(m[1]), spell: m[2] }
  return null
}

/** Whether a line could be a combat line at all, for skipping the rest cheaply. */
export function looksLikeCombat(text: string): boolean {
  return (
    text.includes(' points of ') ||
    text.includes(' damage') ||
    text.includes(', but ') ||
    text.includes(' hit points ') ||
    text.includes('slain') ||
    text.includes(' died.') ||
    text.includes(' resisted ') ||
    text.includes(' told you, ') ||
    text.includes('My leader is') ||
    text.includes('the group') ||
    text.includes(' invites you to join a group') ||
    text.includes('Your group has been disbanded') ||
    text.includes(' rune ') ||
    text.startsWith('You begin ') ||
    text.includes(' begins ') ||
    text.startsWith('You died')
  )
}
