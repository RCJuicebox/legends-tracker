import { itemKey } from '../../core/inventory'
import { heldFrom, heldOf, type CountFrom } from '../../core/itemTally'
import { EPIC_LISTS, everyStep, stepName, tickKey, type EpicList, type EpicState, type EpicStep } from './core'

// What Goals › Epics draws from a character's state (core.ts): each class's steps with what is held of
// each, which are done and why (in hand, ticked off, or covered by the reward above them or the
// finished epic), how much of each item the classes shown still want between them, and the other
// tabs' lists: where to hunt for what is missing (Targets) and every item (Items). A spell quest is a
// list like a class's epic, its scroll what finishes it.

export type { CountFrom }

/** How many of an item a character holds, counted from where the player chose. */
export function held(s: Pick<EpicState, 'logged' | 'adjust' | 'exported'>, name: string, from: CountFrom): number {
  return heldFrom(heldOf(s, name), s.exported ? (s.exported.counts[itemKey(name)] ?? 0) : null, from)
}

/** A step as the page shows it. */
export interface StepView {
  step: EpicStep
  /** Its list's key: what its tick is kept under. */
  list: string
  cls: string
  name: string
  depth: number
  /** Held of its item; 0 for a quest with no reward named. */
  have: number
  /** What the classes shown still want of its item between them, this step's share in: 0 once nothing does. */
  need: number
  /** More than this step takes is wanted: another step, or another class, takes it too. */
  shared: boolean
  ticked: boolean
  /** Enough is held for every step that wants it. */
  enough: boolean
  /** Why it is done by something above it: "Darkforge Breastplate in hand", "Innoruuk's Curse in hand". Null when nothing above covers it. */
  covered: string | null
  /** Ticked, enough held, or covered. */
  done: boolean
  parts: StepView[]
}

/** A list (a class's epic, or a spell quest) as the page shows it. */
export interface ClassView {
  key: string
  kind: EpicList['kind']
  cls: string
  /** A spell quest's spell. */
  spell?: EpicList['spell']
  epic: string[]
  /** The finished epic (or the spell's scroll) in hand, by name; null when not (or none is known). */
  finished: string | null
  steps: StepView[]
  /** The pieces to gather (the steps with nothing under them), and how many are done. */
  pieces: number
  done: number
  /** The share done, 0 to 1. */
  near: number
}

type Counts = Pick<EpicState, 'logged' | 'adjust' | 'exported' | 'ticks'>

/** What a list is called where several are listed: an epic by its class, a spell quest by its spell ("Tashania (Enchanter)"). */
export const listName = (c: Pick<EpicList, 'cls' | 'spell'>): string => (c.spell ? `${c.spell.name} (${c.cls})` : c.cls)

/**
 * The lists given (classes' epics, spell quests), each step with what is held and what the classes still want. A step is its own
 * once ticked or its item held as many as it takes; a step under one that is covers nothing more,
 * nor does any step of a class whose finished epic is in hand. What is wanted of an item is every
 * step not covered or ticked, across the classes given, so one Shining Metallic Robes is half of what
 * an Enchanter and a Rogue want.
 */
export function classViews(classes: readonly EpicList[], s: Counts, from: CountFrom): ClassView[] {
  const have = (name: string) => held(s, name, from)
  // What every class wants of each item, by item key: the steps that nothing covers.
  const wanted = new Map<string, number>()
  const wanting = new Map<string, number>()
  const first = classes.map((c) => {
    const finished = c.epic.find((e) => have(e) > 0) ?? null
    const view = (step: EpicStep, depth: number, covered: string | null): StepView => {
      const ticked = s.ticks.includes(tickKey(c.key, step))
      const h = step.item ? have(step.item) : 0
      const own = ticked || (!!step.item && h >= step.qty)
      if (step.item && !ticked && !covered) {
        const k = itemKey(step.item)
        wanted.set(k, (wanted.get(k) ?? 0) + step.qty)
        wanting.set(k, (wanting.get(k) ?? 0) + 1)
      }
      const below = covered ?? (own ? `${stepName(step)} ${ticked ? 'ticked off' : 'in hand'}` : null)
      return {
        step,
        list: c.key,
        cls: c.cls,
        name: stepName(step),
        depth,
        have: h,
        need: 0,
        shared: false,
        ticked,
        enough: own && !ticked,
        covered,
        done: own || !!covered,
        parts: step.parts.map((p) => view(p, depth + 1, below))
      }
    }
    const steps = c.steps.map((st) => view(st, 0, finished ? `${finished} in hand` : null))
    return { key: c.key, kind: c.kind, cls: c.cls, ...(c.spell ? { spell: c.spell } : {}), epic: c.epic, finished, steps }
  })
  // Then each step against what everything wants of its item.
  return first.map((c) => {
    const settle = (v: StepView): StepView => {
      const k = v.step.item ? itemKey(v.step.item) : ''
      const need = v.step.item && !v.ticked && !v.covered ? (wanted.get(k) ?? 0) : 0
      const enough = need > 0 ? v.have >= need : v.enough
      const done = v.ticked || !!v.covered || enough
      const shared = need > v.step.qty && (wanting.get(k) ?? 0) > 1
      const parts = v.parts.map((p) => settle(done && !p.covered ? { ...p, covered: p.covered ?? `${v.name} in hand` } : p))
      return { ...v, need, shared, enough, done, parts }
    }
    const steps = c.steps.map(settle)
    const leaves = (vs: StepView[]): StepView[] => vs.flatMap((v) => (v.parts.length ? leaves(v.parts) : [v]))
    const pieces = leaves(steps)
    const done = pieces.filter((p) => p.done).length
    return { ...c, steps, pieces: pieces.length, done, near: pieces.length ? done / pieces.length : 1 }
  })
}

/** Every step of a class view, depth first. */
export const everyView = (views: readonly StepView[]): StepView[] => views.flatMap((v) => [v, ...everyView(v.parts)])

// ---- The filter ----

/** What narrows the Checklist. */
export interface EpicFilter {
  /** 'all', 'mine' (the character's classes) or a class. */
  cls: string
  text: string
  /** Hide the steps that are done. */
  hideDone: boolean
}

export const NO_FILTER: EpicFilter = { cls: 'mine', text: '', hideDone: false }

/** The lists of a kind (epics, or spell quests) of the classes the filter picks: the character's, or every class when it has none. */
export function pickClasses(f: Pick<EpicFilter, 'cls'>, mine: readonly string[], kind: EpicList['kind'] = 'epic'): EpicList[] {
  const lists = EPIC_LISTS.filter((c) => c.kind === kind)
  if (f.cls === 'all' || (f.cls === 'mine' && !mine.length)) return lists
  if (f.cls === 'mine') return lists.filter((c) => mine.includes(c.cls))
  return lists.filter((c) => c.cls === f.cls)
}

/** Whether a step's name, how, zone or note holds every word typed. */
export function stepMatch(step: EpicStep, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [stepName(step), step.how, step.zone ?? '', step.note ?? ''].join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The steps that pass the filter, each with the parts of its that do; a step passes when it or one under it matches the words. */
export function filterViews(views: readonly StepView[], f: EpicFilter): StepView[] {
  return views.flatMap((v) => {
    const parts = filterViews(v.parts, f)
    const self = stepMatch(v.step, f.text) && !(f.hideDone && v.done)
    if (!self && !parts.length) return []
    return [{ ...v, parts: self && !f.text ? v.parts.filter((p) => !(f.hideDone && p.done) || filterViews([p], f).length) : parts }]
  })
}

// ---- Targets ----

/** A zone to hunt in, and what it gives that is still wanted. */
export interface Target {
  /** The zone, or "Anywhere" for what the page gives no zone. */
  zone: string
  rows: { name: string; how: string; have: number; need: number; classes: string[]; unverified: boolean; note?: string }[]
}

export const ANYWHERE = 'Anywhere'

/** Where to hunt for what the lists shown are missing: each piece not done, under its zone, with every list that wants it. Zones with most to do first. */
export function targets(views: readonly ClassView[]): Target[] {
  const rows = new Map<string, Target['rows'][number] & { zone: string }>()
  for (const c of views)
    for (const v of everyView(c.steps)) {
      if (v.done || !v.step.item || v.parts.length) continue
      const key = `${v.step.zone ?? ''}|${itemKey(v.step.item)}`
      const r = rows.get(key) ?? {
        zone: v.step.zone ?? ANYWHERE,
        name: v.name,
        how: v.step.how,
        have: v.have,
        need: v.need,
        classes: [],
        unverified: !!v.step.unverified,
        ...(v.step.note ? { note: v.step.note } : {})
      }
      if (!r.classes.includes(listName(c))) r.classes.push(listName(c))
      rows.set(key, r)
    }
  const by = new Map<string, Target>()
  for (const { zone, ...r } of rows.values()) {
    const t = by.get(zone) ?? { zone, rows: [] }
    t.rows.push(r)
    by.set(zone, t)
  }
  for (const t of by.values()) t.rows.sort((a, b) => a.name.localeCompare(b.name))
  return [...by.values()].sort((a, b) => Number(a.zone === ANYWHERE) - Number(b.zone === ANYWHERE) || b.rows.length - a.rows.length || a.zone.localeCompare(b.zone))
}

// ---- Items ----

/** An item any list's steps take, where it comes from and who takes it. */
export interface ItemRow {
  name: string
  /** Where it comes from, as the first step that takes it says. */
  how: string
  zone?: string
  /** The lists that take it, as listName names them. */
  classes: string[]
  /** A piece, or what finishes a list: a class's epic or a spell quest's scroll. */
  kind: 'piece' | 'epic' | 'spell'
}

/** Every item the steps take, and every finished epic and spell, each once, by name: the pieces first. */
export function itemRows(): ItemRow[] {
  const by = new Map<string, ItemRow>()
  const add = (name: string, row: () => ItemRow, list: string) => {
    const r = by.get(itemKey(name)) ?? row()
    if (!r.classes.includes(list)) r.classes.push(list)
    by.set(itemKey(name), r)
  }
  for (const c of EPIC_LISTS) {
    // The spell's scroll is the top step of its list, and what finishes it.
    for (const e of c.epic) add(e, () => ({ name: e, how: c.kind === 'spell' ? 'The spell’s scroll' : 'The finished epic', classes: [], kind: c.kind }), listName(c))
    for (const s of everyStep(c.steps)) {
      const item = s.item
      if (item) add(item, () => ({ name: item, how: s.how, ...(s.zone ? { zone: s.zone } : {}), classes: [], kind: 'piece' }), listName(c))
    }
  }
  const order = { piece: 0, spell: 1, epic: 2 }
  return [...by.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}
