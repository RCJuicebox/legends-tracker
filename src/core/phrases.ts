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
