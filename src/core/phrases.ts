// Game lines more than one reader needs, matched one way. A wording change in a patch is then a
// one-line fix here, and the tests over these patterns cover every reader at once. Patterns match a
// line's text, after the timestamp.

/** "You begin casting Envenomed Bolt X." or "You begin singing …": the spell. */
export const CAST_BY_YOU = /^You begin (?:casting|singing) (.+)\.$/
/** "Aldric begins casting Ice Spear.": caster, spell. */
export const CAST_BY_OTHER = /^(.+?) begins (?:casting|singing) (.+)\.$/

/** "You have slain a fetid fiend!": the victim. */
export const SLAIN_BY_YOU = /^You have slain (.+)!$/
/** "A skeleton has been slain by Aldric!": victim, killer. */
export const SLAIN_BY = /^(.+) has been slain by (.+)!$/
/** "A fetid fiend died.": the victim, killer unnamed. */
export const DIED = /^(.+) died\.$/
/** "You died." */
export const YOU_DIED = /^You died\.$/
/** "You have been slain by a fetid fiend!": the killer. */
export const YOU_WERE_SLAIN = /^You have been slain by (.+)!$/

/**
 * "Jobarab told you, 'Attacking a fetid fiend Master.'": the pet, and what it goes for. Only a pet of
 * yours says it; a charmed mob's name is its own, several words ("a gnoll").
 */
export const PET_ATTACKING = /^(.+?) told you, 'Attacking (.+) Master\.'$/

/** Kills no further apart than this are one run of killing, the time between them time spent killing there: Slayer's pace and the faction plan's outings. */
export const KILL_RUN_MS = 10 * 60_000

/** "You have completed achievement: Bear With Me": the achievement. */
/** "a ratman warrior resisted your Envenomed Bolt X!": your spell (or a proc of yours) resisted outright. */
export const RESISTED_YOUR = /^(.+?) resisted your (.+)!$/

/** "You gain experience!", "You gain party experience!", and since 2026-09-28 sometimes "(0.013%)" after it. */
export const EXPERIENCE = /^You gain (?:party )?experience!(?: \(([\d.]+)%\))?$/

export const COMPLETED_ACHIEVEMENT = /^You have completed achievement: (.+?)\.?$/
/** How far apart an export's file time and its "Outputfile Complete" line may be, and how far before an export a read of what came after it starts. */
export const EXPORT_SLACK_MS = 3000
