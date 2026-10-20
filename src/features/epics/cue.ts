import { itemKey } from '../../core/inventory'
import { DIED, SLAIN_BY, SLAIN_BY_YOU } from '../../core/phrases'
import { EPIC_LISTS, everyStep, type EpicState } from './core'
import { classViews, type StepView } from './views'

// Goals › Epics' live cue (an optional module): the moment the character loots a piece, or a named that
// drops one dies, that a class on its record still wants (SEQO shows the same toast), the Live page's
// feed and the alert overlay say so: "Ghoulbane dropped: Shadow Knight epic, for the Corrupted
// Ghoulbane". Still wanted is what the Checklist says: a step not done (not ticked, not covered by a
// reward or the finished epic in hand, and not held as many as every class shown wants between them),
// the counts taken as the page takes them by default, the higher of the log's and the export's. A
// spell quest's pieces are cued the same: "Crystalline Orb dropped: Shadow Knight's Life Leech quest,
// for the Faceted Hyacinth Telesm".

/** A class that still wants a piece, and what for. */
export interface WantedBy {
  cls: string
  /** The spell, when it is a spell quest that wants it, not the class's epic. */
  spell?: string
  /** The reward the piece makes, or the quest it is for; at the top of a class's list, the finished epic. Null when none is named. */
  forWhat: string | null
  /** Whether `forWhat` is the finished epic (named as is), not a reward or quest (named "the …"). */
  epic: boolean
}

type Counts = Pick<EpicState, 'logged' | 'adjust' | 'exported' | 'ticks' | 'classes'>

/** The counts as they were before a copy the log has just seen came in: the log's count less it, when the log already counts it. */
export function beforeCopy<T extends Pick<EpicState, 'logged' | 'last'>>(s: T, item: string, count: number, at: number): T {
  const k = itemKey(item)
  if ((s.last[k] ?? 0) < at) return s
  return { ...s, logged: { ...s.logged, [k]: Math.max(0, (s.logged[k] ?? 0) - count) } }
}

/** Every list (a class's epic, or a spell quest) of the character's classes that still wants an item, each once, its main class first. */
export function wantedBy(s: Counts, item: string): WantedBy[] {
  const k = itemKey(item)
  const classes = EPIC_LISTS.filter((c) => s.classes.includes(c.cls)).sort((a, b) => s.classes.indexOf(a.cls) - s.classes.indexOf(b.cls))
  const out: WantedBy[] = []
  for (const c of classViews(classes, s, 'both')) {
    const spell = c.spell ? { spell: c.spell.name } : {}
    const find = (views: readonly StepView[], above: StepView | null): WantedBy | null => {
      for (const v of views) {
        if (v.step.item && itemKey(v.step.item) === k && !v.done)
          return above ? { cls: c.cls, ...spell, forWhat: above.name, epic: false } : { cls: c.cls, ...spell, forWhat: c.epic[0] ?? null, epic: true }
        const below = find(v.parts, v)
        if (below) return below
      }
      return null
    }
    const w = find(c.steps, null)
    if (w) out.push(w)
  }
  return out
}

/**
 * Who wants it, as the cue says: "Shadow Knight epic, for the Corrupted Ghoulbane; Paladin epic, for
 * the Fiery Avenger"; a spell quest by its spell, "Ranger's Call of Flame quest, for the Poacher's Head"
 * (its scroll, at the top, goes unsaid).
 */
const forText = (wanted: readonly WantedBy[]): string =>
  wanted
    .map((w) =>
      w.spell
        ? `${w.cls}’s ${w.spell} quest${w.forWhat && !w.epic ? `, for the ${w.forWhat}` : ''}`
        : `${w.cls} epic${w.forWhat ? `, for ${w.epic ? '' : 'the '}${w.forWhat}` : ''}`
    )
    .join('; ')

/** The cue for a piece looted that is still wanted; null when nothing wants it. */
export function lootCue(item: string, wanted: readonly WantedBy[]): string | null {
  return wanted.length ? `${item} dropped: ${forText(wanted)}` : null
}

/** The cue for a named slain that drops pieces still wanted ("Lady Vox slain, drops …: …"); null when it drops none. */
export function killCue(mob: string, pieces: readonly { item: string; wanted: readonly WantedBy[] }[]): string | null {
  const wanted = pieces.filter((p) => p.wanted.length)
  return wanted.length ? `${mob} slain, drops ${wanted.map((p) => `${p.item}: ${forText(p.wanted)}`).join(' · ')}` : null
}

// ---- Named that drop pieces ----

/** A mob's name as the death lines and the checklist are matched on: lower case, no leading "the". */
const mobKey = (name: string): string => name.trim().toLowerCase().replace(/^the /, '')

/**
 * The named a step's "how" says to kill ("Kill Lady Vox (raid)", "Kill Dread, Fright, or Terror
 * (raid)"): the mobs it names that are one of a kind. A common mob ("a skunk", "any snake", "Kill
 * clockwork") is left out: each one's death would cue and only some drop it; its loot cues instead.
 */
export function namedKills(how: string): string[] {
  if (!/^kill /i.test(how)) return []
  return how
    .slice(5)
    .replace(/\([^)]*\)/g, '')
    .split(/\s*\/\s*|\s*,\s*|\s+or\s+/i)
    .map((n) =>
      n
        .replace(/^or\s+/i, '')
        .replace(/\+$/, '')
        .trim()
    )
    .filter((n) => /^[A-Z]/.test(n) && !/^(?:a|an|any|various|some|\d+x)\b/i.test(n) && !/[[\]]/.test(n))
}

/** The pieces each named drops, by mob key: an item once a mob. */
const DROPS: ReadonlyMap<string, readonly string[]> = (() => {
  const by = new Map<string, string[]>()
  for (const c of EPIC_LISTS)
    for (const s of everyStep(c.steps)) {
      const item = s.item
      if (!item) continue
      for (const mob of namedKills(s.how)) {
        const items = by.get(mobKey(mob)) ?? []
        if (!items.some((i) => itemKey(i) === itemKey(item))) items.push(item)
        by.set(mobKey(mob), items)
      }
    }
  return by
})()

/** The mob a death line names ("You have slain Lady Vox!", "Lady Vox has been slain by Kelwyn!", "Lady Vox died."); null for any other line. */
export function slainMob(text: string): string | null {
  const m =
    (text.startsWith('You have slain ') ? SLAIN_BY_YOU.exec(text) : null) ??
    (text.includes(' has been slain by ') ? SLAIN_BY.exec(text) : null) ??
    (text.endsWith(' died.') ? DIED.exec(text) : null)
  return m ? m[1] : null
}

/** The pieces a named drops, as the checklist names them; none for a mob it does not name. */
export const dropsOf = (mob: string): readonly string[] => DROPS.get(mobKey(mob)) ?? []
